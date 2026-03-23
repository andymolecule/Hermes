# Authoring Session API Audit

Date: 2026-03-22
Baseline spec: [authoring-session-api.md](/Users/changyuesin/Agora/docs/specs/authoring-session-api.md)

> Historical note: this audit is a pre-cutover snapshot of the old draft- and
> callback-era codebase. It is kept for context only. The active runtime has
> since been rewritten around deterministic `POST /sessions` + `PATCH
> /sessions/:id` authoring sessions.

## 1. Purpose

This audit compares the current codebase against the locked authoring session spec and classifies each relevant surface as:

- `KEEP` — can survive the cutover unchanged
- `CHANGE` — concept still exists, but the current implementation does not match the locked contract
- `DELETE` — built around assumptions the spec explicitly removed and should not survive the cutover

The goal is not to preserve momentum on the old draft/partner/callback model. The goal is to remove stale assumptions before they harden into permanent tech debt.

## 2. Executive Summary

### 2.1 Verdict

The current codebase does **not** implement the locked session-first contract.

The biggest mismatches are structural, not cosmetic:

1. The API still exposes draft- and partner-oriented route families instead of the canonical session routes.
2. External-source deduplication still refreshes an existing draft by `(provider, external_id)`, which directly violates the locked rule that every `POST /sessions` creates a new session.
3. The persisted/public state model is still the old `draft / compiling / ready / needs_input / published / failed` workflow instead of the locked public session states.
4. The repo still contains a full Beach-partner and callback/webhook subsystem even though the spec explicitly removed that integration model.
5. The web client is still coded against draft endpoints, draft payloads, and legacy compilation/checklist objects.

### 2.2 Missing Required Public Surfaces

These public endpoints are required by the spec and currently do not exist:

- `POST /api/agents/register`
- `GET /api/authoring/sessions`
- `POST /api/authoring/sessions`
- `GET /api/authoring/sessions/:id`
- `PATCH /api/authoring/sessions/:id`
- `POST /api/authoring/sessions/:id/publish`
- `POST /api/authoring/uploads`

### 2.3 Matrix Totals

Across the audited surfaces below:

- `KEEP`: 3
- `CHANGE`: 38
- `DELETE`: 14

These counts are by audited surface bundle, not by raw file count.

## 3. Critical Findings

### 3.1 The router still mounts the old world

The app currently mounts:

- `/api/authoring` source routes
- `/api/integrations/beach`
- `/api/authoring` draft routes

