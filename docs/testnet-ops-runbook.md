# Hermes Testnet Ops Runbook

This runbook is for Base Sepolia operations before opening Hermes to real users.

## 1. Pre-Launch Checklist

1. Merge latest `main` and deploy from `main` only.
2. Ensure all required environment variables are set in your host platform.
3. Apply Supabase migrations in `packages/db/supabase/migrations`.
4. Confirm contract addresses are correct in API, indexer, CLI, and web env.
5. Set API CORS allowlist via `HERMES_CORS_ORIGINS` (comma-separated exact origins).
6. Build and run preflight:

```bash
pnpm install
pnpm turbo build
./scripts/preflight-testnet.sh
```

## 2. Service Startup

Four processes run in production: **API**, **Indexer**, **Worker** (scoring automation), and **MCP** (agent interface).

| Process | Entrypoint | Role |
|---------|-----------|------|
| `hermes-api` | `apps/api/dist/index.js` | REST API + web backend |
| `hermes-indexer` | `packages/chain/dist/indexer.js` | Chain event poller → Supabase |
| `hermes-worker` | `apps/api/dist/worker.js` | Polls `score_jobs`, runs Docker scorer, posts scores on-chain |
| `hermes-mcp` | `apps/mcp-server/dist/index.js` | MCP server for AI agent discovery, submission, and payout |

### Option A: Manual

```bash
node apps/api/dist/index.js
node packages/chain/dist/indexer.js
node apps/api/dist/worker.js
```

### Option B: PM2 (recommended)

```bash
pm2 start scripts/ops/ecosystem.config.cjs
pm2 save
pm2 status   # should show 4 processes: hermes-api, hermes-indexer, hermes-worker, hermes-mcp
```

### Architecture boundary

- **API** creates `score_jobs` rows when submissions arrive (via indexer events).
- **Worker** polls the `score_jobs` table, claims jobs atomically (Postgres RPC), runs the Docker scorer container, and posts scores + proof bundles on-chain.
- **Scorer** is the Docker container itself (e.g. `ghcr.io/hermes-science/repro-scorer:v1`) — stateless, sandboxed, no network access.

The worker and API share no runtime state. The only coordination point is the `score_jobs` table.

## 3. Smoke Test (Live)

Run one partial loop on Base Sepolia:

```bash
./scripts/e2e-test.sh
```

Expected flow (same-session):
- `hm post` succeeds
- challenge appears via indexer/API
- `hm submit` succeeds
- `hm score` + `hm verify` succeed

> **Note:** `hm finalize` and `hm claim` require the dispute window (168–2160 hours) to elapse after deadline. These cannot be tested in the same session on live Base Sepolia. To test the full lifecycle including finalization, use a local Anvil RPC with `evm_increaseTime` for time travel.

## 4. Monitoring

Check every 15-30 minutes during first launch window:

1. API `/healthz` returns 200.
2. Indexer logs show new blocks processed.
3. `indexed_events` block number continues advancing.
4. `hm doctor` passes all required checks.
5. Worker health: `curl <API_URL>/api/worker-health` returns `"ok": true`.
6. Tail worker logs: `pm2 logs hermes-worker --lines 50`.

### Confirming the worker is scoring

1. Check `score_jobs` transitions: jobs should move from `queued` → `running` → `scored`.
2. After a submission, a new `score_jobs` row appears within ~30s (indexer poll) and the worker picks it up within ~15s (worker poll).
3. Successful scoring produces a proof bundle CID in `proof_bundles.cid`.
4. The frontend ActivityPanel "Scorer" row shows live queued/scored/failed counts.

## 5. Incident Playbook

### API down

1. Restart API process.
2. Verify `HERMES_*` env vars in host.
3. Verify Supabase connectivity.

### Indexer stalled

1. Restart indexer process.
2. Verify RPC reachability.
3. Check last row in `indexed_events` and compare with chain head.
4. Check `GET /api/indexer-health` and alert if status is `critical`.
5. Rewind cursors with CLI (dry-run first):

```bash
hm reindex --from-block <block_number> --dry-run
hm reindex --from-block <block_number>
```

6. If a deep replay is required, include `--purge-indexed-events`.
7. Ensure `HERMES_INDEXER_START_BLOCK` is set before restarting indexer when bootstrapping a new factory.

### Bad deploy / regression

1. Roll back API and web to previous release in hosting platform.
2. Keep indexer running if schema is unchanged.
3. If schema changed, roll back DB migration first, then restart indexer.

### Worker stalled

1. Check `GET /api/worker-health` — if `status: "warning"`, the oldest queued job has been waiting > 5 minutes.
2. Tail logs: `pm2 logs hermes-worker --lines 100`.
3. Common causes:
   - Docker daemon not running or unreachable → restart Docker, then `pm2 restart hermes-worker`.
   - RPC errors → check `HERMES_RPC_URL` reachability.
   - All jobs stuck in `failed` → inspect `last_error` column, then retry: `hm retry-failed-jobs` (dry-run first), `hm retry-failed-jobs --yes` to execute.
4. If the worker process itself crashed: `pm2 restart hermes-worker`. PM2 uses exponential backoff (3s base).

### Oracle key issue

1. Stop scoring operations immediately.
2. Rotate oracle key and reconfigure env.
3. Resume scoring only after `hm doctor` and one dry-run check.

## 6. Rollback Criteria

Rollback if any of these happen:

- API health fails for more than 5 minutes.
- Indexer lag exceeds 200 blocks for more than 10 minutes.
- Incorrect challenge/submission writes observed in Supabase.
- Scoring or verification mismatches on-chain and local outputs.
