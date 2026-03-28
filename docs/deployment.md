# Deployment

## Purpose

How to deploy, cut over, and roll back Agora services across environments.

## Audience

Operators and engineers responsible for deploying Agora to testnet or production.

## Read this after

- [Architecture](architecture.md) — system overview
- [specs/runtime-release-architecture.md](specs/runtime-release-architecture.md) — locked release, health, and ingress architecture
- [Protocol](protocol.md) — contract lifecycle and settlement rules
- [Operations](operations.md) — day-to-day operations, monitoring, and incident response
- [specs/authoring-session-api.md](specs/authoring-session-api.md) — locked session-first authoring contract

## Source of truth

This doc is authoritative for: pre-launch checklists, deployment procedures, rollback criteria, contract deployment, external cutover checklists, and worker recovery scripts. It is NOT authoritative for: future-state runtime release architecture (see [specs/runtime-release-architecture.md](specs/runtime-release-architecture.md)), day-to-day operations, health monitoring, incident playbooks, or service startup (see [Operations](operations.md)).

## Summary

- Pre-launch requires aligned (chain id, factory address, USDC address) tuple across all services
- Cutover requires coordinated env updates, DB reset, factory deploy, and reindex
- Railway owns runtime deployment for API, indexer, and worker orchestrator
- GitHub and local operator commands verify hosted runtime readiness; they do not deploy runtime services
- `reset-bomb:testnet` is the destructive admin-only lane for explicit hosted schema rebuilds
- `verify:runtime` is the read-only hosted gate
- `smoke:cli:local` is the deterministic local CLI parity lane
- `smoke:hosted` is the separate funded operator lane
- Rollback if API health, indexer lag, DB consistency, or scoring verification fails
- External cutover covers GitHub, Vercel, API/runtime services, executor runtime, chain addresses, image registry, DNS, and operator machines

---

## Pre-Launch Checklist

1. Merge latest `main` and deploy from `main` only.
2. Set all required environment variables in your host platform.
3. For a clean contract generation: reset the testnet Supabase schema and apply [001_baseline.sql](/Users/changyuesin/Agora/packages/db/supabase/migrations/001_baseline.sql).
4. Deploy a fresh `v2` factory. `scripts/deploy.sh` requires explicit `AGORA_ORACLE_ADDRESS` and `AGORA_TREASURY_ADDRESS`.
5. Set `AGORA_INDEXER_START_BLOCK` to the factory deployment block before restarting the indexer.
6. Confirm the canonical `(chain id, factory address, USDC address)` tuple is identical in API, indexer, worker orchestrator, CLI, and web env.
7. If sealed submissions are enabled, set the submission sealing env vars in API and worker orchestrator.
8. Set `AGORA_CORS_ORIGINS` (comma-separated exact origins).
9. Ensure `/api/health`, `/api/worker-health`, and `/api/indexer-health` expose a stable runtime version and a non-ambiguous `identitySource`. For shared hosted services, prefer `AGORA_EXPECT_RELEASE_METADATA=true` once baked metadata or provider git metadata is confirmed to be present.
10. Keep `AGORA_REQUIRE_PINNED_PRESET_DIGESTS=true`. Official GHCR scorer packages should be public; if they are not public yet, set `AGORA_GHCR_TOKEN` anywhere digest resolution runs and make sure the executor host can still `docker pull` them.
11. Build and run preflight:

```bash
pnpm install
pnpm turbo build
./scripts/preflight-testnet.sh
```

Recommended explicit release checks:

```bash
pnpm schema:verify
pnpm scorers:verify
```

Recommended runtime release trigger:

```bash
pnpm verify:runtime
pnpm smoke:hosted
```

Run `pnpm reset-bomb:testnet` only when the hosted schema is incompatible with
the current runtime or when you intentionally want a destructive clean rebuild.

This repo now ships five explicit runtime lanes:

- `pnpm verify:runtime`: non-destructive hosted verification. Assumes Railway
  already rolled out the current `main` change through its native deploy path,
  waits for `/api/health` to be healthy, `/api/worker-health` to show healthy
  workers on the active API runtime, `/api/indexer-health` to report the same
  runtime identity, and stops there.
