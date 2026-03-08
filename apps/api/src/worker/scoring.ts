import fs from "node:fs/promises";
import path from "node:path";
import {
  getSubmissionLimitViolation,
  loadConfig,
  lookupPreset,
  resolveEvalSpec,
  resolveSubmissionLimits,
  SUBMISSION_RESULT_FORMAT,
  type RunnerLimits,
  validatePresetIntegrity,
} from "@agora/common";
import {
  countSubmissionsBySolverForChallengeUpToOnChainSubId,
  countSubmissionsForChallengeUpToOnChainSubId,
  type createSupabaseClient,
} from "@agora/db";
import { pinFile } from "@agora/ipfs";
import {
  buildProofBundle,
  executeScoringPipeline,
  SealedSubmissionError,
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
  source: "runner_preset_id" | "default";
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

export function resolveRunnerPolicyForChallenge(
  challenge: {
    image: string;
    runner_preset_id: string;
  },
): ResolvedRunnerPolicy {
  const presetId = challenge.runner_preset_id.trim();

  if (presetId === "custom") {
    const customIntegrityError = validatePresetIntegrity(
      "custom",
      challenge.image,
    );
    if (customIntegrityError) {
      throw new Error(
        `Invalid scoring preset configuration: ${customIntegrityError}`,
      );
    }
    return { source: "default" };
  }

  const preset = lookupPreset(presetId);
  if (!preset) {
    throw new Error(`Unknown runner_preset_id on challenge: ${presetId}`);
  }
  const integrityError = validatePresetIntegrity(presetId, challenge.image);
  if (integrityError) {
    throw new Error(`Invalid scoring preset configuration: ${integrityError}`);
  }
  return policyFromLimits(preset.runnerLimits, "runner_preset_id");
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

  const evalPlan = resolveEvalSpec(challenge);
  const runnerPolicy = resolveRunnerPolicyForChallenge({
    image: evalPlan.image,
    runner_preset_id: challenge.runner_preset_id,
  });
  const phaseMeta = {
    jobId,
    submissionId: submission.id,
    challengeId: challenge.id,
    image: evalPlan.image,
  };
  const isProduction = process.env.NODE_ENV === "production";
  let submissionSource;
  try {
    submissionSource = await resolveSubmissionSource({
      resultCid: submission.result_cid as string,
      resultFormat: submission.result_format,
      challengeId: challenge.id,
      solverAddress: submission.solver_address,
      privateKeyPem: loadConfig().AGORA_SUBMISSION_OPEN_PRIVATE_KEY_PEM,
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
    evaluationBundle: evalPlan.evaluationBundleCid
      ? { cid: evalPlan.evaluationBundleCid }
      : undefined,
    submission: submissionSource,
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
          submission.result_format === SUBMISSION_RESULT_FORMAT.sealedV1
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
        const proofCid = await pinFile(proofPath, `proof-${submission.id}.json`);
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
