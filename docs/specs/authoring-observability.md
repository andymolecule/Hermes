# Authoring Telemetry And Conversation Observability

> Status: Active design target
> Scope: Internal telemetry for authoring-session pilot rollouts and operator debugging.
> Public session API contract remains governed by `docs/specs/authoring-session-api.md`.

---

## 0. Intent

Agora needs one internal telemetry model for the authoring flow that is good
enough for pilot releases to multiple agents.

This telemetry must let operators answer:

- which agent hit Agora
- which authoring endpoint it hit
- what structured input it sent
- what blocker Agora returned
- which phase failed: ingress, semantic validation, compile, dry-run, publish,
  or registration
- whether the session reached a deployed on-chain challenge
- which blocker codes repeat across agents so Layer 0 and Layer 1 can be
  tightened

This is not a generalized telemetry platform. It is a narrow internal surface
for:

- per-session replay
- cross-session blocker analysis
- rollout debugging for a small set of agents

## 1. Why The Current MVP Is Not Enough

The current system already has useful pieces:

- structured request logs with `requestId`
- `authoring_sessions.conversation_log_json` for per-session replay
- one internal session timeline route
- on-chain challenge registration and indexed event projection

That is sufficient for debugging one known session after it exists.

It is not sufficient for pilot telemetry because it still misses:

- failures before a session row exists
- authoring uploads as first-class telemetry events
- cross-session search by `agent_id`, blocker code, route, or time window
- one durable authoring trace id across create, patch, publish, and registration
- consistent request-log enrichment with `agent_id`, `session_id`, `challenge_id`,
  and `tx_hash`
- a clean distinction between "caller-correctable blocker" and "platform or
  runtime failure" at the telemetry layer

## 2. Keep / Delete / Refactor

### Keep

- `authoring_sessions.conversation_log_json` as the single-session replay
  surface
- structured service logs as correlation and fallback
- the internal timeline route for one known session
- public authoring APIs unchanged; telemetry remains internal-only

### Delete Or Stop Doing

- treating session replay as the only durable authoring telemetry surface
- relying on transient request logs for failures that happen before a session is
  created
- storing raw provider chain-of-thought, hidden prompts, or free-form secret
  material
- adding telemetry metadata directly to the semantic authoring JSON contract

### Refactor

- one shared telemetry emit helper for create, patch, upload, publish,
  confirm-publish, and expiry paths
- one canonical event taxonomy reused by session replay and cross-session event
  storage
- one stable `trace_id` propagated from the first authoring request through
  publish and registration
- request logs enriched with the same identity and reference fields that durable
  telemetry stores

## 3. Hard Rules

1. Public authoring request and response contracts stay unchanged.
2. Telemetry is internal-only.
3. `conversation_log_json` stays append-only.
4. Every durable authoring telemetry event must include `timestamp`,
   `request_id`, and `trace_id`.
5. Every authenticated authoring request from an agent must produce a durable
   telemetry event, even if no session row exists yet.
6. No raw provider chain-of-thought is stored.
7. If agent-side reasoning is useful, it must be an explicit caller-supplied
   `decision_summary`, not hidden model internals.
8. Secrets, file bytes, bearer keys, SIWE signatures, and signed URL query
   secrets must never be stored.
9. Session replay and cross-session telemetry must share the same event names
   and failure codes.

## 4. Boundary Decision

Agora should not try to reconstruct an agent's hidden reasoning process.

The clean telemetry contract is:

- Agora records what the caller sent
- Agora records how Agora classified it
- Agora records what Agora did next
- Agora records the concrete outcome refs: `session_id`, `challenge_id`,
  `contract_address`, `tx_hash`, `spec_cid`

If a caller wants to expose more context for debugging, Agora may accept a small
explicit summary such as:

- `trace_id`
- `client_name`
- `client_version`
- `decision_summary`

Those values are caller-declared telemetry, not inferred chain-of-thought.

## 5. Telemetry Model

### 5.1 Per-session replay stays on the session row

Keep:

```ts
authoring_sessions.conversation_log_json jsonb not null default []
```

This remains the best surface for:

- replaying one session in order
- showing caller input and Agora output together
- correlating timeline entries to request logs

### 5.2 Add one cross-session event ledger

Pilot telemetry now justifies a second internal store:

```ts
authoring_events
```

Purpose:

- capture authoring requests before a session exists
- support cross-session search by agent, code, route, and time
- support blocker-pattern analysis across a pilot cohort

This is not a full event-sourcing system. It is a small append-only operator
ledger.

Minimum top-level fields:

```ts
{
  id: string,
  created_at: string,
  request_id: string,
  trace_id: string,
  session_id: string | null,
  agent_id: string | null,
  publish_wallet_address: string | null,
  route: string,
  event: string,
  phase:
    | "auth"
    | "upload"
    | "ingress"
    | "semantic"
    | "compile"
    | "dry_run"
    | "publish"
    | "registration"
    | "system",
  actor: "caller" | "agora" | "system" | "publish",
  outcome: "accepted" | "blocked" | "failed" | "completed",
  http_status: number | null,
  code: string | null,
  state_before: string | null,
  state_after: string | null,
  summary: string,
  refs: {
    challenge_id?: string | null,
    contract_address?: string | null,
    tx_hash?: string | null,
    spec_cid?: string | null
  },
  validation?: {...},
  client?: {
    client_name?: string | null,
    client_version?: string | null,
    decision_summary?: string | null
  },
  payload_json: jsonb
}
```