- `pnpm reset-bomb:testnet`: destructive admin lane. Uses
  `AGORA_SUPABASE_ADMIN_DB_URL` to reset the Supabase schema, reapplies the
  single baseline, reloads the PostgREST cache, then runs the hosted runtime
  verification gate. When `AGORA_EXPECTED_GIT_SHA` or
  `AGORA_EXPECTED_RUNTIME_VERSION` is set, it first waits for `/api/health` to
  expose the intended API release metadata before the destructive reset starts.
- `pnpm smoke:hosted`: funded external smoke. Posts a small real challenge,
  submits a real result, waits for worker scoring, and verifies the public
  replay artifacts. It does not try to finalize or claim.
- `pnpm smoke:lifecycle:local`: deterministic local lifecycle. Boots an
  isolated local Supabase + Anvil stack, resets the local schema from the
  canonical baseline, deploys local chain fixtures, then runs the direct
  lifecycle harness.
- `pnpm smoke:cli:local`: deterministic local CLI parity. Runs the exact
  `post -> submit -> worker scoring -> verify-public -> finalize -> claim`
  path on the isolated local stack so CLI settlement coverage stays
  deterministic without coupling funded hosted smoke back into the release
  gate.

GitHub Actions now follow the deploy boundary directly:

- `CI` is the push-time code gate.
- `Verify Runtime` runs after `CI` succeeds on `main`, waits for Railway to
  expose the intended API release metadata, then checks hosted schema
  compatibility and runtime readiness without mutating the environment.
- `Reset Bomb Testnet` is manual and destructive.
- `Hosted Smoke` is manual and funded.

This separation is intentional. Railway still owns deploy. GitHub verifies the
live hosted runtime automatically, while destructive reset remains an explicit
operator action.

The matching GitHub Actions entrypoints are
[`.github/workflows/verify-runtime.yml`](/Users/changyuesin/Agora/.github/workflows/verify-runtime.yml)
for automatic plus manual read-only hosted verification,
[`.github/workflows/reset-bomb-testnet.yml`](/Users/changyuesin/Agora/.github/workflows/reset-bomb-testnet.yml)
for manual destructive reset, and
[`.github/workflows/hosted-smoke.yml`](/Users/changyuesin/Agora/.github/workflows/hosted-smoke.yml)
for funded hosted smoke.

The current runtime verification path requires:

- `AGORA_API_URL`
- `AGORA_SUPABASE_URL`
- `AGORA_SUPABASE_ANON_KEY`
- `AGORA_SUPABASE_SERVICE_KEY`
- `AGORA_SUPABASE_ADMIN_DB_URL` only for destructive reset bomb

The funded hosted smoke lane additionally requires:

- chain, wallet, and Pinata values
- a small real USDC balance in the smoke wallet

Railway should keep its native runtime deploy path enabled for API, indexer,
and worker orchestrator. GitHub Actions no longer updates Railway service
config or promotes runtime-service images.

Notes:

- `pnpm scorers:verify` requires a running Docker daemon.
- It verifies the production invariant, not just digest resolution: official scorer images must be anonymously resolvable from GHCR and anonymously pullable with Docker.
- The shipped official execution-template catalog is intentionally narrow. Today the primary template is `official_table_metric_v1`; do not add placeholder templates unless a real published scorer artifact exists for them.
- This repo now ships a single rebased Supabase baseline. Reset the schema and apply [001_baseline.sql](/Users/changyuesin/Agora/packages/db/supabase/migrations/001_baseline.sql) instead of attempting an incremental migration chain.

Railway deployment checks before production cutover:

- Keep native Railway auto-deploy enabled for API, indexer, and worker
  orchestrator.
- If Railway `Wait for CI` is enabled, only let it wait on the repo `CI`
  workflow. Do not make Railway wait on `Verify Runtime`, because
  `Verify Runtime` is intentionally post-deploy and would create a circular
  gate.
