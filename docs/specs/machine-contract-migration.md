# Machine Contract Migration

> Status: LOCKED
> Scope: Ordered implementation plan for the hard cutover to the new machine
> contract.

Read after:

- [Machine Contract Principles](machine-contract-principles.md)
- [Authoring Validity, Runtime, And Template Registry](authoring-validity-and-execution.md)
- [Authoring Session API](authoring-session-api.md)
- [Submission API](submission-api.md)

---

## 0. Migration Assumption

This migration assumes:

- no backward-compatibility constraint
- no data-preservation constraint

That means:

- reset schemas if simpler
- delete old contract paths when the replacement is ready
- avoid adapters and compatibility shims

The goal is one coherent system, not a transition layer.

---

## 1. Priorities

Order of importance:

1. eliminate live production ambiguity and 500s
2. lock the public machine contract in specs
3. make Layer 1 authoritative and immutable
4. remove runtime/network fallback behavior
5. keep one authoring flow and one submission flow
6. broaden scorer coverage only after the core contract is stable

---

## 2. Phase 0: Spec Freeze

### Objective

Replace the stale spec center before changing code.

### Actions

1. Lock:
   - `docs/specs/machine-contract-principles.md`
   - `docs/specs/authoring-validity-and-execution.md`
   - `docs/specs/authoring-session-api.md`
   - `docs/specs/submission-api.md`
   - `docs/specs/machine-contract-migration.md`
2. Update `docs/README.md` so these are the active authoritative docs.
3. Mark older audit/cutover docs as historical if they remain in the repo.

### Acceptance gates

- There is one clearly authoritative spec set.
- No active spec still says runtime mechanics are caller-controlled.
- No active spec still says public payloads use mixed success envelopes.

---

## 3. Phase 1: P0 Reliability Fixes

### Objective

Stop real E2E failures before deeper architecture refactors.

### Actions

1. Make finalize/confirm resilient in
   `apps/api/src/lib/submission-workflow.ts`.
   - `deleteUnmatchedSubmission()` becomes best-effort follow-up work.
   - registration success must not become a 500 because cleanup failed.
2. Add structured non-fatal finalize warnings.
   - add warning code such as `FINALIZE_CLEANUP_FAILED`
   - surface it in the finalize response contract
3. Fail fast on runtime schema drift.
   - run `verifyRuntimeDatabaseSchema()` from
     `packages/db/src/schema-compatibility.ts` during API startup/readiness
   - missing `unmatched_submissions` must fail readiness before traffic
4. Extend submission status payloads in
   `apps/api/src/lib/submission-status.ts`.
   - add canonical `phase`
   - add `last_error_phase`
   - keep `wait` and `events` aligned to the same state model
5. Add status lookup by intent id.

### Primary files

- `apps/api/src/lib/submission-workflow.ts`
- `apps/api/src/routes/submissions.ts`
- `apps/api/src/lib/submission-status.ts`
- `packages/db/src/schema-compatibility.ts`
- API startup/readiness wiring

### Acceptance gates

- Finalize never returns 500 solely because unmatched cleanup failed.
- Missing required DB schema fails readiness before user traffic.
- Agents can reconcile submission status by `intentId`.

---

## 4. Phase 2: Auth Contract Cleanup

### Objective

Make direct agent auth stable for unattended machine workflows.

### Actions

1. Replace single-key-per-agent behavior with multi-key support.
2. Split identity and key storage if needed.
   - `auth_agents` stores agent identity
   - new key table stores hashed keys and lifecycle
3. Change agent auth routes to:
   - `POST /api/agents/register`
   - `GET /api/agents/me`
   - `POST /api/agents/keys/:id/revoke`
4. Keep generic 401s on protected routes if desired for privacy.
5. Add explicit key introspection on the dedicated auth route.

### Primary files

- `apps/api/src/lib/auth-store.ts`
- `apps/api/src/routes/agents.ts`
- auth-related DB queries and migrations
- auth middleware call sites

### Acceptance gates

- Issuing a new key does not silently revoke active keys.
- An agent can introspect the current key state without re-registering.
- Existing protected routes keep one consistent 401 contract.

---

## 5. Phase 3: Submission Contract Cleanup

### Objective

Make solver flows privacy-correct, explicit, and machine-readable.

### Actions

1. Require explicit `resultFormat` on intent and finalize payloads.
   - remove silent `plain_v0` defaulting
2. Default challenge `submission_privacy_mode` to `sealed` when sealing is
   configured.
3. Block submission if a challenge requires `sealed` and public-key service is
   unavailable.
4. Keep `public` mode as explicit opt-in only.
5. Normalize all submission success and error envelopes.
6. Keep status, wait, and SSE as transport variants of the same lifecycle model.

