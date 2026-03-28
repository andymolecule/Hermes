import crypto from "node:crypto";
import {
  type PayoutClaimableWebhookPayloadOutput,
  payoutClaimableWebhookPayloadSchema,
} from "@agora/common";
import type { AgoraDbClient } from "../index";

export type AgentNotificationEndpointStatus = "active" | "disabled";
export type AgentNotificationOutboxStatus =
  | "queued"
  | "delivering"
  | "delivered"
  | "failed";

export interface AgentNotificationEndpointRow {
  id: string;
  agent_id: string;
  webhook_url: string;
  signing_secret_ciphertext: string;
  signing_secret_key_version: string;
  status: AgentNotificationEndpointStatus;
  last_delivery_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  disabled_at: string | null;
}

export interface UpsertAgentNotificationEndpointInput {
  agent_id: string;
  webhook_url: string;
  signing_secret_ciphertext: string;
  signing_secret_key_version: string;
}

export interface AgentNotificationOutboxInsert {
  agent_id: string;
  endpoint_id: string;
  challenge_id: string;
  solver_address: string;
  event_type: string;
  dedupe_key: string;
  payload_json: unknown;
}

export interface AgentNotificationOutboxHealthRow {
  id: string;
  agent_id: string;
  endpoint_id: string;
  challenge_id: string;
  event_type: string;
  status: AgentNotificationOutboxStatus;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  locked_at: string | null;
  delivered_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentNotificationEndpointHealthRow {
  id: string;
  agent_id: string;
  status: AgentNotificationEndpointStatus;
  last_delivery_at: string | null;
  last_error: string | null;
  updated_at: string;
}

export interface AgentNotificationOutboxRow {
  id: string;
  agent_id: string;
  endpoint_id: string;
  challenge_id: string;
  solver_address: string;
  event_type: string;
  dedupe_key: string;
  payload_json: unknown;
  status: AgentNotificationOutboxStatus;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  locked_at: string | null;
  locked_by: string | null;
  delivered_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClaimableNotificationEntry {
  submission_id: string;
  on_chain_submission_id: number;
  rank: number;
  amount: string;
}

export interface ClaimableNotificationCandidate {
  agent_id: string;
  endpoint_id: string;
  challenge_id: string;
  challenge_title: string;
  challenge_address: string;
  distribution_type: "winner_take_all" | "top_3" | "proportional";
  solver_address: string;
  claimable_amount: string;
  entries: ClaimableNotificationEntry[];
}

export const CLAIMABLE_NOTIFICATION_SKIP_REASONS = [
  "missing_submission",
  "solver_mismatch",
  "missing_agent_attribution",
  "mixed_agent_attribution",
  "missing_endpoint",
  "challenge_not_finalized",
  "challenge_missing",
  "no_claimable_payout",
] as const;

export type ClaimableNotificationSkipReason =
  (typeof CLAIMABLE_NOTIFICATION_SKIP_REASONS)[number];

export interface ClaimableNotificationSkippedWalletGroup {
  challenge_id: string;
  solver_address: string;
  reasons: ClaimableNotificationSkipReason[];
  row_count: number;
  agent_ids: string[];
}

export interface ClaimableNotificationCoverage {
  challenge_id: string;
  candidates: ClaimableNotificationCandidate[];
  skipped_wallet_groups: ClaimableNotificationSkippedWalletGroup[];
}

export interface ClaimableNotificationCoverageSummary {
  finalizedChallengeCount: number;
  candidateGroups: number;
  skippedWalletGroups: number;
  skipReasons: Record<ClaimableNotificationSkipReason, number>;
  skippedExamples: ClaimableNotificationSkippedWalletGroup[];
}

export interface AgentNotificationHealthSnapshot {
  counts: {
    queued: number;
    readyQueued: number;
    delivering: number;
    delivered: number;
    failed: number;
  };
  timing: {
    oldestQueuedAt: string | null;
    oldestReadyQueuedAt: string | null;
    oldestDeliveringAt: string | null;
    lastDeliveredAt: string | null;
  };
  endpoints: {
    active: number;
    disabled: number;
    latestDeliveryAt: string | null;
    latestError: string | null;
  };
  errors: {
    latestOutboxError: string | null;
    latestEndpointError: string | null;
  };
  coverage: ClaimableNotificationCoverageSummary;
}

interface WalletNotificationGroupRow {
  agent_id: string | null;
  submission_id: string;
  on_chain_submission_id: number;
  rank: number;
  amount: string;
}

interface WalletNotificationGroup {
  challenge_id: string;
  solver_address: string;
  rows: WalletNotificationGroupRow[];
  skipReasons: Set<ClaimableNotificationSkipReason>;
}

function createClaimableNotificationSkipReasonCounts() {
  return Object.fromEntries(
    CLAIMABLE_NOTIFICATION_SKIP_REASONS.map((reason) => [reason, 0]),
  ) as Record<ClaimableNotificationSkipReason, number>;
}

function normalizeClaimableNotificationSkippedWalletGroup(input: {
  challengeId: string;
  solverAddress: string;
  rows: WalletNotificationGroupRow[];
  reasons: Set<ClaimableNotificationSkipReason>;
}) {
  return {
    challenge_id: input.challengeId,
    solver_address: input.solverAddress.toLowerCase(),
    reasons: [...input.reasons].sort(),
    row_count: input.rows.length,
    agent_ids: [
      ...new Set(
        input.rows
          .map((row) => row.agent_id)
          .filter((value): value is string => typeof value === "string"),
      ),
    ].sort(),
  } satisfies ClaimableNotificationSkippedWalletGroup;
}

function compareIsoDateAscending(left: string | null, right: string | null) {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left.localeCompare(right);
}

function compareIsoDateDescending(left: string | null, right: string | null) {
  return compareIsoDateAscending(right, left);
}

function decimalUsdcToBaseUnits(value: string | number) {
  const normalized =
    typeof value === "number" ? value.toFixed(6) : String(value).trim();
  const match = normalized.match(/^(\d+)(?:\.(\d{1,6}))?$/);
  if (!match) {
    throw new Error(
      `Invalid USDC amount in runtime payout projection: ${normalized}`,
    );
  }

  const whole = match[1] ?? "0";
  const fraction = (match[2] ?? "").padEnd(6, "0");
  return BigInt(`${whole}${fraction}`);
}

function candidateGroupKey(input: {
  agentId: string;
  challengeId: string;
  solverAddress: string;
}) {
  return `${input.agentId}:${input.challengeId}:${input.solverAddress.toLowerCase()}`;
}

function walletGroupKey(input: { challengeId: string; solverAddress: string }) {
  return `${input.challengeId}:${input.solverAddress.toLowerCase()}`;
}

async function touchAgentNotificationEndpoint(
  db: AgoraDbClient,
  input: {
    endpointId: string;
    lastDeliveryAt?: string | null;
    lastError?: string | null;
  },
) {
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (input.lastDeliveryAt !== undefined) {
    patch.last_delivery_at = input.lastDeliveryAt;
  }
  if (input.lastError !== undefined) {
    patch.last_error = input.lastError;
  }

  const { error } = await db
    .from("agent_notification_endpoints")
    .update(patch)
    .eq("id", input.endpointId);

  if (error) {
    throw new Error(
      `Failed to update notification endpoint delivery state: ${error.message}`,
    );
  }
}

export async function upsertAgentNotificationEndpoint(
  db: AgoraDbClient,
  input: UpsertAgentNotificationEndpointInput,
): Promise<AgentNotificationEndpointRow> {
  const nowIso = new Date().toISOString();
  const { data, error } = await db
    .from("agent_notification_endpoints")
    .upsert(
      {
        agent_id: input.agent_id,
        webhook_url: input.webhook_url,
        signing_secret_ciphertext: input.signing_secret_ciphertext,
        signing_secret_key_version: input.signing_secret_key_version,
        status: "active",
        disabled_at: null,
        updated_at: nowIso,
      },
      { onConflict: "agent_id" },
    )
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to upsert notification endpoint: ${error.message}`);
  }

  return data as AgentNotificationEndpointRow;
}

export async function getAgentNotificationEndpointByAgentId(
  db: AgoraDbClient,
  agentId: string,
): Promise<AgentNotificationEndpointRow | null> {
  const { data, error } = await db
    .from("agent_notification_endpoints")
    .select("*")
    .eq("agent_id", agentId)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to read notification endpoint: ${error.message}`);
  }

