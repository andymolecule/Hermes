# Agent Notification Webhooks

> Status: LOCKED
> Scope: direct agent webhook registration and payout-claimable delivery
> Read after:
>
> - [Architecture](../architecture.md)
> - [Data and Indexing](../data-and-indexing.md)
> - [Protocol](../protocol.md)
> - [Submission API](submission-api.md)
> - [Runtime Release Architecture](runtime-release-architecture.md)

---

## 0. Purpose

This document defines the machine contract for notifying direct agents
when a finalized challenge has an unclaimed payout attributable to that agent.

The target caller is a direct Hermes/OpenClaw-style agent that:

- authenticates with an Agora-issued bearer API key
- submits through the canonical Agora submission flow
- wants a push callback instead of continuous polling

The first and only event in scope for this revision is:

- `payout.claimable`

This event means:

- the challenge is finalized
- payout rows have been projected
- Agora can attribute the payout to an authenticated agent submission
- the solver wallet for that attributed submission still has unclaimed payout

This document is implementation-backed. Code, schema, tests, OpenAPI, and docs
should stay aligned to this file.

---

## 1. Hard Rules

1. Trigger on finalized economic truth, not provisional score visibility.
2. Agent identity, wallet identity, and provenance remain separate concerns.
3. Agora posts to an agent-owned webhook endpoint; Agora does not talk to
   Telegram directly.
4. Webhook delivery must use an outbox. The indexer must never block on HTTP.
5. Attribution must derive only from canonical persisted state:
   `challenge_payouts -> submissions -> submission_intents.submitted_by_agent_id -> auth_agents`.
6. Notification dedupe must preserve wallet identity because payout claims are
   address-bound.
7. Secrets must not be stored in plaintext.
8. The runtime schema still follows the single-baseline rule. This feature must
   update `001_baseline.sql`, not introduce an incremental shared-environment
   migration chain.
9. Unattributed submissions do not receive callbacks.
10. Public payloads and docs must say "payout claimable", not always "winner",
    because `top_3` and `proportional` are valid payout modes.

---

## 2. Non-Goals

- direct Telegram Bot API integration from Agora
- generic event bus infrastructure
- multiple webhook endpoints per agent
- `payout.claimed` in v1
- notifications for browser or SIWE users
- wallet custody or auto-claim behavior inside Agora

---

## 3. Why Finalization Is The Boundary

Agora only has claimable payout after the challenge finalizes. The protocol
sequence is:

- allocate payouts
- emit `SettlementFinalized`
- solver later calls `claim()`

This boundary is authoritative in the protocol and contract.

Implications:

- do not emit on `Scored`
- do not emit on challenge status becoming `scoring`
- do not emit on provisional leaderboard changes
- emit only when settlement is finalized and payout rows are present

---

## 4. Identity And Attribution Model

Agora must keep these domains separate:

| Domain | Meaning | Canonical storage |
|-------|---------|-------------------|
| Agent identity | Which authenticated Agora agent submitted through Agora | `auth_agents.id`, `submission_intents.submitted_by_agent_id` |
| Wallet identity | Which solver wallet owns the on-chain claim | `submissions.solver_address`, `challenge_payouts.solver_address` |
| Provenance | Optional source metadata for reporting only | `source_*` fields |

Rules:

- webhook registration is scoped to `auth_agents.id`
- payout delivery is scoped to one `(agent_id, challenge_id, solver_address)`
- agent identity must never replace wallet identity in payout semantics
- a single agent may submit from multiple wallets; each wallet receives a
  distinct notification event

The dedupe key for `payout.claimable` must therefore be:

`payout.claimable:<challenge_id>:<agent_id>:<solver_address>`

Not acceptable:

- `payout.claimable:<challenge_id>:<agent_id>`

That would collapse multiple claim-owning wallets for the same agent into one
ambiguous event.

---

## 5. Target Data Model

This repo uses one rebased baseline. Add the following tables to
`packages/db/supabase/migrations/001_baseline.sql`.

### 5.1 `agent_notification_endpoints`

One endpoint per authenticated agent.

Suggested shape:

```sql
create table agent_notification_endpoints (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null unique references auth_agents(id) on delete cascade,
  webhook_url text not null,
  signing_secret_ciphertext text not null,
  signing_secret_key_version text not null default 'v1',
  status text not null default 'active',
  last_delivery_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  disabled_at timestamptz,
  constraint agent_notification_endpoints_status_check
    check (status in ('active', 'disabled'))
);

create index idx_agent_notification_endpoints_status
  on agent_notification_endpoints(status);
```

Notes:

- store ciphertext, not plaintext
- keep one stable row per agent and update it in place
- `disabled_at` is operational history; the endpoint row is not deleted in
  normal flow

### 5.2 `agent_notification_outbox`

Outbox rows for background delivery.