### Primary files

- `packages/common/src/schemas/agent-api.ts`
- `apps/api/src/lib/submission-workflow.ts`
- `apps/api/src/routes/submissions.ts`
- `docs/submission-privacy.md`

### Acceptance gates

- A missing `resultFormat` is a validation error, not a silent fallback.
- Sealed mode is the default challenge behavior when supported.
- Submission routes use one response envelope shape.

---

## 6. Phase 4: Layer 1 Registry Replacement

### Objective

Make Layer 1 the single immutable discovery and resolution surface.

### Actions

1. Replace `packages/common/src/official-scorer-catalog.ts` with a real
   template registry.
2. Remove any second executable-template rule modules after moving their logic
   into the registry.
3. Pre-pin official image digests in source.
4. Add `scorerImageTag` only for diagnostics.
5. Add structured validation helpers:
   - list template ids
   - list supported metrics
   - validate metric with candidate values
   - resolve template for metric
6. Remove exported runtime fallbacks such as `DEFAULT_SCORER_MOUNT`.
7. Require exact digest equality for official-image binding.
8. Move GHCR tag-to-digest resolution into a release script, for example
   `scripts/update-scorer-digests.ts`.

### Primary files

- `packages/common/src/official-scorer-catalog.ts` or replacement registry file
- `packages/common/src/schemas/challenge-spec.ts`
- `apps/api/src/lib/authoring-compiler.ts`
- digest update script under `scripts/`

### Acceptance gates

- One file defines the full executable template registry.
- Publish never makes a live GHCR call.
- Validation errors include candidate values.

---

## 7. Phase 5: Worker Hot Path Decoupling

### Objective

Make published challenges score without touching the live registry.

### Actions

1. Ensure `execution_plan_json` contains full worker-ready runtime data:
   - pinned image
   - mount
   - limits
   - policies
   - submission/evaluation contracts
2. Change worker runtime resolution to read only from `execution_plan_json`.
3. Remove live registry reads from:
   - limit resolution
   - mount fallback
   - scorer image fallback

### Primary files

- `packages/common/src/schemas/challenge-spec.ts`
- `apps/api/src/worker/scoring.ts`
- `packages/scorer/src/pipeline.ts`

### Acceptance gates

- Worker scoring succeeds even if the live template registry is unavailable.
- No worker path re-derives limits or mount layouts from the registry.

---

## 8. Phase 6: Public Authoring Contract Cleanup

### Objective

Keep one authoring workflow while removing semantic drift, runtime leakage,
duplicate publish logic, and hardcoded template assumptions.

### Tightening order

1. Fix authoring semantic authority first.
2. Unify wallet-funded publish with shared challenge registration.
3. Tighten canonical semantic schemas across `@agora/common`.
4. Then do smaller cleanup like query-schema tightening and
   non-authoritative client preflight cleanup.

### Keep

- `/api/authoring/sessions/*` as the only public authoring route family
- one canonical session shape and the locked state machine
- semantic-only public session payloads
- one wallet-funded publish flow shared by web and agent callers
- agent-runtime preflights as advisory helpers, not as the source of truth

### Delete

- read-time validation reconstruction from
  `authoring_ir_json.execution.compile_error_codes`,
  `compile_error_message`, or similar heuristics
- caller-derived hard throws on the create/patch assessment path
- any server-side challenge-create orchestration or duplicate publish
  registration logic outside the shared registration helper
- free-text modeling for canonical finite semantics where
  `@agora/common` already owns the enum/union

### Refactor

- create and patch around one authoritative assessment boundary:
  `transport parse -> merge state -> assess -> persist snapshot -> return
  snapshot`
- public `validation` to come from the persisted assessment result, not from
  compile-error reconstruction
- wallet-funded publish confirm to reuse the shared challenge-registration
  helper after the chain write succeeds
- canonical finite semantic schemas to be shared across authoring input,
  session output, challenge queries, and challenge summaries

### Actions

1. Keep `/api/authoring/sessions/*` as the only public authoring route family.
2. Remove table-template literals from public session schemas.
3. Keep public authoring payloads semantic-only.
4. Change the authoring compiler to resolve template internally from semantic
   inputs.
5. Remove public authoring exposure of:
   - template id
   - scorer image
   - mount
   - runner limits
6. Normalize authoring route success and error envelopes to the machine-wide
   contract.

### Concrete code plan

#### 6A. Fix authoring semantic authority

Objective:
- make create, patch, and get agree on one field-level validation truth

