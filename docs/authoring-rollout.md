# Authoring Rollout Runbook

## Purpose

Operational guide for the recent authoring, draft-storage, Beach integration, and strict submission-intent changes.

Use this when you need to:

- apply the new Supabase migrations
- update Railway / Vercel environment variables
- cut over API, indexer, worker, and web safely
- verify Beach-authoring flows end to end

## Audience

Operators and engineers deploying Agora after the phase-1 to phase-7 authoring refactor.

## Read this after

- [Operations](operations.md)
- [Deployment](deployment.md)
- [Data and Indexing](data-and-indexing.md)
- [Authoring Callbacks](authoring-callbacks.md)
- [Challenge Authoring IR](challenge-authoring-ir.md)

## Summary

- Fresh environments: apply all migrations.
- Existing environments: the important migration window is `017` through `035`.
- `020_strict_submission_intents.sql` is guarded and will stop if legacy submissions still lack a matching intent. Preflight it first.
- API, indexer, and worker orchestrator should be redeployed together after env + schema changes.
- Beach/OpenClaw integration is Agora-hosted on the backend: Beach/OpenClaw only need a bearer token and optional webhook endpoint; Agora owns the sponsor signer for the MVP publish path.
- For the Beach/OpenClaw MVP, the server-to-server external draft flow is the primary path. Browser-hosted `/post` is only the human-assist fallback.

---

## What Changed

This rollout introduced four operationally relevant changes:

1. External authoring sources and Beach import
- new partner-authenticated authoring routes
- new callback signing / retry behavior
- new partner return-origin allowlists

2. Strict submission-intent flow
- `submissions` now require `submission_intent_id`
- on-chain-first / reconcile-later scoring is no longer the intended path

3. Tightened draft storage
- canonical draft state lives in `authoring_drafts`
- callback registration metadata and publish outcome now live on the draft row itself
- callback retry outbox lives in `authoring_callback_deliveries`

4. New operator env/config surface
- partner bearer keys
- callback secrets
- allowed return origins
- internal operator token for callback sweep / maintenance operations
- internal sponsor signer for agent-native external publish
- optional per-partner sponsor budget caps

---

## Required Migrations

Fresh environment:

- apply everything in `packages/db/supabase/migrations`

Existing environment already running Agora:

- ensure these are applied in order:
  - `017_posting_session_authoring_ir.sql`
  - `018_authoring_source_callbacks.sql`
  - `019_authoring_callback_deliveries.sql`
  - `020_strict_submission_intents.sql`
  - `021_split_authoring_drafts.sql`
  - `022_restrict_submission_intent_fk.sql`
  - `023_drop_submission_intent_match_backrefs.sql`
  - `024_move_authoring_callback_targets.sql`
  - `025_create_authoring_source_links.sql`
  - `026_add_challenge_source_attribution.sql`
  - `027_extend_authoring_callback_events.sql`
  - `028_add_authoring_sponsor_budget_reservations.sql`
  - `029_add_challenge_evaluation_plan.sql`
  - `030_make_challenge_runtime_caches_optional.sql`
  - `031_drop_legacy_challenge_runtime_caches.sql`
  - `032_scope_score_job_claims_by_chain.sql`
  - `033_atomic_replace_challenge_payouts.sql`
  - `034_merge_authoring_draft_metadata.sql`
  - `035_narrow_authoring_callback_delivery_provider.sql`

### Migration Notes

`017_posting_session_authoring_ir.sql`
- adds `posting_sessions.authoring_ir_json` column
- required before `021` which reads this column during the data copy

`018_authoring_source_callbacks.sql`
- adds callback registration metadata on the legacy draft table

`019_authoring_callback_deliveries.sql`
- adds the durable callback outbox table

`020_strict_submission_intents.sql`
- adds `submissions.submission_intent_id`
- backfills from matched intents
- raises and stops if any submissions still lack intents after backfill
- deduplicates `submission_intents`
- makes the FK non-null

`021_split_authoring_drafts.sql`
- creates `authoring_drafts`
- creates `published_challenge_links`
- copies old draft rows forward from `posting_sessions`
- repoints `authoring_callback_deliveries.draft_id`

