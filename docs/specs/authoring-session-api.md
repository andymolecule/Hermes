# Authoring Session API — Locked Spec

> Status: Step 1 (Business Logic) — LOCKED
> Status: Step 2 (Clarification / anti-drift scaffold) — COMPLETE
> Implementation follows the active machine-contract migration order in `docs/specs/machine-contract-migration.md`.

---

## 0. Clarifying Scope

### 0.1 Why This Doc Exists

The last few days of work drifted because code, docs, and UI kept redefining the public contract at the same time.

The recurring ambiguities were:
- the public noun (`posting session` vs `draft` vs `session`)
- the identity model (external thread/post ID / external ID vs Agora session ID)
- the caller surface (web vs OpenClaw agent vs generic external partner flow)
- the minimum create payload (full intent vs rough context)
- the lifecycle model (compiler-centric states vs business-centric session states)
- the delete boundary (which old routes and response shapes were truly being retired)

This doc exists to stop that loop before more implementation work happens.

### 0.2 What This Doc Is Authoritative For

- The public API contract for the authoring session flow
- Shared business behavior between web and agent callers
- Which existing public concepts and routes must be deleted on cutover
- The exact scope of what Agora does vs what callers do

### 0.3 What This Doc Is NOT For

- UI polish or interaction copy
- New scorer/runtime capabilities
- New external platform integrations beyond the current web + OpenClaw scope unless explicitly approved later
- Rollout mechanics that do not affect the public session contract

### 0.4 Authority Rule

If this doc conflicts with:
- implementation details in routes/tests
- older "draft" terminology in other docs

then this doc wins for the session API contract.

Adjacent docs and code should be updated only after the contract and cutover checklist are locked.

### 0.5 Freeze Rule

No new authoring/session refactors should land until:
1. the unresolved decisions table is answered
2. the candidate delete list is approved
3. the detailed session contract is written
4. the cutover mode is explicit

### 0.6 Naming Note

This document started as a Beach/OpenClaw-focused spec, but it currently defines the shared session contract for both:
- OpenClaw agent calls
- Agora web poster calls

If that shared scope is not desired, it must be explicitly cut in section 4 before implementation resumes.

### 0.7 Current Platform Assumption Correction

Beach.science is an agent-facing social platform, not a Telegram relay or Agora integration backend.

For this spec:
- the non-web caller should be modeled as an **OpenClaw agent**
- Beach should be treated as optional provenance/source context, not as a required middleman
- Agora never funds or signs challenge creation on behalf of a caller
- agent-controlled wallet publish is the canonical non-web publish path in scope for this revision
- older alternate publish-path assumptions are deleted rather than preserved for compatibility
- previous Beach-specific partner-route and callback assumptions must be treated as reopened wherever they still appear below

### 0.8 Privacy Default

Privacy is the default decision rule for this contract.

If a scope or contract choice affects:
- who can see a session
- who can infer that a session exists
- who can access in-progress data
- whether data is shared beyond the authenticated caller without an explicit requirement

then the spec should choose the more private behavior unless there is a clear product requirement saying otherwise.

### 0.9 Transparency Default

Transparency is the default decision rule for solver-facing challenge behavior.

If a scope or contract choice affects:
- how a challenge is scored
- what runtime or scorer image is used
- what solvers are expected to submit
- what limits, thresholds, or payout conditions apply

then the spec should choose the more transparent behavior unless there is a clear product requirement saying otherwise.

### 0.10 Spec Filter

This document should focus on decisions that are painful to change after implementation starts.

Spec-worthy questions include:
- boundaries between systems, callers, and endpoints
- identity and auth
- state machine and legal transitions
- request/response data shapes that external callers depend on
- public naming (nouns, route paths, state names)
- hard invariants and behavioral rules
- wallet-backed publish and money flow

Questions that should usually be left to implementation unless they become externally binding include:
- pagination mechanics
- exact summary/list-item field selection
- internal module structure
- exact English wording of error messages
- performance tuning
- UI rendering details

Decision test:
- if changing it next week would break an external caller or violate a hard invariant, it belongs in the spec
- if it is cheap to change during implementation without breaking the public contract, it should usually stay out of the spec for now

## 1. Business Logic

### 1.1 Actors

| Actor | What they do |
|-------|-------------|
| **OpenClaw agent** | Agent caller. Sends structured intent, execution fields, files, and optional provenance. Patches unresolved fields deterministically. Confirms publish. Beach provenance may be attached as metadata when relevant. |
| **Poster on web** | Human user on the Agora web UI. Same validation-first flow as the agent caller but authenticated via SIWE wallet instead of the agent auth mechanism. |
| **Agora (system)** | Receives structured state. Validates it deterministically. Returns resolved state, validation blockers, and compilation outputs. Publishes when confirmed. |

### 1.2 What Agora Does and Does NOT Do

Agora does:
- Normalize incoming context into a structured intermediate representation
- Specify required machine fields and valid recovery options clearly
- Return exact missing or invalid fields
- Validate against scorer/runtime requirements
- Publish when the caller explicitly confirms

Agora does NOT:
- Serve as a brainstorming partner for the caller
- Automatically invoke Layer 2 inference during the default session flow
- Decide the bounty (reward amount, deadline, distribution)
- Assume answers the caller didn't provide
- Auto-publish without explicit confirmation

### 1.2A Identity Domains (Locked)

Agora treats these identity domains as separate:

| Domain | Meaning | Canonical storage |
|-------|---------|-------------------|
| Agora agent identity | Which authenticated Agora agent created a session or published through Agora | `auth_agents.id` joined through nullable `created_by_agent_id` foreign keys |
| Wallet identity | Which wallet acts on-chain | `poster_address`, `solver_address`, `tx_hash`, `claim_tx_hash` |
| Source provenance | Where a session or published challenge came from | read-only `provenance` / `source_*` metadata |

Rules:
- provenance is never used as session identity or ownership
- authenticated agent identity is never inferred from `source_agent_handle`
- the target storage model uses nullable `created_by_agent_id` on agent-owned authoring sessions and published challenges
- wallet identity remains canonical for on-chain actions even when an authenticated agent is also known
- challenge repair or re-registration flows never establish new ownership; they preserve any existing `created_by_agent_id` set during authenticated publish

### 1.2B Machine Boundary Rule

In the default `/sessions` flow, Agora is a deterministic specifier and
validator of machine input. It is not an interpreter of loose machine
synonyms.

Rules:
- when Agora already knows the canonical allowed values for a field, callers
  must send one of those canonical values
- if the request envelope is well formed but a semantic value is unsupported,
  the session returns `awaiting_input` with `validation.invalid_fields`
- create, patch, and later get must preserve the same field-level validation
  classification

This keeps Agora machine-first without reintroducing assistive or
conversational authoring behavior.

### 1.3 Verbs (The Validation Flow)

```
1. Caller sends structured intent, execution fields, files, and optional provenance
2. Agora runs deterministic validation and compilation first
3. If required fields are missing or invalid, Agora returns exact blockers, missing fields, and invalid fields
4. Caller sends corrected structured fields or additional files via a patch
5. Agora reruns deterministic validation and dry-run
6. If validation passes -> Agora returns `ready` with checklist and compilation
7. Caller confirms publish
8. Agora deploys on-chain and returns refs
```

Layer 2 inference is not part of this default flow.

If Agora later exposes an explicit assist path for loose natural-language
inference, that is a separate mode and not part of the default `/sessions`
contract defined here.

### 1.4 Nouns (Domain Objects)

| Noun | Stored? | Where |
|------|---------|-------|
| Session | Yes | `authoring_sessions` table |
| Resolved state | Yes | jsonb within session row (`authoring_ir_json`) |
| Validation state | Yes | persisted validation snapshot within the session aggregate; canonical reads must return it directly rather than reconstructing it from generic compile hints |
| Artifacts | Yes | Pinned to IPFS, refs stored in session row |
| Checklist | Derived | Built from compilation outcome at read time |
| Spec | Yes | Built by compiler, stored as `compilation_json` |
| Preview / Dry-run | Derived | Generated from compiled spec at read time |
| Publish result | Yes | `published_challenge_id`, `published_spec_cid`, on-chain refs |

### 1.5 State Machine

```
[awaiting_input] → [ready] → [published]
       ↑              ↓
       └──────────────┘  (structured patch loop)

       ↓
 [rejected]  (caller says they can't provide required info,
              or task fundamentally doesn't fit)

 [expired]   (session inactive past TTL)
```

| State | Meaning | Who triggers transition |
|-------|---------|------------------------|
| `awaiting_input` | Agora needs additional structured fields, files, or fixes before it can proceed | System (after deterministic validation finds recoverable gaps) |
| `ready` | All 4 publish gates passed. Confirmation checklist available. | System (after Layer 3 compile + dry-run pass) |
| `published` | On-chain challenge deployed. Terminal. | Caller (explicit confirm) → System (deploys) |
| `rejected` | Task cannot become a valid challenge. Terminal. | Caller (says `cannot_answer`) or System (fundamentally unsupported) |
| `expired` | Session timed out due to inactivity. Terminal. | System (TTL elapsed) |

`created` may exist internally as a brief transient persistence state between row creation and processing, but it is not part of the public API state enum.

TTL policy:
- internal `created`: 15 minutes
- `awaiting_input`: 24 hours
- `ready`: 2 hours

Rationale:
- `awaiting_input` must allow for async correction loops across web and agent callers
- `ready` is intentionally shorter because the work is already complete and only explicit publish confirmation remains

Legal public transitions:

| From | To | Allowed? | Rule |
|------|----|----------|------|
| internal `created` | `awaiting_input` | Yes | Deterministic validation identifies missing or invalid information the caller can fix |
| internal `created` | `ready` | Yes | Deterministic validation, compile, and dry-run succeed with no blocking gaps |
| internal `created` | `rejected` | Yes | Task is fundamentally unsupported |
| `awaiting_input` | `awaiting_input` | Yes | Caller response still leaves blocking gaps |
| `awaiting_input` | `ready` | Yes | Caller response resolves gaps and compile/validation succeeds |
| `awaiting_input` | `rejected` | Yes | Caller indicates they cannot provide required info, or task is determined to be unsupported |
| `awaiting_input` | `expired` | Yes | TTL elapses |
| `ready` | `published` | Yes | Caller explicitly confirms publish and deployment succeeds |
| `ready` | `expired` | Yes | TTL elapses before publish |
| `published` | any other state | No | Terminal means terminal |
| `rejected` | any other state | No | Terminal means terminal |
| `expired` | any other state | No | Terminal means terminal |

There is no reopen path. If the caller wants to try again after `rejected` or `expired`, or wants changes after `ready`, they must create a new session.

### 1.6 Vocabulary (Locked)

| Concept | Public name (API responses, docs) | DB table/column | Internal code |
|---------|----------------------------------|-----------------|---------------|
| A bounty creation attempt | **session** | `authoring_sessions` | `AuthoringSession` |
| Resolved authoring state | **resolved** | jsonb in `authoring_ir_json` | `ChallengeAuthoringIr` |
| Validation result | **validation** | jsonb in `authoring_ir_json` | `AuthoringValidationState` |
| An uploaded file | **artifact** | refs in `uploaded_artifacts_json` | `AuthoringArtifact` |
| The lifecycle position | **state** | `state` column | `SessionState` |
| The compiled output | **compilation** | `compilation_json` column | `CompilationOutcome` |
| Confirmation items | **checklist** | derived from compilation | `ConfirmationChecklist` |