- Set the API service health check path to `/api/health` with a `30` second timeout so Railway refuses to activate a runtime that is already returning `503`.
- Keep `/api/health` and `/healthz` fast and probe-safe for both `GET` and `HEAD`. Health probe responses should be visible in API logs through the `api.health.probe` event so failed promotions can be diagnosed from the application side.
- Set `AGORA_EXPECT_RELEASE_METADATA=true` on shared Railway runtime services once the hosted release metadata path is proven. This makes startup fail loud if release identity falls back to `unknown`, `repo_git`, or placeholder `dev`.
- Do not replace Railway-native runtime deploys with a custom manifest/image
  promotion path.
- Do not use repo-local `railway.toml` files for these services unless Railway
  itself becomes insufficient and a new architecture is explicitly approved.
- If Railway root directories or watch patterns are needed, keep them
  provider-native and document them clearly.
- Any PR or direct push that changes `packages/db/src/schema-compatibility.ts` or `packages/db/supabase/migrations/001_baseline.sql` must include `[runtime-schema-change]` in the PR title or commit message. CI treats that token as the explicit acknowledgment that the hosted reset plan has been reviewed.
- The only supported hosted Base Sepolia rollout is gated and explicit:
  1. merge or push the intended runtime change to `main`
  2. let Railway deploy API, indexer, and worker natively
  3. let `Verify Runtime` wait for the intended API release and check hosted
     schema compatibility plus `/api/health` and `/api/worker-health`
  4. if verification reports schema incompatibility and a destructive rebuild
     is acceptable, run `pnpm reset-bomb:testnet` or the manual workflow
  5. run `pnpm smoke:hosted` only when you intentionally want the funded
     hosted smoke lane
  6. rerun `pnpm verify:runtime` as the read-only confirmation check

---

## Rollback Criteria

Rollback if any of these occur:

- API health fails for more than 5 minutes.
- Indexer lag exceeds 200 blocks for more than 10 minutes.
- Incorrect challenge/submission writes observed in Supabase.
- Scoring or verification mismatches between on-chain and local outputs.

---

## Deployment and Cutover

```mermaid
flowchart TB
    A["1. Merge to main"] --> B["2. pnpm install && pnpm turbo build"]
    B --> C["3. Railway deploys API, Indexer, Worker<br/>(native deploy path)"]
    C --> D["4. Verify hosted runtime readiness<br/>(wait for API release -> schema verify -> health verify)"]
    D --> E["5. Optional funded hosted smoke<br/>(pnpm smoke:hosted)"]
    E --> F{"All checks pass?"}
    F -->|Yes| G["✓ Live"]
    F -->|No| H["Investigate hosted runtime failure<br/>or run explicit reset bomb if schema rebuild is required"]
```

### Contract Deployment

```bash
./scripts/deploy.sh             # Contracts to Base Sepolia
./scripts/preflight-testnet.sh  # Pre-launch validation
```

Clean v2 cutover:

1. Run one active factory generation at a time.
2. Reset Supabase, apply [001_baseline.sql](/Users/changyuesin/Agora/packages/db/supabase/migrations/001_baseline.sql).
3. Deploy fresh `v2` factory.
4. Update canonical `(chain id, factory address, USDC address)` tuple everywhere.
5. Set `AGORA_INDEXER_START_BLOCK` and reindex from zero.

---

## External Cutover Checklist

This section covers non-code work for deployment across hosted systems.

### GitHub

- Confirm repo slug, settings, secrets use `AGORA_*` naming.
- Review branch protection rules, required status checks, environments, and deployment rules.
- Review GHCR visibility, package ownership, and README metadata.
- Review release names, milestones, and any pinned issue/PR templates.

### Vercel

- Set production and preview env vars (`NEXT_PUBLIC_AGORA_*` and server-side `AGORA_*`).
- On Vercel, `AGORA_API_URL` must point to the backend API origin, not the web origin. The web app's `/api/*` proxy uses this server-side value and will return `500` if it loops back to the web host.
- Update the production domain and any preview aliases.
- Validate that Open Graph metadata, title, and favicon render as Agora.
- Verify explorer links in the UI point to current deployments.

### API Runtime