`022_restrict_submission_intent_fk.sql`
- changes the `submissions -> submission_intents` FK from `CASCADE` to `RESTRICT`

`023_drop_submission_intent_match_backrefs.sql`
- removes `submission_intents.matched_submission_id`
- removes `submission_intents.matched_at`
- keeps `submissions.submission_intent_id` as the only canonical link between the two tables

`024_move_authoring_callback_targets.sql`
- creates `authoring_callback_targets`
- copies callback registration metadata out of `authoring_drafts`
- drops callback registration columns from `authoring_drafts`

`025_create_authoring_source_links.sql`
- creates `authoring_source_links`
- establishes canonical `(provider, external_id)` identity for repeated external imports

`026_add_challenge_source_attribution.sql`
- adds `source_provider`, `source_external_id`, `source_external_url`, and `source_agent_handle` to `challenges`
- backfills challenge attribution from `published_challenge_links.published_spec_json.source`

`027_extend_authoring_callback_events.sql`
- extends the callback outbox event constraint
- allows `challenge_created` and `challenge_finalized` in addition to the existing `draft_*` events

`028_add_authoring_sponsor_budget_reservations.sql`
- adds the sponsor-budget reservation ledger used by external authoring publish

`029_add_challenge_evaluation_plan.sql`
- adds `challenges.evaluation_plan_json` as the canonical cached execution plan

`030_make_challenge_runtime_caches_optional.sql`
- relaxes the old challenge runtime cache columns during the evaluation-plan cutover

`031_drop_legacy_challenge_runtime_caches.sql`
- removes legacy challenge runtime cache columns once `evaluation_plan_json` is canonical

`032_scope_score_job_claims_by_chain.sql`
- scopes worker score-job claims by `challenges.chain_id`
- prevents workers on one chain/runtime from stealing jobs from another

`033_atomic_replace_challenge_payouts.sql`
- adds the atomic payout replacement function used by settlement/indexer reconciliation

`034_merge_authoring_draft_metadata.sql`
- moves callback registration and publish outcome back onto `authoring_drafts`
- backfills those fields from the old split tables
- drops `authoring_callback_targets` and `published_challenge_links`

`035_narrow_authoring_callback_delivery_provider.sql`
- fail-loud cleanup for already-migrated environments
- narrows `authoring_callback_deliveries.provider` to `beach_science`
- raises if legacy provider rows still exist instead of silently mutating them

---

## Preflight Before `020`

Do not apply `020_strict_submission_intents.sql` blindly on a populated environment.

Run:

```sql
select count(*) from submissions where submission_intent_id is null;
```

If that count is non-zero:

- `020` will raise and stop instead of deleting those rows implicitly
- decide whether the environment is disposable
- if you care about those rows, stop and inspect/backfill or explicitly delete them before re-running the migration

Recommended extra checks:

```sql
select challenge_id, solver_address, result_hash, count(*)
from submission_intents
group by 1, 2, 3
having count(*) > 1;
```

```sql
select count(*) from submission_intents;
```

After `020`, apply [023_drop_submission_intent_match_backrefs.sql](/Users/changyuesin/Agora/packages/db/supabase/migrations/023_drop_submission_intent_match_backrefs.sql) to remove the now-redundant reverse match columns from `submission_intents`. The strict runtime model uses `submissions.submission_intent_id` as the only canonical linkage.

Interpretation:

- unmatched intents are not a blocker by themselves
- duplicate `(challenge_id, solver_address, result_hash)` rows will be deduplicated by `020`

---

## How To Apply Migrations

There is no repo-local migration wrapper script for Supabase in this repo right now.

Use one of:

1. Supabase dashboard SQL editor
2. your existing Supabase CLI workflow

Recommended order for existing environments:

1. take a DB snapshot / backup
2. apply `017`
3. apply `018`
4. apply `019`
5. run the `020` preflight query
6. apply `020`
7. apply `021`
8. apply `022`
9. apply `023`
10. apply `024`
11. apply `025`
12. apply `026`
13. apply `027`
14. apply `028`
15. apply `029`
16. apply `030`
17. apply `031`
18. apply `032`
19. apply `033`
20. apply `034`
21. apply `035`
22. reload PostgREST schema cache
23. run `pnpm schema:verify`