Public names in this table are permanent. Internal names can change freely.

### 1.7 Hard Rules

1. **Every bounty attempt = new session.** Never refresh, reuse, or dedupe against an existing session. External post/thread IDs are metadata/provenance only, not identity.
2. **Agora specifies, validates, publishes.** Agora never decides reward amount, deadline, distribution, or domain on the caller's behalf, and it does not reinterpret loose machine synonyms for canonical fields later in compile.
3. **The default session contract is structured.** The main `/sessions` API does not model question/answer turns as the core machine protocol.
4. **`ready` requires all 4 publish gates passed.** No partial readiness.
5. **Publish requires explicit confirmation.** Response includes a final checklist summary. Caller sends `confirm_publish: true`.
6. **OpenClaw agents can send partial structured input.** At least one of `intent`, `execution`, or `files` must be present to start a session.
7. **Public concept is "session."** `draft` is not a public API/documentation concept, and internal persistence/code should use session terminology as well.
8. **No provenance-based refresh.** Source provenance is not used to look up and refresh a previous session. Each `POST /sessions` creates a new session unconditionally.
9. **`ready` sessions are frozen.** Once a session reaches `ready`, it cannot be edited. The only valid next actions are publish, expire, or abandon and start a new session.
10. **Public session responses are snapshots, not transcripts.** The API exposes current state, resolved fields, validation blockers, artifacts, and outputs. Conversation-turn history is not part of the core public session shape.
11. **One canonical session shape, with one publish-preparation exception.** `create`, `get by id`, `patch`, and `confirm-publish` all return the canonical session object. `publish` returns a wallet publish preparation object instead.
12. **List is the only read-summary exception.** `GET /sessions` returns a lighter self-scoped list-item shape for browsing, not the full canonical session object.
13. **Canonical session responses are grouped by concern.** The full session object centers `resolved`, `validation`, `checklist`, `compilation`, and `artifacts` rather than a flat conversational payload.
14. **Canonical fields always exist.** Arrays default to `[]`. `resolved` and `validation` always exist as objects. Other objects and scalar outputs default to `null` when not yet applicable.
15. **`expires_at` is explicit.** The canonical session object includes an absolute `expires_at` timestamp. When a session transitions into a state with a new TTL window, `expires_at` is refreshed accordingly.
16. **Every session has a creator.** The canonical session object includes a required `creator` field representing the authenticated principal that created the session.
17. **Sessions are private before publish.** Only the authenticated principal that created the session may read it, patch it, or publish it.
18. **Non-owner access is hidden, not explained.** If a caller attempts to access another principal's session, the API returns `404 not_found` rather than revealing that the session exists.
19. **Provenance is metadata only.** `provenance` is never used as a relational identity key for sessions, challenges, or submissions.
20. **Agent attribution uses Agora ids, not copied names.** The target data model stores nullable `created_by_agent_id` / `submitted_by_agent_id` foreign keys and joins `auth_agents.agent_name` at read time when needed.
21. **Wallet identity remains canonical for chain actions.** Poster and solver wallets, transaction hashes, and claim records stay wallet-based even when an Agora agent is also known.
22. **Agora stays platform-agnostic at the file boundary.** The session API accepts fetchable file URLs and Agora artifact refs. Platform-specific file handles such as Telegram file IDs are out of the public contract.
23. **Default session flow is deterministic.** `POST /sessions` and `PATCH /sessions/:id` must run one shared deterministic assessment boundary first and must not automatically invoke Layer 2 inference.
24. **Layer 2 is explicit assist-only.** If Agora exposes an inference helper later, it must be an explicit assist path outside the default `/sessions` contract.
25. **Structured inputs are authoritative.** `intent`, `execution`, and `files` are the source of truth. The default session contract does not accept conversational freeform fields.
26. **Standard V1 authoring resolves runtime internally.** Callers provide metric, artifact binding, and column mappings. Agora resolves the matching official template and pinned scorer runtime internally, but public session payloads remain semantic-only and do not expose template ids, scorer images, mounts, or runner limits.
27. **Validation issues classify the blocking layer.** Each validation issue carries `blocking_layer = input | dry_run | platform` so callers can distinguish missing poster input from Agora runtime/dependency outages.
28. **Validation issues may include candidate values.** When Agora can name valid recovery choices, such as current artifact IDs, it returns them in `candidate_values` instead of forcing callers to guess.
29. **Canonical session responses include readiness.** The canonical session object includes a compact `readiness` snapshot for `spec`, `artifact_binding`, `scorer`, and `dry_run`, plus a derived `publishable` boolean.
30. **`ready` is an authoring gate, not a publish guarantee.** A `ready` session has passed Agora's authoring compile and dry-run gates, but the caller wallet transaction must still succeed on-chain and match the compiled session during `confirm-publish`.
31. **Challenge creation is always caller-wallet funded.** Agora never funds or server-signs challenge creation.
32. **`confirm-publish` validates the supplied transaction against the active factory and compiled session.** If the tx reverted or mismatched the session, Agora returns the canonical authoring error envelope and includes decoded chain diagnostics in `error.details` when available.
33. **Well-formed semantic mistakes stay in the session object.** Unsupported values inside a valid create/patch envelope return `awaiting_input` with `validation.invalid_fields`; they do not become top-level `invalid_request` errors.
34. **Create, patch, and get share one validation truth.** Public `validation` comes from the persisted assessment result, not from read-time heuristics over compile error codes.
35. **Closed semantic fields reuse canonical shared schemas.** Fields such as `domain` must reuse the same `@agora/common` enum/union definitions across authoring input, session output, challenge queries, and challenge summaries.

### 1.8 Publish Gates (All 4 Required for `ready`)

| Gate | Layer | What it checks |
|------|-------|---------------|
| Spec built | Layer 3 | Challenge YAML compiles from the IR without errors |
| Official scorer path resolved | Layer 3 | The scoring configuration is resolved from the registry and can execute the selected metric and artifact bindings |
| Evaluation binding resolved | Layer 3 | The hidden evaluation artifact and required column mappings are fully resolved |
| Dry-run validated + scoreability passed | Layer 3 | `validateChallengeScoreability()` passes against the resolved execution contract |

### 1.9 Layer Definitions

| Layer | Name | Type | What it does |
|-------|------|------|-------------|
| Layer 2 | Assist-only assessor | Optional LLM-assisted adapter | Interprets loose caller context only when explicit assist mode is requested |
| Layer 3 | Compiler + validator | Deterministic | Builds challenge spec from IR, validates against runtime/scorer requirements, runs dry-run |

In the default session API, blockers should normally come from deterministic validation and Layer 3.

Layer 2 should not appear as the blocking authority in the default `/sessions`
path.

### 1.10 API Surface

**Same session contract, one route family, separate auth only.** Web and non-web callers use the same session engine and the same public route family. Auth differs, not the route surface.

| Caller | Route prefix | Auth | Status |
|--------|-------------|------|--------|
| Web (poster) | `/api/authoring/sessions/*` | SIWE wallet session | Locked |
| OpenClaw agent | `/api/authoring/sessions/*` | Agora-issued API key via agent registration | Locked |

The auth middleware determines whether the caller is a web poster or an OpenClaw agent, then passes the authenticated identity into the same session/intake engine.

