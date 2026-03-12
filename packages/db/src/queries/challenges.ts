import {
  CHALLENGE_STATUS,
  type ChallengeSpecOutput,
  type ChallengeStatus,
  SUBMISSION_LIMITS,
  canonicalizeChallengeSpec,
  defaultMinimumScoreForChallengeType,
  deriveExpectedColumns,
  findPresetIdsByContainer,
  inferPresetIdByContainer,
  resolveEvalSpec,
  validateChallengeScoreability,
  validatePresetIntegrity,
} from "@agora/common";
import type { AgoraDbClient } from "../index";

export interface ChallengeInsert {
  chain_id: number;
  contract_version: number;
  spec_schema_version: number;
  contract_address: string;
  factory_address: string;
  poster_address: string;
  title: string;
  description: string;
  domain: string;
  challenge_type: string;
  spec_cid: string;
  dataset_train_cid?: string | null;
  dataset_test_cid?: string | null;
  eval_image: string;
  eval_metric: string;
  runner_preset_id: string;
  eval_bundle_cid?: string | null;
  expected_columns?: string[] | null;
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
  contractVersion: number;
  contractAddress: string;
  factoryAddress: string;
  posterAddress: string;
  specCid: string;
  spec: ChallengeSpecOutput;
  rewardAmountUsdc: number;
  disputeWindowHours: number;
  requirePinnedPresetDigests?: boolean;
  txHash: string;
  onChainDeadline?: string;
}

export async function buildChallengeInsert(
  input: BuildChallengeInsertInput,
): Promise<ChallengeInsert> {
  const requirePinnedPresetDigest = input.requirePinnedPresetDigests ?? false;
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
  const runnerPresetId = inferredPresetId ?? "custom";
  const resolvedEvalPlan = resolveEvalSpec(canonicalSpec);
  const expectedColumns = deriveExpectedColumns(
    canonicalSpec.submission_contract,
  );

  return {
    chain_id: input.chainId,
    contract_version: input.contractVersion,
    spec_schema_version: canonicalSpec.schema_version,
    contract_address: input.contractAddress.toLowerCase(),
    factory_address: input.factoryAddress.toLowerCase(),
    poster_address: input.posterAddress.toLowerCase(),
    title: canonicalSpec.title,
    description: canonicalSpec.description,
    domain: canonicalSpec.domain,
    challenge_type: canonicalSpec.type,
    spec_cid: input.specCid,
    dataset_train_cid: canonicalSpec.dataset?.train ?? null,
    dataset_test_cid: canonicalSpec.dataset?.test ?? null,
    eval_image: resolvedEvalPlan.image,
    eval_metric: resolvedEvalPlan.metric,
    runner_preset_id: runnerPresetId,
    eval_bundle_cid: resolvedEvalPlan.evaluationBundleCid ?? null,
    expected_columns: expectedColumns.length > 0 ? expectedColumns : null,
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

export async function getChallengeByContractAddress(
  db: AgoraDbClient,
  contractAddress: string,
) {
  const { data, error } = await db
    .from("challenges")
    .select("*")
    .eq("contract_address", contractAddress.toLowerCase())
    .single();
  if (error) {
    throw new Error(
      `Failed to fetch challenge by contract address: ${error.message}`,
    );
  }
  return data;
}

const INDEXING_CHALLENGE_SELECT =
  "id, contract_address, factory_address, tx_hash, status, max_submissions_total, max_submissions_per_solver";

export async function listChallengesForIndexing(db: AgoraDbClient) {
  const activeStatuses = [
    CHALLENGE_STATUS.open,
    CHALLENGE_STATUS.scoring,
    CHALLENGE_STATUS.disputed,
  ];

  const { data: activeChallenges, error: activeError } = await db
    .from("challenges")
    .select(INDEXING_CHALLENGE_SELECT)
    .in("status", activeStatuses);
  if (activeError) {
    throw new Error(
      `Failed to list active challenges for indexing: ${activeError.message}`,
    );
  }

  const { data: unclaimedPayoutRows, error: payoutError } = await db
    .from("challenge_payouts")
    .select("challenge_id")
    .is("claimed_at", null);
  if (payoutError) {
    throw new Error(
      `Failed to list unclaimed challenge payouts: ${payoutError.message}`,
    );
  }

  const finalizedChallengeIds = Array.from(
    new Set(
      (unclaimedPayoutRows ?? [])
        .map((row) => row.challenge_id)
        .filter((value): value is string => typeof value === "string"),
    ),
  );
  if (finalizedChallengeIds.length === 0) {
    return activeChallenges ?? [];
  }

  const { data: finalizedChallenges, error: finalizedError } = await db
    .from("challenges")
    .select(INDEXING_CHALLENGE_SELECT)
    .eq("status", CHALLENGE_STATUS.finalized)
    .in("id", finalizedChallengeIds);
  if (finalizedError) {
    throw new Error(
      `Failed to list finalized challenges for indexing: ${finalizedError.message}`,
    );
  }

  const merged = new Map<string, (typeof activeChallenges)[number]>();
  for (const challenge of activeChallenges ?? []) {
    if (typeof challenge.id === "string") {
      merged.set(challenge.id, challenge);
    }
  }
  for (const challenge of finalizedChallenges ?? []) {
    if (typeof challenge.id === "string") {
      merged.set(challenge.id, challenge);
    }
  }

  return Array.from(merged.values());
}

export interface ChallengeListFilters {
  status?: ChallengeStatus;
  domain?: string;
  posterAddress?: string;
  limit?: number;
  updatedSince?: string;
  cursor?: string;
}

export async function listChallengesWithDetails(
  db: AgoraDbClient,
  filters: ChallengeListFilters = {},
) {
  let query = db
    .from("challenges")
    .select("*, submissions(count)")
    .order("created_at", { ascending: false });

  if (filters.status) {
    query = query.eq("status", filters.status);
  }
  if (filters.domain) {
    query = query.eq("domain", filters.domain);
  }
  if (filters.posterAddress) {
    query = query.eq("poster_address", filters.posterAddress.toLowerCase());
  }
  if (filters.updatedSince) {
    query = query.gte("created_at", filters.updatedSince);
  }
  if (filters.cursor) {
    query = query.lt("created_at", filters.cursor);
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
  winningOnChainSubId: number | null,
  winnerSolverAddress: string | null,
) {
  const { data, error } = await db
    .from("challenges")
    .update({
      status: CHALLENGE_STATUS.finalized,
      winning_on_chain_sub_id: winningOnChainSubId,
      winner_solver_address: winnerSolverAddress?.toLowerCase() ?? null,
    })
    .eq("id", challengeId)
    .select("*")
    .single();
  if (error) {
    throw new Error(`Failed to finalize challenge: ${error.message}`);
  }
  return data;
}

export async function clearChallengeSettlement(
  db: AgoraDbClient,
  challengeId: string,
) {
  const { data, error } = await db
    .from("challenges")
    .update({
      winning_on_chain_sub_id: null,
      winner_solver_address: null,
    })
    .eq("id", challengeId)
    .select("*")
    .single();
  if (error) {
    throw new Error(`Failed to clear challenge settlement: ${error.message}`);
  }
  return data;
}

export async function deleteChallengeById(
  db: AgoraDbClient,
  challengeId: string,
) {
  const { error } = await db.from("challenges").delete().eq("id", challengeId);
  if (error) {
    throw new Error(`Failed to delete challenge: ${error.message}`);
  }
}