  return (data as AgentNotificationEndpointRow | null) ?? null;
}

export async function getAgentNotificationEndpointById(
  db: AgoraDbClient,
  endpointId: string,
): Promise<AgentNotificationEndpointRow | null> {
  const { data, error } = await db
    .from("agent_notification_endpoints")
    .select("*")
    .eq("id", endpointId)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(
      `Failed to read notification endpoint by id: ${error.message}`,
    );
  }

  return (data as AgentNotificationEndpointRow | null) ?? null;
}

export async function disableAgentNotificationEndpoint(
  db: AgoraDbClient,
  agentId: string,
): Promise<AgentNotificationEndpointRow | null> {
  const nowIso = new Date().toISOString();
  const { data, error } = await db
    .from("agent_notification_endpoints")
    .update({
      status: "disabled",
      disabled_at: nowIso,
      updated_at: nowIso,
    })
    .eq("agent_id", agentId)
    .select("*")
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(
      `Failed to disable notification endpoint: ${error.message}`,
    );
  }

  return (data as AgentNotificationEndpointRow | null) ?? null;
}

async function reviveFailedAgentNotification(
  db: AgoraDbClient,
  payload: AgentNotificationOutboxInsert,
  nowIso: string,
) {
  const { data, error } = await db
    .from("agent_notification_outbox")
    .update({
      agent_id: payload.agent_id,
      endpoint_id: payload.endpoint_id,
      challenge_id: payload.challenge_id,
      solver_address: payload.solver_address.toLowerCase(),
      event_type: payload.event_type,
      payload_json: payload.payload_json,
      status: "queued",
      attempts: 0,
      next_attempt_at: nowIso,
      last_error: null,
      locked_at: null,
      locked_by: null,
      delivered_at: null,
      updated_at: nowIso,
    })
    .eq("dedupe_key", payload.dedupe_key)
    .eq("status", "failed")
    .select("*")
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(
      `Failed to revive failed notification delivery: ${error.message}`,
    );
  }

  return (data as AgentNotificationOutboxRow | null) ?? null;
}