**Endpoints (same shape for both prefixes):**

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/sessions` | List the authenticated caller's own sessions |
| `POST` | `/sessions` | Create a new validation session from structured intent/execution/files |
| `GET` | `/sessions/:id` | Read current session state |
| `PATCH` | `/sessions/:id` | Submit structured corrections or additional files |
| `POST` | `/sessions/:id/publish` | Prepare caller-wallet tx inputs from a ready session and bind the poster wallet |
| `POST` | `/sessions/:id/confirm-publish` | Confirm a completed wallet-funded publish using the on-chain transaction hash |
| `POST` | `/uploads` | Upload a file, pin to IPFS, return artifact ref |

`GET /sessions` is the only endpoint that returns a lighter list-item shape instead of the full canonical session object.
For file inputs, Agora accepts fetchable URLs or Agora artifact refs only. Agents are responsible for translating platform-native file references into one of those forms before calling the session API.

Locked success response envelope rule:

- authoring success responses use the machine-wide `data` envelope
- `GET /sessions` returns `{ "data": [ ... ] }`
- `POST /sessions`, `GET /sessions/:id`, `PATCH /sessions/:id`, and `POST /sessions/:id/confirm-publish` return `{ "data": session }`
- `POST /sessions/:id/publish` returns `{ "data": wallet_preparation }`
- `POST /uploads` returns `{ "data": artifact }`

Locked file item shape:

```json
{
  "type": "url",
  "url": "https://example.com/data.csv"
}
```

```json
{
  "type": "artifact",
  "artifact_id": "art-123"
}
```

Rules:
- file items are typed objects, not bare strings
- `type: "url"` requires `url`
- `type: "artifact"` requires `artifact_id`
- callers must not rely on Agora guessing whether a string is a URL or an artifact ref

Locked minimal list-item shape:

```json
{
  "id": "session-123",
  "state": "awaiting_input",
  "summary": "Docking challenge against KRAS",
  "created_at": "2026-03-21T18:00:00Z",
  "updated_at": "2026-03-21T18:05:00Z",
  "expires_at": "2026-03-21T20:05:00Z"
}
```

No `creator` field is included in list items, because `GET /sessions` is already self-scoped to the authenticated caller.

Locked upload contract:

- endpoint: `POST /api/authoring/uploads`
- supports two input modes:
  - direct file upload
  - URL ingestion via JSON body
- both modes return the same normalized Agora artifact object

Example URL-ingestion request:

```json
{
  "url": "https://example.com/data.csv"
}
```

Example normalized upload response:

```json
{
  "artifact_id": "art-123",
  "uri": "ipfs://Qm...",
  "file_name": "data.csv",
  "role": null,
  "source_url": "https://example.com/data.csv"
}
```

Rules:
- callers may use `/uploads` for either local files or fetchable URLs
- the response shape is the same regardless of input mode
- normalized artifact objects always use the same fields in upload responses and session responses
- `role` is nullable until Agora classifies the artifact during session processing
- the returned artifact can be referenced later via `{ "type": "artifact", "artifact_id": "art-123" }`

Locked create request envelope:

```json
{
  "intent": {
    "title": "MDM2 benchmark ranking challenge",
    "description": "Rank candidate peptides against a hidden benchmark reference ranking.",
    "payout_condition": "Highest Spearman correlation wins.",
    "reward_total": "30",
    "deadline": "2026-04-01T23:59:59Z"
  },
  "execution": {
    "metric": "spearman",
    "evaluation_artifact_id": "art-123",
    "evaluation_id_column": "peptide_id",
    "evaluation_value_column": "reference_rank",
    "submission_id_column": "peptide_id",
    "submission_value_column": "predicted_score"
  },
  "files": [
    { "type": "url", "url": "https://example.com/ligands.csv" }
  ],
  "provenance": {
    "source": "beach",
    "external_id": "thread-abc"
  }
}
```

Rules:
- all top-level fields are optional
- at least one of one `intent` field, one `execution` field, or one `files` entry must be present
- `intent` is a partial structured challenge-intent patch
- `execution` is a partial structured table-scoring patch
- `files` contains typed file items representing fetchable URLs or Agora artifact refs
- `provenance` is optional metadata only
- machine callers should prefer `intent` and `execution` whenever they already know the fields

Locked patch request envelope:

```json
{
  "intent": {
    "reward_total": "30"
  },
  "execution": {
    "metric": "spearman",
    "evaluation_artifact_id": "art-123",
    "evaluation_id_column": "peptide_id",
    "evaluation_value_column": "reference_rank",
    "submission_id_column": "peptide_id",
    "submission_value_column": "predicted_score"
  },
  "files": [
    { "type": "url", "url": "https://example.com/extra_data.csv" }
  ]
}
```

Rules:
- all top-level fields are optional
- at least one of `intent`, `execution`, or `files` must be present
- `intent` and `execution` are merged as structured patches onto the current session state
- `files` contains typed file items representing additional attachments Agora should ingest and validate
- the default patch contract does not accept `message`, `messages`, or `answers`
- patching is intentionally the same machine-first model as create: callers send structured state deltas, not conversational turns

Locked publish request envelope:

```json
{
  "confirm_publish": true,
  "poster_address": "0x1234567890abcdef1234567890abcdef12345678"
}
```

Rules:
- `confirm_publish` must be present and `true`
- there is no `funding` field; all challenge creation is caller-wallet funded
- `poster_address` is optional for web callers whose authenticated SIWE wallet already defines the on-chain poster
- `poster_address` is required for agent callers and becomes the frozen poster wallet for `confirm-publish`
- no extra publish metadata fields are part of the request in the current scoped design

**Agent auth note:**

For the current scoped design, OpenClaw agents authenticate directly to Agora using an Agora-issued API key.

The intended flow is:
1. Agent calls `POST /api/agents/register` with its `telegram_bot_id`
2. Agora creates or finds the Agora agent identity for that bot
3. Agora issues a fresh agent API key
4. Agent uses that key as a bearer credential for future session calls

This mirrors the registration pattern agents already use with Beach, but it is Agora-native and does not depend on Beach.

Locked registration route:
- `POST /api/agents/register`
- agent registration is a general Agora capability, not an authoring-specific route

Locked agent auth header:
- `Authorization: Bearer <api_key>`
- no custom API key headers

Locked auth failure behavior:
- missing, malformed, invalid, expired, or revoked agent credentials all return the same auth error
- HTTP status: `401`
- the response must not reveal which auth check failed

Example:

```json
{
  "error": {
    "code": "unauthorized",
    "message": "Invalid or missing authentication.",
    "next_action": "Register at POST /api/agents/register and retry."
  }
}
```

Registration is pseudonymous, but bound to a stable technical identity:
- no KYC or real-world identity is required
- `telegram_bot_id` is the stable machine identity for the agent in the current scoped design
- no Beach or other third-party platform identity binding is required
- the API key proves the caller is an Agora-registered agent for that bot, not who the operator is in the real world
- if the same `telegram_bot_id` registers again, Agora returns the same `agent_id` and issues a fresh API key without revoking the old one

Locked registration contract:

Request:

```json
{
  "telegram_bot_id": "bot_123456"
}
```

Optional metadata may be included:

```json
{
  "telegram_bot_id": "bot_123456",
  "agent_name": "AUBRAI",
  "description": "Longevity research agent",
  "key_label": "ci-runner"
}
```

Response:

```json
{
  "data": {
    "agent_id": "11111111-1111-4111-8111-111111111111",
    "key_id": "22222222-2222-4222-8222-222222222222",
    "api_key": "agora_xxxxxxxx",
    "status": "created"
  }
}
```

Rules:
- `telegram_bot_id` is the only required registration field
- `agent_name`, `description`, and `key_label` are optional metadata fields and may be included at registration time
- the response shape is the same whether optional metadata is provided or not
- `status` is machine-readable and indicates whether the call created a new agent identity or issued a new key for an existing one
- re-registering the same `telegram_bot_id` returns the same `agent_id`, a new `key_id`, and `status = "existing_key_issued"`

### 1.11 Wallet-Funded Publish Only

| Model | Who pays on-chain | How it works |
|-------|-------------------|-------------|
| **Caller-funded** | The wallet that sends `createChallenge` | Caller approves USDC, signs tx, factory deploys challenge, API confirms the resulting transaction |

Rules:
- every challenge is funded by the caller wallet that sends `createChallenge`
- Agora never maintains any server-side challenge-create path
- web callers usually derive `poster_address` from the authenticated SIWE wallet
- agent callers bind `poster_address` during `POST /sessions/:id/publish`
- once a ready session has a bound `poster_address`, later `publish` retries and `confirm-publish` must reuse that address
- `confirm-publish` validates the tx receipt, emitted poster address, and compiled spec before marking the session `published`
- agent wallets are expected to be stable wallets with Base gas and USDC, following the same continuity rule Agora already uses for solver wallets

### 1.12 Callbacks (Webhooks)

Callbacks/webhooks are out of scope for the current contract.

The earlier callback model assumed Beach was an external integration host that Agora should notify directly. That assumption no longer holds now that the non-web caller is modeled as an OpenClaw agent, not a Beach backend.

Locked rule:
- direct mutation responses plus authenticated self-scoped `GET /sessions` and `GET /sessions/:id` reads are sufficient
- no callback registration, delivery, retry, or webhook auth contract is part of this spec revision

### 1.13 Edge Cases

| Scenario | Behavior |
|----------|----------|
| Empty input (no intent, no execution, no files) | Reject at validation. At least one structured field or one uploaded artifact is required. |
| Duplicate publish attempt | Idempotent — if already published, return the existing on-chain refs. |
| Session expired, caller tries to patch | Return error with `expired` state. Caller must create a new session. |
| Caller tries to `GET`, `PATCH`, or `publish` another principal's session | Return `404 not_found`. Do not reveal whether the session exists. |
| Dry-run fails after all required fields are supplied | State stays `awaiting_input` with a concrete `validation.dry_run_failure`. Caller may need to change a field, mapping, or artifact. |
| Publish called when state is not `ready` | Reject with current state and what's still needed. |
| Caller-signed publish tx reverts or confirms with mismatched chain data | Return `TX_REVERTED` or `invalid_request` in the canonical authoring error envelope, with decoded chain diagnostics in optional `error.details` when available. |

### 1.14 Response Transparency

Every session response includes:
- `creator` — the authenticated principal that created the session
- `resolved` — Agora's current accepted structured state
- `provenance` — read-only metadata about where the session came from
- `state` — current lifecycle position
- `created_at` — when the session was first created
- `updated_at` — when the session last changed
- `expires_at` — absolute time when the current session state times out
- `validation` — exact missing fields, invalid fields, dry-run mismatch, and terminal unsupported reason
- `checklist` — confirmation items (if `ready`)
- `compilation` — dry-run outcome (if `ready`), exposing the private session-owner compilation preview that Agora resolved for publish
- `artifacts` — current uploaded artifacts
- all canonical fields, even when their current value is `null` or `[]`

Identity rule:
- `creator` exposes the authenticated principal for the session
- `provenance` exposes origin metadata only
- the session contract does not imply that provenance and creator are the same actor

Cutover rule:

- the `spec_cid` returned after publish refers to the sanitized public
  `schema_version: 5` pinned spec
- private evaluation artifact URIs remain in private runtime/session state, not
  in the published public spec

---

## 2. Audit (Current State vs Target)

### 2.1 Why Recent Work Drifted

| Drift source | What kept changing | Effect |
|--------------|--------------------|--------|
| Public language not frozen | `posting session`, `draft`, and `session` coexisted | Docs, routes, tests, and UI optimized for different contracts |
| Scope not frozen | A non-web integration concept expanded into a shared agent + web authoring contract mid-stream | Large refactors landed before the actual target was stable |
| Identity not frozen | External thread/post IDs were treated as provenance in some places and as session identity in others | Refresh/reuse behavior was introduced and then contradicted |
| Identity domains not separated | source handles, Agora agent auth, and wallet ownership were too easy to conflate | Challenge/submission attribution and leaderboard behavior drifted |
| Input contract not frozen | Some flows assumed full intent up front, others allowed rough context | Adapters, validators, and tests encoded conflicting assumptions |
| State machine not frozen | Implementation kept compiler-centric states while the spec moved toward business-centric states | Storage and response payloads diverged from the intended product model |
| Delete boundary not frozen | Old `/drafts/*` surfaces stayed alive while new session language appeared | The codebase accumulated aliases instead of converging |
| Compatibility policy not decided | Old clients were neither fully supported nor explicitly cut over | Web/API mismatches could linger without a clear owner |

### 2.2 Current Hotspots That Must Be Resolved By Spec, Not By More Code

- Public noun: `draft` vs `session`
- Primary route family: `/drafts/*` vs `/sessions/*`
- Caller coverage: non-web-only vs shared agent + web
- Identity model: `external_id` provenance vs session identity
- Agora agent identity vs wallet identity vs provenance
- Minimum create input: rough context vs full intent
- Response model: legacy conversational payloads vs `resolved/validation/checklist/compilation`
- State model: compiler states vs business states
- Compatibility window: immediate cutover vs temporary shim

### 2.3 Audit Rule

For each hotspot above, this document must eventually produce:
- one chosen answer
- one explicitly deleted alternative
- one migration note if old behavior exists in code already

If a hotspot does not have all three, the spec is not ready to guide implementation.

## 3. Delete List

> Clarification stage only. Nothing in this section is locked until section 4 questions are answered.

### 3.1 Candidate Public-Contract Deletes

These are the highest-risk sources of future drift unless they are explicitly deleted on cutover:

- Public noun `draft`
- `/drafts/submit` as the canonical create route
- `/external/drafts/*` as the canonical generic external route family
- External thread/post IDs or `external_id` as session identity
- "refresh/reuse the same draft/session on repeated create from the same external source"
- Requiring agent callers to send full structured intent at create time
- `card` and `assessment` as the primary public session response
- Public state names `draft`, `compiling`, `needs_input`, and `failed`

### 3.2 Candidate Scope Cuts

These should stay out of scope unless explicitly re-approved after the session contract is locked:

- Generic multi-platform abstraction beyond the current scope
- Platform-specific backend integration assumptions
- Streaming session authoring APIs
- Additional route aliases not required for a short compatibility period
- UI-driven exceptions that bypass the shared session engine
- Net-new product behavior unrelated to the session contract

### 3.3 Compatibility Questions Still Needing A Decision

| Question | Options | Current recommendation | Decision |
|----------|---------|------------------------|----------|
| Do we support temporary `/drafts/*` aliases? | `yes` / `no` | Prefer `no` unless an already-shipped client cannot be cut over quickly | `LOCKED: no` |
| Do we keep `card` / `assessment` as public response helpers? | `yes` / `no` | Prefer `no` in the locked contract | `LOCKED: no` |
| Do we preserve generic `/api/authoring/external/*` routes? | `yes` / `no` | Prefer `no` if OpenClaw agent is the only non-web caller in scope | `LOCKED: no` |

## 4. Locked API Contract (Detailed)

### 4.1 Contract Principles

- One shared intake engine, with separate auth wrappers for web and agent callers
- `session.id` is the only continuation token after create
- `POST /sessions` must accept partial input
- `PATCH /sessions/:id` must accept structured state deltas
- Agora specifies required machine values clearly; it does not reinterpret loose
  semantic aliases later
- Caller-correctable semantic issues in a well-formed request stay in the
  session object as validation, not the top-level error envelope
- Create and patch persist one authoritative assessment snapshot; later `GET`
  returns that same validation classification
- `POST /sessions/:id/publish` must require explicit confirmation
- Direct mutation responses plus authenticated self-scoped `GET /sessions` and `GET /sessions/:id` reads are the only in-scope read model; callbacks/webhooks are out of scope
- Public contract should describe business states, not internal compiler mechanics

### 4.2 Open Decisions That Must Be Answered Before This Section Can Be Locked

| ID | Question | Why it matters | Current recommendation | Decision |
|----|----------|----------------|------------------------|----------|
| Q1 | Is this document authoritative for both OpenClaw agent and web session authoring, or one caller only? | Prevents the spec from being half-shared and half-caller-specific again | Prefer one shared contract with different auth wrappers | `LOCKED: one shared contract for OpenClaw agent and web; auth differs, contract does not` |
| Q2 | Is `session` the only public noun? | Prevents `draft` and `session` from coexisting in public routes/docs | Prefer `session` only | `LOCKED: session is the only public noun; draft is internal-only` |
| Q3 | Does every `POST /sessions` always create a new session? | Decides whether external IDs can ever be used for refresh/reuse | Prefer `yes` | `LOCKED: every POST /sessions creates a new session; external IDs are provenance only` |
| Q4 | Is the non-web caller a direct OpenClaw agent or a Beach partner backend? | Prevents the session contract from being built around the wrong platform boundary | Prefer direct OpenClaw agent | `LOCKED: the non-web caller is a direct OpenClaw agent; Beach is optional provenance, not the calling backend` |
| Q5 | What exact minimum input is valid for create? | Prevents adapters and validators from reintroducing incompatible assumptions | Prefer: at least one structured field or one uploaded artifact | `LOCKED: valid if at least one intent field, one execution field, or one uploaded artifact is present` |
| Q6 | Must files be represented as Agora artifact refs in the session API, or may callers send external URLs for Agora to ingest? | Locks the upload boundary and artifact lifecycle | Prefer Agora-managed artifact refs in the session contract, with ingestion as an adapter concern | `LOCKED: the session API accepts Agora artifact refs and raw external file URLs; Agora ingests, pins, and creates artifact refs internally. Platform-specific file handles such as Telegram file IDs are out of the public contract` |
| Q7 | When Layer 3 fails, what makes the session return to `awaiting_input` versus move to terminal `rejected`? | Prevents state drift and inconsistent recovery behavior | Prefer: recoverable caller fix = `awaiting_input`; unsupported task = `rejected` | `LOCKED: if the caller can fix it, state = awaiting_input; if the task is fundamentally unsupported, state = rejected` |
| Q8 | Is any backward compatibility period required for existing `/drafts/*` clients? | Determines whether we ship aliases or cut over directly | Prefer `no` unless a hard dependency is identified | `LOCKED: no compatibility period; cut directly to /sessions/* with zero public aliases` |
| Q9 | Do `card` and `assessment` remain in the public contract? | Prevents two different response models from surviving indefinitely | Prefer `no` | `LOCKED: delete card and assessment as public API concepts; expose one canonical session shape only` |
| Q10 | Is challenge publish always caller-wallet funded for both web and agent callers? | Prevents a hidden second money path from reappearing in the contract | Prefer `yes` | `LOCKED: all authoring publish is caller-wallet funded; no alternate server-side publish path exists` |
| Q11 | Do non-web callers need any callback/webhook contract in the current scope? | Reassesses the old Beach-backend callback assumption now that the non-web caller is the agent itself | Prefer no callbacks unless a real external host requirement exists | `LOCKED: no callbacks/webhooks in scope; synchronous mutation responses plus GET polling are sufficient` |
| Q12 | What are the TTL rules for `created`, `awaiting_input`, and `ready` sessions? | Prevents hidden product behavior from leaking out of implementation defaults | Prefer explicit per-state TTLs in the contract | `LOCKED: created = 15 minutes; awaiting_input = 24 hours; ready = 2 hours` |
| Q13 | Should the internal persistence layer also be renamed from `authoring_drafts` to `authoring_sessions`? | Separates public contract clarity from storage/migration cost | No default; requires explicit product + migration choice | `LOCKED: rename internal persistence and code to authoring_sessions / AuthoringSession` |
| Q14 | Are create/patch calls synchronous or asynchronous from the caller's perspective? | Determines whether callers get final blocking state immediately or must always poll/background wait | Prefer synchronous best-effort | `LOCKED: create/patch are synchronous best-effort; created is mostly internal/transient` |
| Q15 | What can `PATCH /sessions/:id` contain? | Determines the exact machine patch shape callers must send after create | Prefer one structured patch payload | `LOCKED: patch may include any combination of intent, execution, and files. File inputs must be fetchable URLs or Agora artifact refs, not platform-specific file handles` |
| Q16 | Should the API expose reasoning for validation blockers, and in what form? | Determines whether callers get precise machine-readable failure context without prose-heavy conversation scaffolding | Prefer structured validation issues only | `LOCKED: expose blocker reasoning only through structured validation objects; no separate question or chain-of-thought surface exists in the default contract` |
| Q17 | What must `POST /sessions/:id/publish` include? | Determines how the contract binds the poster wallet before the chain write while keeping `ready` sessions immutable | Prefer explicit confirm plus poster wallet binding only when needed | `LOCKED: publish requires confirm_publish. Agent callers must also provide poster_address; web callers may omit it because the authenticated SIWE wallet already defines the poster address. No freshness token is required because ready sessions are frozen` |
| Q18 | Should create/get/patch all return the same full canonical session shape? | Prevents endpoint-specific payload drift and client branching | Prefer one response shape everywhere | `LOCKED: create, get, and patch all return the same full canonical session shape` |
| Q19 | Should the public API expose conversation history or only the latest merged session snapshot? | Controls whether the core contract stays narrow or expands into turn-by-turn replay semantics | Prefer latest snapshot only | `LOCKED: public API exposes only the current merged session snapshot; history is internal/out-of-scope for now` |
| Q20 | What happens if a caller tries to patch a non-editable session? | Prevents hidden forks/reopens and keeps session semantics deterministic | Prefer explicit error with guidance | `LOCKED: patch on ready/published/rejected/expired returns an error with current state and guidance to create a new session` |
| Q21 | Is polling via GET enough for the locked contract, or is SSE/streaming in scope now? | Prevents the core contract from expanding into transport-specific streaming behavior prematurely | Prefer polling only for now | `LOCKED: GET /sessions/:id polling is sufficient; SSE/streaming is out-of-scope for now` |
| Q22 | Should the contract specify any conversational batching concept in the default path? | Separates the machine contract from the old human-assistant orchestration model | Prefer no | `LOCKED: no question-batch concept exists in the default machine contract` |
| Q23 | What should `POST /sessions/:id/publish` return? | Prevents publish from pretending the server completed the chain write and keeps one transport-neutral wallet flow | Prefer a preparation object only | `LOCKED: publish always returns WalletPublishPreparationSchema and keeps the session in ready until confirm-publish succeeds` |
| Q24 | What artifact shape should session responses expose? | Determines whether outputs are canonicalized or mirror messy caller inputs | Prefer normalized Agora artifact objects with provenance metadata | `LOCKED: session responses return normalized Agora artifacts with stable IDs/refs; original source URLs are provenance metadata only` |
| Q25 | Should the default machine contract include question IDs at all? | Determines whether callers must implement a conversational turn protocol or a direct state-patch protocol | Prefer no | `LOCKED: question IDs are not part of the default machine contract` |
| Q26 | What shape should validation blockers have? | Determines whether callers can distinguish missing data, invalid data, dry-run mismatches, and terminal unsupported reasons without overloading one field | Prefer a structured validation object | `LOCKED: validation is a structured object with missing_fields, invalid_fields, dry_run_failure, and unsupported_reason. It is always present in the canonical session object` |
| Q27 | What shape should `checklist` have when a session is ready? | Determines whether publish confirmation is typed/stable or a loose list | Prefer a structured object with named confirmation fields | `LOCKED: checklist is a structured object with named confirmation fields, not a generic array` |
| Q28 | Should `compilation` always exist in the canonical session shape? | Determines whether the session object is structurally stable across states | Prefer always-present nullable fields | `LOCKED: compilation is always present in the canonical session shape and is null until there is a compile outcome to expose` |
| Q29 | Should all canonical session fields always exist, even when not yet applicable? | Determines whether clients can rely on one flat stable type instead of conditional field presence | Prefer all fields always present | `LOCKED: all canonical session fields always exist; arrays default to []; objects/scalars default to null` |
| Q30 | What shape should error responses have? | Determines whether failure handling is consistent and machine-readable across the contract | Prefer one structured error envelope | `LOCKED: one structured error envelope everywhere with code, message, next_action, optional details, and relevant context such as state when applicable` |
| Q31 | Should `created` remain in the public state enum? | Determines whether callers must handle a transient state they should almost never see | Prefer internal-only if create/patch are synchronous best-effort | `LOCKED: created is internal-only and not part of the public state enum` |
| Q32 | What should each public validation issue contain? | Determines whether callers can remediate blockers without heuristically parsing prose | Prefer typed validation issues | `LOCKED: each validation issue includes field, code, message, next_action, blocking_layer, and candidate_values. The default contract has no public question objects` |
| Q33 | What shape should updates use in `PATCH /sessions/:id`? | Determines whether Agora can validate updates immediately at the boundary instead of inferring which conversational turn was intended | Prefer typed structured patches | `LOCKED: patch includes intent?, execution?, and files?; at least one must be present. There is no answers collection in the default contract` |
| Q34 | Which published fields belong on the canonical session object? | Prevents publish outputs from drifting into ad hoc per-caller convenience fields | Prefer a minimal explicit published field set | `LOCKED: canonical published fields are challenge_id, contract_address, spec_cid, and tx_hash; derived data stays out of the core contract` |
| Q35 | Should the canonical session object expose Agora's current resolved state? | Determines whether callers can see and correct what Agora currently accepts as the machine-readable challenge definition | Prefer explicit resolved state | `LOCKED: expose resolved.intent and resolved.execution on the session object; they reflect Agora's current accepted structured state, not a raw echo of caller input` |
| Q36 | Should the canonical session object expose source provenance metadata? | Determines whether callers can correlate a session back to its origin without turning provenance into identity | Prefer read-only provenance metadata | `LOCKED: expose provenance as read-only metadata; when the source is Beach this may include source, thread/post ID, and source_url; it is never used for lookup/identity and is null when absent` |
| Q36A | How should authenticated agent identity relate to provenance? | Prevents `source_agent_handle` from becoming a fake ownership key | Prefer explicit separation | `LOCKED: provenance is metadata only; authenticated agent identity is stored through nullable *_by_agent_id foreign keys and joined from auth_agents at read time` |
| Q36B | What is the canonical ownership model for agent-created sessions/challenges? | Prevents ownership from drifting between copied strings and wallet-only views | Prefer explicit agent ids plus wallet addresses | `LOCKED: agent-created sessions and published challenges use nullable created_by_agent_id for Agora identity; wallet addresses remain canonical for on-chain actions` |
| Q37 | Should the canonical session object expose expiration explicitly? | Determines whether callers can reason about expiry without reproducing TTL math client-side | Prefer absolute expiration timestamps | `LOCKED: expose expires_at as an absolute timestamp; it refreshes when the session enters a state with a new TTL window` |
| Q38 | Should the canonical session object include an explicit schema version field? | Determines whether versioning is embedded in payloads or handled at the route/docs boundary | Prefer no payload-level version field for now | `LOCKED: do not include schema_version on the session object; versioning lives at the API path/docs level if needed later` |
| Q39 | Should the canonical session object expose created/updated timestamps? | Determines whether callers get operational transparency about session recency and change timing | Prefer exposing both timestamps | `LOCKED: expose created_at and updated_at on the canonical session object` |
| Q40 | Should the canonical session object expose publish-permission metadata? | Determines whether authorization semantics live on the session object or remain part of publish-time validation | Prefer publish-time validation only | `LOCKED: do not expose publish-permission metadata on the session object; validate caller + poster_address binding at publish time` |
| Q41 | How should an OpenClaw agent authenticate directly to Agora in this scoped design? | Replaces the old Beach-partner auth assumption with the real non-web caller model | No default; must be explicitly locked | `LOCKED: agent registers directly with Agora using telegram_bot_id as its stable technical identity, receives an Agora-issued API key, and uses it as bearer auth for future session calls; no KYC or real-world identity is required` |
| Q42 | What is the registration route path for agent auth? | Prevents auth endpoints from drifting between general agent auth and authoring-specific auth | Prefer a general Agora agent registration route | `LOCKED: POST /api/agents/register; registration is a general Agora capability, not scoped under /authoring` |
| Q43 | How is the agent API key sent on authenticated requests? | Prevents auth middleware drift between standard bearer auth and custom headers | Prefer standard bearer auth | `LOCKED: agent requests use Authorization: Bearer <api_key>; no custom API key headers` |
| Q44 | How should agent auth failures be exposed? | Prevents middleware from leaking credential state or returning inconsistent auth errors | Prefer one generic unauthorized response | `LOCKED: missing, malformed, invalid, expired, or revoked agent credentials all return the same 401 unauthorized error envelope with next_action pointing to POST /api/agents/register` |
| Q45 | Should the canonical session object expose the creator? | Determines whether session ownership is explicit for traceability and authorization-sensitive client behavior | Prefer an explicit required creator field | `LOCKED: every session exposes a required creator field; for agent sessions use { type: "agent", agent_id }, and for web sessions use { type: "web", address }` |
| Q46 | What is the access rule for in-progress sessions? | Determines who may read or mutate a private authoring session before it becomes a public challenge | Prefer private-by-default access | `LOCKED: sessions are private to the authenticated principal that created them; only that principal may GET, PATCH, or publish the session before publish` |
| Q47 | How should non-owner session access be exposed? | Determines whether the API leaks the existence of private in-progress sessions to other authenticated principals | Prefer `404` for privacy | `LOCKED: non-owner GET/PATCH/publish attempts return 404 not_found; the API must not reveal whether the session exists` |
| Q48 | Should the contract include a list-sessions endpoint? | Determines whether callers can recover and inspect their own in-progress sessions without already holding a session ID | Prefer a self-scoped list endpoint | `LOCKED: add GET /api/authoring/sessions; it returns only the authenticated caller's own sessions` |
| Q49 | What should GET /api/authoring/sessions return? | Determines whether the list endpoint preserves the full session shape or uses a browsing-oriented summary shape | Prefer a lighter list item for browsing | `LOCKED: GET /api/authoring/sessions returns a lighter list-item shape, not the full canonical session object; it includes enough data to identify and resume a session` |
| Q50 | What exact fields belong in each list item? | Prevents the list endpoint from drifting back into a partial full-session payload | Prefer a minimal browse-only shape | `LOCKED: each list item contains exactly id, state, summary, created_at, updated_at, and expires_at` |
| Q51 | What is the exact create request envelope? | Defines the top-level request shape external callers must code against for POST /api/authoring/sessions | Prefer one agent-native structured envelope | `LOCKED: create accepts intent?, execution?, files?, and provenance?; at least one of intent, execution, or files must be present` |
| Q52 | What is the exact patch request envelope? | Defines the top-level request shape external callers must code against for PATCH /api/authoring/sessions/:id | Prefer one direct structured patch envelope | `LOCKED: patch accepts intent?, execution?, and files?; at least one must be present. Those fields are authoritative structured inputs` |
| Q53 | What is the exact publish request envelope? | Defines the top-level request shape external callers must code against for POST /api/authoring/sessions/:id/publish | Prefer a minimal explicit confirm payload with wallet binding only when needed | `LOCKED: publish accepts confirm_publish and optional poster_address. confirm_publish must be true. poster_address is required for agent callers and optional for web callers` |
| Q54 | What is the exact file item shape in create/patch payloads? | Defines how callers represent file URLs vs existing Agora artifacts without ambiguity | Prefer typed file items | `LOCKED: files is an array of typed objects; use { type: "url", url } for fetchable URLs and { type: "artifact", artifact_id } for existing Agora artifacts` |
| Q55 | Should the canonical full session object be mostly flat or grouped into nested sections? | Determines the structural shape every caller will code against for single-session operations | Prefer grouped by concern for machine clarity | `LOCKED: the canonical full session object is grouped into resolved, validation, checklist, compilation, and artifacts sections rather than a flat conversational shape` |
| Q56 | Where should validation explanations live in the canonical response? | Prevents the contract from duplicating the same explanation in multiple top-level fields | Prefer one source of truth inside validation issues | `LOCKED: validation explanations live only inside validation.missing_fields, validation.invalid_fields, validation.dry_run_failure, and validation.unsupported_reason` |
| Q57 | What exact top-level fields belong in the canonical full session object? | Defines the complete field set external callers may depend on across single-session operations | Prefer one explicit stable field set | `LOCKED: the canonical full session object contains exactly id, state, creator, resolved, validation, checklist, compilation, artifacts, provenance, challenge_id, contract_address, spec_cid, tx_hash, created_at, updated_at, and expires_at` |
| Q58 | Should compilation expose scoring direction explicitly? | Prevents callers and solvers from inferring score direction from metric names | Prefer an explicit objective field | `LOCKED: compilation includes explicit objective alongside metric, using objective = "maximize" | "minimize"` |
| Q59 | Should private authoring sessions expose runtime mechanics such as template ids or scorer images? | Prevents the session API from leaking internal execution routing into the machine contract | Prefer semantic-only session payloads | `LOCKED: no. Public authoring/session payloads do not expose template ids, scorer images, mounts, private evaluation URIs, or runner limits.` |
| Q60 | Should compilation expose the exact submission contract for solvers? | Determines whether solvers can know the required submission format without guessing from prose or external docs | Prefer an explicit machine-readable submission contract | `LOCKED: compilation includes submission_contract as a machine-readable object describing the expected submission format, limits, and structural requirements` |
| Q61 | What is the bundled compilation preview contract? | Defines the exact semantic preview object callers receive inside a private authoring session | Prefer one explicit semantic preview object | `LOCKED: compilation includes exactly metric, objective, evaluation_contract, submission_contract, reward, deadline, dispute_window_hours, and minimum_score. Runtime mechanics remain internal.` |
| Q62 | What is the public upload endpoint contract? | Defines how callers turn either local files or remote URLs into normalized Agora artifacts without building divergent file flows | Prefer one endpoint with two input modes and one output shape | `LOCKED: POST /api/authoring/uploads supports both direct file upload and URL ingestion, and both return the same normalized artifact object` |
| Q63 | What is the machine-readable error code set for the public contract? | Prevents callers from branching on ad hoc endpoint-specific error codes and keeps failure handling stable across auth, access, validation, and terminal-state cases | Prefer a small stable category set | `LOCKED: error.code is one of unauthorized, not_found, invalid_request, session_expired, unsupported_task, or TX_REVERTED. Publish-path chain reverts use TX_REVERTED; specific diagnostics belong in error.details rather than a larger enum` |
| Q64 | What is the legal state transition table for the public session lifecycle? | Prevents implementation drift around reopen behavior, terminal states, and which transitions are permitted after create/patch/publish/TTL events | Prefer a strict no-reopen lifecycle | `LOCKED: internal created may transition only to awaiting_input, ready, or rejected; awaiting_input may transition only to awaiting_input, ready, rejected, or expired; ready may transition only to published or expired; published, rejected, and expired are terminal and never reopen. If a caller wants to try again, they must create a new session` |
| Q65 | What is the shared normalized artifact schema? | Prevents upload responses and session artifacts from drifting into different shapes and keeps artifact classification semantics explicit | Prefer one stable artifact object with nullable role until classified | `LOCKED: the normalized artifact object contains exactly artifact_id, uri, file_name, role, and source_url. role is null until Agora classifies the artifact during session processing, and the same object shape is used in upload responses and session responses` |
| Q66 | What is the exact bundled agent registration contract? | Prevents agent onboarding and key rotation from drifting across partial auth decisions and removes ambiguity about optional metadata at the registration boundary | Prefer one minimal required field with optional profile metadata | `LOCKED: POST /api/agents/register accepts telegram_bot_id as the only required field and may also accept optional agent_name and description. It returns exactly agent_id, api_key, and status, where status is created or rotated. The response shape is the same whether optional metadata is provided or not` |
| Q67 | What is the success response envelope rule for the public API? | Prevents endpoint-specific wrapper drift and keeps client parsing rules uniform across registration, uploads, and single-session operations | Prefer one machine-wide response shape | `LOCKED: authoring success responses use the machine-wide data envelope. Collections return { "data": [...] } and single-resource results return { "data": ... }.` |
| Q68 | How narrow should the public submission_contract schema be in v1? | Prevents speculative generic abstractions from leaking into the solver-facing contract before Agora actually supports more submission kinds | Prefer a current-scope schema only | `LOCKED: submission_contract stays narrow and explicit for the current scoped design. It contains version, kind, extension, mime, max_bytes, and columns. kind refers to the concrete submission kind Agora supports now, not a speculative future abstraction` |
| Q69 | What is the bundled public checklist schema? | Defines the final confirmation object callers render before publish and prevents it from drifting into either a loose prose summary or a second typed compilation object | Prefer a concise human-facing summary object | `LOCKED: checklist is a concise confirmation summary object containing exactly title, domain, type, reward, distribution, deadline, metric, objective, and artifacts_count. It is optimized for human confirmation, while detailed typed challenge semantics live in compilation.` |
| Q70 | How should wallet-funded publish work when the signer may live in a browser or an agent runtime? | Prevents transport-specific forks while keeping one wallet continuity rule for all callers | Prefer one publish-prepare step plus one confirm step | `LOCKED: POST /sessions/:id/publish remains the single publish URL and always returns wallet tx preparation. POST /sessions/:id/confirm-publish validates the supplied tx_hash for both web and agent callers and transitions the session to published on success` |
| Q71 | How should Layer 2's natural-language turn surface in the public contract? | Determines whether the default session API is validation-first or conversation-first | Prefer no Layer 2 prose in the default path | `LOCKED: the default /sessions contract is structured and deterministic. It does not include assistant_message. If Agora later exposes an explicit assist path, that surface is separate and out of scope here.` |

### 4.3 Remaining High-Risk Contract Decisions

- None. High-risk contract decisions are locked.

Everything else below is primarily exact contract write-up, not major product scoping.

### 4.4 Exact JSON / Zod Contract

This section converts the locked decisions above into exact request/response and shared object shapes. It is the contract that implementation should code against.

#### 4.4.1 Shared Enums And Object Schemas

```ts
const PublicSessionStateSchema = z.enum([
  "awaiting_input",
  "ready",
  "published",
  "rejected",
  "expired",
]);

const PublishSessionRequestSchema = z.object({
  confirm_publish: z.literal(true),
  poster_address: z.string().trim().min(1).optional(),
});
const ObjectiveSchema = z.enum(["maximize", "minimize"]);
const ChallengeDomainSchema = z.enum([
  "longevity",
  "drug_discovery",
  "protein_design",
  "omics",
  "neuroscience",
  "other",
]);

const ErrorCodeSchema = z.enum([
  "unauthorized",
  "not_found",
  "invalid_request",
  "session_expired",
  "unsupported_task",
  "TX_REVERTED",
]);

// Imported from the shared authoring core schema module.
// Any closed semantic field in that schema, such as domain, must reuse the
// canonical shared enum rather than an arbitrary string.
const PartialChallengeIntentSchema = challengeIntentSchema.partial();

// Standard V1 authoring resolves the official template from the metric.
// Callers do not choose template ids directly.
const ExecutionInputSchema = z.object({
  metric: z.string().min(1).optional(),
  evaluation_artifact_id: z.string().min(1).optional(),
  evaluation_id_column: z.string().min(1).optional(),
  evaluation_value_column: z.string().min(1).optional(),
  submission_id_column: z.string().min(1).optional(),
  submission_value_column: z.string().min(1).optional(),
});

// Agora adds derived semantic resolution back in resolved state.
const ResolvedExecutionSchema = z.object({
  metric: z.string().min(1).optional(),
  objective: ObjectiveSchema.optional(),
  evaluation_artifact_id: z.string().min(1).optional(),
  evaluation_id_column: z.string().min(1).optional(),
  evaluation_value_column: z.string().min(1).optional(),
  submission_id_column: z.string().min(1).optional(),
  submission_value_column: z.string().min(1).optional(),
});

const FileInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("url"),
    url: z.string().url(),
  }),
  z.object({
    type: z.literal("artifact"),
    artifact_id: z.string().min(1),
  }),
]);

const ProvenanceSchema = z.object({
  source: z.string().min(1),
  external_id: z.string().min(1).optional(),
  source_url: z.string().url().optional(),
});

const CreatorSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("agent"),
    agent_id: z.string().min(1),
  }),
  z.object({
    type: z.literal("web"),
    address: z.string().min(1),
  }),
]);

const ValidationIssueSchema = z.object({
  field: z.string().min(1),
  code: z.string().min(1),
  message: z.string().min(1),
  next_action: z.string().min(1),
  blocking_layer: z.enum(["input", "dry_run", "platform"]),
  candidate_values: z.array(z.string().min(1)).default([]),
});

const DryRunFailureSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  next_action: z.string().min(1),
});

const UnsupportedReasonSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  next_action: z.string().min(1),
});

const ArtifactSchema = z.object({
  artifact_id: z.string().min(1),
  uri: z.string().min(1),
  file_name: z.string().min(1),
  role: z.string().nullable(),
  source_url: z.string().url().nullable(),
});

const ResolvedStateSchema = z.object({
  intent: PartialChallengeIntentSchema,
  execution: ResolvedExecutionSchema,
});

const ValidationSchema = z.object({
  missing_fields: z.array(ValidationIssueSchema),
  invalid_fields: z.array(ValidationIssueSchema),
  dry_run_failure: DryRunFailureSchema.nullable(),
  unsupported_reason: UnsupportedReasonSchema.nullable(),
});

const ReadinessCheckSchema = z.object({
  status: z.enum(["pass", "pending", "fail"]),
  code: z.string().min(1),
  message: z.string().min(1),
});

const ReadinessSchema = z.object({
  spec: ReadinessCheckSchema,
  artifact_binding: ReadinessCheckSchema,
  scorer: ReadinessCheckSchema,
  dry_run: ReadinessCheckSchema,
  publishable: z.boolean(),
});

const SubmissionContractSchema = z.object({
  version: z.literal("v1"),
  kind: z.literal("csv_table"),
  extension: z.literal(".csv"),
  mime: z.literal("text/csv"),
  max_bytes: z.number().int().positive(),
  columns: z.object({
    required: z.array(z.string().min(1)).min(1),
    id: z.string().min(1),
    value: z.string().min(1),
    allow_extra: z.boolean(),
  }),
});

const EvaluationContractSchema = z.object({
  kind: z.literal("csv_table"),
  columns: z.object({
    required: z.array(z.string().min(1)).min(1),
    id: z.string().min(1),
    value: z.string().min(1),
    allow_extra: z.boolean(),
  }),
});

const RewardSchema = z.object({
  total: z.string().min(1),
  currency: z.string().min(1),
  distribution: z.string().min(1),
  protocol_fee_bps: z.number().int().nonnegative(),
});

// Compilation is a private session-owner preview of challenge semantics, not
// runtime mechanics.
const CompilationSchema = z.object({
  metric: z.string().min(1),
  objective: ObjectiveSchema,
  evaluation_contract: EvaluationContractSchema,
  submission_contract: SubmissionContractSchema,
  reward: RewardSchema,
  deadline: z.string().datetime(),
  dispute_window_hours: z.number().int().nonnegative(),
  minimum_score: z.number().nullable(),
});

const ChecklistSchema = z.object({
  title: z.string().min(1),
  domain: ChallengeDomainSchema,
  type: z.string().min(1),
  reward: z.string().min(1),
  distribution: z.string().min(1),
  deadline: z.string().datetime(),
  metric: z.string().min(1),
  objective: ObjectiveSchema,
  artifacts_count: z.number().int().nonnegative(),
});

const SessionListItemSchema = z.object({
  id: z.string().min(1),
  state: PublicSessionStateSchema,
  summary: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  expires_at: z.string().datetime(),
});

const SessionSchema = z.object({
  id: z.string().min(1),
  state: PublicSessionStateSchema,
  creator: CreatorSchema,
  resolved: ResolvedStateSchema,
  validation: ValidationSchema,
  readiness: ReadinessSchema,
  checklist: ChecklistSchema.nullable(),
  compilation: CompilationSchema.nullable(),
  artifacts: z.array(ArtifactSchema),
  provenance: ProvenanceSchema.nullable(),
  challenge_id: z.string().nullable(),
  contract_address: z.string().nullable(),
  spec_cid: z.string().nullable(),
  tx_hash: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  expires_at: z.string().datetime(),
});

const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string().min(1),
    next_action: z.string().min(1),
    state: PublicSessionStateSchema.optional(),
    details: z.record(z.unknown()).optional(),
  }),
});
```

#### 4.4.2 `POST /api/agents/register`

Authentication:
- none

Request schema:

```ts
const RegisterAgentRequestSchema = z.object({
  telegram_bot_id: z.string().min(1),
  agent_name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
});
```

Success response schema:

```ts
const RegisterAgentResponseSchema = z.object({
  agent_id: z.string().min(1),
  api_key: z.string().min(1),
  status: z.enum(["created", "rotated"]),
});
```

Example request:

```json
{
  "telegram_bot_id": "bot_123456",
  "agent_name": "AUBRAI",
  "description": "Longevity research agent"
}
```

Example success response:

```json
{
  "agent_id": "agent-abc",
  "api_key": "agora_xxxxxxxx",
  "status": "created"
}
```

Validation rules:
- `telegram_bot_id` is required
- `agent_name`, `description`, and `key_label` are optional
- re-registering the same `telegram_bot_id` returns the same `agent_id`, issues a new key, does not revoke the existing keys, and sets `status = "existing_key_issued"`

Error cases:
- `400 invalid_request` for malformed request body

#### 4.4.3 `GET /api/authoring/sessions`

Authentication:
- required

Request:
- no body
- no query parameters in v1

Success response schema:

```ts
const ListSessionsResponseSchema = z.object({
  data: z.array(SessionListItemSchema),
});
```

Example success response:

```json
{
  "data": [
    {
      "id": "session-123",
      "state": "awaiting_input",
      "summary": "Docking challenge against KRAS",
      "created_at": "2026-03-21T18:00:00Z",
      "updated_at": "2026-03-21T18:05:00Z",
      "expires_at": "2026-03-22T18:05:00Z"
    }
  ]
}
```

Validation rules:
- returns only sessions owned by the authenticated principal
- list items use the lighter browse shape, not the full canonical session object

Error cases:
- `401 unauthorized`

#### 4.4.4 `POST /api/authoring/sessions`

Authentication:
- required

Request schema:

```ts
const CreateSessionRequestSchema = z.object({
  intent: PartialChallengeIntentSchema.optional(),
  execution: ExecutionInputSchema.optional(),
  files: z.array(FileInputSchema).min(1).optional(),
  provenance: ProvenanceSchema.optional(),
}).superRefine((value, ctx) => {
  const hasIntent = value.intent != null && Object.keys(value.intent).length > 0;
  const hasExecution =
    value.execution != null && Object.keys(value.execution).length > 0;
  const hasFiles = Array.isArray(value.files) && value.files.length > 0;

  if (!hasIntent && !hasExecution && !hasFiles) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide at least one of intent, execution, or files.",
    });
  }
});
```

Example request:

```json
{
  "intent": {
    "title": "MDM2 benchmark ranking challenge",
    "description": "Rank candidate peptides against a hidden benchmark reference ranking.",
    "payout_condition": "Highest Spearman correlation wins.",
    "reward_total": "30",
    "deadline": "2026-04-01T23:59:59Z"
  },
  "execution": {
    "metric": "spearman",
    "evaluation_artifact_id": "art-123",
    "evaluation_id_column": "peptide_id"
  },
  "files": [
    { "type": "url", "url": "https://example.com/mdm2_candidates.csv" }
  ],
  "provenance": {
    "source": "beach",
    "external_id": "thread-abc"
  }
}
```

Success response schema:

```ts
const SessionMutationResponseSchema = SessionSchema;
```

Example success response:

```json
{
  "id": "session-123",
  "state": "awaiting_input",
  "creator": {
    "type": "agent",
    "agent_id": "agent-abc"
  },
  "resolved": {
    "intent": {
      "title": "MDM2 benchmark ranking challenge",
      "description": "Rank candidate peptides against a hidden benchmark reference ranking.",
      "payout_condition": "Highest Spearman correlation wins.",
      "reward_total": "30",
      "deadline": "2026-04-01T23:59:59Z"
    },
    "execution": {
      "metric": "spearman",
      "objective": "maximize",
      "evaluation_artifact_id": "art-123",
      "evaluation_id_column": "peptide_id"
    }
  },
  "validation": {
    "missing_fields": [
      {
        "field": "evaluation_value_column",
        "code": "missing_field",
        "message": "Agora still needs the evaluation value column.",
        "next_action": "Provide the evaluation_value_column and retry.",
        "blocking_layer": "input",
        "candidate_values": []
      },
      {
        "field": "submission_value_column",
        "code": "missing_field",
        "message": "Agora still needs the submission value column.",
        "next_action": "Provide the submission_value_column and retry.",
        "blocking_layer": "input",
        "candidate_values": []
      }
    ],
    "invalid_fields": [],
    "dry_run_failure": null,
    "unsupported_reason": null
  },
  "readiness": {
    "spec": {
      "status": "pending",
      "code": "spec_pending_input",
      "message": "Agora still needs enough structured input to build the canonical challenge spec."
    },
    "artifact_binding": {
      "status": "pending",
      "code": "artifact_binding_pending",
      "message": "Agora still needs a valid evaluation artifact binding and column mappings."
    },
    "scorer": {
      "status": "pending",
      "code": "scorer_pending_resolution",
      "message": "Agora has not yet resolved the scoring configuration for this session."
    },
    "dry_run": {
      "status": "pending",
      "code": "dry_run_pending",
      "message": "Dry-run validation has not passed yet for this session."
    },
    "publishable": false
  },
  "checklist": null,
  "compilation": null,
  "artifacts": [
    {
      "artifact_id": "art-123",
      "uri": "ipfs://QmXyz...",
      "file_name": "mdm2_candidates.csv",
      "role": null,
      "source_url": "https://example.com/mdm2_candidates.csv"
    }
  ],
  "provenance": {
    "source": "beach",
    "external_id": "thread-abc"
  },
  "challenge_id": null,
  "contract_address": null,
  "spec_cid": null,
  "tx_hash": null,
  "created_at": "2026-03-21T18:00:00Z",
  "updated_at": "2026-03-21T18:00:00Z",
  "expires_at": "2026-03-22T18:00:00Z"
}
```

State transition effects:
- internal `created` -> `awaiting_input`
- internal `created` -> `ready`
- internal `created` -> `rejected`

Rejected response rule:
- if create ends in `rejected`, `session.validation.unsupported_reason` must be populated with the terminal reason

Error cases:
- `401 unauthorized`
- `400 invalid_request`

#### 4.4.5 `GET /api/authoring/sessions/:id`

Authentication:
- required

Success response:
- returns `{ "data": SessionSchema }`

Example success response (`data` payload shown inline below):

```json
{
  "id": "session-123",
  "state": "ready",
  "creator": {
    "type": "agent",
    "agent_id": "agent-abc"
  },
  "resolved": {
    "intent": {
      "title": "Rank ligands for KRAS binding affinity",
      "description": "Solvers rank ligands by predicted binding affinity against a hidden reference.",
      "payout_condition": "Highest Spearman correlation wins.",
      "reward_total": "30",
      "distribution": "winner_take_all",
      "deadline": "2026-04-01T23:59:59Z"
    },
    "execution": {
      "metric": "spearman",
      "objective": "maximize",
      "evaluation_artifact_id": "art-456",
      "evaluation_id_column": "ligand_id",
      "evaluation_value_column": "reference_score",
      "submission_id_column": "ligand_id",
      "submission_value_column": "docking_score"
    }
  },
  "validation": {
    "missing_fields": [],
    "invalid_fields": [],
    "dry_run_failure": null,
    "unsupported_reason": null
  },
  "readiness": {
    "spec": {
      "status": "pass",
      "code": "spec_ready",
      "message": "Agora compiled the canonical challenge spec."
    },
    "artifact_binding": {
      "status": "pass",
      "code": "artifact_binding_ready",
      "message": "The hidden evaluation artifact and column mappings are resolved."
    },
    "scorer": {
      "status": "pass",
      "code": "scorer_ready",
      "message": "The scoring configuration is resolved."
    },
    "dry_run": {
      "status": "pass",
      "code": "dry_run_ready",
      "message": "Dry-run validation passed."
    },
    "publishable": true
  },
  "checklist": {
    "title": "Rank ligands for KRAS binding affinity",
    "domain": "drug_discovery",
    "type": "docking",
    "reward": "30 USDC",
    "distribution": "winner_take_all",
    "deadline": "2026-04-01T23:59:59Z",
    "metric": "spearman",
    "objective": "maximize",
    "artifacts_count": 3
  },
  "compilation": {
    "metric": "spearman",
    "objective": "maximize",
    "evaluation_contract": {
      "kind": "csv_table",
      "columns": {
        "required": ["ligand_id", "reference_score"],
        "id": "ligand_id",
        "value": "reference_score",
        "allow_extra": true
      }
    },
    "submission_contract": {
      "version": "v1",
      "kind": "csv_table",
      "extension": ".csv",
      "mime": "text/csv",
      "max_bytes": 26214400,
      "columns": {
        "required": ["ligand_id", "docking_score"],
        "id": "ligand_id",
        "value": "docking_score",
        "allow_extra": true
      }
    },
    "reward": {
      "total": "30",
      "currency": "USDC",
      "distribution": "winner_take_all",
      "protocol_fee_bps": 1000
    },
    "deadline": "2026-04-01T23:59:59Z",
    "dispute_window_hours": 168,
    "minimum_score": null
  },
  "artifacts": [
    {
      "artifact_id": "art-123",
      "uri": "ipfs://QmXyz...",
      "file_name": "ligands.csv",
      "role": "ligand_library",
      "source_url": "https://example.com/ligands.csv"
    }
  ],
  "provenance": {
    "source": "beach",
    "external_id": "thread-abc"
  },
  "challenge_id": null,
  "contract_address": null,
  "spec_cid": null,
  "tx_hash": null,
  "created_at": "2026-03-21T18:00:00Z",
  "updated_at": "2026-03-21T18:10:00Z",
  "expires_at": "2026-03-21T20:10:00Z"
}
```

Validation rules:
- returns only the authenticated caller's own session
- non-owner access is hidden and returns `404 not_found`

Error cases:
- `401 unauthorized`
- `404 not_found`

#### 4.4.6 `PATCH /api/authoring/sessions/:id`

Authentication:
- required

Request schema:

```ts
const PatchSessionRequestSchema = z.object({
  intent: PartialChallengeIntentSchema.optional(),
  execution: ExecutionInputSchema.optional(),
  files: z.array(FileInputSchema).min(1).optional(),
}).superRefine((value, ctx) => {
  const hasIntent = value.intent != null && Object.keys(value.intent).length > 0;
  const hasExecution =
    value.execution != null && Object.keys(value.execution).length > 0;
  const hasFiles = Array.isArray(value.files) && value.files.length > 0;

  if (!hasIntent && !hasExecution && !hasFiles) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide at least one of intent, execution, or files.",
    });
  }
});
```

Example request:

```json
{
  "execution": {
    "evaluation_value_column": "reference_rank",
    "submission_id_column": "peptide_id",
    "submission_value_column": "predicted_score"
  },
  "files": [
    { "type": "url", "url": "https://example.com/extra_data.csv" }
  ]
}
```

Patch rule:
- `intent`, `execution`, and `files` are authoritative structured inputs
- patching merges only the supplied fields onto the existing session state
- the default patch contract does not accept conversational `message`, `messages`, or `answers`

Example success response:

```json
{
  "id": "session-123",
  "state": "ready",
  "creator": {
    "type": "agent",
    "agent_id": "agent-abc"
  },
  "resolved": {
    "intent": {
      "title": "MDM2 benchmark ranking challenge",
      "description": "Rank candidate peptides against a hidden benchmark reference ranking.",
      "payout_condition": "Highest Spearman correlation wins.",
      "reward_total": "30",
      "distribution": "winner_take_all",
      "deadline": "2026-04-01T23:59:59Z"
    },
    "execution": {
      "metric": "spearman",
      "objective": "maximize",
      "evaluation_artifact_id": "art-123",
      "evaluation_id_column": "peptide_id",
      "evaluation_value_column": "reference_rank",
      "submission_id_column": "peptide_id",
      "submission_value_column": "predicted_score"
    }
  },
  "validation": {
    "missing_fields": [],
    "invalid_fields": [],
    "dry_run_failure": null,
    "unsupported_reason": null
  },
  "readiness": {
    "spec": {
      "status": "pass",
      "code": "spec_ready",
      "message": "Agora compiled the canonical challenge spec."
    },
    "artifact_binding": {
      "status": "pass",
      "code": "artifact_binding_ready",
      "message": "The hidden evaluation artifact and column mappings are resolved."
    },
    "scorer": {
      "status": "pass",
      "code": "scorer_ready",
      "message": "The scoring configuration is resolved."
    },
    "dry_run": {
      "status": "pass",
      "code": "dry_run_ready",
      "message": "Dry-run validation passed."
    },
    "publishable": true
  },
  "checklist": {
    "title": "MDM2 benchmark ranking challenge",
    "domain": "drug_discovery",
    "type": "docking",
    "reward": "30 USDC",
    "distribution": "winner_take_all",
    "deadline": "2026-04-01T23:59:59Z",
    "metric": "spearman",
    "objective": "maximize",
    "artifacts_count": 3
  },
  "compilation": {
    "metric": "spearman",
    "objective": "maximize",
    "evaluation_contract": {
      "kind": "csv_table",
      "columns": {
        "required": ["peptide_id", "reference_rank"],
        "id": "peptide_id",
        "value": "reference_rank",
        "allow_extra": true
      }
    },
    "submission_contract": {
      "version": "v1",
      "kind": "csv_table",
      "extension": ".csv",
      "mime": "text/csv",
      "max_bytes": 26214400,
      "columns": {
        "required": ["peptide_id", "predicted_score"],
        "id": "peptide_id",
        "value": "predicted_score",
        "allow_extra": true
      }
    },
    "reward": {
      "total": "30",
      "currency": "USDC",
      "distribution": "winner_take_all",
      "protocol_fee_bps": 1000
    },
    "deadline": "2026-04-01T23:59:59Z",
    "dispute_window_hours": 168,
    "minimum_score": null
  },
  "artifacts": [
    {
      "artifact_id": "art-123",
      "uri": "ipfs://QmXyz...",
      "file_name": "mdm2_candidates.csv",
      "role": "ranking_inputs",
      "source_url": "https://example.com/mdm2_candidates.csv"
    }
  ],
  "provenance": {
    "source": "beach",
    "external_id": "thread-abc"
  },
  "challenge_id": null,
  "contract_address": null,
  "spec_cid": null,
  "tx_hash": null,
  "created_at": "2026-03-21T18:00:00Z",
  "updated_at": "2026-03-21T18:10:00Z",
  "expires_at": "2026-03-21T20:10:00Z"
}
```

State transition effects:
- `awaiting_input` -> `awaiting_input`
- `awaiting_input` -> `ready`
- `awaiting_input` -> `rejected`

Rejected response example:

```json
{
  "id": "session-123",
  "state": "rejected",
  "creator": {
    "type": "agent",
    "agent_id": "agent-abc"
  },
  "resolved": {
    "intent": {
      "title": "Free-form peptide binder rationale challenge"
    },
    "execution": {}
  },
  "validation": {
    "missing_fields": [],
    "invalid_fields": [],
    "dry_run_failure": null,
    "unsupported_reason": {
      "code": "unsupported_task",
      "message": "Agora requires deterministic scoring. Subjective winner criteria are not supported.",
      "next_action": "Reframe the challenge so the winner is determined by a metric computed from structured table submissions.",
      "blocking_layer": "input",
      "candidate_values": []
    }
  },
  "readiness": {
    "spec": {
      "status": "fail",
      "code": "AUTHORING_TASK_UNSUPPORTED",
      "message": "Agora requires deterministic scoring. Subjective winner criteria are not supported."
    },
    "artifact_binding": {
      "status": "fail",
      "code": "AUTHORING_TASK_UNSUPPORTED",
      "message": "Agora requires deterministic scoring. Subjective winner criteria are not supported."
    },
    "scorer": {
      "status": "fail",
      "code": "AUTHORING_TASK_UNSUPPORTED",
      "message": "Agora requires deterministic scoring. Subjective winner criteria are not supported."
    },
    "dry_run": {
      "status": "fail",
      "code": "AUTHORING_TASK_UNSUPPORTED",
      "message": "Agora requires deterministic scoring. Subjective winner criteria are not supported."
    },
    "publishable": false
  },
  "checklist": null,
  "compilation": null,
  "artifacts": [
    {
      "artifact_id": "art-123",
      "uri": "ipfs://QmXyz...",
      "file_name": "challenge-brief.md",
      "role": null,
      "source_url": null
    }
  ],
  "provenance": null,
  "challenge_id": null,
  "contract_address": null,
  "spec_cid": null,
  "tx_hash": null,
  "created_at": "2026-03-21T18:00:00Z",
  "updated_at": "2026-03-21T18:12:00Z",
  "expires_at": "2026-03-28T18:12:00Z"
}
```

Validation rules:
- `PATCH` on `ready`, `published`, or `rejected` returns `invalid_request`
- `PATCH` on `expired` returns `session_expired`

Error cases:
- `401 unauthorized`
- `404 not_found`
- `400 invalid_request`
- `409 session_expired`

#### 4.4.7 `POST /api/authoring/sessions/:id/publish`

Authentication:
- required

Request schema:

```ts
const PublishSessionRequestSchema = z.object({
  confirm_publish: z.literal(true),
  poster_address: z.string().min(1).optional(),
});
```

Example request:

```json
{
  "confirm_publish": true,
  "poster_address": "0x1234567890abcdef1234567890abcdef12345678"
}
```

Success response schema:

```ts
const WalletPublishPreparationSchema = z.object({
  spec_cid: z.string().min(1),
  factory_address: z.string().min(1),
  usdc_address: z.string().min(1),
  reward_units: z.string().min(1),
  deadline_seconds: z.number().int().nonnegative(),
  dispute_window_hours: z.number().int().nonnegative(),
  minimum_score_wad: z.string().min(1),
  distribution_type: z.number().int().nonnegative(),
  lab_tba: z.string().min(1),
  max_submissions_total: z.number().int().positive(),
  max_submissions_per_solver: z.number().int().positive(),
});
```

Example success response:

```json
{
  "spec_cid": "QmSpecCid",
  "factory_address": "0x1234",
  "usdc_address": "0x5678",
  "reward_units": "500000000",
  "deadline_seconds": 1775087999,
  "dispute_window_hours": 168,
  "minimum_score_wad": "0",
  "distribution_type": 0,
  "lab_tba": "0x0000000000000000000000000000000000000000",
  "max_submissions_total": 100,
  "max_submissions_per_solver": 5
}
```

State transition effects:
- session remains `ready`; publish is prepared but not completed

Validation rules:
- session must be in `ready`
- `ready` sessions are frozen; no freshness token is required
- `publish` always prepares a caller-wallet transaction; it does not publish the session by itself
- web callers may omit `poster_address`; the server derives it from the authenticated SIWE wallet
- agent callers must provide `poster_address`
- once `poster_address` is bound on a ready session, repeated publish calls must reuse it
- wallet publish preparation returns exact contract-call inputs; callers must treat `reward_units` as already scaled USDC base units and `minimum_score_wad` as already scaled 18-decimal units, not recompute them from human-readable values
- `lab_tba` is included because the factory call requires it; in the current scoped design it defaults to the zero address for standalone bounties unless an explicit Molecule lab linkage is introduced later

Error cases:
- `401 unauthorized`
- `404 not_found`
- `400 invalid_request`
- `409 session_expired`

#### 4.4.8 `POST /api/authoring/sessions/:id/confirm-publish`

Authentication:
- required

Request schema:

```ts
const ConfirmPublishRequestSchema = z.object({
  tx_hash: z.string().min(1),
});
```

Example request:

```json
{
  "tx_hash": "0xdeadbeef"
}
```

Success response:
- returns `{ "data": SessionSchema }`
- on success the session transitions from `ready` to `published`
- the returned session includes populated `challenge_id`, `contract_address`, `spec_cid`, and `tx_hash`

Validation rules:
- session must be in `ready`
- this endpoint is used for all wallet-funded publish flows, including agent-owned wallets
- the supplied transaction must match the session's bound `poster_address`
- the server validates the supplied on-chain transaction before marking the session as published

Error cases:
- `401 unauthorized`
- `404 not_found`
- `400 invalid_request`
- `409 session_expired`

#### 4.4.9 `POST /api/authoring/uploads`

Authentication:
- required

Request modes:
- multipart form-data with one required file field for direct upload
- JSON body for URL ingestion

URL-ingestion request schema:

```ts
const UploadUrlRequestSchema = z.object({
  url: z.string().url(),
});
```

Success response:
- returns `{ "data": ArtifactSchema }`

Example URL-ingestion request:

```json
{
  "url": "https://example.com/data.csv"
}
```

Example success response:

```json
{
  "artifact_id": "art-123",
  "uri": "ipfs://QmXyz...",
  "file_name": "data.csv",
  "role": null,
  "source_url": "https://example.com/data.csv"
}
```

Validation rules:
- direct uploads set `source_url = null`
- URL ingestion sets `source_url` to the ingested URL
- both modes return the same normalized artifact object

Error cases:
- `401 unauthorized`
- `400 invalid_request`

#### 4.4.10 Error Envelope Contract

HTTP status mapping:

| HTTP | `error.code` | When |
|------|--------------|------|
| `401` | `unauthorized` | Missing, malformed, invalid, expired, or revoked credentials |
| `404` | `not_found` | Session does not exist or is not owned by the caller |
| `400` | `invalid_request` | Malformed body, bad file item, invalid structured patch payload, publish when not ready, or attempts to mutate a non-editable non-expired session |
| `409` | `session_expired` | Caller attempts to mutate an expired session |
| `400` | `unsupported_task` | Request cannot produce or continue a valid session object at all |

Canonical example:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "This session is ready for publish and cannot accept more input.",
    "next_action": "Create a new session to make changes.",
    "state": "ready"
  }
}
```

Notes:
- `unsupported_task` should be used sparingly; if a session already exists and the workflow determines the task is unsupported, the preferred contract is a successful `SessionSchema` response with `state = "rejected"`
- user-facing message wording may vary, but `code` and envelope shape must remain stable

#### 4.4.11 State Transition Contract

| Endpoint / Trigger | From | To | Contract effect |
|--------------------|------|----|-----------------|
| `POST /sessions` | internal `created` | `awaiting_input` | Returns `SessionSchema` with `resolved` and non-empty `validation.missing_fields` and/or `validation.invalid_fields` |
| `POST /sessions` | internal `created` | `ready` | Returns `SessionSchema` with `checklist` and `compilation` |
| `POST /sessions` | internal `created` | `rejected` | Returns `SessionSchema` with terminal `rejected` state and non-null `validation.unsupported_reason` |
| `PATCH /sessions/:id` | `awaiting_input` | `awaiting_input` | Returns updated `SessionSchema` with remaining validation blockers |
| `PATCH /sessions/:id` | `awaiting_input` | `ready` | Returns `SessionSchema` with `checklist` and `compilation` |
| `PATCH /sessions/:id` | `awaiting_input` | `rejected` | Returns `SessionSchema` with terminal `rejected` state and non-null `validation.unsupported_reason` |
| TTL elapsed | `awaiting_input` | `expired` | Future mutation attempts return `session_expired` |
| `POST /sessions/:id/publish` | `ready` | `ready` | Returns `WalletPublishPreparationSchema`; caller signs and submits the on-chain transaction |
| `POST /sessions/:id/confirm-publish` | `ready` | `published` | Validates the supplied wallet `tx_hash` and returns `SessionSchema` with challenge refs populated |
| TTL elapsed | `ready` | `expired` | Future mutation attempts return `session_expired` |

Terminal rules:
- `published` never reopens
- `rejected` never reopens
- `expired` never reopens
- callers must create a new session to try again after any terminal state

### 4.5 Contract Writing Rule

Step 4 is not "done" until every endpoint above has:
- exact JSON examples
- Zod shape
- validation rules
- state transition effects
- error cases

No implementation work should start from prose alone.

## 5. Implementation Plan

> High-level scope decisions are locked. Implementation should tighten the
> current code to this contract, not invent a second authoring flow.

### 5.1 Tightening Order

1. Fix authoring semantic authority first
2. Unify wallet-funded authoring confirm-publish with shared challenge registration
3. Tighten canonical semantic schemas across `@agora/common`
4. Then do smaller cleanup like query-schema tightening and non-authoritative client preflight cleanup

### 5.2 Keep

- one public authoring route family: `/api/authoring/sessions/*`
- one canonical session shape and state machine
- semantic-only public payloads
- one wallet-funded publish flow for both web and agent callers
- client-side preflight as advisory only; API assessment remains authoritative

### 5.3 Delete Or Stop Doing

- read-time validation reconstruction from generic compile error codes
- caller-derived hard throws in create/patch assessment
- duplicate publish registration logic
- loose free-text modeling for closed semantic fields that already have shared
  canonical enums

### 5.4 Refactor Target

- one authoritative assessment boundary for `POST /sessions` and
  `PATCH /sessions/:id`
- one persisted validation snapshot that `GET /sessions/:id` returns unchanged
- one shared challenge-registration path used by confirm-publish and direct
  tx-hash registration
- one set of canonical finite semantic schemas in `@agora/common`

### 5.5 Concrete Code Plan

The detailed file-by-file implementation order and acceptance gates live in
`docs/specs/machine-contract-migration.md` Phase 6. That plan is the active
coding checklist for this contract.