Indexed query paths:

- `(created_at desc)`
- `(agent_id, created_at desc)`
- `(session_id, created_at asc)`
- `(trace_id, created_at asc)`
- `(code, created_at desc)`
- `(phase, created_at desc)`

### 5.3 Stable trace propagation

Add one stable internal `trace_id` for authoring flows.

Rules:

- callers may send `X-Agora-Trace-Id`
- if absent, Agora generates one on the first authoring request
- once a session exists, its `trace_id` becomes canonical for later patch,
  publish, and confirm-publish turns
- the same `trace_id` must appear in:
  - durable authoring events
  - session timeline entries or session-level metadata
  - structured request logs
  - publish and registration events

### 5.4 Caller telemetry metadata stays out of semantic JSON

To avoid polluting the public semantic contract, pilot telemetry metadata should
travel in headers, not authoring request bodies.

Supported internal headers:

- `X-Agora-Trace-Id`
- `X-Agora-Client-Name`
- `X-Agora-Client-Version`
- `X-Agora-Decision-Summary`

`X-Agora-Decision-Summary` is optional, short, and explicit. It is not hidden
chain-of-thought.

## 6. Canonical Event Taxonomy

The same event names should be used in session replay and cross-session events.

Required names:

- `turn.input.recorded`
- `turn.output.recorded`
- `turn.validation_failed`
- `upload.recorded`
- `upload.failed`
- `publish.requested`
- `publish.prepared`
- `publish.chain_submitted`
- `publish.chain_confirmed`
- `publish.completed`
- `publish.failed`
- `registration.completed`
- `registration.failed`
- `session.expired`

Event names answer "what happened".

`phase` answers "which boundary was active":

- `auth`
- `upload`
- `ingress`
- `semantic`
- `compile`
- `dry_run`
- `publish`
- `registration`
- `system`

`code` answers "why it blocked or failed".

This split keeps analytics deterministic:

- `event` for timeline readability
- `phase` for operator grouping
- `code` for blocker pattern analysis

## 7. When To Emit Events

Emit durable authoring events for:

- `POST /api/authoring/uploads`
  - upload accepted
  - upload failed
- `POST /api/authoring/sessions`
  - request observed
  - session created or blocked
- `PATCH /api/authoring/sessions/:id`
  - request observed
  - session updated or blocked
- `POST /api/authoring/sessions/:id/publish`
  - publish requested
  - wallet publish prepared
  - publish completed or failed
- `POST /api/authoring/sessions/:id/confirm-publish`
  - confirm requested
  - registration completed or failed
  - publish completed or failed
- automatic expiry
  - session expired
- agent-auth failures on authoring routes
  - auth blocked
- request-shape failures on authoring routes
  - ingress blocked

If a request fails before a session exists, the event must still be written to
`authoring_events`.

## 8. Internal Read Surfaces

Keep:

- `GET /api/internal/authoring/sessions/:id/timeline`

Add:

- `GET /api/internal/authoring/events`

Required filters:

- `agent_id`
- `session_id`
- `trace_id`
- `route`
- `phase`
- `code`
- `since`
- `until`
- `limit`

Optional next step after MVP:

- grouped summaries by `agent_id`, `code`, and `phase`

For the pilot, one filtered event list is enough if the payload is consistent
and queryable.

## 9. Request Log Tightening

Current request logs only bind request-level metadata at ingress.

Tighten them so authoring request logs consistently include, when known:

- `requestId`
- `traceId`
- `agentId`
- `sessionId`
- `route`
- `event`
- `phase`
- `code`
- `challengeId`
- `contractAddress`
- `txHash`

Request logs remain a correlation surface, not the system of record.

## 10. Privacy And Redaction

Allowed:

- structured intent deltas
- structured execution deltas
- validation blockers
- artifact metadata
- safe URLs without signed query strings
- explicit caller telemetry headers
- publish refs and on-chain ids

Never store:

- bearer tokens
- API keys
- SIWE signatures
- private keys
- file bytes
- raw provider prompts
- hidden chain-of-thought
- signed URL query secrets

URL rule:

- keep origin + path
- strip query string and fragment unless explicitly known-safe

## 11. Tightening Order

1. Add trace propagation and one shared authoring telemetry emit helper.
2. Add the append-only `authoring_events` ledger for uploads, authoring turns,
   publish, registration, and pre-session failures.
3. Enrich request logs with the same identity and reference fields.
4. Add the internal filtered event route for operator debugging.
5. Only after that, add grouped summaries or export tooling if the pilot proves
   the need.

## 12. Acceptance Criteria

This spec is satisfied when an operator can:

1. list all recent authoring interactions for one `agent_id`
2. find repeated blocker codes across a time window
3. follow one `trace_id` from first authoring request through session state and
   publish outcome
4. see upload, validation, compile, publish, and registration failures as
   separate phases
5. fetch one session replay by `session_id`
6. correlate a timeline entry to backend logs with `request_id`
7. determine whether a blocked interaction was caller-correctable or a platform
   failure
8. do all of the above without storing raw chain-of-thought or secrets
