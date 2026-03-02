/**
 * Automated scoring worker.
 *
 * Polls the score_jobs table for queued jobs, runs the Docker scorer,
 * posts scores on-chain, and updates the database.
 *
 * Run: node --import tsx apps/api/src/worker.ts
 * Or:  pnpm --filter @hermes/api worker
 *
 * Required env vars: everything the API needs, plus HERMES_ORACLE_KEY.
 */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { loadConfig } from "@hermes/common";
import { getOnChainSubmission, getPublicClient, postScore, finalizeChallenge } from "@hermes/chain";
import HermesChallengeAbiJson from "@hermes/common/abi/HermesChallenge.json" with { type: "json" };
import {
    createSupabaseClient,
    getChallengeById,
    getSubmissionById,
    claimNextJob,
    clearJobPostedTx,
    completeJob,
    failJob,
    markJobPosted,
    requeueJobWithoutAttemptPenalty,
    updateScore,
    upsertProofBundle,
} from "@hermes/db";
import { pinFile } from "@hermes/ipfs";
import {
    runScorer,
    buildProofBundle,
    ensureDockerReady,
    createScoringWorkspace,
    stageGroundTruth,
    stageSubmissionFromCid,
    scoreToWad,
    cleanupWorkspace,
} from "@hermes/scorer";
import { keccak256, toBytes, type Abi } from "viem";

const HermesChallengeAbi = HermesChallengeAbiJson as unknown as Abi;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = Number(process.env.HERMES_WORKER_POLL_MS ?? 15_000);
const FINALIZE_SWEEP_INTERVAL_MS = Number(process.env.HERMES_WORKER_FINALIZE_SWEEP_MS ?? 60_000);
const WORKER_ID = `worker-${crypto.randomBytes(4).toString("hex")}`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function log(level: "info" | "warn" | "error", message: string, meta?: Record<string, unknown>) {
    const ts = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
    console[level](`[${ts}] [${WORKER_ID}] ${message}${metaStr}`);
}

// ---------------------------------------------------------------------------
// Types (minimal, from DB rows)
// ---------------------------------------------------------------------------

interface ChallengeRow {
    id: string;
    contract_address: string;
    scoring_container: string;
    dataset_test_cid: string | null;
}

interface SubmissionRow {
    id: string;
    challenge_id: string;
    on_chain_sub_id: number;
    result_cid: string | null;
    proof_bundle_cid?: string | null;
}

interface ScoreJobRow {
    id: string;
    submission_id: string;
    challenge_id: string;
    attempts: number;
    max_attempts: number;
    score_tx_hash: string | null;
}

async function reconcileScoredSubmission(
    db: ReturnType<typeof createSupabaseClient>,
    submission: SubmissionRow,
    challengeAddress: `0x${string}`,
    scoreTxHash: string | null,
    jobId: string,
) {
    const onChain = await getOnChainSubmission(
        challengeAddress,
        BigInt(submission.on_chain_sub_id),
    );
    if (!onChain.scored) return false;

    await updateScore(db, {
        submission_id: submission.id,
        score: onChain.score.toString(),
        proof_bundle_cid: submission.proof_bundle_cid ?? "",
        proof_bundle_hash: onChain.proofBundleHash,
        scored_at: new Date().toISOString(),
    });
    await completeJob(db, jobId, scoreTxHash ?? undefined);
    return true;
}

