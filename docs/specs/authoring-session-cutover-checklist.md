# Authoring Session Cutover Checklist

Date: 2026-03-22
Baseline spec: [authoring-session-api.md](/Users/changyuesin/Agora/docs/specs/authoring-session-api.md)  
Audit matrix: [authoring-session-api-audit.md](/Users/changyuesin/Agora/docs/specs/authoring-session-api-audit.md)

## Purpose

Execution checklist for replacing the legacy draft/partner/callback authoring model with the locked session-first contract.

## Phase 1A — Hard Deletions That Are Safe Now

- [x] Remove Beach/partner route mounts from [apps/api/src/app.ts](/Users/changyuesin/Agora/apps/api/src/app.ts)
- [x] Delete [apps/api/src/routes/authoring-sources.ts](/Users/changyuesin/Agora/apps/api/src/routes/authoring-sources.ts)
- [x] Delete [apps/api/src/routes/integrations-beach.ts](/Users/changyuesin/Agora/apps/api/src/routes/integrations-beach.ts)
- [x] Delete [apps/api/src/lib/authoring-source-auth.ts](/Users/changyuesin/Agora/apps/api/src/lib/authoring-source-auth.ts)
- [x] Delete [apps/api/src/lib/authoring-external-workflow.ts](/Users/changyuesin/Agora/apps/api/src/lib/authoring-external-workflow.ts)
- [x] Delete [apps/api/src/lib/source-adapters/beach-science.ts](/Users/changyuesin/Agora/apps/api/src/lib/source-adapters/beach-science.ts)
- [x] Delete [apps/api/src/lib/authoring-source-import.ts](/Users/changyuesin/Agora/apps/api/src/lib/authoring-source-import.ts)
- [x] Delete [apps/api/tests/authoring-sources.test.ts](/Users/changyuesin/Agora/apps/api/tests/authoring-sources.test.ts)
- [x] Delete [apps/api/tests/integrations-beach.test.ts](/Users/changyuesin/Agora/apps/api/tests/integrations-beach.test.ts)
- [x] Delete [packages/db/src/queries/authoring-source-links.ts](/Users/changyuesin/Agora/packages/db/src/queries/authoring-source-links.ts)
- [x] Remove stale exports for deleted query modules
- [x] Delete [docs/beach-integration.md](/Users/changyuesin/Agora/docs/beach-integration.md)
- [x] Delete [docs/authoring-callbacks.md](/Users/changyuesin/Agora/docs/authoring-callbacks.md)
- [x] Delete [docs/authoring-rollout.md](/Users/changyuesin/Agora/docs/authoring-rollout.md)
- [x] Remove broken references to deleted docs from active docs

## Phase 1B — Deletions Blocked Until Session Routes Exist

- [x] Delete [apps/api/src/lib/authoring-drafts.ts](/Users/changyuesin/Agora/apps/api/src/lib/authoring-drafts.ts)
- [x] Delete [apps/api/src/lib/authoring-draft-payloads.ts](/Users/changyuesin/Agora/apps/api/src/lib/authoring-draft-payloads.ts)
- [x] Delete [apps/api/src/lib/authoring-draft-transitions.ts](/Users/changyuesin/Agora/apps/api/src/lib/authoring-draft-transitions.ts)
- [x] Delete [apps/api/src/lib/authoring-intake-workflow.ts](/Users/changyuesin/Agora/apps/api/src/lib/authoring-intake-workflow.ts)
- [x] Delete [apps/api/tests/authoring-drafts.test.ts](/Users/changyuesin/Agora/apps/api/tests/authoring-drafts.test.ts)
- [x] Remove callback enqueue behavior from [packages/chain/src/indexer/settlement.ts](/Users/changyuesin/Agora/packages/chain/src/indexer/settlement.ts) and its tests
- [x] Delete callback delivery code and the runtime table once the direct draft route is gone

Result: the remaining direct draft runtime and callback outbox code have been removed. The legacy DB query exports for those surfaces are gone too.

## Phase 2 — DB Cutover

- [x] Add a new migration that renames `authoring_drafts` to `authoring_sessions`
- [x] Drop runtime table `authoring_source_links`
- [x] Drop runtime table `authoring_callback_deliveries`
- [x] Remove callback registration columns from the session aggregate
- [x] Rename sponsor reservation foreign keys from `draft_id` to `session_id`
- [x] Replace old public state constraints with the locked session state model

Historical note: the session-first schema cutover originally landed as an incremental migration step, but the active Supabase migration chain has since been rebased into [001_baseline.sql](/Users/changyuesin/Agora/packages/db/supabase/migrations/001_baseline.sql).

## Phase 3 — Auth And Shared Contract Foundation

- [x] Add `POST /api/agents/register`
- [x] Add agent API key auth using `Authorization: Bearer <api_key>`
- [x] Add shared `creator` model for web and agent sessions
- [x] Replace common public schemas with the locked session request/response contract

Historical note: the agent-auth and creator persistence work is now folded into [001_baseline.sql](/Users/changyuesin/Agora/packages/db/supabase/migrations/001_baseline.sql).

## Phase 4 — Session API Implementation

- [x] Add `POST /api/authoring/uploads`
- [x] Add `GET /api/authoring/sessions`
- [x] Add `POST /api/authoring/sessions`
- [x] Add `GET /api/authoring/sessions/:id`
- [x] Add `PATCH /api/authoring/sessions/:id`
- [x] Add `POST /api/authoring/sessions/:id/publish`
- [x] Add `POST /api/authoring/sessions/:id/confirm-publish`
- [x] Replace old draft serializers with the canonical flat session object
- [x] Implement wallet-funded publish prepare + confirm on the session route

Note: sponsor-funded agent publish and wallet-funded browser publish now both run through the session API contract.

## Phase 5 — Frontend Cutover

- [x] Replace `/api/authoring/drafts/*` usage in the web post flow
- [x] Replace `/api/pin-data` usage with `/api/authoring/uploads`
- [x] Replace old `needs_input` / `failed` / draft payload assumptions with the locked session model
- [x] Update review/publish UI to render `checklist` and the locked `compilation` object
- [x] Remove unused draft-era web helpers from the active `/post` surface

## Phase 6 — Tests And Docs Reconciliation

- [x] Replace draft-route tests with session-route tests
- [x] Rewrite docs still describing draft/partner/callback behavior
- [x] Update OpenAPI to include the new authoring surfaces
- [x] Run repo build plus targeted cutover validation after the cutover lands

Validation completed with:
- `pnpm turbo build`
- `pnpm --filter @agora/common test`
- `pnpm exec tsc -p apps/api/tsconfig.json --noEmit`
- `node --import tsx --test apps/api/tests/openapi-route.test.ts apps/api/tests/authoring-sessions-route.test.ts apps/api/tests/authoring-compiler.test.ts apps/api/tests/authoring-sponsored-publish.test.ts`