Suggested shape:

```sql
create table agent_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references auth_agents(id) on delete cascade,
  endpoint_id uuid not null references agent_notification_endpoints(id) on delete cascade,
  challenge_id uuid not null references challenges(id) on delete cascade,
  solver_address text not null,
  event_type text not null,
  dedupe_key text not null unique,
  payload_json jsonb not null,
  status text not null default 'queued',
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_notification_outbox_status_check
    check (status in ('queued', 'delivering', 'delivered', 'failed')),
  constraint agent_notification_outbox_solver_address_lowercase_check
    check (solver_address = lower(solver_address))
);

create index idx_agent_notification_outbox_status_next_attempt
  on agent_notification_outbox(status, next_attempt_at);

create index idx_agent_notification_outbox_agent
  on agent_notification_outbox(agent_id);

create index idx_agent_notification_outbox_challenge_solver
  on agent_notification_outbox(challenge_id, solver_address);
```

Notes:

- `challenge_id` and `solver_address` make replay/repair and operational
  inspection easier
- `payload_json` stores the exact body sent to the receiver
- status stays simple: queued, delivering, delivered, failed

### 5.3 Runtime Schema Contract Updates

This feature must also update:

- `packages/db/supabase/migrations/001_baseline.sql` with a
  `claim_next_agent_notification` Postgres function
- `packages/db/src/schema-compatibility.ts`
- `packages/db/src/tests/schema-compatibility.ts`
- the runtime schema contract string if the repo uses it to fence hosted
  runtime compatibility

The worker and notification runtime must fail closed when the active DB schema
does not contain the expected endpoint and outbox tables.

---

## 6. Secrets And Signing

### 6.1 Storage Rule

Signing secrets must be encrypted at rest before they are written to the DB.

Recommended approach:

- app-layer symmetric encryption in the API/notification runtime
- master key loaded through `@agora/common` config
- ciphertext stored in `signing_secret_ciphertext`
- key version stored in `signing_secret_key_version`

Do not:

- store webhook signing secrets in plaintext
- log signing secrets
- derive webhook signing secrets from the agent API key

### 6.2 Config

Add one config entry through `packages/common/src/config.ts`:

- `AGORA_AGENT_NOTIFICATION_MASTER_KEY`

Rules:

- required for webhook create/update and delivery runtime
- must never be read directly from `process.env`
- API should fail fast with a clear next step if webhook management is called
  while the key is missing

### 6.3 Request Signing Contract

Each delivery uses:

`signature = HMAC-SHA256(signing_secret, timestamp + "." + body)`

Headers:

- `X-Agora-Event`
- `X-Agora-Delivery-Id`
- `X-Agora-Timestamp`
- `X-Agora-Signature`

Header format:

```text
X-Agora-Signature: sha256=<hex>
```

Receiver verification guidance:

- reject if timestamp is too old, recommended 5 minutes
- recompute HMAC over the exact raw body bytes
- compare in constant time

---

## 7. Public API Surface

Extend the existing direct-agent routes.

### 7.1 Routes

| Method | Path | Purpose |
|-------|------|---------|
| `GET` | `/api/agents/me/notifications/webhook` | Read current webhook registration |
| `PUT` | `/api/agents/me/notifications/webhook` | Create or update webhook registration |
| `DELETE` | `/api/agents/me/notifications/webhook` | Disable webhook registration |

Auth:

- `Authorization: Bearer <api_key>`

### 7.2 PUT Request

```json
{
  "url": "https://agent.example.com/agora/webhook",
  "rotate_secret": false
}
```

Rules:

- `https` required in shared environments
- `http://localhost` may be allowed in local dev/test only
- updating the URL does not rotate the secret unless `rotate_secret = true`

### 7.3 PUT Response

```json
{
  "data": {
    "endpoint_id": "uuid",
    "url": "https://agent.example.com/agora/webhook",
    "status": "active",
    "created_at": "2026-03-27T12:00:00Z",
    "updated_at": "2026-03-27T12:00:00Z",
    "signing_secret": "whsec_..."
  }
}
```

Rules:

- `signing_secret` is returned only when the endpoint is first created or the
  caller explicitly rotates it
- otherwise `signing_secret` should be `null`

### 7.4 GET Response

```json
{
  "data": {
    "endpoint_id": "uuid",
    "url": "https://agent.example.com/agora/webhook",
    "status": "active",
    "created_at": "2026-03-27T12:00:00Z",
    "updated_at": "2026-03-27T12:10:00Z",
    "last_delivery_at": "2026-03-27T12:34:56Z",
    "last_error": null
  }
}
```

### 7.5 DELETE Behavior

Delete is a soft disable:

- set endpoint status to `disabled`
- set `disabled_at = now()`
- keep the row for auditability and future re-enable via `PUT`

Disabled endpoints do not receive new outbox rows.

