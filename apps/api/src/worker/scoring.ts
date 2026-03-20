import fs from "node:fs/promises";
import path from "node:path";
import {
  EXPERT_RUNTIME_FAMILY_ID,
  type RunnerLimits,
  SEMI_CUSTOM_RUNTIME_FAMILY_ID,
  SUBMISSION_RESULT_FORMAT,
  getSubmissionLimitViolation,
  isProductionRuntime,
  loadConfig,
  resolveChallengeEvaluation,
  resolveChallengeRuntimeConfig,
  resolveRuntimeFamilyLimits,
  resolveSubmissionLimits,
  resolveSubmissionOpenPrivateKeys,
  validateExpertScorerImage,
} from "@agora/common";
import {
  countSubmissionsBySolverForChallengeUpToOnChainSubId,
  countSubmissionsForChallengeUpToOnChainSubId,
  type createSupabaseClient,
} from "@agora/db";
import { pinFile } from "@agora/ipfs";
import {
  SealedSubmissionError,
  buildProofBundle,
  executeScoringPipeline,
  resolveSubmissionSource,
  scoreToWad,
} from "@agora/scorer";
import { keccak256, toBytes } from "viem";
import { createWorkerPhaseObserver, runWorkerPhase } from "./phases.js";
import type { ChallengeRow, SubmissionRow, WorkerLogFn } from "./types.js";

type DbClient = ReturnType<typeof createSupabaseClient>;

export interface ResolvedRunnerPolicy {
  limits?: {
    memory: string;
    cpus: string;
    pids: number;
  };
  timeoutMs?: number;
  source: "runtime_family" | "default";
}

function policyFromLimits(
  runnerLimits: RunnerLimits,
  source: ResolvedRunnerPolicy["source"],
): ResolvedRunnerPolicy {
  return {
    limits: {
      memory: runnerLimits.memory,
      cpus: runnerLimits.cpus,
      pids: runnerLimits.pids,
    },
    timeoutMs: runnerLimits.timeoutMs,
    source,
  };
}

export function resolveRunnerPolicyForChallenge(challenge: {
  image: string;
  runtime_family: string;
  semi_custom_runner_family?: string;
}): ResolvedRunnerPolicy {
  const runtimeFamily = challenge.runtime_family.trim();

  if (runtimeFamily === EXPERT_RUNTIME_FAMILY_ID) {
    const customIntegrityError = validateExpertScorerImage(challenge.image);
    if (customIntegrityError) {
      throw new Error(
        `Invalid runtime family configuration: ${customIntegrityError}`,
      );
    }
    return { source: "default" };
  }

  if (
    runtimeFamily === SEMI_CUSTOM_RUNTIME_FAMILY_ID &&
    challenge.semi_custom_runner_family?.trim()
  ) {
    const runnerLimits = resolveRuntimeFamilyLimits(
      challenge.semi_custom_runner_family,
    );
    if (!runnerLimits) {
      throw new Error(
        `Unknown semi-custom runner family: ${challenge.semi_custom_runner_family}`,
      );
    }
    return policyFromLimits(runnerLimits, "runtime_family");
  }

  const runnerLimits = resolveRuntimeFamilyLimits(runtimeFamily);
  if (!runnerLimits) {
    throw new Error(`Unknown runtime family on challenge: ${runtimeFamily}`);
  }
  return policyFromLimits(runnerLimits, "runtime_family");
}

export interface ScoringOutcomeSuccess {
  ok: true;
  score: number;
  scoreWad: bigint;
  proofCid: string;
  proofHash: `0x${string}`;
  proof: {
    inputHash: string;
    outputHash: string;
    containerImageDigest: string;
    replaySubmissionCid: string | null;
    scorerLog?: string;
  };
}

export interface ScoringOutcomeInvalid {
  ok: false;
  kind: "invalid" | "skipped";
  reason: string;
}

export type ScoringOutcome = ScoringOutcomeSuccess | ScoringOutcomeInvalid;

async function getSubmissionLimitViolationForRun(
  db: DbClient,
  challenge: ChallengeRow,
  submission: SubmissionRow,
) {
  const limits = resolveSubmissionLimits({
    max_submissions_total: challenge.max_submissions_total,
    max_submissions_per_solver: challenge.max_submissions_per_solver,
  });
  const [totalSubmissions, solverSubmissions] = await Promise.all([
    countSubmissionsForChallengeUpToOnChainSubId(
      db,
      challenge.id,
      submission.on_chain_sub_id,
    ),
    countSubmissionsBySolverForChallengeUpToOnChainSubId(
      db,
      challenge.id,
      submission.solver_address,
      submission.on_chain_sub_id,
    ),
  ]);

  return getSubmissionLimitViolation({
    totalSubmissions,
    solverSubmissions,
    limits,
  });
}