export async function enqueueAgentNotification(
  db: AgoraDbClient,
  payload: AgentNotificationOutboxInsert,
  options: {
    reviveFailed?: boolean;
  } = {},
): Promise<AgentNotificationOutboxRow | null> {
  const nowIso = new Date().toISOString();
  const { data, error } = await db
    .from("agent_notification_outbox")
    .upsert(
      {
        agent_id: payload.agent_id,
        endpoint_id: payload.endpoint_id,
        challenge_id: payload.challenge_id,
        solver_address: payload.solver_address.toLowerCase(),
        event_type: payload.event_type,
        dedupe_key: payload.dedupe_key,
        payload_json: payload.payload_json,
        status: "queued",
        next_attempt_at: nowIso,
        updated_at: nowIso,
      },
      {
        onConflict: "dedupe_key",
        ignoreDuplicates: true,
      },
    )
    .select("*")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") return null;
    throw new Error(`Failed to enqueue notification: ${error.message}`);
  }

  const inserted = (data as AgentNotificationOutboxRow | null) ?? null;
  if (inserted || options.reviveFailed !== true) {
    return inserted;
  }

  return reviveFailedAgentNotification(db, payload, nowIso);
}

export async function claimNextAgentNotification(
  db: AgoraDbClient,
  workerId: string,
  leaseMs: number,
): Promise<AgentNotificationOutboxRow | null> {
  const { data, error } = await db.rpc("claim_next_agent_notification", {
    p_worker_id: workerId,
    p_lease_ms: leaseMs,
  });

  if (error) {
    if (error.message.includes("claim_next_agent_notification")) {
      throw new Error(
        "Failed to claim notification delivery job: runtime schema is missing claim_next_agent_notification(). Next step: reset the Supabase schema or apply packages/db/supabase/migrations/001_baseline.sql, reload the PostgREST schema cache, and retry.",
      );
    }
    throw new Error(`Failed to claim notification job: ${error.message}`);
  }

  if (!data || (Array.isArray(data) && data.length === 0)) {
    return null;
  }

  return (Array.isArray(data) ? data[0] : data) as AgentNotificationOutboxRow;
}