If a queued row is claimed while the endpoint is disabled, mark that row failed
with a clear terminal error such as `endpoint_disabled`.

---

## 8. Event Contract

### 8.1 Event Type

`payout.claimable`

### 8.2 Delivery Semantics

One webhook delivery represents:

- one attributed agent
- one finalized challenge
- one solver wallet
- one current unclaimed payout amount

### 8.3 Payload Shape

```json
{
  "id": "evt_uuid",
  "type": "payout.claimable",
  "occurred_at": "2026-03-27T12:34:56Z",
  "agent_id": "uuid",
  "challenge": {
    "id": "uuid",
    "title": "KRAS ranking challenge",
    "address": "0x0000000000000000000000000000000000000000",
    "distribution_type": "winner_take_all"
  },
  "solver": {
    "address": "0x0000000000000000000000000000000000000000"
  },
  "payout": {
    "asset": "USDC",
    "decimals": 6,
    "claimable_amount": "9000000"
  },
  "entries": [
    {
      "submission_id": "uuid",
      "on_chain_submission_id": 7,
      "rank": 1,
      "amount": "9000000"
    }
  ]
}
```

Rules:

- `claimable_amount` is raw USDC base units as a string
- `entries[].amount` is also raw USDC base units as a string
- do not include human-formatted strings in the machine contract
- do not include a relative `claim_url` in v1
- receivers that want to deep-link to Agora web UI should construct that link
  from their own configured Agora base URL plus the challenge identity in the
  payload

### 8.4 Message Semantics

The receiver may render:

- "Congratulations, you won" only when the event clearly represents first place
  in `winner_take_all`
- otherwise: "Challenge finalized. Payout claimable."

Agora's machine contract should not overstate the result.

---

## 9. Enqueue Algorithm

### 9.1 Canonical Function

Add one canonical function in the settlement/indexing layer:

- `syncChallengeClaimableNotifications(challengeId)`

This function computes the desired `payout.claimable` outbox rows from current
projected state and inserts any missing rows idempotently.

It should be safe to call multiple times.

### 9.2 Query Inputs

For one finalized challenge:

1. read unclaimed `challenge_payouts`
2. join each payout row to `submissions` on:
   - `challenge_id`
   - `winning_on_chain_sub_id = submissions.on_chain_sub_id`
3. join to `submission_intents` through `submissions.submission_intent_id`
4. read `submitted_by_agent_id`
5. join to active `agent_notification_endpoints`

Rows must be skipped when:

- `submitted_by_agent_id` is null
- no endpoint exists
- endpoint status is not `active`
- the wallet has no remaining unclaimed amount

### 9.3 Grouping

Group rows by:

- `agent_id`
- `challenge_id`
- `solver_address`

Build one payload per group.

### 9.4 Dedupe

Use:

- `event_type = 'payout.claimable'`
- `dedupe_key = payout.claimable:<challenge_id>:<agent_id>:<solver_address>`

Insert with conflict-ignore semantics.

### 9.5 Trigger Points

Call the sync function from both:

1. live settlement projection after `SettlementFinalized`
2. settlement repair/reprojection after canonical payout rows have been rebuilt
3. webhook create/update after the endpoint becomes active for one agent

Reason:

- live indexing handles normal traffic
- repair path preserves correctness after retries, rewind, or projection repair
- webhook create/update backfills already-claimable payouts for newly activated agents

The sync function must be idempotent so both call sites are safe.

---

## 10. Delivery Runtime

### 10.1 Runtime Shape

Implement delivery as a separate notification runner, not as a dependency of
the existing scoring worker startup path.

Reason:

- the current scoring worker requires oracle/scoring/sealing readiness
- payout notification should not be blocked by scorer readiness or oracle key
  issues

The notification runner may reuse worker polling and lease patterns, but it
must have its own entrypoint and startup checks.

### 10.2 Claim Loop

Add a DB query module:

- `packages/db/src/queries/agent-notifications.ts`

Suggested operations:

- `upsertAgentNotificationEndpoint`
- `getAgentNotificationEndpointByAgentId`
- `disableAgentNotificationEndpoint`
- `enqueueAgentNotification`
- `claimNextAgentNotification`
- `heartbeatAgentNotificationLease`
- `markAgentNotificationDelivered`
- `markAgentNotificationFailed`

`claimNextAgentNotification` should call a
`claim_next_agent_notification` Postgres function added to
`001_baseline.sql`.

Reason:

- the repo already uses Supabase RPC for atomic job claims
- `FOR UPDATE SKIP LOCKED` is not a first-class query-builder primitive in the
  current DB access layer
- keeping claim semantics in one DB function avoids race windows

Unlike `claim_next_score_job`, this function should stay intentionally simple:

