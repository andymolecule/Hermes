import type { HermesDbClient } from "../index";
import {
  defaultMinimumScoreForChallengeType,
  findPresetIdsByContainer,
  inferPresetIdByContainer,
  resolveEvalSpec,
  SUBMISSION_LIMITS,
  CHALLENGE_STATUS,
  validatePresetIntegrity,
  type ChallengeDbStatus,
  type ChallengeSpecOutput,
} from "@hermes/common";

export interface ChallengeInsert {
  chain_id: number;
  contract_address: string;
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
  // Eval spec columns
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
  status: ChallengeDbStatus;
  tx_hash: string;
}

export interface BuildChallengeInsertInput {
  chainId: number;
  contractAddress: string;
  factoryChallengeId: number;
  posterAddress: string;
  specCid: string;
  spec: ChallengeSpecOutput;
  rewardAmountUsdc: number;
  disputeWindowHours: number;
  txHash: string;
}

export function buildChallengeInsert(
  input: BuildChallengeInsertInput,
): ChallengeInsert {
  const requirePinnedPresetDigest =
    process.env.HERMES_REQUIRE_PINNED_PRESET_DIGESTS === "1" ||
    process.env.HERMES_REQUIRE_PINNED_PRESET_DIGESTS === "true" ||
    process.env.NODE_ENV === "production";
  const explicitPresetId =
    typeof input.spec.preset_id === "string" && input.spec.preset_id.trim().length > 0
      ? input.spec.preset_id.trim()
      : null;
  // Types where the poster provides their own scorer container
  const usesCustomScorer = input.spec.type === "custom" || input.spec.type === "optimization";
  const effectivePresetId = explicitPresetId ?? (usesCustomScorer ? "custom" : null);
  const inferredPresetId =
    effectivePresetId ?? inferPresetIdByContainer(input.spec.scoring.container);
  const presetIdsForContainer = findPresetIdsByContainer(input.spec.scoring.container);

  if (!inferredPresetId && !usesCustomScorer && presetIdsForContainer.length > 1) {
    throw new Error(
      `Ambiguous scoring preset for container ${input.spec.scoring.container}. Set preset_id explicitly.`,
    );
  }

  if (!inferredPresetId && !usesCustomScorer && presetIdsForContainer.length === 0) {
    throw new Error(
      `Unknown scorer container for non-custom challenge: ${input.spec.scoring.container}. Use a registered preset container or set type to custom with a pinned digest.`,
    );
  }

  if (inferredPresetId) {
    const integrityError = validatePresetIntegrity(
      inferredPresetId,
      input.spec.scoring.container,
      { requirePinnedPresetDigest },
    );
    if (integrityError) {
      throw new Error(`Invalid scoring preset configuration: ${integrityError}`);
    }
  }

  // Resolve the evaluation spec (supports both new eval_spec and legacy scoring fields)
  const evalSpec = resolveEvalSpec(input.spec);

  return {
    chain_id: input.chainId,
    contract_address: input.contractAddress,
    factory_challenge_id: input.factoryChallengeId,
    poster_address: input.posterAddress,
    title: input.spec.title,
    description: input.spec.description,
    domain: input.spec.domain,
    challenge_type: input.spec.type,
    spec_cid: input.specCid,
    dataset_train_cid: input.spec.dataset?.train ?? null,
    dataset_test_cid: input.spec.dataset?.test ?? null,
    scoring_container: input.spec.scoring.container,
    scoring_metric: input.spec.scoring.metric,
    scoring_preset_id: inferredPresetId,
    // Eval spec columns
    eval_engine_id: evalSpec.engineId,
    eval_engine_digest: evalSpec.engineDigest ?? null,
    eval_bundle_cid: evalSpec.evaluationBundle ?? null,
    minimum_score:
      input.spec.minimum_score ??
      defaultMinimumScoreForChallengeType(input.spec.type) ??
      null,
    max_submissions_total:
      input.spec.max_submissions_total ?? SUBMISSION_LIMITS.maxPerChallenge,
    max_submissions_per_solver:
      input.spec.max_submissions_per_solver ??
      SUBMISSION_LIMITS.maxPerSolverPerChallenge,
    reward_amount: input.rewardAmountUsdc,
    distribution_type: input.spec.reward.distribution,
    deadline: input.spec.deadline,
    dispute_window_hours: input.disputeWindowHours,
    status: CHALLENGE_STATUS.active,
    tx_hash: input.txHash,
  };
}

export async function upsertChallenge(
  db: HermesDbClient,
  payload: ChallengeInsert,
) {
  const { data, error } = await db
    .from("challenges")
    .upsert(payload, {
      onConflict: "chain_id,factory_challenge_id",
    })
    .select("*")
    .single();
  if (error) {
    throw new Error(`Failed to upsert challenge: ${error.message}`);
  }
  return data;
}

export async function getChallengeById(db: HermesDbClient, id: string) {
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

export async function listChallenges(db: HermesDbClient) {
  const { data, error } = await db
    .from("challenges")
    .select(
      "id, contract_address, tx_hash, status, max_submissions_total, max_submissions_per_solver",
    );
  if (error) {
    throw new Error(`Failed to list challenges: ${error.message}`);
  }
  return data ?? [];
}

export interface ChallengeListFilters {
  status?: ChallengeDbStatus;
  domain?: string;
  posterAddress?: string;
  limit?: number;
}

export async function listChallengesWithDetails(
  db: HermesDbClient,
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

  // Flatten the Supabase embedded count into submissions_count
  return (data ?? []).map((row: Record<string, unknown>) => {
    const subs = row.submissions as Array<{ count: number }> | undefined;
    const submissions_count = subs?.[0]?.count ?? 0;
    const { submissions, ...rest } = row;
    return { ...rest, submissions_count };
  });
}

export async function updateChallengeStatus(
  db: HermesDbClient,
  challengeId: string,
  status: ChallengeDbStatus,
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
  db: HermesDbClient,
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