export async function heartbeatAgentNotificationLease(
  db: AgoraDbClient,
  notificationId: string,
  workerId: string,
): Promise<boolean> {
  const heartbeatAt = new Date().toISOString();
  const { data, error } = await db
    .from("agent_notification_outbox")
    .update({
      locked_at: heartbeatAt,
      updated_at: heartbeatAt,
    })
    .eq("id", notificationId)
    .eq("status", "delivering")
    .eq("locked_by", workerId)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to heartbeat notification job lease: ${error.message}`,
    );
  }

  return Boolean(data);
}

export async function markAgentNotificationDelivered(
  db: AgoraDbClient,
  input: {
    notificationId: string;
    endpointId: string;
  },
) {
  const nowIso = new Date().toISOString();
  const { error } = await db
    .from("agent_notification_outbox")
    .update({
      status: "delivered",
      delivered_at: nowIso,
      last_error: null,
      locked_at: null,
      locked_by: null,
      updated_at: nowIso,
    })
    .eq("id", input.notificationId);

  if (error) {
    throw new Error(`Failed to mark notification delivered: ${error.message}`);
  }

  await touchAgentNotificationEndpoint(db, {
    endpointId: input.endpointId,
    lastDeliveryAt: nowIso,
    lastError: null,
  });
}

export async function markAgentNotificationFailed(
  db: AgoraDbClient,
  input: {
    notificationId: string;
    endpointId: string;
    errorMessage: string;
    attempts: number;
    maxAttempts: number;
    delayMs?: number;
    permanent?: boolean;
  },
) {
  const exhausted =
    input.permanent === true || input.attempts >= input.maxAttempts;
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const nextAttemptAt = exhausted
    ? nowIso
    : new Date(now + Math.max(0, input.delayMs ?? 0)).toISOString();

  const { error } = await db
    .from("agent_notification_outbox")
    .update({
      status: exhausted ? "failed" : "queued",
      next_attempt_at: nextAttemptAt,
      last_error: input.errorMessage,
      locked_at: null,
      locked_by: null,
      updated_at: nowIso,
    })
    .eq("id", input.notificationId);

  if (error) {
    throw new Error(`Failed to update notification job: ${error.message}`);
  }

  await touchAgentNotificationEndpoint(db, {
    endpointId: input.endpointId,
    lastError: input.errorMessage,
  });
}

export async function requeueAgentNotification(
  db: AgoraDbClient,
  input: {
    notificationId: string;
    resetAttempts?: boolean;
    delayMs?: number;
  },
): Promise<AgentNotificationOutboxRow | null> {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const nextAttemptAt = new Date(
    now + Math.max(0, input.delayMs ?? 0),
  ).toISOString();
  const patch: Record<string, unknown> = {
    status: "queued",
    next_attempt_at: nextAttemptAt,
    last_error: null,
    locked_at: null,
    locked_by: null,
    delivered_at: null,
    updated_at: nowIso,
  };
  if (input.resetAttempts !== false) {
    patch.attempts = 0;
  }
  const { data, error } = await db
    .from("agent_notification_outbox")
    .update(patch)
    .eq("id", input.notificationId)
    .select("*")
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to requeue notification job: ${error.message}`);
  }

  return (data as AgentNotificationOutboxRow | null) ?? null;
}

export async function listAgentNotificationOutboxHealthRows(
  db: AgoraDbClient,
): Promise<AgentNotificationOutboxHealthRow[]> {
  const { data, error } = await db
    .from("agent_notification_outbox")
    .select(
      "id,agent_id,endpoint_id,challenge_id,event_type,status,attempts,max_attempts,next_attempt_at,locked_at,delivered_at,last_error,created_at,updated_at",
    )
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(
      `Failed to read notification outbox health rows: ${error.message}`,
    );
  }

  return (data ?? []) as AgentNotificationOutboxHealthRow[];
}

export async function listAgentNotificationEndpointHealthRows(
  db: AgoraDbClient,
): Promise<AgentNotificationEndpointHealthRow[]> {
  const { data, error } = await db
    .from("agent_notification_endpoints")
    .select("id,agent_id,status,last_delivery_at,last_error,updated_at")
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(
      `Failed to read notification endpoint health rows: ${error.message}`,
    );
  }

  return (data ?? []) as AgentNotificationEndpointHealthRow[];
}

async function listFinalizedChallengeIdsWithClaimablePayouts(
  db: AgoraDbClient,
): Promise<string[]> {
  const { data, error } = await db
    .from("challenge_payouts")
    .select("challenge_id")
    .is("claimed_at", null);

  if (error) {
    throw new Error(
      `Failed to read claimable payout challenge ids for notifications: ${error.message}`,
    );
  }

  return [
    ...new Set(
      ((data ?? []) as Array<{ challenge_id: string | null }>)
        .map((row) => row.challenge_id)
        .filter((value): value is string => typeof value === "string"),
    ),
  ].sort((left, right) => left.localeCompare(right));
}

