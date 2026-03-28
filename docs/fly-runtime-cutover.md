# Fly Runtime Hosting

## Purpose

Canonical runbook for Agora runtime hosting on Fly.

## Scope

This runbook covers:

- `@agora/api`
- `@agora/api` worker orchestrator
- `@agora/chain` indexer

The executor stays separate on a Docker-capable host or service.

## Repo-Native Fly Assets

- [fly.toml](/Users/changyuesin/Agora/fly.toml)
- [Dockerfile](/Users/changyuesin/Agora/Dockerfile)
- [.github/workflows/deploy-fly-runtime.yml](/Users/changyuesin/Agora/.github/workflows/deploy-fly-runtime.yml)
- [scripts/fly/deploy-runtime.mjs](/Users/changyuesin/Agora/scripts/fly/deploy-runtime.mjs)
- [scripts/fly/shared.mjs](/Users/changyuesin/Agora/scripts/fly/shared.mjs)
- [scripts/fly/sync-secrets.mjs](/Users/changyuesin/Agora/scripts/fly/sync-secrets.mjs)

## Runtime Topology

- one Fly app
- one Docker image
- three process groups: `app`, `worker`, `indexer`
- public API served from `https://<fly-app-name>.fly.dev`
- worker bridge served privately at
  `http://worker.process.<fly-app-name>.internal:3400`

## Required Platform Inputs

- `FLY_API_TOKEN`
- `FLY_APP_NAME`
- chain and Supabase `AGORA_*` secrets
- `AGORA_WORKER_INTERNAL_TOKEN`
- `AGORA_SCORER_EXECUTOR_URL`
- `AGORA_SCORER_EXECUTOR_TOKEN`
- sealing keys, if sealed submissions remain enabled

## Deploy Flow

The canonical hosted runtime deploy path is:

1. `CI`
2. `Deploy Fly Runtime`
3. `Verify Runtime`
4. optional `Hosted Smoke`

The deploy workflow:

1. stages Fly secrets
2. derives `AGORA_API_URL=https://<app>.fly.dev`
3. derives `AGORA_WORKER_INTERNAL_URL=http://worker.process.<app>.internal:3400`
4. stamps `AGORA_RELEASE_ID`, `AGORA_RUNTIME_VERSION`, and
   `AGORA_RELEASE_GIT_SHA` from the commit SHA
5. deploys the runtime image to Fly
6. verifies the hosted runtime

## Manual Operator Flow

For trusted emergency use only:

```bash
export FLY_API_TOKEN=...
export FLY_APP_NAME=<fly-app-name>
pnpm fly:deploy
```

## Health Model

- `/healthz` is Fly liveness
- `/api/health` is hosted readiness
- `/api/worker-health` is scoring readiness
- `/api/indexer-health` is projection readiness

Shared environments should set `AGORA_EXPECT_RELEASE_METADATA=true`.

## Verification

```bash
AGORA_API_URL=https://<fly-app-name>.fly.dev pnpm verify:runtime
pnpm deploy:verify --api-url=https://<fly-app-name>.fly.dev --skip-web
```

## Rollback

Rollback keeps the same data plane:

- Supabase stays the same
- Base stays the same
- executor stays the same

If a Fly deploy fails:

1. restore the previous healthy Fly image or machine set
2. confirm `/api/health`, `/api/worker-health`, and `/api/indexer-health`
3. rerun `pnpm verify:runtime`

## Steady-State Rules

- keep Fly config in-repo
- keep release identity stamped from the commit SHA
- do not hand-edit long-lived hosted runtime identity on the platform
- do not split API, worker, and indexer across separate hosted deploy owners