If your deployment path relies on Supabase-managed PostgREST metadata, reload schema visibility before restarting API/worker services.

---

## Post-Migration Validation

Run:

```bash
pnpm schema:verify
pnpm --filter @agora/db test
```

Expected database state:

- `submissions.submission_intent_id` exists and is non-null
- `authoring_drafts` exists
- `authoring_drafts.source_callback_url` exists
- `authoring_drafts.published_spec_cid` exists
- `authoring_callback_deliveries` exists and points to `authoring_drafts`

Useful SQL checks:

```sql
select count(*) from authoring_drafts;
```

```sql
select count(*) from authoring_callback_deliveries;
```

```sql
select conname
from pg_constraint
where conname = 'submissions_submission_intent_id_fkey';
```

---

## Required Environment Variables

These are the important ones for the new authoring flow.

### Shared Core

Set consistently across the relevant services:

```bash
AGORA_SUPABASE_URL=
AGORA_SUPABASE_ANON_KEY=
AGORA_SUPABASE_SERVICE_KEY=
AGORA_PINATA_JWT=
AGORA_API_URL=
AGORA_FACTORY_ADDRESS=
AGORA_USDC_ADDRESS=
AGORA_CHAIN_ID=
AGORA_RPC_URL=
AGORA_RUNTIME_VERSION=
```

### New Authoring / Beach / Review Vars

```bash
AGORA_AUTHORING_OPERATOR_TOKEN=
AGORA_AUTHORING_PARTNER_KEYS='beach_science:...'
AGORA_AUTHORING_PARTNER_CALLBACK_SECRETS='beach_science:...'
AGORA_AUTHORING_PARTNER_RETURN_ORIGINS='beach_science:https://beach.science'
AGORA_AUTHORING_SPONSOR_PRIVATE_KEY='0x...'
AGORA_AUTHORING_SPONSOR_MONTHLY_BUDGETS='beach_science:500'
```

Formatting rules:

- `AGORA_AUTHORING_PARTNER_KEYS`
  - comma-separated `provider:key`
- `AGORA_AUTHORING_PARTNER_CALLBACK_SECRETS`
  - comma-separated `provider:secret`
- `AGORA_AUTHORING_PARTNER_RETURN_ORIGINS`
  - comma-separated `provider:https://origin1|https://origin2`
  - HTTPS only
  - public origins only
- `AGORA_AUTHORING_SPONSOR_PRIVATE_KEY`
  - 32-byte hex private key
  - Agora-side only
  - used for the internal sponsor wallet in the agent-native external publish path
- `AGORA_AUTHORING_SPONSOR_MONTHLY_BUDGETS`
  - optional comma-separated `provider:amount` pairs
  - enforced before Agora sponsor-publishes an external draft

Example:

```bash
AGORA_AUTHORING_PARTNER_KEYS='beach_science:beach-prod-bearer'
AGORA_AUTHORING_PARTNER_CALLBACK_SECRETS='beach_science:beach-prod-callback-secret'
AGORA_AUTHORING_PARTNER_RETURN_ORIGINS='beach_science:https://beach.science|https://staging.beach.science'
AGORA_AUTHORING_OPERATOR_TOKEN='internal-operator-token'
AGORA_AUTHORING_SPONSOR_PRIVATE_KEY='0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
AGORA_AUTHORING_SPONSOR_MONTHLY_BUDGETS='beach_science:500'
```

### Web

Set the usual web vars too:

```bash
NEXT_PUBLIC_AGORA_API_URL=
NEXT_PUBLIC_AGORA_FACTORY_ADDRESS=
NEXT_PUBLIC_AGORA_USDC_ADDRESS=
NEXT_PUBLIC_AGORA_CHAIN_ID=
NEXT_PUBLIC_AGORA_RPC_URL=
```

`AGORA_AUTHORING_OPERATOR_TOKEN` is only needed for internal callback sweep / maintenance callers. The normal hosted `/post` flow does not require that token in the web environment.

---

## Railway / Vercel Service Map

Recommended hosted layout:

- Vercel
  - `@agora/web`
- Railway
  - `@agora/api`
  - `@agora/chain` indexer
  - `@agora/api` worker orchestrator