async function readClaimableNotificationCoverageForChallenge(
  db: AgoraDbClient,
  challengeId: string,
): Promise<ClaimableNotificationCoverage> {
  const { data: challenge, error: challengeError } = await db
    .from("challenges")
    .select("id,title,contract_address,distribution_type,status")
    .eq("id", challengeId)
    .maybeSingle();

  if (challengeError && challengeError.code !== "PGRST116") {
    throw new Error(
      `Failed to load notification challenge context: ${challengeError.message}`,
    );
  }

  if (!challenge) {
    return {
      challenge_id: challengeId,
      candidates: [],
      skipped_wallet_groups: [
        {
          challenge_id: challengeId,
          solver_address: "unknown",
          reasons: ["challenge_missing"],
          row_count: 0,
          agent_ids: [],
        },
      ],
    };
  }

  if (challenge.status !== "finalized") {
    return {
      challenge_id: challenge.id,
      candidates: [],
      skipped_wallet_groups: [
        {
          challenge_id: challenge.id,
          solver_address: "unknown",
          reasons: ["challenge_not_finalized"],
          row_count: 0,
          agent_ids: [],
        },
      ],
    };
  }

  const { data: payoutRows, error: payoutError } = await db
    .from("challenge_payouts")
    .select(
      "challenge_id,solver_address,winning_on_chain_sub_id,rank,amount,claimed_at",
    )
    .eq("challenge_id", challengeId)
    .is("claimed_at", null)
    .order("solver_address", { ascending: true })
    .order("rank", { ascending: true });

  if (payoutError) {
    throw new Error(
      `Failed to load claimable payout rows for notifications: ${payoutError.message}`,
    );
  }

  const normalizedPayoutRows = (payoutRows ?? []) as Array<{
    challenge_id: string;
    solver_address: string;
    winning_on_chain_sub_id: number | string;
    rank: number | string;
    amount: string | number;
    claimed_at: string | null;
  }>;

  if (normalizedPayoutRows.length === 0) {
    return {
      challenge_id: challenge.id,
      candidates: [],
      skipped_wallet_groups: [
        {
          challenge_id: challenge.id,
          solver_address: "unknown",
          reasons: ["no_claimable_payout"],
          row_count: 0,
          agent_ids: [],
        },
      ],
    };
  }

  const onChainSubmissionIds = [
    ...new Set(
      normalizedPayoutRows.map((row) => Number(row.winning_on_chain_sub_id)),
    ),
  ];
  const { data: submissions, error: submissionsError } = await db
    .from("submissions")
    .select("id,submission_intent_id,on_chain_sub_id,solver_address")
    .eq("challenge_id", challengeId)
    .in("on_chain_sub_id", onChainSubmissionIds);

  if (submissionsError) {
    throw new Error(
      `Failed to load submissions for notifications: ${submissionsError.message}`,
    );
  }

  const normalizedSubmissions = (submissions ?? []) as Array<{
    id: string;
    submission_intent_id: string;
    on_chain_sub_id: number | string;
    solver_address: string;
  }>;
  const submissionByOnChainId = new Map(
    normalizedSubmissions.map((submission) => [
      Number(submission.on_chain_sub_id),
      submission,
    ]),
  );

  const submissionIntentIds = [
    ...new Set(
      normalizedSubmissions.map(
        (submission) => submission.submission_intent_id,
      ),
    ),
  ];
  if (submissionIntentIds.length === 0) {
    return {
      challenge_id: challenge.id,
      candidates: [],
      skipped_wallet_groups: [
        {
          challenge_id: challenge.id,
          solver_address: "unknown",
          reasons: ["missing_submission"],
          row_count: normalizedPayoutRows.length,
          agent_ids: [],
        },
      ],
    };
  }

  const { data: intents, error: intentsError } = await db
    .from("submission_intents")
    .select("id,submitted_by_agent_id")
    .in("id", submissionIntentIds);

  if (intentsError) {
    throw new Error(
      `Failed to load submission intents for notifications: ${intentsError.message}`,
    );
  }

  const normalizedIntents = (intents ?? []) as Array<{
    id: string;
    submitted_by_agent_id: string | null;
  }>;
  const intentById = new Map(
    normalizedIntents.map((intent) => [intent.id, intent]),
  );

  const agentIds = [
    ...new Set(
      normalizedIntents
        .map((intent) => intent.submitted_by_agent_id)
        .filter((value): value is string => typeof value === "string"),
    ),
  ];
  const normalizedEndpoints =
    agentIds.length === 0
      ? []
      : await (async () => {
          const { data: endpoints, error: endpointsError } = await db
            .from("agent_notification_endpoints")
            .select("id,agent_id,status")
            .eq("status", "active")
            .in("agent_id", agentIds);

          if (endpointsError) {
            throw new Error(
              `Failed to load notification endpoints: ${endpointsError.message}`,
            );
          }

          return (endpoints ?? []) as Array<{
            id: string;
            agent_id: string;
            status: AgentNotificationEndpointStatus;
          }>;
        })();
  const endpointByAgentId = new Map(
    normalizedEndpoints.map((endpoint) => [endpoint.agent_id, endpoint]),
  );

  const groupedWallets = new Map<string, WalletNotificationGroup>();

  for (const payoutRow of normalizedPayoutRows) {
    const walletKey = walletGroupKey({
      challengeId,
      solverAddress: payoutRow.solver_address,
    });
    const walletGroup =
      groupedWallets.get(walletKey) ??
      ({
        challenge_id: challengeId,
        solver_address: payoutRow.solver_address.toLowerCase(),
        rows: [],
        skipReasons: new Set<ClaimableNotificationSkipReason>(),
      } satisfies WalletNotificationGroup);
    groupedWallets.set(walletKey, walletGroup);

    const submission = submissionByOnChainId.get(
      Number(payoutRow.winning_on_chain_sub_id),
    );
    if (!submission) {
      walletGroup.skipReasons.add("missing_submission");
      continue;
    }

    if (
      submission.solver_address.toLowerCase() !==
      payoutRow.solver_address.toLowerCase()
    ) {
      walletGroup.skipReasons.add("solver_mismatch");
      continue;
    }

    const intent = intentById.get(submission.submission_intent_id);
    const entryAmount = decimalUsdcToBaseUnits(payoutRow.amount).toString();
    walletGroup.rows.push({
      agent_id: intent?.submitted_by_agent_id ?? null,
      submission_id: submission.id,
      on_chain_submission_id: Number(submission.on_chain_sub_id),
      rank: Number(payoutRow.rank),
      amount: entryAmount,
    });
    if (!intent?.submitted_by_agent_id) {
      walletGroup.skipReasons.add("missing_agent_attribution");
    }
  }

  const candidates: ClaimableNotificationCandidate[] = [];
  const skippedWalletGroups: ClaimableNotificationSkippedWalletGroup[] = [];

  for (const walletGroup of groupedWallets.values()) {
    const attributedAgentIds = [
      ...new Set(
        walletGroup.rows
          .map((row) => row.agent_id)
          .filter((value): value is string => typeof value === "string"),
      ),
    ];
    const unattributedRowCount = walletGroup.rows.filter(
      (row) => !row.agent_id,
    ).length;
    if (
      attributedAgentIds.length > 1 ||
      (attributedAgentIds.length > 0 && unattributedRowCount > 0)
    ) {
      walletGroup.skipReasons.add("mixed_agent_attribution");
    }

    const [agentId] = attributedAgentIds;
    const endpoint = agentId ? endpointByAgentId.get(agentId) : null;

    if (agentId && (!endpoint || endpoint.status !== "active")) {
      walletGroup.skipReasons.add("missing_endpoint");
    }

    if (walletGroup.skipReasons.size > 0 || !agentId || !endpoint) {
      skippedWalletGroups.push(
        normalizeClaimableNotificationSkippedWalletGroup({
          challengeId: challenge.id,
          solverAddress: walletGroup.solver_address,
          rows: walletGroup.rows,
          reasons: walletGroup.skipReasons,
        }),
      );
      continue;
    }

    candidates.push({
      agent_id: agentId,
      endpoint_id: endpoint.id,
      challenge_id: challenge.id,
      challenge_title: String(challenge.title),
      challenge_address: String(challenge.contract_address).toLowerCase(),
      distribution_type: challenge.distribution_type as
        | "winner_take_all"
        | "top_3"
        | "proportional",
      solver_address: walletGroup.solver_address,
      claimable_amount: walletGroup.rows
        .reduce((sum, row) => sum + BigInt(row.amount), 0n)
        .toString(),
      entries: walletGroup.rows
        .map((row) => ({
          submission_id: row.submission_id,
          on_chain_submission_id: row.on_chain_submission_id,
          rank: row.rank,
          amount: row.amount,
        }))
        .sort((left, right) => left.rank - right.rank),
    });
  }

  return {
    challenge_id: challenge.id,
    candidates: candidates.sort((left, right) =>
      candidateGroupKey({
        agentId: left.agent_id,
        challengeId: left.challenge_id,
        solverAddress: left.solver_address,
      }).localeCompare(
        candidateGroupKey({
          agentId: right.agent_id,
          challengeId: right.challenge_id,
          solverAddress: right.solver_address,
        }),
      ),
    ),
    skipped_wallet_groups: skippedWalletGroups.sort((left, right) =>
      walletGroupKey({
        challengeId: left.challenge_id,
        solverAddress: left.solver_address,
      }).localeCompare(
        walletGroupKey({
          challengeId: right.challenge_id,
          solverAddress: right.solver_address,
        }),
      ),
    ),
  };
}

