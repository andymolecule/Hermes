import fs from "node:fs/promises";
import path from "node:path";
import {
  officialScorerTemplateIdSchema,
  type RunnerLimits,
  SUBMISSION_RESULT_FORMAT,
  getSubmissionLimitViolation,
  isProductionRuntime,
  loadConfig,
  resolveChallengeExecution,
  resolveChallengeRunnerLimits,
  resolveChallengeRuntimeConfig,
  resolveSubmissionLimits,
  resolveSubmissionOpenPrivateKeys,
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
  source: "template" | "default";
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
  template: string;
}): ResolvedRunnerPolicy {
  const templateResult = officialScorerTemplateIdSchema.safeParse(
    challenge.template,
  );
  if (!templateResult.success) {
    throw new Error(
      `Unknown official scorer template on challenge: ${challenge.template}`,
    );
  }

  const runnerLimits = resolveChallengeRunnerLimits(templateResult.data);
  if (!runnerLimits) {
    throw new Error(
      `Unknown official scorer template on challenge: ${challenge.template}`,
    );
  }
  return policyFromLimits(runnerLimits, "template");
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

  const execution = resolveChallengeExecution(challenge);
  const runnerPolicy = resolveRunnerPolicyForChallenge({
    image: execution.image,
    template: execution.template,
  });
  const phaseMeta = {
    jobId,
    submissionId: submission.id,
    challengeId: challenge.id,
    image: execution.image,
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
    image: execution.image,
    evaluationBundle: execution.evaluationBundleCid
      ? { cid: execution.evaluationBundleCid }
      : undefined,
    mount: execution.mount,
    submission: submissionSource,
    submissionContract: cachedRuntimeConfig.submissionContract,
    evaluationContract: cachedRuntimeConfig.evaluationContract,
    metric: execution.metric,
    policies: cachedRuntimeConfig.policies,
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
          evaluationBundleCid: execution.evaluationBundleCid ?? null,
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