export async function scoreSubmissionAndBuildProof(
  db: DbClient,
  challenge: ChallengeRow,
  submission: SubmissionRow,
  log: WorkerLogFn,
  jobId?: string,
): Promise<ScoringOutcome> {
  const submissionLimitViolation = await getSubmissionLimitViolationForRun(
    db,
    challenge,
    submission,
  );
  if (submissionLimitViolation) {
    return {
      ok: false,
      kind: "skipped",
      reason: submissionLimitViolation,
    };
  }

  const evalPlan = resolveChallengeEvaluation(challenge);
  const runnerPolicy = resolveRunnerPolicyForChallenge({
    image: evalPlan.image,
    runtime_family: challenge.runtime_family,
    semi_custom_runner_family:
      evalPlan.semiCustomExecution?.runner_runtime_family,
  });
  const phaseMeta = {
    jobId,
    submissionId: submission.id,
    challengeId: challenge.id,
    image: evalPlan.image,
  };
  const config = loadConfig();
  const isProduction = isProductionRuntime(config);
  const cachedRuntimeConfig = resolveChallengeRuntimeConfig(challenge);
  let submissionSource: Awaited<ReturnType<typeof resolveSubmissionSource>>;
  try {
    submissionSource = await resolveSubmissionSource({
      resultCid: submission.result_cid as string,
      resultFormat: submission.result_format,
      challengeId: challenge.id,
      solverAddress: submission.solver_address,
      privateKeyPemsByKid: resolveSubmissionOpenPrivateKeys(config),
    });
  } catch (error) {
    if (error instanceof SealedSubmissionError) {
      return {
        ok: false,
        kind: "invalid",
        reason: `sealed_submission_${error.code}: ${error.message}`,
      };
    }
    throw error;
  }
  const run = await executeScoringPipeline({
    image: evalPlan.image,
    runtimeFamily: evalPlan.runtimeFamily,
    evaluationBundle: evalPlan.evaluationBundleCid
      ? { cid: evalPlan.evaluationBundleCid }
      : undefined,
    mount: evalPlan.mount,
    submission: submissionSource,
    submissionContract: cachedRuntimeConfig.submissionContract,
    evaluationContract: cachedRuntimeConfig.evaluationContract,
    metric: evalPlan.metric,
    policies: cachedRuntimeConfig.policies,
    env: cachedRuntimeConfig.env,
    timeoutMs: runnerPolicy.timeoutMs,
    limits: runnerPolicy.limits,
    strictPull: isProduction,
    keepWorkspace: true,
    phaseObserver: createWorkerPhaseObserver(log, phaseMeta),
  });
  try {
    const result = run.result;

    if (!result.ok) {
      return {
        ok: false,
        kind: "invalid",
        reason:
          result.error ?? "Scorer rejected submission (invalid format or data)",
      };
    }

    log(
      "info",
      `Scored submission ${submission.id} for challenge ${challenge.id} with score ${result.score}`,
      {
        submissionId: submission.id,
        challengeId: challenge.id,
        score: result.score,
      },
    );

    const { proof, proofCid } = await runWorkerPhase(
      log,
      "pin_proof",
      phaseMeta,
      async () => {
        const replaySubmissionCid =
          submission.result_format ===
          SUBMISSION_RESULT_FORMAT.sealedSubmissionV2
            ? await pinFile(
                run.submissionPath,
                `submission-input-${submission.id}.bin`,
              )
            : (submission.result_cid ?? null);
        const baseProof = await buildProofBundle({
          challengeId: challenge.id,
          submissionId: submission.id,
          score: result.score,
          scorerLog: null,
          containerImageDigest: result.containerImageDigest,
          inputPaths: run.inputPaths,
          outputPath: result.outputPath,
        });
        const proof = {
          ...baseProof,
          challengeSpecCid:
            (challenge as { spec_cid?: string | null }).spec_cid ?? null,
          evaluationBundleCid: evalPlan.evaluationBundleCid ?? null,
          replaySubmissionCid,
        };

        const proofPath = path.join(run.workspaceRoot, "proof-bundle.json");
        await fs.writeFile(proofPath, JSON.stringify(proof, null, 2), "utf8");
        const proofCid = await pinFile(
          proofPath,
          `proof-${submission.id}.json`,
        );
        log("info", "Proof pinned", {
          ...phaseMeta,
          proofCid,
        });
        return { proof, proofCid };
      },
    );

    const proofHash = keccak256(toBytes(proofCid.replace("ipfs://", "")));
    const scoreWad = scoreToWad(result.score);

    return {
      ok: true,
      score: result.score,
      scoreWad,
      proofCid,
      proofHash,
      proof: {
        inputHash: proof.inputHash,
        outputHash: proof.outputHash,
        containerImageDigest: proof.containerImageDigest,
        replaySubmissionCid: proof.replaySubmissionCid ?? null,
        scorerLog: proof.scorerLog,
      },
    };
  } finally {
    await run.cleanup();
  }
}
