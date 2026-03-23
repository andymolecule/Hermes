# Authoring Session API — Locked Spec

> Status: Step 1 (Business Logic) — LOCKED
> Status: Step 2 (Clarification / anti-drift scaffold) — COMPLETE
> Implementation may proceed only through the cutover order in `docs/specs/authoring-session-cutover-checklist.md`.

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
- Which existing public concepts and routes must be deleted or compatibility-shimmed
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
4. the compatibility policy is explicit

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
- Agora's existing sponsor-funded publish path remains in scope for agent-created sessions
- future agent-controlled wallet flows or wallet-authorization flows are explicitly out of scope for this spec revision unless reopened later
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
- funding and money flow

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
| **OpenClaw agent** | Agent caller. Sends rough bounty context, messages, files, and optional provenance. Answers Agora's questions. Confirms publish. Beach provenance may be attached as metadata when relevant. |
| **Poster on web** | Human user on the Agora web UI. Same flow as the agent caller but authenticated via SIWE wallet instead of the agent auth mechanism. |
| **Agora (system)** | Receives context. Normalizes it. Identifies what's missing. Asks canonical questions. Validates against scorer/runtime requirements. Publishes when confirmed. |

### 1.2 What Agora Does and Does NOT Do

Agora does:
- Normalize incoming context into a structured intermediate representation
- Ask for what is missing
- Validate against scorer/runtime requirements
- Publish when the caller explicitly confirms

Agora does NOT:
- Decide the bounty (reward amount, deadline, distribution)
- Assume answers the caller didn't provide
- Auto-publish without explicit confirmation

### 1.3 Verbs (The Conversation Flow)

```
1. Caller sends rough context through message, summary, messages, files, and optional provenance
2. Agora runs Layer 2 (schema-guided LLM intake/validation)
3. Agora returns one short batch of canonical questions plus one assistant_message for the caller to display verbatim or adapt
4. Caller answers only those questions, but may also send one natural-language reply message in the same turn
5. Agora reruns Layer 2, then Layer 3 (deterministic compile/validation)
6. If compiler passes -> Agora returns "ready" with confirmation checklist and assistant_message
7. Caller confirms publish
8. Agora deploys on-chain and returns refs
```

### 1.4 Nouns (Domain Objects)

| Noun | Stored? | Where |
|------|---------|-------|
| Session | Yes | `authoring_sessions` table |
| Questions | Yes | jsonb within session row (`authoring_ir_json`) |
| Answers | Yes | Merged into session interaction state |
| Artifacts | Yes | Pinned to IPFS, refs stored in session row |
| Checklist | Derived | Built from compilation outcome at read time |
| Spec | Yes | Built by compiler, stored as `compilation_json` |
| Preview / Dry-run | Derived | Generated from compiled spec at read time |
| Publish result | Yes | `published_challenge_id`, `published_spec_cid`, on-chain refs |

### 1.5 State Machine

```
[awaiting_input] → [ready] → [published]
       ↑              ↓
       └──────────────┘  (question/answer loop)

       ↓
 [rejected]  (caller says they can't provide required info,
              or task fundamentally doesn't fit)

 [expired]   (session inactive past TTL)
```

| State | Meaning | Who triggers transition |
|-------|---------|------------------------|
| `awaiting_input` | Agora needs answers before it can proceed | System (after Layer 2 finds gaps) |
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
- `awaiting_input` must allow for real human response pace in Telegram-mediated conversations
- `ready` is intentionally shorter because the work is already complete and only explicit publish confirmation remains

Legal public transitions:

| From | To | Allowed? | Rule |
|------|----|----------|------|
| internal `created` | `awaiting_input` | Yes | Layer 2 identifies missing information |
| internal `created` | `ready` | Yes | Layer 2 + Layer 3 complete successfully with no missing information |
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
| The current question batch | **questions** | jsonb in `authoring_ir_json` | `IntakeQuestion` |
| Caller's replies | **answers** | merged into `authoring_ir_json.interaction` | `QuestionAnswer` |
| An uploaded file | **artifact** | refs in `uploaded_artifacts_json` | `AuthoringArtifact` |
| The lifecycle position | **state** | `state` column | `SessionState` |
| The compiled output | **compilation** | `compilation_json` column | `CompilationOutcome` |
| Confirmation items | **checklist** | derived from compilation | `ConfirmationChecklist` |

Public names in this table are permanent. Internal names can change freely.

### 1.7 Hard Rules

1. **Every bounty attempt = new session.** Never refresh, reuse, or dedupe against an existing session. External post/thread IDs are metadata/provenance only, not identity.
2. **Agora normalizes, asks, validates, publishes.** Agora never decides reward amount, deadline, distribution, or domain on the caller's behalf.
3. **Questions have stable IDs.** Answers reference question IDs explicitly. The server can merge into full session state internally.
4. **`ready` requires all 4 publish gates passed.** No partial readiness.
5. **Publish requires explicit confirmation.** Response includes a final checklist summary. Caller sends `confirm_publish: true`.
6. **OpenClaw agents can send partial input.** No full structured intent required. Even just a summary + files is valid to start a session.
7. **Public concept is "session."** `draft` is not a public API/documentation concept, and internal persistence/code should use session terminology as well.
8. **No provenance-based refresh.** Source provenance is not used to look up and refresh a previous session. Each `POST /sessions` creates a new session unconditionally.
9. **`ready` sessions are frozen.** Once a session reaches `ready`, it cannot be edited. The only valid next actions are publish, expire, or abandon and start a new session.
10. **Public session responses are snapshots, not transcripts.** The API exposes current state, pending questions, blockers, artifacts, and outputs. Conversation-turn history is not part of the core public session shape.
11. **One canonical session shape, with one wallet-publish exception.** `create`, `get by id`, `respond`, sponsor-funded `publish`, and `confirm-publish` all return the canonical session object. Wallet-funded `publish` is the only exception and returns a wallet publish preparation object instead.
12. **List is the only read-summary exception.** `GET /sessions` returns a lighter self-scoped list-item shape for browsing, not the full canonical session object.
13. **Canonical session responses are flat.** The full session object uses a flat top-level shape rather than nested sections, so callers can access all canonical fields directly.
14. **Canonical fields always exist.** Arrays default to `[]`. Objects and scalar outputs default to `null` when not yet applicable. No conditional field presence in the public session shape.
15. **`expires_at` is explicit.** The canonical session object includes an absolute `expires_at` timestamp. When a session transitions into a state with a new TTL window, `expires_at` is refreshed accordingly.
16. **Every session has a creator.** The canonical session object includes a required `creator` field representing the authenticated principal that created the session.
17. **Sessions are private before publish.** Only the authenticated principal that created the session may read it, respond to it, or publish it.
18. **Non-owner access is hidden, not explained.** If a caller attempts to access another principal's session, the API returns `404 not_found` rather than revealing that the session exists.
19. **Agora stays platform-agnostic at the file boundary.** The session API accepts fetchable file URLs and Agora artifact refs. Platform-specific file handles such as Telegram file IDs are out of the public contract.