- no worker-runtime version fence
- no chain-id filter
- no stale-running recovery path in v1
- only claim rows where `status = 'queued'` and `next_attempt_at <= now()`

Target behavior:

1. select one eligible queued row ordered by `next_attempt_at`, then
   `created_at`
2. lock it with `FOR UPDATE SKIP LOCKED`
3. update it to:
   - `status = 'delivering'`
   - `attempts = attempts + 1`
   - `locked_at = now()`
   - `locked_by = <worker_id>`
   - `updated_at = now()`
4. return the claimed row

### 10.3 Delivery Rules

When a job is claimed:

1. load the current endpoint row
2. fail terminally if the endpoint is disabled or missing
3. decrypt the signing secret
4. sign the request
5. POST the exact `payload_json` body

Success:

- any `2xx`

Retriable:

- timeout
- network failure
- `408`
- `429`
- any `5xx`

Terminal failure:

- most `4xx`
- endpoint disabled
- malformed endpoint URL that passed earlier validation unexpectedly

### 10.4 Backoff

Use a fixed explicit schedule:

1. 30 seconds
2. 2 minutes
3. 10 minutes
4. 30 minutes
5. 2 hours

At max attempts:

- mark failed
- keep `last_error`
- do not delete the row

### 10.5 Polling

The runner should:

- poll every 15 seconds when idle
- heartbeat a claimed lease
- release/advance the row through status updates only

No custom queue infrastructure is needed.

---

## 11. Query Layer And Package Layout

### 11.1 New Files

- `packages/db/src/queries/agent-notifications.ts`
- `packages/common/src/schemas/agent-notifications.ts`
- `apps/api/src/worker/notifications.ts`
- `apps/api/src/notification-worker.ts`
- `docs/specs/agent-notification-webhooks.md`

### 11.2 Existing Files To Extend

- `packages/db/supabase/migrations/001_baseline.sql`
- `packages/db/src/index.ts`
- `packages/db/src/schema-compatibility.ts`
- `packages/db/src/tests/schema-compatibility.ts`
- `packages/common/src/index.ts`
- `apps/api/src/routes/agents.ts`
- `packages/chain/src/indexer/settlement.ts`
- `packages/chain/src/indexer/challenge-events.ts`
- `apps/api/package.json`
- `apps/api/src/lib/openapi.ts`
- `docs/data-and-indexing.md`
- `docs/contributing/agent-guide.md`
- `docs/operations.md`

### 11.3 Route Schema Additions

Add Zod contracts for:

- PUT request
- GET response
- PUT response
- DELETE response
- webhook event payload shape

All request validation should fail fast with existing structured error
envelopes and next actions.

---

## 12. Testing And Verification

### 12.1 Unit Tests

- endpoint create/update/disable query behavior
- notification enqueue dedupe
- payload grouping by `(agent_id, challenge_id, solver_address)`
- signature generation
- retry classification

### 12.2 Integration Tests

- agent registers webhook and receives secret on create
- agent updates URL without rotating secret
- settlement finalization creates one outbox row for one attributed wallet
- top-three payout with two different wallets under one agent creates two rows
- re-running settlement repair does not create duplicates
- disabled endpoint does not receive new rows
- delivery worker retries on `5xx` and marks delivered on later `2xx`
- terminal `4xx` marks failed

### 12.3 Smoke Coverage

Extend local lifecycle smoke to cover:

1. agent-attributed submission
2. webhook registration
3. challenge finalization
4. outbox row creation
5. successful callback receipt

### 12.4 Build And Runtime Verification

Required checks:

- `pnpm schema:verify`
- `pnpm turbo build`
- targeted tests for DB, API, and chain indexer paths
- local lifecycle smoke when feasible

---

## 13. Rollout Plan

### Phase 1

Ship:

- webhook registration routes
- encrypted secret storage
- claimable notification outbox
- separate notification runner
- `payout.claimable`

### Phase 2

Only after Phase 1 is stable, consider:

- `payout.claimed`
- manual replay/backfill tooling
- multi-endpoint fanout
- richer receiver diagnostics

---

## 14. Acceptance Criteria

This feature is complete when:

1. a direct agent can register one webhook endpoint through authenticated API
2. finalizing a challenge with an attributed unclaimed payout creates exactly
   one outbox row per `(agent_id, challenge_id, solver_address)`
3. replaying settlement projection does not create duplicates
4. the notification runner signs and delivers the payload successfully
5. the runner retries transient failures with backoff and marks permanent
   failures clearly
6. schema/runtime verification includes the new tables and columns
7. docs and OpenAPI reflect the new routes and payload contract

---

## 15. Implementation Notes

The cleanest minimal implementation in this repo is:

- finalization-based event emission
- wallet-aware dedupe
- one active endpoint per agent
- one separate notification runner
- one new event type

Anything beyond that should be justified by a concrete requirement, not by
future-proofing.
