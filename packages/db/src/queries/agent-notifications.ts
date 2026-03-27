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
  has_unattributed_rows: boolean;
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

export async function enqueueAgentNotification(
  db: AgoraDbClient,
  payload: AgentNotificationOutboxInsert,
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

  return (data as AgentNotificationOutboxRow | null) ?? null;
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

export async function listClaimableNotificationCandidatesForChallenge(
  db: AgoraDbClient,
  challengeId: string,
): Promise<ClaimableNotificationCandidate[]> {
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

  if (!challenge || challenge.status !== "finalized") {
    return [];
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
    return [];
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
    return [];
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
  if (agentIds.length === 0) {
    return [];
  }

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

  const normalizedEndpoints = (endpoints ?? []) as Array<{
    id: string;
    agent_id: string;
    status: AgentNotificationEndpointStatus;
  }>;
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
        has_unattributed_rows: false,
      } satisfies WalletNotificationGroup);
    groupedWallets.set(walletKey, walletGroup);

    const submission = submissionByOnChainId.get(
      Number(payoutRow.winning_on_chain_sub_id),
    );
    if (!submission) {
      walletGroup.has_unattributed_rows = true;
      continue;
    }

    if (
      submission.solver_address.toLowerCase() !==
      payoutRow.solver_address.toLowerCase()
    ) {
      walletGroup.has_unattributed_rows = true;
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
      walletGroup.has_unattributed_rows = true;
    }
  }

  const candidates: ClaimableNotificationCandidate[] = [];

  for (const walletGroup of groupedWallets.values()) {
    if (walletGroup.has_unattributed_rows) {
      continue;
    }

    const attributedAgentIds = [
      ...new Set(
        walletGroup.rows
          .map((row) => row.agent_id)
          .filter((value): value is string => typeof value === "string"),
      ),
    ];
    if (attributedAgentIds.length !== 1) {
      continue;
    }

    const [agentId] = attributedAgentIds;
    if (!agentId) {
      continue;
    }

    const endpoint = endpointByAgentId.get(agentId);
    if (!endpoint || endpoint.status !== "active") {
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

export async function enqueueClaimableNotificationsForChallenge(
  db: AgoraDbClient,
  challengeId: string,
  occurredAt = new Date().toISOString(),
) {
  const candidates = await listClaimableNotificationCandidatesForChallenge(
    db,
    challengeId,
  );
  const enqueued: AgentNotificationOutboxRow[] = [];

  for (const candidate of candidates) {
    const payload = buildClaimableNotificationPayload({
      candidate,
      occurredAt,
    });
    const row = await enqueueAgentNotification(db, {
      agent_id: candidate.agent_id,
      endpoint_id: candidate.endpoint_id,
      challenge_id: candidate.challenge_id,
      solver_address: candidate.solver_address,
      event_type: payload.type,
      dedupe_key: `${payload.type}:${candidate.challenge_id}:${candidate.agent_id}:${candidate.solver_address}`,
      payload_json: payload,
    });
    if (row) {
      enqueued.push(row);
    }
  }

  return enqueued;
}
