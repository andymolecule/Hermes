import {
  CHALLENGE_STATUS,
  type ChallengeSpecOutput,
  type ChallengeStatus,
  SUBMISSION_LIMITS,
  canonicalizeChallengeSpec,
  defaultMinimumScoreForChallengeType,
  findPresetIdsByContainer,
  inferPresetIdByContainer,
  validateChallengeScoreability,
  validatePresetIntegrity,
} from "@agora/common";
import type { AgoraDbClient } from "../index";

export interface ChallengeInsert {
  chain_id: number;
  contract_address: string;
  factory_address: string;
  factory_challenge_id: number;
  poster_address: string;
  title: string;
  description: string;
  domain: string;
  challenge_type: string;
  spec_cid: string;
  dataset_train_cid?: string | null;
  dataset_test_cid?: string | null;
  scoring_container: string;
  scoring_metric: string;
  scoring_preset_id?: string | null;
  eval_engine_id?: string | null;
  eval_engine_digest?: string | null;
  eval_bundle_cid?: string | null;
  minimum_score?: number | null;
  max_submissions_total?: number | null;
  max_submissions_per_solver?: number | null;
  reward_amount: number;
  distribution_type: string;
  deadline: string;
  dispute_window_hours: number;
  status: ChallengeStatus;
  tx_hash: string;
}

export interface BuildChallengeInsertInput {
  chainId: number;
  contractAddress: string;
  factoryAddress: string;
  factoryChallengeId: number;
  posterAddress: string;
  specCid: string;
  spec: ChallengeSpecOutput;
  rewardAmountUsdc: number;
  disputeWindowHours: number;
  txHash: string;
  onChainDeadline?: string;
}

export async function buildChallengeInsert(
  input: BuildChallengeInsertInput,
): Promise<ChallengeInsert> {
  const requirePinnedPresetDigest =
    process.env.AGORA_REQUIRE_PINNED_PRESET_DIGESTS === "1" ||
    process.env.AGORA_REQUIRE_PINNED_PRESET_DIGESTS === "true" ||
    process.env.NODE_ENV === "production";
  const canonicalSpec = await canonicalizeChallengeSpec(input.spec, {
    resolveOfficialPresetDigests: requirePinnedPresetDigest,
  });
  const explicitPresetId =
    typeof canonicalSpec.preset_id === "string" &&
    canonicalSpec.preset_id.trim().length > 0
      ? canonicalSpec.preset_id.trim()
      : null;
  const usesCustomScorer =
    canonicalSpec.type === "custom" || canonicalSpec.type === "optimization";
  const effectivePresetId =
    explicitPresetId ?? (usesCustomScorer ? "custom" : null);
  const inferredPresetId =
    effectivePresetId ??
    inferPresetIdByContainer(canonicalSpec.scoring.container);
  const presetIdsForContainer = findPresetIdsByContainer(
    canonicalSpec.scoring.container,
  );

  if (
    !inferredPresetId &&
    !usesCustomScorer &&
    presetIdsForContainer.length > 1
  ) {
    throw new Error(
      `Ambiguous scoring preset for container ${canonicalSpec.scoring.container}. Set preset_id explicitly.`,
    );
  }

  if (
    !inferredPresetId &&
    !usesCustomScorer &&
    presetIdsForContainer.length === 0
  ) {
    throw new Error(
      `Unknown scorer container for non-custom challenge: ${canonicalSpec.scoring.container}. Use a registered preset container or set type to custom with a pinned digest.`,
    );
  }

  if (inferredPresetId) {
    const integrityError = validatePresetIntegrity(
      inferredPresetId,
      canonicalSpec.scoring.container,
      {
        requirePinnedPresetDigest,
      },
    );
    if (integrityError) {
      throw new Error(
        `Invalid scoring preset configuration: ${integrityError}`,
      );
    }
  }

  const scoreability = validateChallengeScoreability(canonicalSpec);
  if (!scoreability.ok) {
    throw new Error(scoreability.errors[0] ?? "Challenge is not scoreable.");
  }

  const evalEngineId =
    canonicalSpec.eval_spec?.engine_id ?? inferredPresetId ?? "custom";
  const evalEngineDigest =
    canonicalSpec.eval_spec?.engine_digest ??
    (canonicalSpec.scoring.container.includes("@sha256:")
      ? canonicalSpec.scoring.container
      : undefined);
  const evalBundleCid =
    canonicalSpec.eval_spec?.evaluation_bundle ??
    (canonicalSpec.type === "prediction"
      ? canonicalSpec.dataset?.hidden_labels
      : undefined) ??
    canonicalSpec.dataset?.test;

  return {
    chain_id: input.chainId,
    contract_address: input.contractAddress.toLowerCase(),
    factory_address: input.factoryAddress.toLowerCase(),
    factory_challenge_id: input.factoryChallengeId,
    poster_address: input.posterAddress.toLowerCase(),
    title: canonicalSpec.title,
    description: canonicalSpec.description,
    domain: canonicalSpec.domain,
    challenge_type: canonicalSpec.type,
    spec_cid: input.specCid,
    dataset_train_cid: canonicalSpec.dataset?.train ?? null,
    dataset_test_cid: canonicalSpec.dataset?.test ?? null,
    scoring_container: canonicalSpec.scoring.container,
    scoring_metric: canonicalSpec.scoring.metric,
    scoring_preset_id: inferredPresetId,
    eval_engine_id: evalEngineId,
    eval_engine_digest: evalEngineDigest ?? null,
    eval_bundle_cid: evalBundleCid ?? null,
    minimum_score:
      canonicalSpec.minimum_score ??
      defaultMinimumScoreForChallengeType(canonicalSpec.type) ??
      null,
    max_submissions_total:
      canonicalSpec.max_submissions_total ?? SUBMISSION_LIMITS.maxPerChallenge,
    max_submissions_per_solver:
      canonicalSpec.max_submissions_per_solver ??
      SUBMISSION_LIMITS.maxPerSolverPerChallenge,
    reward_amount: input.rewardAmountUsdc,
    distribution_type: canonicalSpec.reward.distribution,
    deadline: input.onChainDeadline ?? canonicalSpec.deadline,
    dispute_window_hours: input.disputeWindowHours,
    status: CHALLENGE_STATUS.open,
    tx_hash: input.txHash,
  };
}