and does **not** mount any agent registration or session-first routes.  
See [apps/api/src/app.ts:99](/Users/changyuesin/Agora/apps/api/src/app.ts#L99), [apps/api/src/app.ts:103](/Users/changyuesin/Agora/apps/api/src/app.ts#L103), and [apps/api/src/app.ts:106](/Users/changyuesin/Agora/apps/api/src/app.ts#L106).

### 3.2 The external import path still reuses an existing draft

`authoring-source-import.ts` looks up `authoring_source_links` by `(provider, external_id)`, loads the existing draft, and refreshes it instead of creating a new record.  
That is a direct violation of the locked invariant that the only continuation token is `session.id`.  
See [apps/api/src/lib/authoring-source-import.ts:64](/Users/changyuesin/Agora/apps/api/src/lib/authoring-source-import.ts#L64) and [apps/api/src/lib/authoring-source-import.ts:73](/Users/changyuesin/Agora/apps/api/src/lib/authoring-source-import.ts#L73).

### 3.3 The partner/callback route family is still live

The API still serves:

- `POST /api/authoring/callbacks/sweep`
- `POST /api/authoring/external/drafts/submit`
- `GET /api/authoring/external/drafts/:id`
- `GET /api/authoring/external/drafts/:id/card`
- `POST /api/authoring/external/drafts/:id/publish`
- `POST /api/authoring/external/drafts/:id/webhook`

This entire surface is outside the locked design.  
See [apps/api/src/routes/authoring-sources.ts:93](/Users/changyuesin/Agora/apps/api/src/routes/authoring-sources.ts#L93), [apps/api/src/routes/authoring-sources.ts:131](/Users/changyuesin/Agora/apps/api/src/routes/authoring-sources.ts#L131), and [apps/api/src/routes/authoring-sources.ts:269](/Users/changyuesin/Agora/apps/api/src/routes/authoring-sources.ts#L269).

### 3.4 The Beach-specific route is still live

The API still exposes `POST /api/integrations/beach/drafts/submit` and validates against a Beach-specific thread payload plus partner bearer auth.  
That assumption is obsolete.  
See [apps/api/src/routes/integrations-beach.ts:42](/Users/changyuesin/Agora/apps/api/src/routes/integrations-beach.ts#L42).

### 3.5 The common schema layer still bakes in legacy defaults and legacy state names

`challengeIntentSchema` still defaults `distribution`, `domain`, and `timezone`, and the file still defines the old draft-oriented workflow objects.  
Those defaults and labels are inconsistent with the locked session contract.  
See [packages/common/src/schemas/authoring-core.ts](/Users/changyuesin/Agora/packages/common/src/schemas/authoring-core.ts) and [packages/common/src/schemas/authoring-session-api.ts](/Users/changyuesin/Agora/packages/common/src/schemas/authoring-session-api.ts).

### 3.6 The web client is still coded against the old draft contract, and is already internally inconsistent

The web client still posts to `/api/authoring/drafts/submit`, fetches `/api/authoring/drafts/:id`, and assumes `AuthoringDraftOutput`.  
At the same time, the current API router only exposes submit and publish under the draft routes, not a `GET /api/authoring/drafts/:id` reader.  
So the web flow is not only inconsistent with the new spec; it is already inconsistent with the current backend.  
See [apps/web/src/app/post/post-authoring-api.ts:139](/Users/changyuesin/Agora/apps/web/src/app/post/post-authoring-api.ts#L139), [apps/web/src/app/post/post-authoring-api.ts:160](/Users/changyuesin/Agora/apps/web/src/app/post/post-authoring-api.ts#L160), and [apps/api/src/routes/authoring-drafts.ts:204](/Users/changyuesin/Agora/apps/api/src/routes/authoring-drafts.ts#L204).

## 4. Boss Findings Reconciliation

The earlier boss review was directionally correct and should be preserved in the final cutover plan.

### 4.1 Findings Confirmed

Confirmed as valid:

- delete `authoring_source_links`
- delete `/api/authoring/external/*`
- delete callback/webhook routes and delivery infrastructure
- delete `docs/beach-integration.md`
- delete `docs/authoring-callbacks.md`
- delete `apps/api/src/lib/authoring-source-auth.ts`
- delete `apps/api/src/lib/authoring-external-workflow.ts`
- rename `authoring_drafts` to `authoring_sessions`
- replace `/drafts/*` with `/sessions/*`
- replace partner auth with direct agent registration + API key

### 4.2 Missing From The Boss Review That Should Be Added

The earlier review did not fully account for:

- the common schema/config layer still encoding the old draft/public contract
- the old question kind system (`short_text`, `currency_amount`, `single_select`, `artifact_role_map`)
- the old submission-contract public shape
- the entire web post flow still depending on `AuthoringDraftOutput`, `needs_input`, `failed`, `/api/pin-data`, and `/drafts/*`
- the OpenAPI document not describing the new session API at all
- stale architecture, operations, glossary, README, testing, and data-model docs beyond the two obvious Beach/callback docs
- the fact that the current web and API draft surfaces are already inconsistent with each other

## 5. KEEP / CHANGE / DELETE Matrix

### 5.1 API Surface And Routing

| Status | Surface | Why | Required action |
| --- | --- | --- | --- |
| `CHANGE` | [apps/api/src/app.ts](/Users/changyuesin/Agora/apps/api/src/app.ts) | Mounts old draft, external, and Beach route families; missing agent registration, sessions, and uploads | Replace route wiring with the locked public surface |
| `CHANGE` | [apps/api/src/routes/authoring-drafts.ts](/Users/changyuesin/Agora/apps/api/src/routes/authoring-drafts.ts) | Implements `/drafts/submit` and `/drafts/:id/publish`, old auth, old TTLs, old state model, and old response envelope | Replace with session routes and the locked request/response contract |
| `DELETE` | [apps/api/src/routes/authoring-sources.ts](/Users/changyuesin/Agora/apps/api/src/routes/authoring-sources.ts) | Entire route family is partner/callback/webhook based and outside the spec | Delete rather than migrate |
| `DELETE` | [apps/api/src/routes/integrations-beach.ts](/Users/changyuesin/Agora/apps/api/src/routes/integrations-beach.ts) | Entire route assumes Beach backend caller and partner bearer auth | Delete rather than migrate |
| `CHANGE` | [apps/api/src/routes/authoring-draft-ownership.ts](/Users/changyuesin/Agora/apps/api/src/routes/authoring-draft-ownership.ts) | Ownership concept survives, but file is draft-labeled and wallet-only | Rewrite around `creator` and shared web/agent session ownership |
| `CHANGE` | [apps/api/src/routes/authoring-draft-health-shared.ts](/Users/changyuesin/Agora/apps/api/src/routes/authoring-draft-health-shared.ts) | Operational health concept survives, but states and labels are stale | Rename/rebuild for session states and new TTL expectations |
| `CHANGE` | [apps/api/src/lib/openapi.ts](/Users/changyuesin/Agora/apps/api/src/lib/openapi.ts) and [apps/api/tests/openapi-route.test.ts](/Users/changyuesin/Agora/apps/api/tests/openapi-route.test.ts) | OpenAPI omits the session API and agent registration entirely | Add the canonical agent/session/upload surfaces and remove draft/partner assumptions |
| `KEEP` | [apps/api/src/lib/auth/session-policy.ts](/Users/changyuesin/Agora/apps/api/src/lib/auth/session-policy.ts) and [apps/api/tests/session-policy.test.ts](/Users/changyuesin/Agora/apps/api/tests/session-policy.test.ts) | Generic wallet session-address normalization is not tied to the stale authoring model | Keep unchanged |

### 5.2 Partner / Beach / Callback Subsystem

| Status | Surface | Why | Required action |
| --- | --- | --- | --- |
| `DELETE` | [apps/api/src/lib/authoring-source-auth.ts](/Users/changyuesin/Agora/apps/api/src/lib/authoring-source-auth.ts) | Entire file is partner bearer-token auth | Delete and replace with agent registration + API key auth |
| `DELETE` | [apps/api/src/lib/authoring-external-workflow.ts](/Users/changyuesin/Agora/apps/api/src/lib/authoring-external-workflow.ts) | Entire file encodes the external partner workflow that no longer exists | Delete rather than migrate |
| `DELETE` | [apps/api/src/lib/source-adapters/beach-science.ts](/Users/changyuesin/Agora/apps/api/src/lib/source-adapters/beach-science.ts) | Beach-specific payload normalization is now outside scope | Delete rather than migrate |
| `CHANGE` | [packages/chain/src/indexer/settlement.ts](/Users/changyuesin/Agora/packages/chain/src/indexer/settlement.ts) and [packages/chain/src/tests/indexer-projection-helpers.test.ts](/Users/changyuesin/Agora/packages/chain/src/tests/indexer-projection-helpers.test.ts) | The chain settlement path still enqueues `challenge_finalized` callbacks by reading `source_callback_url` and writing `authoring_callback_deliveries` | Remove callback enqueue behavior before rebasing the schema to the session-first baseline |
| `DELETE` | [docs/beach-integration.md](/Users/changyuesin/Agora/docs/beach-integration.md) and [docs/authoring-callbacks.md](/Users/changyuesin/Agora/docs/authoring-callbacks.md) | Both documents describe obsolete partner/callback behavior | Delete from docs set |

### 5.3 Core Authoring Workflow

| Status | Surface | Why | Required action |
| --- | --- | --- | --- |
| `DELETE` | [apps/api/src/lib/authoring-source-import.ts](/Users/changyuesin/Agora/apps/api/src/lib/authoring-source-import.ts) | Reuses drafts by `external_id` through `authoring_source_links`; violates new-session invariant | Delete and replace with provenance-only intake logic |
| `DELETE` | [apps/api/src/lib/authoring-drafts.ts](/Users/changyuesin/Agora/apps/api/src/lib/authoring-drafts.ts) and [apps/api/tests/authoring-drafts.test.ts](/Users/changyuesin/Agora/apps/api/tests/authoring-drafts.test.ts) | Built around callback delivery, return URLs, draft cards, lifecycle events, and partner callbacks | Delete and replace with a session-native payload/workflow module |
| `DELETE` | [apps/api/src/lib/authoring-draft-payloads.ts](/Users/changyuesin/Agora/apps/api/src/lib/authoring-draft-payloads.ts) | Emits legacy `draft`, `card`, `assessment`, and old-state payloads | Delete and replace with canonical session serializer |
| `CHANGE` | [apps/api/src/lib/authoring-draft-transitions.ts](/Users/changyuesin/Agora/apps/api/src/lib/authoring-draft-transitions.ts) | Transition logic survives conceptually, but state names, publish handling, and callback helpers are stale | Rewrite as session transitions and remove callback logic |
| `CHANGE` | [apps/api/src/lib/authoring-intake-workflow.ts](/Users/changyuesin/Agora/apps/api/src/lib/authoring-intake-workflow.ts) | Intake flow concept survives, but it still targets draft rows, old states, and old payload expectations | Rebuild around sessions, new TTLs, and new patch semantics |
| `CHANGE` | [apps/api/src/lib/authoring-ir.ts](/Users/changyuesin/Agora/apps/api/src/lib/authoring-ir.ts) and [apps/api/tests/authoring-ir.test.ts](/Users/changyuesin/Agora/apps/api/tests/authoring-ir.test.ts) | IR still encodes `assessment`, old outcomes, and partner/provider assumptions | Keep the IR concept, but align it to the locked session contract and provenance model |
| `CHANGE` | [apps/api/src/lib/authoring-compiler.ts](/Users/changyuesin/Agora/apps/api/src/lib/authoring-compiler.ts), [apps/api/tests/authoring-compiler.test.ts](/Users/changyuesin/Agora/apps/api/tests/authoring-compiler.test.ts), [apps/api/tests/authoring-benchmarks.test.ts](/Users/changyuesin/Agora/apps/api/tests/authoring-benchmarks.test.ts), and [apps/api/tests/authoring-benchmark-fixtures.ts](/Users/changyuesin/Agora/apps/api/tests/authoring-benchmark-fixtures.ts) | Core compile engine is still useful, but it returns old state names and old public objects | Keep the deterministic engine, replace the public mapping and tests |
| `CHANGE` | [apps/api/src/lib/authoring-checklist.ts](/Users/changyuesin/Agora/apps/api/src/lib/authoring-checklist.ts) | Confirmation summary concept survives, but it still builds the old confirmation-contract object rather than the locked checklist | Rewrite to emit `checklist` only |
| `CHANGE` | future assist path | Any future assist path must be separated from the default deterministic session contract | Keep only as an explicit assist surface, not as part of `/sessions` |
| `CHANGE` | [apps/api/src/lib/authoring-artifact-resolution.ts](/Users/changyuesin/Agora/apps/api/src/lib/authoring-artifact-resolution.ts) and [apps/api/src/lib/authoring-dry-run.ts](/Users/changyuesin/Agora/apps/api/src/lib/authoring-dry-run.ts) | These are reusable internals, but they still consume and emit old common schema shapes | Keep the core logic, update type/contracts around them |
| `CHANGE` | future assist question builder | Question construction is no longer part of the default machine-first session contract | Move to an explicit assist-only surface if retained |
| `CHANGE` | [apps/api/src/lib/authoring-artifacts.ts](/Users/changyuesin/Agora/apps/api/src/lib/authoring-artifacts.ts) and [apps/api/tests/authoring-artifacts.test.ts](/Users/changyuesin/Agora/apps/api/tests/authoring-artifacts.test.ts) | Artifact ingestion survives, but current inputs/outputs still reflect external-source draft payloads and older artifact IDs | Keep the ingestion capability, retarget it to the upload/session artifact contract |
| `CHANGE` | [apps/api/src/lib/authoring-source-attribution.ts](/Users/changyuesin/Agora/apps/api/src/lib/authoring-source-attribution.ts) | Provenance survives, but source attribution is still modeled as external provider identity | Align it to the locked `provenance` metadata rules |
| `CHANGE` | [apps/api/src/lib/authoring-sponsored-publish.ts](/Users/changyuesin/Agora/apps/api/src/lib/authoring-sponsored-publish.ts) and [apps/api/tests/authoring-sponsored-publish.test.ts](/Users/changyuesin/Agora/apps/api/tests/authoring-sponsored-publish.test.ts) | Sponsor-funded publish stays in scope, but current implementation is draft/provider oriented | Keep sponsor publish, rewrite it around agent/session funding rules |

### 5.4 Common Schemas And Config

| Status | Surface | Why | Required action |
| --- | --- | --- | --- |
| `CHANGE` | [packages/common/src/schemas/authoring-core.ts](/Users/changyuesin/Agora/packages/common/src/schemas/authoring-core.ts) | Still defines old draft states, old response envelopes, old confirmation contract, and defaulted intent fields | Replace with the locked session/request/response schemas |
| `CHANGE` | [packages/common/src/schemas/authoring-source.ts](/Users/changyuesin/Agora/packages/common/src/schemas/authoring-source.ts) and [packages/common/src/config/authoring.ts](/Users/changyuesin/Agora/packages/common/src/config/authoring.ts) | Still encode Beach partner providers, callback secrets, partner return origins, and provider-scoped sponsor budgets | Split out what still matters and remove partner/callback assumptions |
| `CHANGE` | future assist question schema | Intake-question scaffolding is no longer part of the default machine-first authoring contract | Keep only for a future explicit assist path if needed |
| `CHANGE` | [packages/common/src/schemas/submission-contract.ts](/Users/changyuesin/Agora/packages/common/src/schemas/submission-contract.ts) and [packages/common/src/tests/submission-contract.ts](/Users/changyuesin/Agora/packages/common/src/tests/submission-contract.ts) | Public submission-contract shape does not match the locked compilation contract | Rewrite the public schema and helper constructors |
| `CHANGE` | [packages/common/src/tests/authoring-core.ts](/Users/changyuesin/Agora/packages/common/src/tests/authoring-core.ts) and [packages/common/src/tests/authoring-benchmarks.ts](/Users/changyuesin/Agora/packages/common/src/tests/authoring-benchmarks.ts) | Test fixtures still reinforce the old contract | Update to the new session schema and transition rules |

### 5.5 Database Query Layer And Runtime Schema

| Status | Surface | Why | Required action |
| --- | --- | --- | --- |
| `CHANGE` | [packages/db/src/queries/authoring-drafts.ts](/Users/changyuesin/Agora/packages/db/src/queries/authoring-drafts.ts) | Canonical query layer is still draft-named and old-state oriented | Rename to `authoring-sessions` and update fields/states/ownership lookups |
| `DELETE` | [packages/db/src/queries/authoring-source-links.ts](/Users/changyuesin/Agora/packages/db/src/queries/authoring-source-links.ts) and runtime table `authoring_source_links` | Entire table/query layer exists to preserve refresh-by-external-id behavior that the spec forbids | Delete table and query layer |
| `DELETE` | [packages/db/src/queries/authoring-callback-deliveries.ts](/Users/changyuesin/Agora/packages/db/src/queries/authoring-callback-deliveries.ts) and runtime table `authoring_callback_deliveries` | Entire outbox exists for callbacks that are now out of scope | Delete table and query layer |
| `CHANGE` | [packages/db/src/queries/authoring-sponsor-budget-reservations.ts](/Users/changyuesin/Agora/packages/db/src/queries/authoring-sponsor-budget-reservations.ts) and [packages/db/src/tests/authoring-sponsor-budget-reservations.ts](/Users/changyuesin/Agora/packages/db/src/tests/authoring-sponsor-budget-reservations.ts) | Sponsor budgets remain, but identifiers and provider semantics are stale | Rename `draft_id` to `session_id` and align budget ownership to the new actor model |
| `CHANGE` | [packages/db/src/index.ts](/Users/changyuesin/Agora/packages/db/src/index.ts) | Still exports stale callback/source-link query modules | Remove dead exports and rename draft query exports |
| `CHANGE` | Runtime aggregate `authoring_drafts` | Aggregate survives conceptually, but must be renamed to `authoring_sessions`, with new public states and no callback columns | New migration required |
| `CHANGE` | Historical migration files in [packages/db/supabase/migrations](/Users/changyuesin/Agora/packages/db/supabase/migrations) | The repo no longer has a data-preservation requirement, so carrying the old incremental chain is unnecessary noise | Rebase the runtime schema into a single current baseline migration |

### 5.6 Web Authoring Flow

| Status | Surface | Why | Required action |
| --- | --- | --- | --- |
| `CHANGE` | [apps/web/src/app/post/post-authoring-api.ts](/Users/changyuesin/Agora/apps/web/src/app/post/post-authoring-api.ts) | Still targets `AuthoringDraftOutput`, `/drafts/*`, and `/api/pin-data` | Rebuild around agent/session/upload endpoints and the bare-object success envelope |
| `CHANGE` | [apps/web/src/app/post/use-post-authoring.ts](/Users/changyuesin/Agora/apps/web/src/app/post/use-post-authoring.ts), [apps/web/src/app/post/guided-state.ts](/Users/changyuesin/Agora/apps/web/src/app/post/guided-state.ts), and the `apps/web/tests/post-guided-*` tests | Entire guided flow stores draft IDs, old states, and old question/compilation shapes | Rewire around sessions, creator ownership, new states, and new question kinds |
| `CHANGE` | [apps/web/src/app/post/use-chat-stream.ts](/Users/changyuesin/Agora/apps/web/src/app/post/use-chat-stream.ts) and [apps/web/src/app/post/ChatPostClient.tsx](/Users/changyuesin/Agora/apps/web/src/app/post/ChatPostClient.tsx) | Chat flow still assumes draft compile semantics, `needs_input`, `failed`, and a future draft SSE route | Rebuild around `PATCH /sessions/:id`, deterministic validation errors, and the locked no-SSE scope |
| `CHANGE` | [apps/web/src/app/post/managed-post-flow.ts](/Users/changyuesin/Agora/apps/web/src/app/post/managed-post-flow.ts), [apps/web/src/lib/challenge-post.ts](/Users/changyuesin/Agora/apps/web/src/lib/challenge-post.ts), and [apps/web/tests/challenge-post.test.ts](/Users/changyuesin/Agora/apps/web/tests/challenge-post.test.ts) | Publish flow still calls `/api/authoring/drafts/:id/publish` and assumes old auth body shape | Rebuild around `POST /api/authoring/sessions/:id/publish` with explicit `funding` |
| `CHANGE` | [apps/web/src/app/post/ReviewPanel.tsx](/Users/changyuesin/Agora/apps/web/src/app/post/ReviewPanel.tsx) and [apps/web/src/app/post/PostSections.tsx](/Users/changyuesin/Agora/apps/web/src/app/post/PostSections.tsx) | UI still renders old compilation and confirmation-contract fields | Update to render `checklist`, new `compilation`, and flat session fields |
| `CHANGE` | [apps/web/src/app/post/PostClient.tsx](/Users/changyuesin/Agora/apps/web/src/app/post/PostClient.tsx), [apps/web/src/app/post/GuidedComposer.tsx](/Users/changyuesin/Agora/apps/web/src/app/post/GuidedComposer.tsx), [apps/web/src/app/post/AuthoringQuestionList.tsx](/Users/changyuesin/Agora/apps/web/src/app/post/AuthoringQuestionList.tsx), and related post UI files | These presentation components are fed by the old draft/question payloads | Update once the flow modules switch to the locked session contract |

### 5.7 Documentation

| Status | Surface | Why | Required action |
| --- | --- | --- | --- |
| `CHANGE` | [docs/challenge-authoring-ir.md](/Users/changyuesin/Agora/docs/challenge-authoring-ir.md) | Still documents draft routes, old states, and Beach provider assumptions | Rewrite around the locked session contract |
| `CHANGE` | [docs/data-and-indexing.md](/Users/changyuesin/Agora/docs/data-and-indexing.md) and [docs/system-anatomy.md](/Users/changyuesin/Agora/docs/system-anatomy.md) | Both docs still treat `authoring_drafts`, `authoring_source_links`, `authoring_callback_deliveries`, and callback flows as canonical | Rewrite after the DB/runtime cutover |
| `CHANGE` | [docs/architecture.md](/Users/changyuesin/Agora/docs/architecture.md) and [docs/operations.md](/Users/changyuesin/Agora/docs/operations.md) | Both docs still publish the old routes, health states, and callback recovery procedures | Rewrite to the locked agent/session model |
| `CHANGE` | [docs/README.md](/Users/changyuesin/Agora/docs/README.md), [docs/testing.md](/Users/changyuesin/Agora/docs/testing.md), and [docs/glossary.md](/Users/changyuesin/Agora/docs/glossary.md) | Still link to or define stale callback/Beach/draft concepts | Clean references and terminology after the cutover |
| `DELETE` | [docs/authoring-rollout.md](/Users/changyuesin/Agora/docs/authoring-rollout.md) | Rollout doc is effectively a narrative of the obsolete draft/partner/callback architecture | Delete rather than patch |
| `KEEP` | [docs/specs/authoring-session-api.md](/Users/changyuesin/Agora/docs/specs/authoring-session-api.md) | This is now the source of truth for the cutover | Keep as baseline |

### 5.8 API Tests Not Already Covered Above

| Status | Surface | Why | Required action |
| --- | --- | --- | --- |
| `DELETE` | [apps/api/tests/integrations-beach.test.ts](/Users/changyuesin/Agora/apps/api/tests/integrations-beach.test.ts) | Entire test suite encodes the deleted Beach backend integration | Delete rather than migrate |
| `DELETE` | [apps/api/tests/authoring-sources.test.ts](/Users/changyuesin/Agora/apps/api/tests/authoring-sources.test.ts) | Entire suite encodes the deleted partner/external/callback route family | Delete rather than migrate |
| `CHANGE` | [apps/api/tests/authoring-drafts-route.test.ts](/Users/changyuesin/Agora/apps/api/tests/authoring-drafts-route.test.ts) | Route coverage still targets draft submit/publish and old auth/request shapes | Replace with session route coverage |
| `CHANGE` | [apps/api/tests/authoring-draft-health.test.ts](/Users/changyuesin/Agora/apps/api/tests/authoring-draft-health.test.ts) and [apps/api/tests/authoring-draft-ownership.test.ts](/Users/changyuesin/Agora/apps/api/tests/authoring-draft-ownership.test.ts) | These operational concepts survive, but names, states, and ownership messages are stale | Update to session terminology and creator-based ownership |

## 6. Delete-First List

These are the highest-confidence deletions and should happen before any major rewrite. They are dead assumptions, not refactor targets.

1. [apps/api/src/routes/authoring-sources.ts](/Users/changyuesin/Agora/apps/api/src/routes/authoring-sources.ts)
2. [apps/api/src/routes/integrations-beach.ts](/Users/changyuesin/Agora/apps/api/src/routes/integrations-beach.ts)
3. [apps/api/src/lib/authoring-source-auth.ts](/Users/changyuesin/Agora/apps/api/src/lib/authoring-source-auth.ts)
4. [apps/api/src/lib/authoring-external-workflow.ts](/Users/changyuesin/Agora/apps/api/src/lib/authoring-external-workflow.ts)
5. [apps/api/src/lib/source-adapters/beach-science.ts](/Users/changyuesin/Agora/apps/api/src/lib/source-adapters/beach-science.ts)
6. [apps/api/src/lib/authoring-source-import.ts](/Users/changyuesin/Agora/apps/api/src/lib/authoring-source-import.ts)
7. [apps/api/src/lib/authoring-drafts.ts](/Users/changyuesin/Agora/apps/api/src/lib/authoring-drafts.ts)
8. [apps/api/src/lib/authoring-draft-payloads.ts](/Users/changyuesin/Agora/apps/api/src/lib/authoring-draft-payloads.ts)
9. `authoring_source_links` runtime table and [packages/db/src/queries/authoring-source-links.ts](/Users/changyuesin/Agora/packages/db/src/queries/authoring-source-links.ts)
10. `authoring_callback_deliveries` runtime table and [packages/db/src/queries/authoring-callback-deliveries.ts](/Users/changyuesin/Agora/packages/db/src/queries/authoring-callback-deliveries.ts)
11. [docs/beach-integration.md](/Users/changyuesin/Agora/docs/beach-integration.md)
12. [docs/authoring-callbacks.md](/Users/changyuesin/Agora/docs/authoring-callbacks.md)
13. [docs/authoring-rollout.md](/Users/changyuesin/Agora/docs/authoring-rollout.md)
14. [apps/api/tests/integrations-beach.test.ts](/Users/changyuesin/Agora/apps/api/tests/integrations-beach.test.ts)
15. [apps/api/tests/authoring-sources.test.ts](/Users/changyuesin/Agora/apps/api/tests/authoring-sources.test.ts)

## 7. Foundational Renames / Replacements

These are the changes that unlock the rest of the cutover:

1. Rename the runtime aggregate from `authoring_drafts` to `authoring_sessions`.
2. Replace the public route family with:
   - `POST /api/agents/register`
   - `GET /api/authoring/sessions`
   - `POST /api/authoring/sessions`
   - `GET /api/authoring/sessions/:id`
   - `PATCH /api/authoring/sessions/:id`
   - `POST /api/authoring/sessions/:id/publish`
   - `POST /api/authoring/uploads`
3. Replace the public state enum with:
   - `awaiting_input`
   - `ready`
   - `published`
   - `rejected`
   - `expired`
4. Remove public `draft`, `card`, `assessment`, partner, and callback concepts from the common schema layer.
5. Replace partner bearer auth with:
   - `POST /api/agents/register`
   - `telegram_bot_id`
   - Agora-issued bearer API key
6. Rename sponsor reservation references from `draft_id` to `session_id`.

## 8. Recommended Cutover Order

1. Delete the dead partner/Beach/callback subsystem.
2. Add the DB migration that:
   - renames `authoring_drafts` to `authoring_sessions`
   - drops `authoring_source_links`
   - drops `authoring_callback_deliveries`
   - removes callback columns from the session aggregate
   - renames sponsor reservation foreign keys to `session_id`
   - installs the new public state enum/checks
3. Replace the common/public schema layer with the locked session contract.
4. Implement the new API surface:
   - agent registration
   - uploads
   - sessions list/create/get/patch/publish
5. Rewire sponsor-funded publish onto the session model.
6. Cut the web flow over to the session API.
7. Rewrite docs and tests last, but before the branch is considered complete.

## 9. What Must Not Survive The Cutover

The following concepts should be treated as prohibited after the cutover:

- any public `/drafts/*` route
- any public `/external/drafts/*` route
- any `/api/integrations/beach/*` authoring route
- any callback/webhook registration or delivery model
- any refresh/reuse of an authoring record by `external_id`
- any public `draft`, `card`, or `assessment` payload
- any public state named `draft`, `compiling`, `needs_input`, or `failed`
- any requirement that Agora understand Telegram-native or Beach-native file identifiers
- any common-schema defaults that silently fill in reward/distribution/domain/timezone on the caller’s behalf

## 10. Final Recommendation

This should be executed as a **hard cutover**, not as a compatibility migration.

The repo currently has too many stale parallel concepts:

- draft vs session
- direct vs external vs Beach routes
- partner bearer auth vs agent auth
- callback push vs self-scoped polling
- refresh-by-external-id vs create-new-session
- old compilation/confirmation/card payloads vs the locked canonical session object

Keeping any of those alive “for now” will recreate the same drift that caused this audit.