### 1.8 Publish Gates (All 4 Required for `ready`)

| Gate | Layer | What it checks |
|------|-------|---------------|
| Spec built | Layer 3 | Challenge YAML compiles from the IR without errors |
| Execution template resolved | Layer 3 | A valid official scorer template + scorer image is resolved |
| Evaluation binding resolved | Layer 3 | The hidden evaluation artifact and required column mappings are fully resolved |
| Dry-run validated + scoreability passed | Layer 3 | `validateChallengeScoreability()` passes against the resolved execution contract |

### 1.9 Layer Definitions

| Layer | Name | Type | What it does |
|-------|------|------|-------------|
| Layer 2 | Intake validator | LLM-assisted | Interprets raw context, identifies missing fields, generates canonical questions |
| Layer 3 | Compiler + validator | Deterministic | Builds challenge spec from IR, validates against runtime/scorer requirements, runs dry-run |

Every session response should indicate which layer is currently blocking progress (if any), so the caller knows whether they need to provide more info (Layer 2) or whether there's a system-side validation issue (Layer 3).

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
| `POST` | `/sessions` | Create a new intake session from rough context |
| `GET` | `/sessions/:id` | Read current session state |
| `POST` | `/sessions/:id/respond` | Answer questions or provide additional context/files |
| `POST` | `/sessions/:id/publish` | Confirm sponsor publish immediately, or prepare wallet publish when funding = `wallet` |
| `POST` | `/sessions/:id/confirm-publish` | Confirm a completed wallet-funded browser publish using the on-chain transaction hash |
| `POST` | `/uploads` | Upload a file, pin to IPFS, return artifact ref |

`GET /sessions` is the only endpoint that returns a lighter list-item shape instead of the full canonical session object.
For file inputs, Agora accepts fetchable URLs or Agora artifact refs only. Agents are responsible for translating platform-native file references into one of those forms before calling the session API.

Locked success response envelope rule:

- single-resource success responses return the bare resource object directly, except `POST /sessions` and `POST /sessions/:id/respond`
- `POST /sessions` and `POST /sessions/:id/respond` return `{ "session": SessionSchema, "assistant_message": string }`
- collection success responses wrap the collection, e.g. `{ "sessions": [...] }`
- all other single-resource endpoints must not add wrappers such as `{ "session": ... }`, `{ "artifact": ... }`, or `{ "agent": ... }`

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
  "summary": "Want to create a docking challenge for KRAS",
  "messages": [
    { "text": "I found this interesting KRAS target paper" },
    { "text": "The ligand dataset is attached" }
  ],
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
- at least one of `message`, `summary`, one `messages` entry, or one `files` entry must be present
- `message` is the caller's first natural-language turn
- `messages` is an array of text-only message objects in the current scoped design
- `files` contains typed file items representing fetchable URLs or Agora artifact refs
- `provenance` is optional metadata only
- no extra structured-hint fields are part of the create request in the current scoped design

Locked respond request envelope:

```json
{
  "answers": [
    { "question_id": "q1", "value": "r2" },
    {
      "question_id": "q3",
      "value": { "type": "artifact", "artifact_id": "art-123" }
    }
  ],
  "message": "Also, the dataset has about 1000 ligands",
  "files": [
    { "type": "url", "url": "https://example.com/extra_data.csv" }
  ]
}
```

Rules:
- all top-level fields are optional
- at least one of `answers`, `message`, or `files` must be present
- `answers` is a typed collection keyed by `question_id`
- `answers` handles text, select, and file questions
- file-question answers use artifact references inside `answers`
- `message` is one freeform natural-language reply turn for additional Layer 2 context
- `files` contains typed file items representing extra unbound attachments
- `respond` is intentionally different from create: it is a direct reply to pending questions, not a raw conversation dump

Locked publish request envelope:

```json
{
  "confirm_publish": true,
  "funding": "sponsor"
}
```

Rules:
- `confirm_publish` must be present and `true`
- `funding` must be present and explicit
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
    "next_action": "Register or re-register at POST /api/agents/register"
  }
}
```

Registration is pseudonymous, but bound to a stable technical identity:
- no KYC or real-world identity is required
- `telegram_bot_id` is the stable machine identity for the agent in the current scoped design
- no Beach or other third-party platform identity binding is required
- the API key proves the caller is an Agora-registered agent for that bot, not who the operator is in the real world
- if the same `telegram_bot_id` registers again, Agora returns the same `agent_id`, issues a fresh API key, and invalidates the old key

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
  "description": "Longevity research agent"
}
```

Response:

```json
{
  "agent_id": "agent-abc",
  "api_key": "agora_xxxxxxxx",
  "status": "created"
}
```

Rules:
- `telegram_bot_id` is the only required registration field
- `agent_name` and `description` are optional metadata fields and may be included at registration time
- the response shape is the same whether optional metadata is provided or not
`status` is machine-readable and indicates whether the call created a new agent identity or rotated the key for an existing one.

### 1.11 Funding Models

| Model | Who pays on-chain | How it works |
|-------|-------------------|-------------|
| **Wallet-funded** | Poster's own wallet | Poster approves USDC, signs tx, factory deploys challenge |
| **Sponsor-funded** | Agora sponsor wallet | Agora's pre-configured sponsor key signs tx on the server for authorized agent-created sessions, with budget tracked via `authoring_sponsor_budget_reservations` |

Both models go through the same publish gate. The funding source is a publish-time decision, not a session-level concept.

Locked publish rule:
- web callers send `funding: "wallet"` or `funding: "sponsor"` explicitly
- agent callers also send `funding` explicitly
- in the current scoped design, agent-created sessions use `funding: "sponsor"`
- keeping `funding` explicit avoids a future contract break if agent wallet funding is added later

Current scope note:
- Agora already has a sponsor-funded authoring publish path for agent-native flows.
- Future agent-controlled wallet funding or wallet-authorization flows may exist later, but they are outside the current spec-clarification scope unless explicitly reopened.

### 1.12 Callbacks (Webhooks)

Callbacks/webhooks are out of scope for the current contract.

The earlier callback model assumed Beach was an external integration host that Agora should notify directly. That assumption no longer holds now that the non-web caller is modeled as an OpenClaw agent, not a Beach backend.

Locked rule:
- direct mutation responses plus authenticated self-scoped `GET /sessions` and `GET /sessions/:id` reads are sufficient
- no callback registration, delivery, retry, or webhook auth contract is part of this spec revision

### 1.13 Edge Cases