export async function listClaimableNotificationCandidatesForChallenge(
  db: AgoraDbClient,
  challengeId: string,
): Promise<ClaimableNotificationCandidate[]> {
  const coverage = await readClaimableNotificationCoverageForChallenge(
    db,
    challengeId,
  );
  return coverage.candidates;
}

export async function getClaimableNotificationCoverageForChallenge(
  db: AgoraDbClient,
  challengeId: string,
): Promise<ClaimableNotificationCoverage> {
  return readClaimableNotificationCoverageForChallenge(db, challengeId);
}

export async function getClaimableNotificationCoverageSummary(
  db: AgoraDbClient,
  options: {
    maxExamples?: number;
  } = {},
): Promise<ClaimableNotificationCoverageSummary> {
  const challengeIds = await listFinalizedChallengeIdsWithClaimablePayouts(db);
  if (challengeIds.length === 0) {
    return {
      finalizedChallengeCount: 0,
      candidateGroups: 0,
      skippedWalletGroups: 0,
      skipReasons: createClaimableNotificationSkipReasonCounts(),
      skippedExamples: [],
    };
  }

  const maxExamples = Math.max(0, options.maxExamples ?? 10);
  const skipReasons = createClaimableNotificationSkipReasonCounts();
  const skippedExamples: ClaimableNotificationSkippedWalletGroup[] = [];
  let candidateGroups = 0;
  let skippedWalletGroups = 0;

  for (const challengeId of challengeIds) {
    const coverage = await readClaimableNotificationCoverageForChallenge(
      db,
      challengeId,
    );
    candidateGroups += coverage.candidates.length;
    skippedWalletGroups += coverage.skipped_wallet_groups.length;
    for (const skippedGroup of coverage.skipped_wallet_groups) {
      for (const reason of skippedGroup.reasons) {
        skipReasons[reason] += 1;
      }
      if (skippedExamples.length < maxExamples) {
        skippedExamples.push(skippedGroup);
      }
    }
  }

  return {
    finalizedChallengeCount: challengeIds.length,
    candidateGroups,
    skippedWalletGroups,
    skipReasons,
    skippedExamples,
  };
}