Primary files:
- `packages/common/src/schemas/authoring-core.ts`
- `packages/common/src/schemas/authoring-session-api.ts`
- `apps/api/src/routes/authoring-sessions.ts`
- `apps/api/src/lib/authoring-compiler.ts`
- `apps/api/src/lib/authoring-ir.ts`
- `apps/api/src/lib/authoring-validation.ts`
- `apps/api/src/lib/authoring-session-payloads.ts`
- `packages/common/src/tests/authoring-core.ts`
- `packages/common/src/tests/authoring-session-api.ts`
- `apps/api/tests/authoring-compiler.test.ts`
- `apps/api/tests/authoring-sessions-route.test.ts`

Changes:
- keep transport parsing permissive for partial session input, but validate
  closed semantic fields such as `domain` against the canonical shared enum
  during the shared assessment step
- introduce one authoritative assessment result for create and patch that
  produces `resolved`, `validation`, `readiness`, and compile eligibility in a
  single pass
- replace caller-derived `.parse()` on the create/patch path with
  `.safeParse()` plus structured field-level failures
- persist the exact validation snapshot needed for the public session contract
  instead of only missing fields plus generic compile-error hints
- make `GET /sessions/:id` read the persisted validation snapshot directly
  instead of rebuilding it heuristically from `compile_error_codes`

Acceptance gates:
- unsupported `domain` or similar caller-correctable semantic values return
  `200` with `state = awaiting_input`
- `validation.invalid_fields` names the correct field and candidate values
- create, patch, and get return the same validation classification
- caller-correctable input no longer escapes as an unhandled `500`

#### 6B. Unify wallet-funded publish with shared challenge registration

Objective:
- remove duplicate publish/registration verification logic and keep one
  canonical post-transaction registration path

Primary files:
- `apps/api/src/lib/challenge-registration.ts`
- `apps/api/src/routes/authoring-sessions.ts`
- `apps/api/tests/authoring-sessions-route.test.ts`
- `apps/api/tests/challenge-registration.test.ts`

Changes:
- keep `POST /api/authoring/sessions/:id/publish` as a pure prepare step that
  binds the poster wallet and returns canonical wallet tx inputs
- make `POST /api/authoring/sessions/:id/confirm-publish` the only path that
  registers a completed `createChallenge` transaction
- move challenge registration and shared verification into the existing
  `registerChallengeFromTxHash(...)` path
- delete any server-side tx broadcast helper and any duplicate
  challenge-registration branches once the shared helper covers the needed
  assertions

Acceptance gates:
- all authoring publish confirmation and tx-hash registration use the same
  registration helper
- challenge identity, spec CID, and contract-address verification happen in
  one place
- publish failures still return the locked authoring error envelope

#### 6C. Tighten canonical semantic schemas across `@agora/common`

Objective:
- make shared finite semantics canonical across request, response, query, and
  read contracts

Primary files:
- `packages/common/src/types/challenge.ts`
- `packages/common/src/schemas/authoring-core.ts`
- `packages/common/src/schemas/authoring-session-api.ts`
- `packages/common/src/schemas/agent-api.ts`
- `apps/api/src/routes/challenges-shared.ts`
- `apps/api/src/lib/openapi.ts`
- `packages/common/src/tests/agent-api.ts`

Changes:
- reuse the canonical challenge-domain enum in authoring intent, authoring
  session outputs, agent challenge queries, and challenge summary/detail
  schemas
- remove duplicated free-text definitions for closed semantic fields where the
  common package already owns the canonical set
- align OpenAPI generation and route query parsing with the tightened shared
  schemas

Acceptance gates:
- `domain` and similar closed semantic fields have one canonical definition in
  `@agora/common`
- challenge query/read contracts no longer accept shapes the authoring flow can
  never publish
- generated API docs match the tightened shared schemas

#### 6D. Finish smaller cleanup

Objective:
- remove lower-value drift after the semantic boundary is fixed

Primary files:
- `packages/agent-runtime/src/local-workflows.ts`
- `packages/agent-runtime/src/api-client.ts`
- `packages/agent-runtime/src/tests/local-workflows.test.ts`
- `packages/agent-runtime/src/tests/api-client.test.ts`
- query-schema call sites under `apps/api/src/routes/`

Changes:
- keep client-side authoring preflights clearly advisory and aligned with the
  server contract
- tighten leftover query schemas that still use looser free-text modeling than
  the shared canonical schemas
- remove stale compatibility checks that only existed to paper over the old
  drift

Acceptance gates:
- agent-runtime preflights never disagree with the API about closed semantic
  fields
- remaining cleanup does not introduce new public contracts or route families
- the codebase has one clear semantic authority for authoring and challenge
  discovery

#### 6E. Add authoring telemetry for pilot agent rollouts

Objective:
- make authoring interactions queryable across agents and requests without
  storing raw chain-of-thought

