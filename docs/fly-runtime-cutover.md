# Fly Runtime Cutover

## Purpose

How to move the Agora runtime services from Railway to Fly without reintroducing
provider drift between API, worker, and indexer.

## Scope

This cutover covers:

- `@agora/api`
- `@agora/api` worker orchestrator
- `@agora/chain` indexer

This cutover does **not** move the scorer executor. Keep the executor on a
Docker-capable host or service and continue pointing the worker at
`AGORA_SCORER_EXECUTOR_URL`.

## What ships in-repo

The Fly lane is now repo-native:

- [fly.toml](/Users/changyuesin/Agora/fly.toml)
- [Dockerfile](/Users/changyuesin/Agora/Dockerfile)
- [scripts/fly/shared.mjs](/Users/changyuesin/Agora/scripts/fly/shared.mjs)
- [scripts/fly/sync-secrets.mjs](/Users/changyuesin/Agora/scripts/fly/sync-secrets.mjs)
- [scripts/fly/deploy-runtime.mjs](/Users/changyuesin/Agora/scripts/fly/deploy-runtime.mjs)
- [.github/workflows/deploy-fly-runtime.yml](/Users/changyuesin/Agora/.github/workflows/deploy-fly-runtime.yml)

Design choices:

- one Fly app
- one Docker image
- three Fly process groups: `app`, `worker`, `indexer`
- public API traffic goes through Fly Proxy on `3000`
- worker validation bridge stays private on Fly 6PN at
  `worker.process.<app>.internal:3400`
- release metadata is stamped per deploy from the git SHA and enforced with
  `AGORA_EXPECT_RELEASE_METADATA=true`

## Prerequisites

1. Create the Fly app once.

```bash
fly apps create <fly-app-name>
```

2. Add the GitHub deploy token:

- secret: `FLY_API_TOKEN`
- variable: `FLY_APP_NAME`

3. Mirror the runtime secrets that the Fly workflow needs:

- existing `AGORA_*` chain and Supabase secrets
- `AGORA_WORKER_INTERNAL_TOKEN`
- `AGORA_SCORER_EXECUTOR_URL`
- `AGORA_SCORER_EXECUTOR_TOKEN`
- any submission sealing keys if sealed submissions stay enabled

4. Keep the executor reachable from Fly. This migration does not replace the
executor host.

## Deploy flow

The deploy workflow triggers after `CI` succeeds on `main` and then:

1. stages Fly secrets with `flyctl secrets import --stage`
2. derives `AGORA_API_URL` as `https://<app>.fly.dev`
3. derives `AGORA_WORKER_INTERNAL_URL` as
   `http://worker.process.<app>.internal:3400`
4. stamps `AGORA_RELEASE_ID`, `AGORA_RUNTIME_VERSION`, and
   `AGORA_RELEASE_GIT_SHA` from the git SHA
5. deploys via `flyctl deploy --remote-only`
6. runs [verify-runtime.sh](/Users/changyuesin/Agora/scripts/verify-runtime.sh)
   against the Fly public API

## Local operator flow

If you need to deploy manually from a trusted machine:

```bash
export FLY_API_TOKEN=...
export FLY_APP_NAME=<fly-app-name>
pnpm fly:deploy
```

The deploy script stages the runtime secrets before it calls `flyctl deploy`.

## Health model on Fly

- Fly Proxy liveness check: `GET /healthz`
- Independent readiness check: `GET /api/health`
- Worker bridge is private-only and binds to `fly-local-6pn`
- API reaches the worker bridge over Fly internal DNS

This split is deliberate:

- `/healthz` keeps deploy routing simple
- `/api/health` stays fail-closed for schema and readiness
- `verify:runtime` still checks `/api/health`, `/api/worker-health`, and
  `/api/indexer-health`

## Cutover sequence

1. Ensure the Fly deploy workflow has completed successfully.
2. Confirm the public Fly runtime is healthy:

```bash
AGORA_API_URL=https://<fly-app-name>.fly.dev pnpm verify:runtime
```

3. Update any external consumers that still point to Railway:

- GitHub `AGORA_API_URL` secret
- Vercel server-side `AGORA_API_URL`
- agent/operator machines

4. Keep Railway live only until the Fly runtime has served stable traffic long
enough for confidence.

5. Once Fly is accepted as the live runtime, stop Railway runtime deploys so
there is only one deploy owner again.

## Rollback

Rollback is straightforward because the data plane stays the same:

- Supabase stays the same
- Base Sepolia stays the same
- executor stays the same

If Fly deploy health or runtime verification fails:

1. point consumers back to the previous Railway API origin
2. keep the existing Supabase schema and chain state in place
3. fix the Fly runtime issue
4. redeploy Fly and rerun `pnpm verify:runtime`

## Why this is cleaner than Railway

The Fly migration fixes the specific category of drift that kept recurring:

- API, worker, and indexer now deploy from one image and one commit
- public and internal networking are explicit in config
- staged secrets plus git-stamped release metadata remove manual version drift
- the worker bridge no longer depends on a provider-specific wildcard bind