| Scenario | Behavior |
|----------|----------|
| Empty input (no message, no summary, no files, no messages) | Reject at validation. At least a message, a summary, one poster-authored message, or one uploaded artifact is required. |
| Duplicate publish attempt | Idempotent — if already published, return the existing on-chain refs. |
| Answer references a question ID that doesn't exist | Reject the answer, return error with valid question IDs. |
| Session expired, caller tries to respond | Return error with `expired` state. Caller must create a new session. |
| Caller tries to `GET`, `respond`, or `publish` another principal's session | Return `404 not_found`. Do not reveal whether the session exists. |
| Caller says `cannot_answer` for a required question | If the missing info is fundamental, move to `rejected` with reason. If optional, skip and re-evaluate. |
| Layer 3 fails after all questions answered | State stays `awaiting_input` with Layer 3 error exposed. Caller may need to change an answer or upload a different artifact. |
| Publish called when state is not `ready` | Reject with current state and what's still needed. |

### 1.14 Response Transparency

Every session response includes:
- `creator` — the authenticated principal that created the session
- `summary` — Agora's current normalized interpretation of the challenge/context
- `provenance` — read-only metadata about where the session came from
- `state` — current lifecycle position
- `created_at` — when the session was first created
- `updated_at` — when the session last changed
- `expires_at` — absolute time when the current session state times out
- `questions` — pending questions (if `awaiting_input`)
- `blocked_by` — which layer is blocking and why. Required for `awaiting_input` and `rejected`; null for `ready`, `published`, and `expired`
- `checklist` — confirmation items (if `ready`)
- `compilation` — dry-run outcome (if `ready`), exposing the full public scoring/submission contract while excluding hidden evaluation/reference data
- `artifacts` — current uploaded artifacts
- all canonical fields, even when their current value is `null` or `[]`

---

## 2. Audit (Current State vs Target)

### 2.1 Why Recent Work Drifted

| Drift source | What kept changing | Effect |
|--------------|--------------------|--------|
| Public language not frozen | `posting session`, `draft`, and `session` coexisted | Docs, routes, tests, and UI optimized for different contracts |
| Scope not frozen | A non-web integration concept expanded into a shared agent + web authoring contract mid-stream | Large refactors landed before the actual target was stable |
| Identity not frozen | External thread/post IDs were treated as provenance in some places and as session identity in others | Refresh/reuse behavior was introduced and then contradicted |
| Input contract not frozen | Some flows assumed full intent up front, others allowed rough context | Adapters, validators, and tests encoded conflicting assumptions |
| State machine not frozen | Implementation kept compiler-centric states while the spec moved toward business-centric states | Storage and response payloads diverged from the intended product model |
| Delete boundary not frozen | Old `/drafts/*` surfaces stayed alive while new session language appeared | The codebase accumulated aliases instead of converging |
| Compatibility policy not decided | Old clients were neither fully supported nor explicitly cut over | Web/API mismatches could linger without a clear owner |

### 2.2 Current Hotspots That Must Be Resolved By Spec, Not By More Code

- Public noun: `draft` vs `session`
- Primary route family: `/drafts/*` vs `/sessions/*`
- Caller coverage: non-web-only vs shared agent + web
- Identity model: `external_id` provenance vs session identity
- Minimum create input: rough context vs full intent
- Response model: `draft/card/assessment` vs `state/questions/blocked_by/checklist/...`
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

