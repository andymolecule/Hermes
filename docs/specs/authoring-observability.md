# Authoring Conversation Observability

> Status: Draft
> Scope: Internal per-session replay for authoring debugging.
> Public session API contract remains governed by `docs/specs/authoring-session-api.md`.

---

## 0. Intent

Agora needs one simple debugging surface for authoring sessions:

- show the full caller/Agora exchange for one session
- show blockers, state transitions, and publish outcomes in order
- correlate turns to `request_id` and service logs
- use those session replays to improve prompts, question design, and backend behavior

This is **not** a generalized observability platform.

## 1. Scope

In scope:

- append-only conversation replay stored on the session row itself
- one internal operator read surface by `session_id`
- one CLI command to render the replay
- structured service logs emitted alongside session-log writes

Out of scope for this MVP:

- cross-session search
- live tail / streaming
- web operator panel
- retention scheduler
- fine-tuning export pipeline
- public history APIs

## 2. Hard Rules

1. Public authoring reads stay snapshot-only.
2. Conversation replay is internal-only.
3. The session row remains the single source of truth.
4. Every replay entry must include `timestamp` and `request_id` when available.
5. Replay data must never store secrets, file bytes, or provider chain-of-thought.

## 3. Storage Model

Store the replay directly on `authoring_sessions`:

```ts
authoring_sessions.conversation_log_json jsonb not null default []
```

Each element is an append-only entry. Existing entries are never rewritten in place.

Why this design:

- simplest thing that satisfies the current use case
- no second table or indexing strategy to maintain
- easy to fetch a whole session replay in one read
- enough for debugging one Telegram/OpenClaw session at a time

## 4. Entry Shape

Each replay entry stores:

```ts
{
  timestamp: string,
  request_id: string | null,
  route: string,
  event:
    | "turn.input.recorded"
    | "turn.output.recorded"
    | "turn.validation_failed"
    | "publish.requested"
    | "publish.prepared"
    | "publish.completed"
    | "publish.failed"
    | "session.expired",
  actor: "caller" | "agora" | "system" | "publish",
  summary: string,
  state_before: string | null,
  state_after: string | null,
  intent?: {...},
  execution?: {...},
  files?: [...],
  resolved?: {...},
  validation?: {
    missing_fields: [...],
    invalid_fields: [...],
    dry_run_failure?: {...} | null,
    unsupported_reason?: {...} | null,
  },
  artifacts?: [...],
  publish?: {
    funding?: string | null,
    challenge_id?: string | null,
    contract_address?: string | null,
    tx_hash?: string | null,
    spec_cid?: string | null,
  },
  error?: {
    status?: number | null,
    code?: string | null,
    message: string,
    next_action?: string | null,
  }
}
```

## 5. When To Append Entries

Append replay entries on:

- `POST /api/authoring/sessions`
  - caller turn
  - Agora turn
- `PATCH /api/authoring/sessions/:id`
  - caller turn
  - Agora turn
- invalid create/patch/publish/confirm turns against an existing session
  - validation-failed entry
- `POST /api/authoring/sessions/:id/publish`
  - publish requested
  - publish prepared for wallet flow
  - publish completed or failed
- `POST /api/authoring/sessions/:id/confirm-publish`
  - publish completed
- automatic expiry transition
  - session expired

If a request fails before a session exists, only structured service logs are required.

## 6. Internal Read Surface

Required MVP route:

- `GET /api/internal/authoring/sessions/:id/timeline`

Rules:

- protected by `AGORA_AUTHORING_OPERATOR_TOKEN`
- returns the current public session state plus `conversation_log_json`
- internal-only; never exposed through public caller auth

## 7. CLI Surface

Required MVP command:

```bash
agora session-timeline <session_id>
```

Supported output modes:

- default readable text
- `--format json`
- optional `--limit <n>` for the last N entries

The CLI uses:

- `AGORA_API_URL`
- `AGORA_AUTHORING_OPERATOR_TOKEN`

## 8. Service Logs

Every replay append should also emit a structured service log line with:

- `session_id`
- `request_id`
- route
- event name
- state before / after

These logs are for correlation and fallback, not the primary replay surface.

## 9. Privacy Rules

Allowed in replay entries:

- structured intent patches
- structured execution patches
- resolved state snapshots
- validation blockers
- artifact metadata and safe URLs
- publish refs after success

Never store:

- bearer tokens
- API keys
- SIWE signatures
- private keys
- file bytes
- hidden provider prompts
- signed URL query secrets

URL rule:

- keep origin + path
- strip query string and fragment unless explicitly known-safe

## 10. Why Not A Separate Events Table

Not needed for the current scope.

That extra complexity only becomes justified when Agora truly needs:

- cross-session search
- event-type dashboards
- time-range triage across many sessions
- bulk export pipelines

Those are explicitly out of scope for this MVP.

## 11. Acceptance Criteria

This spec is satisfied when an operator can:

1. fetch one session replay by `session_id`
2. see the caller inputs and Agora state transitions in order
3. see the resolved state and validation output returned on each turn
4. see validation failures and rejection blockers in context
5. see publish preparation / success / failure in the same replay
6. correlate replay entries to backend logs using `request_id`
7. debug a Telegram/OpenClaw session without needing the pasted chat transcript
