import fs from "node:fs/promises";
import path from "node:path";
import {
  findPresetIdsByContainer,
  getSubmissionLimitViolation,
  lookupPreset,
  resolveEvalSpec,
  resolveSubmissionLimits,
  type RunnerLimits,
  validatePresetIntegrity,
} from "@hermes/common";
import {
  countSubmissionsBySolverForChallengeUpToOnChainSubId,
  countSubmissionsForChallengeUpToOnChainSubId,
  type createSupabaseClient,
} from "@hermes/db";
import { pinFile } from "@hermes/ipfs";
import {
  buildProofBundle,
  executeScoringPipeline,
  scoreToWad,
} from "@hermes/scorer";
import { keccak256, toBytes } from "viem";
import type { ChallengeRow, SubmissionRow, WorkerLogFn } from "./types.js";

type DbClient = ReturnType<typeof createSupabaseClient>;

export interface ResolvedRunnerPolicy {
  limits?: {
    memory: string;
    cpus: string;
    pids: number;
  };
  timeoutMs?: number;
  source: "preset_id" | "container_unique" | "default";
  warning?: string;
}

function policyFromLimits(
  runnerLimits: RunnerLimits,
  source: ResolvedRunnerPolicy["source"],
  warning?: string,
): ResolvedRunnerPolicy {
  return {
    limits: {
      memory: runnerLimits.memory,
      cpus: runnerLimits.cpus,
      pids: runnerLimits.pids,
    },
    timeoutMs: runnerLimits.timeoutMs,
    source,
    warning,
  };
}

export function resolveRunnerPolicyForChallenge(
  challenge: {
    image: string;
    scoring_preset_id?: string | null;
  },
): ResolvedRunnerPolicy {
  const presetId =
    typeof challenge.scoring_preset_id === "string"
      ? challenge.scoring_preset_id.trim()
      : "";

  if (presetId) {
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
      throw new Error(`Unknown scoring preset_id on challenge: ${presetId}`);
    }
    const integrityError = validatePresetIntegrity(
      presetId,
      challenge.image,
    );
    if (integrityError) {
      throw new Error(`Invalid scoring preset configuration: ${integrityError}`);
    }
    return policyFromLimits(preset.runnerLimits, "preset_id");
  }

  const matchedPresetIds = findPresetIdsByContainer(challenge.image);
  if (matchedPresetIds.length === 1) {
    const matchedId = matchedPresetIds[0];
    const preset = matchedId ? lookupPreset(matchedId) : undefined;
    if (preset) {
      return policyFromLimits(
        preset.runnerLimits,
        "container_unique",
        "Challenge missing scoring_preset_id; resolved preset by unique container match.",
      );
    }
  }

  if (matchedPresetIds.length > 1) {
    return {
      source: "default",
      warning: `Challenge missing scoring_preset_id and container maps to multiple presets (${matchedPresetIds.join(", ")}). Using default runner limits.`,
    };
  }

  return { source: "default" };
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
    scorerLog: string;
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

  log("info", "Preparing scoring inputs", {
    submissionId: submission.id,
    challengeId: challenge.id,
  });
  const evalPlan = resolveEvalSpec(challenge);
  const runnerPolicy = resolveRunnerPolicyForChallenge({
    image: evalPlan.image,
    scoring_preset_id: challenge.scoring_preset_id,
  });
  if (runnerPolicy.warning) {
    log("warn", runnerPolicy.warning, {
      challengeId: challenge.id,
      submissionId: submission.id,
      image: evalPlan.image,
    });
  }

  log("info", "Running scorer container", {
    submissionId: submission.id,
    image: evalPlan.image,
  });
  const isProduction = process.env.NODE_ENV === "production";
  const run = await executeScoringPipeline({
    image: evalPlan.image,
    evaluationBundle: evalPlan.evaluationBundleCid
      ? { cid: evalPlan.evaluationBundleCid }
      : undefined,
    submission: { cid: submission.result_cid as string },
    timeoutMs: runnerPolicy.timeoutMs,
    limits: runnerPolicy.limits,
    strictPull: isProduction,
    keepWorkspace: true,
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

    const proof = await buildProofBundle({
      challengeId: challenge.id,
      submissionId: submission.id,
      score: result.score,
      scorerLog: result.log,
      containerImageDigest: result.containerImageDigest,
      inputPaths: run.inputPaths,
      outputPath: result.outputPath,
    });

    const proofPath = path.join(run.workspaceRoot, "proof-bundle.json");
    await fs.writeFile(proofPath, JSON.stringify(proof, null, 2), "utf8");

    const proofCid = await pinFile(proofPath, `proof-${submission.id}.json`);
    log("info", "Proof pinned", { submissionId: submission.id, proofCid });

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
        scorerLog: proof.scorerLog,
      },
    };
  } finally {
    await run.cleanup();
  }
}