Primary files:
- `docs/specs/authoring-observability.md`
- `packages/common/src/schemas/authoring-observability.ts`
- `packages/db/supabase/migrations/`
- `packages/db/src/queries/authoring-sessions.ts`
- `packages/db/src/queries/` (new authoring event queries)
- `apps/api/src/lib/authoring-session-observability.ts`
- `apps/api/src/lib/observability.ts`
- `apps/api/src/routes/authoring-sessions.ts`
- `apps/api/src/routes/internal-authoring.ts`
- `apps/api/tests/authoring-sessions-route.test.ts`
- `apps/api/tests/internal-authoring-route.test.ts`

Changes:
- keep `conversation_log_json` as the per-session replay surface, but stop
  treating it as the only durable authoring telemetry store
- add one append-only internal `authoring_events` ledger that captures:
  - uploads
  - create / patch turns
  - publish / confirm-publish phases
  - registration phases
  - auth or ingress failures that happen before a session exists
- propagate one stable `trace_id` from the first authoring request through the
  rest of the session lifecycle
- accept optional internal caller telemetry via headers only:
  - `X-Agora-Trace-Id`
  - `X-Agora-Client-Name`
  - `X-Agora-Client-Version`
  - `X-Agora-Decision-Summary`
- enrich structured request logs with `traceId`, `agentId`, `sessionId`,
  `challengeId`, and `txHash` when known
- add one internal filtered event read surface for operators, while keeping the
  existing session timeline route

Acceptance gates:
- every authenticated authoring request from an agent produces a durable
  telemetry event, even if the request fails before a session is created
- operators can query authoring telemetry by `agent_id`, `session_id`,
  `trace_id`, `phase`, `code`, and time window
- publish telemetry distinguishes chain write, receipt confirmation, and
  registration
- session replay and cross-session telemetry use the same event names and
  blocker codes
- no secrets or raw provider chain-of-thought are stored

### Primary files

- `packages/common/src/schemas/authoring-session-api.ts`
- `packages/common/src/schemas/authoring-core.ts`
- `apps/api/src/lib/authoring-compiler.ts`
- `apps/api/src/routes/authoring-sessions.ts`
- `apps/api/src/lib/authoring-session-payloads.ts`

### Acceptance gates

- Authoring inputs stay semantic-only.
- Session responses no longer leak runtime mechanics.
- The compiler no longer hardcodes `official_table_metric_v1`.

---

## 9. Phase 7: Explicit Resolver Cleanup

### Objective

Remove ambiguous helper APIs and hidden branching.

### Actions

1. Split union-style execution resolvers into explicit functions.
2. Update all call sites to choose the right resolver directly.
3. Delete compatibility wrappers once all call sites are moved.

### Primary files

- `packages/common/src/schemas/challenge-spec.ts`
- all call sites in API, worker, scorer, and shared challenge read helpers

### Acceptance gates

- No resolver helper accepts `spec | row` style unions in active code.
- Call sites are explicit about the source they are resolving from.

---

## 10. Phase 8: Delete Stale Code And Docs

### Objective

Remove compatibility clutter immediately after the new contract is live.

### Actions

1. Delete stale auth/session/spec compatibility code.
2. Delete or archive superseded audit/cutover docs.
3. Remove dead exports that only supported the old behavior.

### Acceptance gates

- No active public route exists solely for legacy compatibility.
- No stale spec is still listed as an authoritative source.

---

## 11. Phase 9: Broaden The Scoring Surface

### Objective

Only after the contract is clean, add more template coverage.

### Actions

1. Add new official template-registry entries.
2. Add corresponding compile-time validation tests.
3. Add worker/runtime tests for the new template.

Broadening the scoring surface must mean:

- new registry entries

It must not mean:

- new public request shapes
- new per-template authoring flows
- new runtime fallback layers

---

## 12. Global Acceptance Gates

The migration is complete only when all of the following are true:

1. Public write APIs are semantic-only.
2. All machine JSON routes use one success envelope and one error envelope.
3. The worker hot path consumes only `execution_plan_json`.
4. No runtime GHCR resolution exists on publish or score paths.
5. Sealed submission is the default when sealing is configured.
6. Finalize is idempotent and does not produce ambiguous 500s.
7. Agent auth supports unattended workflows without surprise key invalidation.
8. Layer 1 is the single source of truth for executable scorer templates.
9. Authoring create, patch, and get share one persisted validation truth.
10. Wallet-funded publish confirmation and tx-hash registration use one shared
    challenge registration path.
11. Closed semantic fields such as `domain` have one canonical shared schema
    across authoring and challenge discovery contracts.
12. Agent-runtime preflights are advisory only and cannot override API
    validation.