export async function readAgentNotificationHealthSnapshot(
  db: AgoraDbClient,
): Promise<AgentNotificationHealthSnapshot> {
  const nowMs = Date.now();
  const [outboxRows, endpointRows, coverage] = await Promise.all([
    listAgentNotificationOutboxHealthRows(db),
    listAgentNotificationEndpointHealthRows(db),
    getClaimableNotificationCoverageSummary(db),
  ]);

  const queuedRows = outboxRows.filter((row) => row.status === "queued");
  const readyQueuedRows = queuedRows.filter(
    (row) => Date.parse(row.next_attempt_at) <= nowMs,
  );
  const deliveringRows = outboxRows.filter(
    (row) => row.status === "delivering",
  );
  const deliveredRows = outboxRows.filter((row) => row.status === "delivered");
  const failedRows = outboxRows.filter((row) => row.status === "failed");
  const activeEndpoints = endpointRows.filter((row) => row.status === "active");
  const disabledEndpoints = endpointRows.filter(
    (row) => row.status === "disabled",
  );
  const latestEndpointError =
    endpointRows
      .filter(
        (row) =>
          typeof row.last_error === "string" &&
          row.last_error.trim().length > 0,
      )
      .sort((left, right) =>
        compareIsoDateDescending(left.updated_at, right.updated_at),
      )[0]?.last_error ?? null;
  const latestOutboxError =
    outboxRows
      .filter(
        (row) =>
          typeof row.last_error === "string" &&
          row.last_error.trim().length > 0,
      )
      .sort((left, right) =>
        compareIsoDateDescending(left.updated_at, right.updated_at),
      )[0]?.last_error ?? null;

  return {
    counts: {
      queued: queuedRows.length,
      readyQueued: readyQueuedRows.length,
      delivering: deliveringRows.length,
      delivered: deliveredRows.length,
      failed: failedRows.length,
    },
    timing: {
      oldestQueuedAt:
        queuedRows
          .map((row) => row.created_at)
          .sort(compareIsoDateAscending)[0] ?? null,
      oldestReadyQueuedAt:
        readyQueuedRows
          .map((row) => row.created_at)
          .sort(compareIsoDateAscending)[0] ?? null,
      oldestDeliveringAt:
        deliveringRows
          .map((row) => row.locked_at ?? row.updated_at)
          .sort(compareIsoDateAscending)[0] ?? null,
      lastDeliveredAt:
        deliveredRows
          .map((row) => row.delivered_at)
          .filter((value): value is string => typeof value === "string")
          .sort(compareIsoDateDescending)[0] ?? null,
    },
    endpoints: {
      active: activeEndpoints.length,
      disabled: disabledEndpoints.length,
      latestDeliveryAt:
        endpointRows
          .map((row) => row.last_delivery_at)
          .filter((value): value is string => typeof value === "string")
          .sort(compareIsoDateDescending)[0] ?? null,
      latestError: latestEndpointError,
    },
    errors: {
      latestOutboxError,
      latestEndpointError,
    },
    coverage,
  };
}

