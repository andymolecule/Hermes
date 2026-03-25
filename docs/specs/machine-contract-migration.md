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

Keep one authoring workflow while removing runtime leakage and hardcoded
template assumptions.

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
