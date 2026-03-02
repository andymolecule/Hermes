/**
 * End-to-end test: post → submit → score → finalize → verify claimable
 * Uses the test factory with MIN_DISPUTE_WINDOW_HOURS = 0
 */
import { loadConfig } from "@hermes/common";
import { getPublicClient, getWalletClient, finalizeChallenge } from "@hermes/chain";
import { createSupabaseClient, upsertChallenge, buildChallengeInsert, createScoreJob } from "@hermes/db";
import { pinJSON, pinFile } from "@hermes/ipfs";
import HermesFactoryAbiJson from "@hermes/common/abi/HermesFactory.json" with { type: "json" };
import HermesChallengeAbiJson from "@hermes/common/abi/HermesChallenge.json" with { type: "json" };
import { type Abi, parseUnits, parseEventLogs, keccak256, toBytes } from "viem";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const HermesFactoryAbi = HermesFactoryAbiJson as unknown as Abi;
const HermesChallengeAbi = HermesChallengeAbiJson as unknown as Abi;

// E2E test factory (MIN_DISPUTE_WINDOW_HOURS = 0)
const TEST_FACTORY = "0x0461d896e8500542bdb59ae5a6c95740a912d484";

async function main() {
    const config = loadConfig();
    if (process.env.HERMES_ORACLE_KEY && !process.env.HERMES_PRIVATE_KEY) {
        process.env.HERMES_PRIVATE_KEY = process.env.HERMES_ORACLE_KEY;
    }

    const db = createSupabaseClient(true);
    const publicClient = getPublicClient();
    const walletClient = getWalletClient();
    const account = walletClient.account!;

    console.log("\n=== E2E TEST: Full Scoring → Finalize → Claim Flow ===\n");

    // ── Step 1: Pin spec and answer to IPFS ──
    console.log("1️⃣  Pinning challenge spec...");
    const spec = {
        version: "1.0",
        title: "E2E Test – Quick Arithmetic",
        description: "Answer with a number. Score = 100 - answer - 42",
        domain: "other",
        type: "deterministic",
        scoring_container: "hermes/toy-arithmetic-scorer:latest",
        scoring_metric: "exact_match",
        submission_format: "JSON with {answer: number}",
        success_definition: "answer = 42",
        distribution_type: "winner_takes_all",
    };
    const specCid = await pinJSON("e2e-test-spec.json", spec as Record<string, unknown>);
    console.log("   Spec CID:", specCid);

    // ── Step 2: Approve USDC and create challenge ──
    console.log("2️⃣  Approving USDC...");
    const usdcAddress = config.HERMES_USDC_ADDRESS as `0x${string}`;
    const rewardAmount = parseUnits("1", 6); // 1 USDC

    const usdcAbi = [
        { type: "function", name: "approve", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
    ] as const;

    await walletClient.writeContract({
        address: usdcAddress,
        abi: usdcAbi,
        functionName: "approve",
        args: [TEST_FACTORY as `0x${string}`, rewardAmount],
    });

    console.log("3️⃣  Creating challenge (3-min deadline, 0h dispute)...");
    const deadlineSeconds = BigInt(Math.floor(Date.now() / 1000) + 180); // 3 minutes from now
    const specCidClean = specCid.replace("ipfs://", "");

    const createTxHash = await walletClient.writeContract({
        address: TEST_FACTORY as `0x${string}`,
        abi: HermesFactoryAbi,
        functionName: "createChallenge",
        args: [specCidClean, rewardAmount, deadlineSeconds, 0n, 0n, 0, "0x0000000000000000000000000000000000000000"], // 0h dispute, 0 minScore, WinnerTakeAll, no labTBA
    });

    const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createTxHash });
    const logs = parseEventLogs({ abi: HermesFactoryAbi, logs: createReceipt.logs });
    const createdEvent = logs.find((l: any) => l.eventName === "ChallengeCreated") as any;
    const challengeAddress = createdEvent?.args?.challenge as `0x${string}`;
    console.log("   Challenge address:", challengeAddress);

    // Register in DB directly (skip buildChallengeInsert which expects full parsed spec)
    const chalRow = {
        chain_id: 84532,
        contract_address: challengeAddress,
        factory_challenge_id: Number(createdEvent?.args?.id ?? 0),
        poster_address: account.address,
        title: spec.title,
        description: spec.description,
        domain: spec.domain,
        challenge_type: spec.type,
        spec_cid: specCidClean,
        scoring_container: spec.scoring_container,
        scoring_metric: spec.scoring_metric,
        minimum_score: 0,
        reward_amount: 1,
        distribution_type: spec.distribution_type,
        deadline: new Date(Number(deadlineSeconds) * 1000).toISOString(),
        dispute_window_hours: 0,
        status: "active",
        tx_hash: createTxHash,
    };
    const { data: dbChallenge, error: chalError } = await db.from("challenges").insert(chalRow).select("*").single();
    if (chalError) throw new Error(`DB insert failed: ${chalError.message}`);
    console.log("   DB ID:", dbChallenge.id);

    // ── Step 3: Submit the correct answer ──
    console.log("4️⃣  Submitting answer {answer: 42}...");
    const answerJson = JSON.stringify({ answer: 42 });
    // Write to temp file and pin
    const tmpFile = path.join(os.tmpdir(), `e2e-answer-${Date.now()}.json`);
    await fs.writeFile(tmpFile, answerJson, "utf8");
    const resultCid = await pinFile(tmpFile, "e2e-result.json");
    console.log("   Result CID:", resultCid);

    const resultHash = keccak256(toBytes(resultCid.replace("ipfs://", "")));
    const submitTxHash = await walletClient.writeContract({
        address: challengeAddress,
        abi: HermesChallengeAbi,
        functionName: "submit",
        args: [resultHash],
    });
    await publicClient.waitForTransactionReceipt({ hash: submitTxHash });
    console.log("   Submitted on-chain:", submitTxHash);

    // Register submission in DB
    const { data: dbSub, error: subError } = await db.from("submissions").insert({
        challenge_id: dbChallenge.id,
        solver_address: account.address,
        on_chain_sub_id: 0,
        result_cid: resultCid.replace("ipfs://", ""),
        result_hash: resultHash,
        tx_hash: submitTxHash,
        submitted_at: new Date().toISOString(),
    }).select("id").single();
    if (subError) throw new Error(`Submission insert failed: ${subError.message}`);
    console.log("   DB submission ID:", dbSub?.id);

    // Create score job
    await createScoreJob(db, { submission_id: dbSub!.id, challenge_id: dbChallenge.id });
    console.log("   Score job created");

    // ── Step 4: Wait for deadline ──
    const deadlineMs = Number(deadlineSeconds) * 1000;
    const waitMs = deadlineMs - Date.now() + 5000; // +5s buffer
    if (waitMs > 0) {
        console.log(`\n⏳  Waiting ${Math.ceil(waitMs / 1000)}s for deadline to pass...`);
        console.log("   Meanwhile, make sure the WORKER is running to score this submission!");
        console.log("   Worker command: node --import tsx --env-file=.env apps/api/src/worker.ts\n");
        await new Promise(resolve => setTimeout(resolve, waitMs));
    }

    // ── Step 5: Check if scored ──
    console.log("5️⃣  Checking score...");
    const { data: scored } = await db.from("submissions").select("scored, score").eq("id", dbSub!.id).single();
    if (scored?.scored) {
        console.log(`   ✅ Scored: ${scored.score}`);
    } else {
        console.log("   ⚠️  Not scored yet — worker may still be processing");
        console.log("   Waiting 20s for worker to pick it up...");
        await new Promise(resolve => setTimeout(resolve, 20000));
        const { data: scored2 } = await db.from("submissions").select("scored, score").eq("id", dbSub!.id).single();
        console.log(`   Score: ${scored2?.scored ? scored2.score : "still pending"}`);
    }

    // ── Step 6: Finalize ──
    console.log("6️⃣  Finalizing challenge...");
    try {
        const finTxHash = await finalizeChallenge(challengeAddress);
        const finReceipt = await publicClient.waitForTransactionReceipt({ hash: finTxHash });
        if (finReceipt.status === "success") {
            console.log("   ✅ Finalized:", finTxHash);
        } else {
            console.log("   ❌ Finalize reverted:", finTxHash);
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("ChallengeFinalized")) {
            console.log("   ✅ Already finalized (worker beat us to it)");
        } else {
            console.log("   ❌ Finalize error:", msg.slice(0, 200));
        }
    }

    // ── Step 7: Check claimable ──
    console.log("7️⃣  Checking claimable balance...");
    const claimable = await publicClient.readContract({
        address: challengeAddress,
        abi: HermesChallengeAbi,
        functionName: "payoutByAddress",
        args: [account.address],
    }) as bigint;
    const claimableUsdc = Number(claimable) / 1e6;
    console.log(`   Claimable: ${claimableUsdc} USDC`);

    if (claimable > 0n) {
        console.log("\n🎉 SUCCESS! Full flow complete:");
        console.log("   Submit → Score → Finalize → Claimable ✅");
        console.log(`   Solver can claim ${claimableUsdc} USDC`);
    } else {
        console.log("\n⚠️  No claimable balance. Check if scoring and finalization completed.");
    }

    // Cleanup
    await fs.unlink(tmpFile).catch(() => { });
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