These are the highest-risk sources of future drift unless they are explicitly deleted or compatibility-shimmed for a short period:

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
- `POST /sessions/:id/respond` must reference question IDs explicitly
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
| Q5 | What exact minimum input is valid for create? | Prevents adapters and validators from reintroducing incompatible assumptions | Prefer: at least one of `message`, `summary`, one poster-authored message, or one uploaded artifact | `LOCKED: valid if at least one of message, summary, one poster-authored message, or one uploaded artifact is present` |
| Q6 | Must files be represented as Agora artifact refs in the session API, or may callers send external URLs for Agora to ingest? | Locks the upload boundary and artifact lifecycle | Prefer Agora-managed artifact refs in the session contract, with ingestion as an adapter concern | `LOCKED: the session API accepts Agora artifact refs and raw external file URLs; Agora ingests, pins, and creates artifact refs internally. Platform-specific file handles such as Telegram file IDs are out of the public contract` |
| Q7 | When Layer 3 fails, what makes the session return to `awaiting_input` versus move to terminal `rejected`? | Prevents state drift and inconsistent recovery behavior | Prefer: recoverable caller fix = `awaiting_input`; unsupported task = `rejected` | `LOCKED: if the caller can fix it, state = awaiting_input; if the task is fundamentally unsupported, state = rejected` |
| Q8 | Is any backward compatibility period required for existing `/drafts/*` clients? | Determines whether we ship aliases or cut over directly | Prefer `no` unless a hard dependency is identified | `LOCKED: no compatibility period; cut directly to /sessions/* with zero public aliases` |
| Q9 | Do `card` and `assessment` remain in the public contract? | Prevents two different response models from surviving indefinitely | Prefer `no` | `LOCKED: delete card and assessment as public API concepts; expose one canonical session shape only` |
| Q10 | Is funding source an explicit field on publish for both web and agent callers? | Prevents funding behavior from becoming implicit or caller-specific | Prefer `yes` | `LOCKED: publish requests must explicitly declare funding source for both web and agent callers` |
| Q11 | Do non-web callers need any callback/webhook contract in the current scope? | Reassesses the old Beach-backend callback assumption now that the non-web caller is the agent itself | Prefer no callbacks unless a real external host requirement exists | `LOCKED: no callbacks/webhooks in scope; synchronous mutation responses plus GET polling are sufficient` |
| Q12 | What are the TTL rules for `created`, `awaiting_input`, and `ready` sessions? | Prevents hidden product behavior from leaking out of implementation defaults | Prefer explicit per-state TTLs in the contract | `LOCKED: created = 15 minutes; awaiting_input = 24 hours; ready = 2 hours` |
| Q13 | Should the internal persistence layer also be renamed from `authoring_drafts` to `authoring_sessions`? | Separates public contract clarity from storage/migration cost | No default; requires explicit product + migration choice | `LOCKED: rename internal persistence and code to authoring_sessions / AuthoringSession` |
| Q14 | Are create/respond calls synchronous or asynchronous from the caller's perspective? | Determines whether callers get final blocking state immediately or must always poll/background wait | Prefer synchronous best-effort | `LOCKED: create/respond are synchronous best-effort; created is mostly internal/transient` |
| Q15 | What can `POST /sessions/:id/respond` contain? | Determines whether one conversational turn can carry answers, extra context, and files together | Prefer one flexible conversational turn payload | `LOCKED: respond may include any combination of question-ID answers, additional freeform context, and additional files/artifacts. File inputs must be fetchable URLs or Agora artifact refs, not platform-specific file handles` |
| Q16 | Should the API expose reasoning for questions, and in what form? | Determines whether callers see why Agora is asking something without exposing raw model internals | Prefer short structured reasons only | `LOCKED: expose short structured per-question reasons; never expose raw chain-of-thought` |
| Q17 | What must `POST /sessions/:id/publish` include? | Determines whether publish is stale-safe by freezing ready sessions or by requiring freshness tokens | Prefer explicit confirm + funding only if ready sessions are immutable | `LOCKED: publish requires confirm_publish plus explicit funding; no freshness token because ready sessions are frozen` |
| Q18 | Should create/get/respond all return the same full canonical session shape? | Prevents endpoint-specific payload drift and client branching | Prefer one response shape everywhere | `LOCKED: create, get, and respond all return the same full canonical session shape` |
| Q19 | Should the public API expose conversation history or only the latest merged session snapshot? | Controls whether the core contract stays narrow or expands into turn-by-turn replay semantics | Prefer latest snapshot only | `LOCKED: public API exposes only the current merged session snapshot; history is internal/out-of-scope for now` |
| Q20 | What happens if a caller tries to respond to a non-editable session? | Prevents hidden forks/reopens and keeps session semantics deterministic | Prefer explicit error with guidance | `LOCKED: respond on ready/published/rejected/expired returns an error with current state and guidance to create a new session` |
| Q21 | Is polling via GET enough for the locked contract, or is SSE/streaming in scope now? | Prevents the core contract from expanding into transport-specific streaming behavior prematurely | Prefer polling only for now | `LOCKED: GET /sessions/:id polling is sufficient; SSE/streaming is out-of-scope for now` |
| Q22 | Should the contract specify a numeric question-batch cap? | Separates the public API shape from internal orchestration/tuning decisions | Prefer no numeric cap in the contract | `LOCKED: no numeric cap in the contract; questions should be returned in small focused batches, not exhaustive forms` |
| Q23 | What should `POST /sessions/:id/publish` return? | Prevents publish from introducing endpoint-specific drift while still respecting the browser-wallet signing boundary | Prefer canonical session shape except where browser-wallet publish requires a preparation object | `LOCKED: sponsor-funded publish returns SessionSchema. Wallet-funded publish returns a wallet publish preparation object and keeps the session in ready until confirm-publish succeeds` |
| Q24 | What artifact shape should session responses expose? | Determines whether outputs are canonicalized or mirror messy caller inputs | Prefer normalized Agora artifact objects with provenance metadata | `LOCKED: session responses return normalized Agora artifacts with stable IDs/refs; original source URLs are provenance metadata only` |
| Q25 | Are question IDs stable across the life of the session once issued? | Determines whether callers can safely answer specific pending questions without ambiguity | Prefer stable IDs for the life of the session | `LOCKED: question IDs are stable for the life of the session once issued` |
| Q26 | What shape should `blocked_by` have? | Determines whether callers can distinguish machine-readable blockers from display text and whether terminal rejection reasons are exposed consistently | Prefer one structured object reused across recoverable and terminal blocked states | `LOCKED: blocked_by is a structured object with layer, code, and message. It is required for awaiting_input and rejected, where it explains why progress cannot continue. It is null for ready, published, and expired` |
| Q27 | What shape should `checklist` have when a session is ready? | Determines whether publish confirmation is typed/stable or a loose list | Prefer a structured object with named confirmation fields | `LOCKED: checklist is a structured object with named confirmation fields, not a generic array` |
| Q28 | Should `compilation` always exist in the canonical session shape? | Determines whether the session object is structurally stable across states | Prefer always-present nullable fields | `LOCKED: compilation is always present in the canonical session shape and is null until there is a compile outcome to expose` |
| Q29 | Should all canonical session fields always exist, even when not yet applicable? | Determines whether clients can rely on one flat stable type instead of conditional field presence | Prefer all fields always present | `LOCKED: all canonical session fields always exist; arrays default to []; objects/scalars default to null` |
| Q30 | What shape should error responses have? | Determines whether failure handling is consistent and machine-readable across the contract | Prefer one structured error envelope | `LOCKED: one structured error envelope everywhere with code, message, next_action, and relevant context such as state when applicable` |
| Q31 | Should `created` remain in the public state enum? | Determines whether callers must handle a transient state they should almost never see | Prefer internal-only if create/respond are synchronous best-effort | `LOCKED: created is internal-only and not part of the public state enum` |
| Q32 | What should each public question object contain? | Determines whether callers can render/answer questions without parsing English text heuristically | Prefer typed question metadata | `LOCKED: each question includes id, text, reason, kind, and any typed metadata such as options needed to answer/render it. Allowed kind values are exactly text, select, and file. select may include options; no broader kind set is in scope` |
| Q33 | What shape should answers have in `POST /sessions/:id/respond`? | Determines whether Agora can validate responses immediately at the boundary instead of inferring which question was answered | Prefer typed answers keyed by question ID | `LOCKED: respond includes a typed answers collection keyed by question_id. text and select answers use string values validated against the issued question kind. file questions are answered in the same answers collection using an artifact-ref value. Top-level files are extra unbound attachments, not the primary answer path for file questions` |
| Q34 | Which published fields belong on the canonical session object? | Prevents publish outputs from drifting into ad hoc per-caller convenience fields | Prefer a minimal explicit published field set | `LOCKED: canonical published fields are challenge_id, contract_address, spec_cid, and tx_hash; derived data stays out of the core contract` |
| Q35 | Should the canonical session object expose Agora's current interpreted brief/summary? | Determines whether callers can see and correct what Agora currently thinks the challenge is about | Prefer a normalized interpreted summary | `LOCKED: expose a normalized current summary on the session object; it reflects Agora's current interpretation, not a raw echo of caller input` |
| Q36 | Should the canonical session object expose source provenance metadata? | Determines whether callers can correlate a session back to its origin without turning provenance into identity | Prefer read-only provenance metadata | `LOCKED: expose provenance as read-only metadata; when the source is Beach this may include source, thread/post ID, and source_url; it is never used for lookup/identity and is null when absent` |
| Q37 | Should the canonical session object expose expiration explicitly? | Determines whether callers can reason about expiry without reproducing TTL math client-side | Prefer absolute expiration timestamps | `LOCKED: expose expires_at as an absolute timestamp; it refreshes when the session enters a state with a new TTL window` |
| Q38 | Should the canonical session object include an explicit schema version field? | Determines whether versioning is embedded in payloads or handled at the route/docs boundary | Prefer no payload-level version field for now | `LOCKED: do not include schema_version on the session object; versioning lives at the API path/docs level if needed later` |
| Q39 | Should the canonical session object expose created/updated timestamps? | Determines whether callers get operational transparency about session recency and change timing | Prefer exposing both timestamps | `LOCKED: expose created_at and updated_at on the canonical session object` |
| Q40 | Should the canonical session object expose publish-permission metadata? | Determines whether authorization semantics live on the session object or remain part of publish-time validation | Prefer publish-time validation only | `LOCKED: do not expose publish-permission metadata on the session object; validate caller + funding combination at publish time` |
| Q41 | How should an OpenClaw agent authenticate directly to Agora in this scoped design? | Replaces the old Beach-partner auth assumption with the real non-web caller model | No default; must be explicitly locked | `LOCKED: agent registers directly with Agora using telegram_bot_id as its stable technical identity, receives an Agora-issued API key, and uses it as bearer auth for future session calls; no KYC or real-world identity is required` |
| Q42 | What is the registration route path for agent auth? | Prevents auth endpoints from drifting between general agent auth and authoring-specific auth | Prefer a general Agora agent registration route | `LOCKED: POST /api/agents/register; registration is a general Agora capability, not scoped under /authoring` |
| Q43 | How is the agent API key sent on authenticated requests? | Prevents auth middleware drift between standard bearer auth and custom headers | Prefer standard bearer auth | `LOCKED: agent requests use Authorization: Bearer <api_key>; no custom API key headers` |
| Q44 | How should agent auth failures be exposed? | Prevents middleware from leaking credential state or returning inconsistent auth errors | Prefer one generic unauthorized response | `LOCKED: missing, malformed, invalid, expired, or revoked agent credentials all return the same 401 unauthorized error envelope with next_action pointing to POST /api/agents/register` |
| Q45 | Should the canonical session object expose the creator? | Determines whether session ownership is explicit for traceability and authorization-sensitive client behavior | Prefer an explicit required creator field | `LOCKED: every session exposes a required creator field; for agent sessions use { type: "agent", agent_id }, and for web sessions use { type: "web", address }` |
| Q46 | What is the access rule for in-progress sessions? | Determines who may read or mutate a private authoring session before it becomes a public challenge | Prefer private-by-default access | `LOCKED: sessions are private to the authenticated principal that created them; only that principal may GET, respond, or publish the session before publish` |
| Q47 | How should non-owner session access be exposed? | Determines whether the API leaks the existence of private in-progress sessions to other authenticated principals | Prefer `404` for privacy | `LOCKED: non-owner GET/respond/publish attempts return 404 not_found; the API must not reveal whether the session exists` |
| Q48 | Should the contract include a list-sessions endpoint? | Determines whether callers can recover and inspect their own in-progress sessions without already holding a session ID | Prefer a self-scoped list endpoint | `LOCKED: add GET /api/authoring/sessions; it returns only the authenticated caller's own sessions` |
| Q49 | What should GET /api/authoring/sessions return? | Determines whether the list endpoint preserves the full session shape or uses a browsing-oriented summary shape | Prefer a lighter list item for browsing | `LOCKED: GET /api/authoring/sessions returns a lighter list-item shape, not the full canonical session object; it includes enough data to identify and resume a session` |
| Q50 | What exact fields belong in each list item? | Prevents the list endpoint from drifting back into a partial full-session payload | Prefer a minimal browse-only shape | `LOCKED: each list item contains exactly id, state, summary, created_at, updated_at, and expires_at` |
| Q51 | What is the exact create request envelope? | Defines the top-level request shape external callers must code against for POST /api/authoring/sessions | Prefer one shared minimal envelope with one first-class natural-language message plus existing optional fields | `LOCKED: create accepts message?, summary?, messages?, files?, and provenance?; at least one of message, summary, one messages entry, or one file is required. message is the caller's first natural-language turn. summary/messages remain optional alongside it; no extra structured-hint fields are part of the request in the current scoped design` |
| Q52 | What is the exact respond request envelope? | Defines the top-level request shape external callers must code against for POST /api/authoring/sessions/:id/respond | Prefer one direct-reply envelope with structured answers, one natural-language turn, and files | `LOCKED: respond accepts answers?, message?, and files?; at least one of those must be present. message is the caller's latest natural-language turn. If both structured answers/files and message are present, answers/files are authoritative and message is additional Layer 2 context. respond is intentionally distinct from create and does not use a messages array` |
| Q53 | What is the exact publish request envelope? | Defines the top-level request shape external callers must code against for POST /api/authoring/sessions/:id/publish | Prefer a minimal explicit confirm + funding payload | `LOCKED: publish accepts exactly confirm_publish and funding; confirm_publish must be true and funding must be explicit` |
| Q54 | What is the exact file item shape in create/respond payloads? | Defines how callers represent file URLs vs existing Agora artifacts without ambiguity | Prefer typed file items | `LOCKED: files is an array of typed objects; use { type: "url", url } for fetchable URLs and { type: "artifact", artifact_id } for existing Agora artifacts` |
| Q55 | Should the canonical full session object be mostly flat or grouped into nested sections? | Determines the structural shape every caller will code against for single-session operations | Prefer flat if direct access and simplicity matter more than grouping | `LOCKED: the canonical full session object is flat at the top level rather than grouped into nested sections` |
| Q56 | Where should question explanations live in the canonical response? | Prevents the contract from duplicating the same explanation in both question objects and a separate top-level field | Prefer one source of truth per question | `LOCKED: question explanations live only in each question object's reason field; there is no separate top-level reasoning field` |
| Q57 | What exact top-level fields belong in the canonical full session object? | Defines the complete field set external callers may depend on across single-session operations | Prefer one explicit stable field set | `LOCKED: the canonical full session object contains exactly id, state, creator, summary, questions, blocked_by, checklist, compilation, artifacts, provenance, challenge_id, contract_address, spec_cid, tx_hash, created_at, updated_at, and expires_at` |
| Q58 | Should compilation expose scoring direction explicitly? | Prevents callers and solvers from inferring score direction from metric names | Prefer an explicit objective field | `LOCKED: compilation includes explicit objective alongside metric, using objective = "maximize" | "minimize"` |
| Q59 | Should compilation expose the exact immutable scorer image? | Determines whether callers and solvers can inspect the concrete scoring runtime rather than relying on a high-level template label | Prefer explicit immutable image refs for transparency | `LOCKED: compilation includes scorer_image as an immutable image reference, e.g. ghcr.io/...@sha256:...` |
| Q60 | Should compilation expose the exact submission contract for solvers? | Determines whether solvers can know the required submission format without guessing from prose or external docs | Prefer an explicit machine-readable submission contract | `LOCKED: compilation includes submission_contract as a machine-readable object describing the expected submission format, limits, and structural requirements` |
| Q61 | What is the bundled public compilation contract? | Defines the full solver-facing compilation object boundary so callers do not have to guess what is public versus hidden | Prefer one explicit transparency object with hidden evaluation data excluded | `LOCKED: compilation is the full public scoring/submission contract and includes exactly template, metric, objective, scorer_image, evaluation_artifact_uri, evaluation_columns, submission_contract, resource_limits, reward, deadline, dispute_window_hours, and minimum_score. Hidden evaluation/reference data contents stay out of the public contract` |
| Q62 | What is the public upload endpoint contract? | Defines how callers turn either local files or remote URLs into normalized Agora artifacts without building divergent file flows | Prefer one endpoint with two input modes and one output shape | `LOCKED: POST /api/authoring/uploads supports both direct file upload and URL ingestion, and both return the same normalized artifact object` |
| Q63 | What is the machine-readable error code set for the public contract? | Prevents callers from branching on ad hoc endpoint-specific error codes and keeps failure handling stable across auth, access, validation, and terminal-state cases | Prefer a small stable category set | `LOCKED: error.code is one of unauthorized, not_found, invalid_request, session_expired, or unsupported_task. Specific details belong in message and next_action, not in a larger enum` |
| Q64 | What is the legal state transition table for the public session lifecycle? | Prevents implementation drift around reopen behavior, terminal states, and which transitions are permitted after create/respond/publish/TTL events | Prefer a strict no-reopen lifecycle | `LOCKED: internal created may transition only to awaiting_input, ready, or rejected; awaiting_input may transition only to awaiting_input, ready, rejected, or expired; ready may transition only to published or expired; published, rejected, and expired are terminal and never reopen. If a caller wants to try again, they must create a new session` |
| Q65 | What is the shared normalized artifact schema? | Prevents upload responses and session artifacts from drifting into different shapes and keeps artifact classification semantics explicit | Prefer one stable artifact object with nullable role until classified | `LOCKED: the normalized artifact object contains exactly artifact_id, uri, file_name, role, and source_url. role is null until Agora classifies the artifact during session processing, and the same object shape is used in upload responses and session responses` |
| Q66 | What is the exact bundled agent registration contract? | Prevents agent onboarding and key rotation from drifting across partial auth decisions and removes ambiguity about optional metadata at the registration boundary | Prefer one minimal required field with optional profile metadata | `LOCKED: POST /api/agents/register accepts telegram_bot_id as the only required field and may also accept optional agent_name and description. It returns exactly agent_id, api_key, and status, where status is created or rotated. The response shape is the same whether optional metadata is provided or not` |
| Q67 | What is the success response envelope rule for the public API? | Prevents endpoint-specific wrapper drift and keeps client parsing rules uniform across registration, uploads, and single-session operations | Prefer one narrow conversational exception instead of broad wrapper drift | `LOCKED: single-resource success responses return the bare resource object directly, except POST /api/authoring/sessions and POST /api/authoring/sessions/:id/respond. Those two conversational endpoints return { "session": SessionSchema, "assistant_message": string }. Collection success responses wrap the collection, e.g. { "sessions": [...] }` |
| Q68 | How narrow should the public submission_contract schema be in v1? | Prevents speculative generic abstractions from leaking into the solver-facing contract before Agora actually supports more submission kinds | Prefer a current-scope schema only | `LOCKED: submission_contract stays narrow and explicit for the current scoped design. It contains version, kind, extension, mime, max_bytes, and columns. kind refers to the concrete submission kind Agora supports now, not a speculative future abstraction` |
| Q69 | What is the bundled public checklist schema? | Defines the final confirmation object callers render before publish and prevents it from drifting into either a loose prose summary or a second typed compilation object | Prefer a concise human-facing summary object | `LOCKED: checklist is a concise confirmation summary object containing exactly title, domain, type, reward, distribution, deadline, template, metric, objective, and artifacts_count. It is optimized for human confirmation, while detailed typed challenge semantics live in compilation` |
| Q70 | How should wallet-funded web publish work when the signer lives in the browser? | Prevents the contract from pretending the server can complete a browser-wallet transaction and keeps sponsor vs wallet publish paths explicit | Prefer one publish URL with funding-dependent behavior plus one confirm step | `LOCKED: POST /sessions/:id/publish remains the single publish URL. funding = sponsor performs one-call publish and returns SessionSchema. funding = wallet prepares the browser transaction, keeps the session in ready, and returns a wallet publish preparation object. POST /sessions/:id/confirm-publish then validates the wallet tx_hash and transitions the session to published` |
| Q71 | How should Layer 2's natural-language turn surface in the public contract? | Prevents chat surfaces from reverse-engineering structured questions into a fake conversation and keeps Layer 2 output explicit without exposing internal history | Prefer a narrow create/respond-only assistant turn | `LOCKED: create/respond success responses include required assistant_message generated by Layer 2. GET/list/publish endpoints remain pure structured state and do not include assistant_message. Public turn history remains out of scope` |

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