async function processJob(
    db: ReturnType<typeof createSupabaseClient>,
    job: ScoreJobRow,
) {
    let workspaceRoot: string | null = null;

    try {
        // 1. Load challenge and submission
        const challenge = (await getChallengeById(db, job.challenge_id)) as ChallengeRow;
        const submission = (await getSubmissionById(db, job.submission_id)) as SubmissionRow;
        const challengeAddress = challenge.contract_address as `0x${string}`;
        const publicClient = getPublicClient();

        // Idempotency: if already scored on-chain, reconcile DB and finish.
        if (await reconcileScoredSubmission(db, submission, challengeAddress, job.score_tx_hash, job.id)) {
            log("info", "Submission already scored on-chain; reconciled and completed job", {
                jobId: job.id,
                submissionId: submission.id,
            });
            return;
        }

        // If we already posted a tx, don't repost blindly. Check receipt first.
        if (job.score_tx_hash) {
            try {
                const postedReceipt = await publicClient.getTransactionReceipt({
                    hash: job.score_tx_hash as `0x${string}`,
                });
                if (postedReceipt.status === "success") {
                    if (await reconcileScoredSubmission(db, submission, challengeAddress, job.score_tx_hash, job.id)) {
                        log("info", "Posted tx succeeded; reconciled and completed job", {
                            jobId: job.id,
                            submissionId: submission.id,
                            txHash: job.score_tx_hash,
                        });
                        return;
                    }
                    const reason = "Score tx mined but submission is not marked scored on-chain yet.";
                    await requeueJobWithoutAttemptPenalty(db, job.id, job.attempts, reason);
                    log("warn", reason, {
                        jobId: job.id,
                        submissionId: submission.id,
                        txHash: job.score_tx_hash,
                    });
                    return;
                }

                // Reverted tx: clear and continue with a fresh scoring attempt.
                await clearJobPostedTx(db, job.id);
                log("warn", "Posted tx reverted; cleared score_tx_hash and retrying scoring", {
                    jobId: job.id,
                    submissionId: submission.id,
                    txHash: job.score_tx_hash,
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (/not found|could not be found|missing or invalid|unknown transaction/i.test(message)) {
                    const reason = `Score tx pending confirmation: ${job.score_tx_hash}`;
                    await requeueJobWithoutAttemptPenalty(db, job.id, job.attempts, reason);
                    log("info", reason, {
                        jobId: job.id,
                        submissionId: submission.id,
                    });
                    return;
                }
                throw error;
            }
        }

        // 2. Check for missing result_cid (on-chain-only submissions)
        if (!submission.result_cid) {
            log("warn", "Submission missing result_cid — cannot score (on-chain-only submission)", {
                submissionId: submission.id,
                challengeId: challenge.id,
            });
            await failJob(
                db,
                job.id,
                "missing_result_cid_onchain_submission",
                job.max_attempts,
                job.max_attempts,
            );
            return;
        }

        // 3. Prepare scoring workspace
        log("info", "Preparing scoring inputs", { submissionId: submission.id, challengeId: challenge.id });
        const workspace = await createScoringWorkspace();
        workspaceRoot = workspace.root;

        const inputPaths: string[] = [];

        // Ground truth is optional — not all bounty types have datasets
        if (challenge.dataset_test_cid) {
            const groundTruthPath = await stageGroundTruth(
                workspace.inputDir,
                challenge.dataset_test_cid,
            );
            inputPaths.push(groundTruthPath);
        }

        const submissionPath = await stageSubmissionFromCid(
            workspace.inputDir,
            submission.result_cid,
        );
        inputPaths.push(submissionPath);

        // 4. Run scorer container
        log("info", "Running scorer container", {
            submissionId: submission.id,
            image: challenge.scoring_container,
        });
        const result = await runScorer({
            image: challenge.scoring_container,
            inputDir: workspace.inputDir,
        });
        // Check if the submission was valid
        if (!result.ok) {
            const reason = result.error ?? "Scorer rejected submission (invalid format or data)";
            log("warn", `Submission invalid — not posting score on-chain`, {
                submissionId: submission.id,
                challengeId: challenge.id,
                error: reason,
            });
            await failJob(
                db,
                job.id,
                `invalid_submission: ${reason}`,
                job.max_attempts,
                job.max_attempts,
            );
            return;
        }

        log("info", `Scored submission ${submission.id} for challenge ${challenge.id} with score ${result.score}`, {
            submissionId: submission.id,
            challengeId: challenge.id,
            score: result.score,
        });

        // 5. Build and pin proof bundle
        const proof = await buildProofBundle({
            challengeId: challenge.id,
            submissionId: submission.id,
            score: result.score,
            scorerLog: result.log,
            containerImageDigest: result.containerImageDigest,
            inputPaths,
            outputPath: result.outputPath,
        });

        const proofPath = path.join(workspace.root, "proof-bundle.json");
        await fs.writeFile(proofPath, JSON.stringify(proof, null, 2), "utf8");

        const proofCid = await pinFile(proofPath, `proof-${submission.id}.json`);
        log("info", "Proof pinned", { submissionId: submission.id, proofCid });

        // 7. Post score on-chain
        const proofHash = keccak256(toBytes(proofCid.replace("ipfs://", "")));
        const scoreWad = scoreToWad(result.score);

        log("info", "Posting score on-chain", { submissionId: submission.id, scoreWad: scoreWad.toString() });
        const txHash = await postScore(
            challengeAddress,
            BigInt(submission.on_chain_sub_id),
            scoreWad,
            proofHash,
        );
        // Persist tx hash immediately so retries become reconcile-only, even if the worker crashes.
        await markJobPosted(db, job.id, txHash);
        log("info", "Score tx submitted", { submissionId: submission.id, txHash });

        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
        if (receipt.status !== "success") {
            throw new Error(`Score transaction reverted: ${txHash}`);
        }
        log("info", "Score tx confirmed on-chain", { submissionId: submission.id, txHash });

        // 8. Update DB
        await upsertProofBundle(db, {
            submission_id: submission.id,
            cid: proofCid,
            input_hash: proof.inputHash,
            output_hash: proof.outputHash,
            container_image_hash: proof.containerImageDigest,
            scorer_log: proof.scorerLog,
            reproducible: true,
        });

        await updateScore(db, {
            submission_id: submission.id,
            score: scoreWad.toString(),
            proof_bundle_cid: proofCid,
            proof_bundle_hash: proofHash,
            scored_at: new Date().toISOString(),
        });

        // 9. Mark job complete
        await completeJob(db, job.id, txHash);
        log("info", `✓ Job complete for submission ${submission.id}`, { txHash, score: result.score });

    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const isDockerError = /docker is required|docker.*not running|docker info failed/i.test(message);

        if (isDockerError) {
            // Infra failure — don't burn attempts. Requeue and pause.
            log("error", "Docker unavailable — requeuing job without penalty", {
                jobId: job.id,
                submissionId: job.submission_id,
            });
            await requeueJobWithoutAttemptPenalty(db, job.id, job.attempts, `docker_unavailable: ${message}`);
        } else {
            log("error", `Job failed for submission ${job.submission_id}`, {
                jobId: job.id,
                submissionId: job.submission_id,
                attempts: job.attempts,
                maxAttempts: job.max_attempts,
                error: message,
            });
            await failJob(db, job.id, message, job.attempts, job.max_attempts);
        }
    } finally {
        if (workspaceRoot) {
            await cleanupWorkspace(workspaceRoot);
        }
    }
}

// ---------------------------------------------------------------------------
// Auto-finalize sweep
// ---------------------------------------------------------------------------

async function sweepFinalizable(db: ReturnType<typeof createSupabaseClient>) {
    // Find candidate challenges that may need finalization.
    // Include both active and scoring states; scoring rows are common after deadline.
    const { data: challenges, error } = await db
        .from("challenges")
        .select("id, contract_address, status")
        .in("status", ["active", "scoring"]);

    if (error || !challenges || challenges.length === 0) return;

    const publicClient = getPublicClient();

    for (const challenge of challenges) {
        try {
            // Guard using on-chain source of truth (status + finalizable timestamp).
            const [onChainStatusRaw, onChainDeadline, onChainDisputeWindowHours] = await Promise.all([
                publicClient.readContract({
                    address: challenge.contract_address as `0x${string}`,
                    abi: HermesChallengeAbi,
                    functionName: "status",
                }),
                publicClient.readContract({
                    address: challenge.contract_address as `0x${string}`,
                    abi: HermesChallengeAbi,
                    functionName: "deadline",
                }) as Promise<bigint>,
                publicClient.readContract({
                    address: challenge.contract_address as `0x${string}`,
                    abi: HermesChallengeAbi,
                    functionName: "disputeWindowHours",
                }) as Promise<bigint>,
            ]);
            const onChainStatus = Number(onChainStatusRaw);
            if (!Number.isFinite(onChainStatus)) continue;

            // Status enum: Active=0, Scoring=1, Finalized=2, Disputed=3, Cancelled=4
            if (onChainStatus >= 2) continue; // Already finalized/disputed/cancelled

            const finalizeAfterSeconds = onChainDeadline + (onChainDisputeWindowHours * 3600n);
            const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
            if (nowSeconds <= finalizeAfterSeconds) continue; // Not yet eligible

            log("info", `Auto-finalizing challenge ${challenge.id}`, {
                challengeId: challenge.id,
                contract: challenge.contract_address,
            });

            const txHash = await finalizeChallenge(
                challenge.contract_address as `0x${string}`,
            );

            const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
            if (receipt.status === "success") {
                log("info", `Challenge finalized`, { challengeId: challenge.id, txHash });
            } else {
                log("warn", `Finalize tx reverted`, { challengeId: challenge.id, txHash });
            }
            // DB update happens via the indexer picking up the Finalized event
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            // ChallengeFinalized revert = idempotent, skip silently
            if (msg.includes("ChallengeFinalized") || msg.includes("Finalized")) {
                continue;
            }
            // Other errors: log and try again next cycle
            log("warn", `Auto-finalize failed for challenge ${challenge.id}`, {
                challengeId: challenge.id,
                error: msg,
            });
        }
    }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

async function runWorker() {
    loadConfig();

    // Ensure oracle key is set
    if (!process.env.HERMES_ORACLE_KEY && !process.env.HERMES_PRIVATE_KEY) {
        throw new Error(
            "HERMES_ORACLE_KEY or HERMES_PRIVATE_KEY is required for the scoring worker.",
        );
    }
    if (process.env.HERMES_ORACLE_KEY && !process.env.HERMES_PRIVATE_KEY) {
        process.env.HERMES_PRIVATE_KEY = process.env.HERMES_ORACLE_KEY;
    }

    // Startup health check — refuse to start without Docker
    try {
        await ensureDockerReady();
        log("info", "Docker health check passed");
    } catch {
        log("error", "Docker is not available. Worker cannot start without Docker.");
        process.exit(1);
    }

    const db = createSupabaseClient(true);

    log("info", "Scoring worker started", {
        pollIntervalMs: POLL_INTERVAL_MS,
        finalizeSweepIntervalMs: FINALIZE_SWEEP_INTERVAL_MS,
        workerId: WORKER_ID,
    });

    let lastFinalizeSweepAt = 0;
    while (true) {
        let claimedJob = false;
        try {
            // 1. Score one job if available
            const job = await claimNextJob(db, WORKER_ID);

            if (job) {
                claimedJob = true;
                log("info", `Claimed job ${job.id}`, {
                    submissionId: job.submission_id,
                    challengeId: job.challenge_id,
                    attempt: job.attempts,
                    maxAttempts: job.max_attempts,
                });

                await processJob(
                    db,
                    job as ScoreJobRow,
                );
            }

            // 2. Run finalize sweep on a fixed interval, even under sustained job load.
            const now = Date.now();
            if (now - lastFinalizeSweepAt >= FINALIZE_SWEEP_INTERVAL_MS) {
                await sweepFinalizable(db);
                lastFinalizeSweepAt = now;
            }

        } catch (error) {
            log("error", "Worker loop error", {
                error: error instanceof Error ? error.message : String(error),
            });
        }

        if (!claimedJob) {
            await sleep(POLL_INTERVAL_MS);
        }
    }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

runWorker().catch((error) => {
    log("error", "Worker failed to start", {
        error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
});