async function listChallengeIdsWithAgentSubmissions(
  db: AgoraDbClient,
  agentId: string,
) {
  const { data, error } = await db
    .from("submission_intents")
    .select("challenge_id")
    .eq("submitted_by_agent_id", agentId);

  if (error) {
    throw new Error(
      `Failed to load submission intent challenges for notifications: ${error.message}`,
    );
  }

  return [
    ...new Set(
      ((data ?? []) as Array<{ challenge_id: string | null }>)
        .map((row) => row.challenge_id)
        .filter((value): value is string => typeof value === "string"),
    ),
  ].sort((left, right) => left.localeCompare(right));
}

export async function listClaimableNotificationCandidatesForAgent(
  db: AgoraDbClient,
  agentId: string,
): Promise<ClaimableNotificationCandidate[]> {
  const challengeIds = await listChallengeIdsWithAgentSubmissions(db, agentId);
  if (challengeIds.length === 0) {
    return [];
  }

  const candidates: ClaimableNotificationCandidate[] = [];
  for (const challengeId of challengeIds) {
    const challengeCandidates =
      await listClaimableNotificationCandidatesForChallenge(db, challengeId);
    candidates.push(
      ...challengeCandidates.filter(
        (candidate) => candidate.agent_id === agentId,
      ),
    );
  }

  return candidates.sort((left, right) =>
    candidateGroupKey({
      agentId: left.agent_id,
      challengeId: left.challenge_id,
      solverAddress: left.solver_address,
    }).localeCompare(
      candidateGroupKey({
        agentId: right.agent_id,
        challengeId: right.challenge_id,
        solverAddress: right.solver_address,
      }),
    ),
  );
}

function buildClaimableNotificationPayload(input: {
  candidate: ClaimableNotificationCandidate;
  occurredAt: string;
}): PayoutClaimableWebhookPayloadOutput {
  return payoutClaimableWebhookPayloadSchema.parse({
    id: crypto.randomUUID(),
    type: "payout.claimable",
    occurred_at: input.occurredAt,
    agent_id: input.candidate.agent_id,
    challenge: {
      id: input.candidate.challenge_id,
      title: input.candidate.challenge_title,
      address: input.candidate.challenge_address,
      distribution_type: input.candidate.distribution_type,
    },
    solver: {
      address: input.candidate.solver_address,
    },
    payout: {
      asset: "USDC",
      decimals: 6,
      claimable_amount: input.candidate.claimable_amount,
    },
    entries: input.candidate.entries,
  });
}

async function enqueueClaimableNotificationCandidates(
  db: AgoraDbClient,
  candidates: ClaimableNotificationCandidate[],
  options: {
    occurredAt?: string;
    reviveFailed?: boolean;
  } = {},
) {
  const occurredAt = options.occurredAt ?? new Date().toISOString();
  const enqueued: AgentNotificationOutboxRow[] = [];

  for (const candidate of candidates) {
    const payload = buildClaimableNotificationPayload({
      candidate,
      occurredAt,
    });
    const row = await enqueueAgentNotification(
      db,
      {
        agent_id: candidate.agent_id,
        endpoint_id: candidate.endpoint_id,
        challenge_id: candidate.challenge_id,
        solver_address: candidate.solver_address,
        event_type: payload.type,
        dedupe_key: `${payload.type}:${candidate.challenge_id}:${candidate.agent_id}:${candidate.solver_address}`,
        payload_json: payload,
      },
      {
        reviveFailed: options.reviveFailed,
      },
    );
    if (row) {
      enqueued.push(row);
    }
  }

  return enqueued;
}

export async function enqueueClaimableNotificationsForChallenge(
  db: AgoraDbClient,
  challengeId: string,
  occurredAt = new Date().toISOString(),
) {
  const coverage = await readClaimableNotificationCoverageForChallenge(
    db,
    challengeId,
  );
  return enqueueClaimableNotificationCandidates(db, coverage.candidates, {
    occurredAt,
  });
}

export async function enqueueClaimableNotificationsForAgent(
  db: AgoraDbClient,
  agentId: string,
  occurredAt = new Date().toISOString(),
) {
  const candidates = await listClaimableNotificationCandidatesForAgent(
    db,
    agentId,
  );
  return enqueueClaimableNotificationCandidates(db, candidates, {
    occurredAt,
    reviveFailed: true,
  });
}