const FundingSchema = z.enum(["wallet", "sponsor"]);
const ObjectiveSchema = z.enum(["maximize", "minimize"]);

const ErrorCodeSchema = z.enum([
  "unauthorized",
  "not_found",
  "invalid_request",
  "session_expired",
  "unsupported_task",
]);

const MessageInputSchema = z.object({
  text: z.string().min(1),
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

const QuestionSchema = z.discriminatedUnion("kind", [
  z.object({
    id: z.string().min(1),
    text: z.string().min(1),
    reason: z.string().min(1),
    kind: z.literal("text"),
  }),
  z.object({
    id: z.string().min(1),
    text: z.string().min(1),
    reason: z.string().min(1),
    kind: z.literal("select"),
    options: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    id: z.string().min(1),
    text: z.string().min(1),
    reason: z.string().min(1),
    kind: z.literal("file"),
  }),
]);

const AnswerValueSchema = z.union([
  z.string().min(1),
  z.object({
    type: z.literal("artifact"),
    artifact_id: z.string().min(1),
  }),
]);

const AnswerInputSchema = z.object({
  question_id: z.string().min(1),
  value: AnswerValueSchema,
});

const ArtifactSchema = z.object({
  artifact_id: z.string().min(1),
  uri: z.string().min(1),
  file_name: z.string().min(1),
  role: z.string().nullable(),
  source_url: z.string().url().nullable(),
});

const BlockedBySchema = z.object({
  layer: z.union([z.literal(2), z.literal(3)]),
  code: z.string().min(1),
  message: z.string().min(1),
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

const ResourceLimitsSchema = z.object({
  memory_mb: z.number().int().positive(),
  cpus: z.number().int().positive(),
  timeout_minutes: z.number().int().positive(),
  pids_limit: z.number().int().positive(),
});

const RewardSchema = z.object({
  total: z.string().min(1),
  currency: z.string().min(1),
  distribution: z.string().min(1),
  protocol_fee_bps: z.number().int().nonnegative(),
});

const CompilationSchema = z.object({
  template: z.string().min(1),
  metric: z.string().min(1),
  objective: ObjectiveSchema,
  scorer_image: z.string().min(1),
  evaluation_artifact_uri: z.string().min(1),
  evaluation_columns: z.object({
    required: z.array(z.string().min(1)).min(1),
    id: z.string().min(1),
    value: z.string().min(1),
    allow_extra: z.boolean(),
  }),
  submission_contract: SubmissionContractSchema,
  resource_limits: ResourceLimitsSchema,
  reward: RewardSchema,
  deadline: z.string().datetime(),
  dispute_window_hours: z.number().int().nonnegative(),
  minimum_score: z.number().nullable(),
});

const ChecklistSchema = z.object({
  title: z.string().min(1),
  domain: z.string().min(1),
  type: z.string().min(1),
  reward: z.string().min(1),
  distribution: z.string().min(1),
  deadline: z.string().datetime(),
  template: z.string().min(1),
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
  summary: z.string().nullable(),
  questions: z.array(QuestionSchema),
  blocked_by: BlockedBySchema.nullable(),
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
- `agent_name` and `description` are optional
- re-registering the same `telegram_bot_id` returns the same `agent_id`, rotates the key, invalidates the old key, and sets `status = "rotated"`

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
  sessions: z.array(SessionListItemSchema),
});
```

Example success response:

```json
{
  "sessions": [
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
  message: z.string().min(1).optional(),
  summary: z.string().min(1).optional(),
  messages: z.array(MessageInputSchema).min(1).optional(),
  files: z.array(FileInputSchema).min(1).optional(),
  provenance: ProvenanceSchema.optional(),
}).superRefine((value, ctx) => {
  const hasMessage = typeof value.message === "string" && value.message.length > 0;
  const hasSummary = typeof value.summary === "string" && value.summary.length > 0;
  const hasMessages = Array.isArray(value.messages) && value.messages.length > 0;
  const hasFiles = Array.isArray(value.files) && value.files.length > 0;

  if (!hasMessage && !hasSummary && !hasMessages && !hasFiles) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide at least one of message, summary, messages, or files.",
    });
  }
});
```

Example request:

```json
{
  "message": "Create a docking challenge for KRAS using the attached ligand dataset.",
  "summary": "Want to create a docking challenge for KRAS",
  "messages": [
    { "text": "I found this interesting KRAS target paper" },
    { "text": "The ligand dataset is attached" }
  ],
  "files": [
    { "type": "url", "url": "https://example.com/ligands.csv" }
  ],
  "provenance": {
    "source": "beach",
    "external_id": "thread-abc"
  }
}
```

Success response schema:

```ts
const ConversationalSessionResponseSchema = z.object({
  session: SessionSchema,
  assistant_message: z.string().min(1),
});
```

Example success response:

```json
{
  "session": {
    "id": "session-123",
    "state": "awaiting_input",
    "creator": {
      "type": "agent",
      "agent_id": "agent-abc"
    },
    "summary": "Docking challenge against KRAS protein target.",
    "questions": [
      {
        "id": "q1",
        "text": "What metric should solvers optimize?",
        "reason": "Needed to select the right scoring runtime",
        "kind": "select",
        "options": ["r2", "rmse", "spearman", "accuracy"]
      }
    ],
    "blocked_by": {
      "layer": 2,
      "code": "missing_evaluation_metric",
      "message": "Agora needs to know which metric solvers should optimize"
    },
    "checklist": null,
    "compilation": null,
    "artifacts": [
      {
        "artifact_id": "art-123",
        "uri": "ipfs://QmXyz...",
        "file_name": "ligands.csv",
        "role": null,
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
    "updated_at": "2026-03-21T18:00:00Z",
    "expires_at": "2026-03-22T18:00:00Z"
  },
  "assistant_message": "I can set up this docking challenge, but I still need the scoring metric before I can continue."
}
```

State transition effects:
- internal `created` -> `awaiting_input`
- internal `created` -> `ready`
- internal `created` -> `rejected`

Rejected response rule:
- if create ends in `rejected`, `session.blocked_by` must be populated with the terminal reason

Error cases:
- `401 unauthorized`
- `400 invalid_request`

#### 4.4.5 `GET /api/authoring/sessions/:id`

Authentication:
- required

Success response:
- bare `SessionSchema`

Example success response:

```json
{
  "id": "session-123",
  "state": "ready",
  "creator": {
    "type": "agent",
    "agent_id": "agent-abc"
  },
  "summary": "Docking challenge against KRAS protein target. Solvers rank ligands by predicted binding affinity.",
  "questions": [],
  "blocked_by": null,
  "checklist": {
    "title": "Rank ligands for KRAS binding affinity",
    "domain": "drug_discovery",
    "type": "docking",
    "reward": "500 USDC",
    "distribution": "winner_take_all",
    "deadline": "2026-04-01T23:59:59Z",
    "template": "official_table_metric_v1",
    "metric": "spearman",
    "objective": "maximize",
    "artifacts_count": 3
  },
  "compilation": {
    "template": "official_table_metric_v1",
    "metric": "spearman",
    "objective": "maximize",
    "scorer_image": "ghcr.io/andymolecule/gems-tabular-scorer:v1@sha256:abc123",
    "evaluation_artifact_uri": "ipfs://QmReferenceScores",
    "evaluation_columns": {
      "required": ["ligand_id", "reference_score"],
      "id": "ligand_id",
      "value": "reference_score",
      "allow_extra": true
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
    "resource_limits": {
      "memory_mb": 4096,
      "cpus": 2,
      "timeout_minutes": 20,
      "pids_limit": 64
    },
    "reward": {
      "total": "500",
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

#### 4.4.6 `POST /api/authoring/sessions/:id/respond`

Authentication:
- required

Request schema:

```ts
const RespondSessionRequestSchema = z.object({
  answers: z.array(AnswerInputSchema).min(1).optional(),
  message: z.string().min(1).optional(),
  files: z.array(FileInputSchema).min(1).optional(),
}).superRefine((value, ctx) => {
  const hasAnswers = Array.isArray(value.answers) && value.answers.length > 0;
  const hasMessage = typeof value.message === "string" && value.message.length > 0;
  const hasFiles = Array.isArray(value.files) && value.files.length > 0;

  if (!hasAnswers && !hasMessage && !hasFiles) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide at least one of answers, message, or files.",
    });
  }
});
```

Example request:

```json
{
  "answers": [
    { "question_id": "q1", "value": "spearman" },
    {
      "question_id": "q3",
      "value": { "type": "artifact", "artifact_id": "art-123" }
    }
  ],
  "message": "Use Spearman. The dataset has about 1000 ligands, and I uploaded an extra supporting file.",
  "files": [
    { "type": "url", "url": "https://example.com/extra_data.csv" }
  ]
}
```

Precedence rule:
- if `answers` or `files` are present, they are authoritative
- `message` is additional conversational context for Layer 2, not a competing source of truth

Example success response:

```json
{
  "session": {
    "id": "session-123",
    "state": "ready",
    "creator": {
      "type": "agent",
      "agent_id": "agent-abc"
    },
    "summary": "Docking challenge against KRAS protein target. Solvers rank ligands by predicted binding affinity.",
    "questions": [],
    "blocked_by": null,
    "checklist": {
      "title": "Rank ligands for KRAS binding affinity",
      "domain": "drug_discovery",
      "type": "docking",
      "reward": "500 USDC",
      "distribution": "winner_take_all",
      "deadline": "2026-04-01T23:59:59Z",
      "template": "official_table_metric_v1",
      "metric": "spearman",
      "objective": "maximize",
      "artifacts_count": 3
    },
    "compilation": {
      "template": "official_table_metric_v1",
      "metric": "spearman",
      "objective": "maximize",
      "scorer_image": "ghcr.io/andymolecule/gems-tabular-scorer:v1@sha256:abc123",
      "evaluation_artifact_uri": "ipfs://QmReferenceScores",
      "evaluation_columns": {
        "required": ["ligand_id", "reference_score"],
        "id": "ligand_id",
        "value": "reference_score",
        "allow_extra": true
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
      "resource_limits": {
        "memory_mb": 4096,
        "cpus": 2,
        "timeout_minutes": 20,
        "pids_limit": 64
      },
      "reward": {
        "total": "500",
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
    },
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
  },
  "assistant_message": "Your challenge is ready. I mapped the uploaded files, selected Spearman for docking, and prepared the publish checklist."
}
```

State transition effects:
- `awaiting_input` -> `awaiting_input`
- `awaiting_input` -> `ready`
- `awaiting_input` -> `rejected`

Rejected response example:

```json
{
  "session": {
    "id": "session-123",
    "state": "rejected",
    "creator": {
      "type": "agent",
      "agent_id": "agent-abc"
    },
    "summary": "Free-form peptide binder rationale challenge.",
    "questions": [],
    "blocked_by": {
      "layer": 3,
      "code": "unsupported_task",
      "message": "Agora requires deterministic scoring for managed challenges. Subjective winner criteria are not supported."
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
  },
  "assistant_message": "I can’t turn this into a managed Agora challenge as written because the winner rule is subjective. To continue, create a new session with a deterministic scoring metric and scorer-relevant artifacts."
}
```

Validation rules:
- file-question answers must use artifact refs inside `answers`
- top-level `files` are extra unbound attachments only
- `respond` on `ready`, `published`, or `rejected` returns `invalid_request`
- `respond` on `expired` returns `session_expired`

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
  funding: FundingSchema,
});
```

Example request:

```json
{
  "confirm_publish": true,
  "funding": "wallet"
}
```

Success response schemas:

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

Sponsor-funded example success response:

```json
{
  "id": "session-123",
  "state": "published",
  "creator": {
    "type": "agent",
    "agent_id": "agent-abc"
  },
  "summary": "Docking challenge against KRAS protein target. Solvers rank ligands by predicted binding affinity.",
  "questions": [],
  "blocked_by": null,
  "checklist": {
    "title": "Rank ligands for KRAS binding affinity",
    "domain": "drug_discovery",
    "type": "docking",
    "reward": "500 USDC",
    "distribution": "winner_take_all",
    "deadline": "2026-04-01T23:59:59Z",
    "template": "official_table_metric_v1",
    "metric": "spearman",
    "objective": "maximize",
    "artifacts_count": 3
  },
  "compilation": {
    "template": "official_table_metric_v1",
    "metric": "spearman",
    "objective": "maximize",
    "scorer_image": "ghcr.io/andymolecule/gems-tabular-scorer:v1@sha256:abc123",
    "evaluation_artifact_uri": "ipfs://QmReferenceScores",
    "evaluation_columns": {
      "required": ["ligand_id", "reference_score"],
      "id": "ligand_id",
      "value": "reference_score",
      "allow_extra": true
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
    "resource_limits": {
      "memory_mb": 4096,
      "cpus": 2,
      "timeout_minutes": 20,
      "pids_limit": 64
    },
    "reward": {
      "total": "500",
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
  "challenge_id": "challenge-456",
  "contract_address": "0x1234",
  "spec_cid": "QmSpecCid",
  "tx_hash": "0xdeadbeef",
  "created_at": "2026-03-21T18:00:00Z",
  "updated_at": "2026-03-21T18:12:00Z",
  "expires_at": "2026-03-21T20:10:00Z"
}
```

Wallet-funded example success response:

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
- when `funding = "sponsor"`: `ready` -> `published`
- when `funding = "wallet"`: session remains `ready`; publish is prepared but not completed

Validation rules:
- session must be in `ready`
- `ready` sessions are frozen; no freshness token is required
- funding must be explicit even for agent-created sessions
- `funding = "wallet"` prepares the browser-wallet transaction only; it does not publish the session by itself
- `funding = "sponsor"` performs the full publish and returns `SessionSchema`
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
- returns `SessionSchema`
- on success the session transitions from `ready` to `published`
- the returned session includes populated `challenge_id`, `contract_address`, `spec_cid`, and `tx_hash`

Validation rules:
- session must be in `ready`
- this endpoint is used only for wallet-funded browser publish flows
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
- bare `ArtifactSchema`

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
| `400` | `invalid_request` | Malformed body, bad file item, invalid answer payload, publish when not ready, or attempts to mutate a non-editable non-expired session |
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
| `POST /sessions` | internal `created` | `awaiting_input` | Returns conversational session response with pending questions and `blocked_by` |
| `POST /sessions` | internal `created` | `ready` | Returns conversational session response with `checklist` and `compilation` |
| `POST /sessions` | internal `created` | `rejected` | Returns conversational session response with terminal `rejected` state and non-null `blocked_by` |
| `POST /sessions/:id/respond` | `awaiting_input` | `awaiting_input` | Returns updated conversational session response with remaining blockers |
| `POST /sessions/:id/respond` | `awaiting_input` | `ready` | Returns conversational session response with `checklist` and `compilation` |
| `POST /sessions/:id/respond` | `awaiting_input` | `rejected` | Returns conversational session response with terminal `rejected` state and non-null `blocked_by` |
| TTL elapsed | `awaiting_input` | `expired` | Future mutation attempts return `session_expired` |
| `POST /sessions/:id/publish` with `funding = "sponsor"` | `ready` | `published` | Returns `SessionSchema` with challenge refs populated |
| `POST /sessions/:id/publish` with `funding = "wallet"` | `ready` | `ready` | Returns `WalletPublishPreparationSchema`; browser signs and submits the on-chain transaction |
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

> High-level scope decisions are locked. Section 4.4 is now written. Coding should remain paused until this exact contract is reviewed and approved.

### 5.1 Exit Criteria Before Coding Resumes

1. All open decisions in section 4.2 are answered
2. The candidate delete list is approved or explicitly revised
3. One route family is chosen as canonical
4. One response shape is chosen as canonical
5. A compatibility decision is made

### 5.2 Clarification-First Sequence

1. Answer the open decisions in section 4.2
2. Lock section 3 delete/compatibility choices
3. Write exact request/response JSON in section 4
4. Update adjacent docs to match this contract
5. Only then write a file-by-file implementation plan

### 5.3 Adjacent Docs That Must Be Reconciled After Lock

- `docs/challenge-authoring-ir.md`
- any API docs or tests still using public `draft` terminology