export async function upsertChallenge(
  db: AgoraDbClient,
  payload: ChallengeInsert,
) {
  const { data, error } = await db
    .from("challenges")
    .upsert(payload, {
      onConflict: "chain_id,contract_address",
    })
    .select("*")
    .single();
  if (error) {
    throw new Error(`Failed to upsert challenge: ${error.message}`);
  }
  return data;
}

export async function getChallengeById(db: AgoraDbClient, id: string) {
  const { data, error } = await db
    .from("challenges")
    .select("*")
    .eq("id", id)
    .single();
  if (error) {
    throw new Error(`Failed to fetch challenge: ${error.message}`);
  }
  return data;
}

export async function listChallenges(db: AgoraDbClient) {
  const { data, error } = await db
    .from("challenges")
    .select(
      "id, contract_address, factory_address, tx_hash, status, max_submissions_total, max_submissions_per_solver",
    );
  if (error) {
    throw new Error(`Failed to list challenges: ${error.message}`);
  }
  return data ?? [];
}

export interface ChallengeListFilters {
  status?: ChallengeStatus;
  domain?: string;
  posterAddress?: string;
  limit?: number;
}

export async function listChallengesWithDetails(
  db: AgoraDbClient,
  filters: ChallengeListFilters = {},
) {
  let query = db.from("challenges").select("*, submissions(count)");

  if (filters.status) {
    query = query.eq("status", filters.status);
  }
  if (filters.domain) {
    query = query.eq("domain", filters.domain);
  }
  if (filters.posterAddress) {
    query = query.eq("poster_address", filters.posterAddress);
  }
  if (filters.limit) {
    query = query.limit(filters.limit);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to list challenges: ${error.message}`);
  }

  return (data ?? []).map((row: Record<string, unknown>) => {
    const subs = row.submissions as Array<{ count: number }> | undefined;
    const submissions_count = subs?.[0]?.count ?? 0;
    const { submissions, ...rest } = row;
    return { ...rest, submissions_count };
  });
}

export async function updateChallengeStatus(
  db: AgoraDbClient,
  challengeId: string,
  status: ChallengeStatus,
) {
  const { data, error } = await db
    .from("challenges")
    .update({ status })
    .eq("id", challengeId)
    .select("*")
    .single();
  if (error) {
    throw new Error(`Failed to update challenge status: ${error.message}`);
  }
  return data;
}

export async function setChallengeFinalized(
  db: AgoraDbClient,
  challengeId: string,
  finalizedAt: string,
  winnerOnChainSubId: number | null,
  winnerSubmissionId: string | null,
) {
  const { data, error } = await db
    .from("challenges")
    .update({
      status: CHALLENGE_STATUS.finalized,
      finalized_at: finalizedAt,
      winner_on_chain_sub_id: winnerOnChainSubId,
      winner_submission_id: winnerSubmissionId,
    })
    .eq("id", challengeId)
    .select("*")
    .single();
  if (error) {
    throw new Error(`Failed to finalize challenge: ${error.message}`);
  }
  return data;
}