- Set the API environment to `AGORA_*` names only.
- `AGORA_CORS_ORIGINS` matches frontend origins.
- `AGORA_RUNTIME_VERSION` is an optional override. API, worker orchestrator, and indexer processes launched through `scripts/run-node-with-root-env.mjs` use build metadata or platform git metadata when available and otherwise fall back to a best-effort runtime version such as `dev`.
- `AGORA_RELEASE_ID` and `AGORA_RELEASE_GIT_SHA` should normally be left alone on Railway. Only inject them deliberately if the team chooses an explicit metadata-sync step.
- `AGORA_SUPABASE_ADMIN_DB_URL` is bootstrap-only. Do not inject it into the
  long-running runtime services unless an explicit admin command needs it.
- While the runtime schema is healthy, the API keeps the active scoring runtime version in sync inside `worker_runtime_control`. Scoring workers only claim jobs when their runtime version matches that active row, which keeps claim fencing explicit even though API and worker orchestrator now roll forward together.
- SIWE origin and domain checks pass against production API and web domains.
- `agora_session` cookie is issued with correct `secure` behavior in production.
- Reverse proxy forwards `x-forwarded-host` and `x-forwarded-proto` correctly.
- Browser auth/session requests stay same-origin under the web origin's `/api/*` proxy instead of calling the backend API origin directly.

### Chain Cutover

- Reset testnet DB through `AGORA_SUPABASE_ADMIN_DB_URL`, then apply [001_baseline.sql](/Users/changyuesin/Agora/packages/db/supabase/migrations/001_baseline.sql).
- Deploy fresh `v2` factory.
- Update all runtime addresses together:
  - `AGORA_FACTORY_ADDRESS`, `AGORA_USDC_ADDRESS`, `AGORA_CHAIN_ID`, `AGORA_RPC_URL`
  - `AGORA_ORACLE_ADDRESS`, `AGORA_TREASURY_ADDRESS`
  - `NEXT_PUBLIC_AGORA_FACTORY_ADDRESS`, `NEXT_PUBLIC_AGORA_USDC_ADDRESS`, `NEXT_PUBLIC_AGORA_CHAIN_ID`, `NEXT_PUBLIC_AGORA_RPC_URL`
- Set indexer start block for the new deployment generation.
- Reindex from the fresh `v2` factory only.
- Never mix prior-generation factory addresses into active runtime envs.

### Image Registry

- Publish scorer images under the Agora namespace (`ghcr.io/andymolecule/*`).
- The current official package set is:
  - `gems-match-scorer`
  - `gems-tabular-scorer`
  - `gems-ranking-scorer`
  - `gems-generated-scorer`
- Use the `Publish Scorers` GitHub Actions workflow to build and publish official scorer images from `containers/`.
- The scorer publish workflow must publish a multi-arch manifest list for `linux/amd64` and `linux/arm64`.
- The scorer publish workflow now verifies digest resolution plus unauthenticated `docker pull` for both `linux/amd64` and `linux/arm64` after publishing. A release is not healthy until all pass.
- If the repo owner and GHCR namespace differ, provide `GHCR_PAT` (with `write:packages`) and, if needed, `GHCR_USERNAME` to the workflow so it can push into the org package namespace.
- Make official scorer packages public in GHCR so solvers and verifiers can inspect and pull them without credentials.
- If you cannot make the package public yet, provide `AGORA_GHCR_TOKEN` for any API or worker environment that resolves official image digests, and configure Docker auth on the worker host separately. Public packages are still the preferred steady state.
- Publish stable release tags (for example `:v1`) and resolve them to pinned `@sha256:` digests before challenge persistence. Do not use `:latest`.
- Verify tags/digests referenced by official execution templates are available.
- Do not treat amd64-only official images as healthy for release. Local Apple Silicon operator/developer hosts are part of the supported verification surface.
- Do not bake hidden labels, hidden test sets, or other evaluation-only data into the image. Put that material in the evaluation bundle or mounted dataset CIDs instead.
- After the first publish, confirm package visibility in the GitHub Packages UI. The workflow pushes images, but package visibility is still an org-level/package-level setting.

### Executor Runtime

- Deploy the executor from `apps/executor` onto a Docker-capable host or service.
- Set `AGORA_EXECUTOR_AUTH_TOKEN` on the executor and the matching `AGORA_SCORER_EXECUTOR_TOKEN` on the worker orchestrator.
- In production, the executor now fails to start without `AGORA_EXECUTOR_AUTH_TOKEN`.
- Set the worker orchestrator to `AGORA_SCORER_EXECUTOR_BACKEND=remote_http` and `AGORA_SCORER_EXECUTOR_URL=<executor base url>`.
- The executor is infrastructure, not an every-commit app deploy target. Update it when the executor service changes or when scorer execution semantics require it.