- separate Docker-capable host/service
  - `apps/executor`

### Railway Build / Start Commands

API:

```bash
pnpm turbo build --filter=@agora/api
pnpm --filter @agora/api start
```

Indexer:

```bash
pnpm turbo build --filter=@agora/chain
pnpm --filter @agora/chain indexer
```

Worker orchestrator:

```bash
pnpm turbo build --filter=@agora/api
pnpm --filter @agora/api worker
```

### Deploy Order

1. apply DB migrations
2. reload schema cache
3. update Railway env vars
4. deploy API
5. deploy indexer
6. deploy worker orchestrator
7. deploy web
8. verify executor connectivity

Do not roll API and worker onto different runtime expectations for long. They should move together.

---

## Beach Integration Checklist

For the full host-side implementation guide, see [Beach Integration Guide](beach-integration.md).

Beach does not need direct DB access.

Beach needs:

- a bearer token matching `AGORA_AUTHORING_PARTNER_KEYS`
- optionally a callback endpoint
- optionally an allowlisted return origin for human redirect flows

Beach does not need:

- Supabase credentials
- scorer runtime access
- chain deploy access for the MVP sponsor-backed flow

### Backend Entry Points

Submit Beach thread:

- `POST /api/integrations/beach/sessions`

Then use generic partner draft lifecycle:

- `GET /api/authoring/external/drafts/:id`
- `POST /api/authoring/external/drafts/submit`
- `POST /api/integrations/beach/sessions/:id/publish`
- `POST /api/authoring/external/drafts/:id/webhook`

Session responses now include canonical `state`, `questions`, `reasons`, and `checklist` fields so OpenClaw can tell whether the session is publishable, still awaiting input, or rejected.

### Callback Sweep

The durable callback outbox still needs an operator-triggered sweep.

Endpoint:

- `POST /api/authoring/callbacks/sweep`

Header:

```bash
x-agora-operator-token: ${AGORA_AUTHORING_OPERATOR_TOKEN}
```

This can be called from cron or an internal operator job.

---

## Smoke Test Checklist

After deploy:

```bash
pnpm schema:verify
pnpm scorers:verify
curl -sS http://<api>/healthz
curl -sS http://<api>/api/worker-health
curl -sS http://<api>/api/authoring/health
```

Authoring-specific checks:

1. create a direct draft in `/post`
2. compile a direct draft
3. start a Beach session through `/api/integrations/beach/sessions`
4. confirm the session response `state`, `questions`, and `checklist` are sensible
5. publish it through `/api/integrations/beach/sessions/:id/publish`
6. register a webhook through `/api/authoring/external/drafts/:id/webhook`
7. confirm `challenge_created` callbacks or polling-visible challenge refs after publish
8. publish a hosted session and confirm return-to behavior if humans are in the loop
9. run callback sweep and confirm pending deliveries drain, including `challenge_finalized` when applicable

Useful local regression command:

```bash
cd /Users/changyuesin/Agora/apps/api
node --import tsx --test \
  tests/authoring-drafts-route.test.ts \
  tests/authoring-sources.test.ts \
  tests/authoring-drafts.test.ts \
  tests/integrations-beach.test.ts
```

---

## Known Operational Caveats

- `020_strict_submission_intents.sql` now raises and stops on unmatched submissions instead of deleting them implicitly.
- `021_split_authoring_drafts.sql` copies forward from `posting_sessions`; it does not drop the old table itself.
- `034_merge_authoring_draft_metadata.sql` collapses callback registration and publish outcome back into `authoring_drafts`; older split tables are intentionally removed.
- callback delivery is durable and signed, but still depends on the sweep endpoint being run.
- internal-operator sealed-submission privacy is still not the current runtime model; public/API privacy is the enforced boundary today.

---

## Recommended Cutover Decision

If you are deploying the latest code to an existing environment, the minimum safe cutover set is:

1. apply `017` through `034`
2. set the new authoring env vars
3. redeploy API + indexer + worker orchestrator together
4. run `pnpm schema:verify`
5. run the authoring/Beach smoke checks

If any of those fail, stop before exposing Beach or other external-host authoring traffic.
