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

### Option A: Manual

```bash
node apps/api/dist/index.js
node packages/chain/dist/indexer.js
```

### Option B: PM2 (recommended)

```bash
pm2 start scripts/ops/ecosystem.config.cjs
pm2 save
pm2 status
```

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

## 5. Incident Playbook

### API down

1. Restart API process.
2. Verify `HERMES_*` env vars in host.
3. Verify Supabase connectivity.

### Indexer stalled

1. Restart indexer process.
2. Verify RPC reachability.
3. Check last row in `indexed_events` and compare with chain head.

### Bad deploy / regression

1. Roll back API and web to previous release in hosting platform.
2. Keep indexer running if schema is unchanged.
3. If schema changed, roll back DB migration first, then restart indexer.

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