### Sealed Submission Validation Bridge

- Set `AGORA_WORKER_INTERNAL_PORT` and `AGORA_WORKER_INTERNAL_TOKEN` on the worker service.
- Set the matching `AGORA_WORKER_INTERNAL_URL` and `AGORA_WORKER_INTERNAL_TOKEN` on the API service.
- `GET /api/submissions/public-key` now fails closed when this bridge is missing, so sealed submission traffic cannot start from a partially configured deploy.
- `pnpm deploy:verify` now compares the API public-key fingerprint with `/api/worker-health.sealing.publicKeyFingerprint` and `/api/worker-health.sealing.derivedPublicKeyFingerprint`, so the default hosted verify lane can catch API/worker key drift without Railway-private access.
- `pnpm deploy:verify --worker-internal-url=<worker-internal-origin> --worker-internal-token=<token>` remains the optional deep check when you want to query the worker's private validation server directly from a network that can reach Railway internal services.

### Worker Recovery Scripts

- `pnpm recover:score-jobs -- --challenge-id=<challenge-id>` requeues stale `running` jobs and retries failed jobs after an infra outage.
- `agora clean-failed-jobs` skips terminal failed jobs such as invalid submissions, missing off-chain submission metadata, and invalid challenge scoring configs. It is dry-run by default.
- `pnpm schema:verify` checks that the live Supabase/PostgREST schema exposes all runtime-critical columns.
- `pnpm scorers:verify` checks that all official scorer images are anonymously resolvable from GHCR and anonymously pullable with Docker.
- `pnpm smoke:lifecycle:local` runs the deterministic Anvil-backed lifecycle smoke.
- `pnpm verify:runtime` runs the read-only hosted runtime gate.
- `pnpm smoke:hosted` runs the funded hosted smoke against the configured deployment.
- `pnpm deploy:verify --api-url=<api-origin> --web-url=<web-origin>` checks hosted API health, optional web version visibility, and worker readiness on the active API runtime. Use `--skip-web` for runtime-only verification. Pass `--expected`, `--expected-api`, `--expected-web`, or `--expected-git-sha` only when you intentionally want an explicit identity check.
- Railway `redeploy` rebuilds the latest Railway deployment snapshot; it does not fetch the latest GitHub `main` commit. Use Railway auto-deploy or the dashboard's `Deploy Latest Commit` when the goal is to advance source freshness.
- A healthy-but-stale runtime is a deploy freshness problem, not a smoke-test problem. The clean detector is `AGORA_EXPECTED_GIT_SHA` in `pnpm verify:runtime`; the clean fix is Railway advancing the GitHub source, not a second deploy system in this repo.
- `Monitor Scoring Runtime` GitHub Actions runs on a schedule and fails visibly when `/api/worker-health` reports zero healthy workers on the active runtime or sealing readiness is unavailable.

### DNS and Domains

- Point the production web domain to the frontend deployment.
- Point the production API domain to the API deployment.
- Update CORS allowlists, reverse-proxy configs, and TLS cert coverage for final domains.

### Operator Machines

- Replace local `.env` files with current `AGORA_*` naming.
- Update agent client configs to Agora API origin and tool ids.
- Confirm CLI config directories and aliases use `agora`.
- Confirm cron jobs, shell aliases, launch agents, or systemd units do not reference retired names.

### Final Verification

- `git remote -v` shows the Agora repo URL.
- Hosted web app title and metadata display Agora.
- `pnpm deploy:verify --api-url=<api-origin> --web-url=<web-origin>` passes before cutover, proving the hosted API is healthy, the worker is aligned with the API runtime, and the optional web check is visible.
- API auth flow sets `agora_session`.
- CLI help text shows `agora`.
- Runtime envs contain only `AGORA_*` and `NEXT_PUBLIC_AGORA_*` keys for first-party settings.
- All externally referenced scorer images resolve under the Agora registry namespace.
