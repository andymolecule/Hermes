---
name: ops-consistency
description: "Full end-to-end operational consistency check across all Agora services. Use when the user asks to check health, verify alignment, detect schema drift, run e2e checks, or ensure all services are consistent and talking the same language."
allowed-tools: Read, Grep, Glob, Bash, WebFetch, mcp__claude_ai_Supabase__execute_sql, mcp__claude_ai_Supabase__list_tables, mcp__claude_ai_Supabase__list_migrations, mcp__claude_ai_Supabase__get_project, mcp__claude_ai_Vercel__list_deployments, mcp__claude_ai_Vercel__get_deployment, mcp__claude_ai_Vercel__get_project, mcp__claude_ai_Vercel__get_deployment_build_logs, mcp__claude_ai_Vercel__get_runtime_logs
---

# Ops Consistency Check

Run a full end-to-end consistency sweep across all Agora services. Verify that every layer is aligned, healthy, and speaking the same language.

## Available Tools

| Service | Tool | What you can check |
|---------|------|-------------------|
| **Supabase** | MCP (`mcp__claude_ai_Supabase__*`) or `psql` via `DATABASE_URL` | Execute SQL queries, list tables, list migrations, check schema, apply migrations |
| **Vercel** | MCP (`mcp__claude_ai_Vercel__*`) | List deployments, get deployment status, check build logs, get runtime logs |
| **Fly** | `flyctl` CLI or WebFetch | Check runtime machine status, deployments, logs. Install CLI: `brew install flyctl` then `fly auth login` |
| **API endpoints** | Bash (`curl`) or WebFetch | Hit health endpoints directly |
| **Local** | Bash | `pnpm turbo build`, `pnpm schema:verify`, `pnpm scorers:verify`, `agora doctor` |

If a CLI is not installed, note it in the report and skip that check — don't fail the whole run.

### Database Connection

For direct Postgres access (schema checks, applying migrations), use `DATABASE_URL` from `.env`:

```
postgresql://postgres:[PASSWORD]@db.hnimaouknacrtakzaxqt.supabase.co:5432/postgres
```

If the direct host is IPv6-only and unreachable, use the Supabase session-mode pooler:

```
postgresql://postgres.hnimaouknacrtakzaxqt:[PASSWORD]@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres
```

Prefer Supabase MCP tools when available. Fall back to `psql` via `DATABASE_URL` when MCP returns permission errors. Migration files live in `packages/db/supabase/migrations/`.

## Check Sequence

Run these checks in order. Stop and report immediately on any critical failure.

### 1. Build Integrity

```bash
pnpm turbo build
```

All packages must compile with zero errors. If this fails, nothing else matters.

### 2. Schema Verification

Two-pronged check:

**Local:** `pnpm schema:verify` — confirms expected migrations match code.

**Supabase MCP:** Use `mcp__claude_ai_Supabase__list_migrations` to verify all migrations are applied. Use `mcp__claude_ai_Supabase__list_tables` to confirm expected tables exist. Use `mcp__claude_ai_Supabase__execute_sql` for spot-checks:

```sql
-- Check for expected tables
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;

-- Check score_jobs schema has backoff columns
SELECT column_name FROM information_schema.columns WHERE table_name = 'score_jobs' AND column_name IN ('next_attempt_at', 'max_attempts');

-- Check submission_intents table exists
SELECT column_name FROM information_schema.columns WHERE table_name = 'submission_intents' ORDER BY column_name;

-- Check worker_runtime columns
SELECT column_name FROM information_schema.columns WHERE table_name = 'worker_runtime_state' AND column_name = 'executor_ready';
```

### 3. Scorer Verification

```bash
pnpm scorers:verify
```

Confirms official scorer images are published and pullable.

### 4. Vercel Deployment Health

Use Vercel MCP tools:

- `mcp__claude_ai_Vercel__get_project` — confirm project exists and is linked
- `mcp__claude_ai_Vercel__list_deployments` — check latest deployment status is `READY`
- `mcp__claude_ai_Vercel__get_deployment` — verify the active deployment commit SHA matches expected
- `mcp__claude_ai_Vercel__get_deployment_build_logs` — check for build warnings or errors if deployment looks off
- `mcp__claude_ai_Vercel__get_runtime_logs` — check for runtime errors if API proxy is failing

Verify the web proxy works:
```bash
curl -sS https://agora-market.vercel.app/api/healthz
```

### 5. Fly Runtime Health

If `flyctl` CLI is available:
```bash
flyctl status --app agora-runtime-prod
flyctl logs --app agora-runtime-prod
```

If CLI is not available, use WebFetch against the Fly dashboard or skip with a note.

Check that all three Fly runtime process groups (`app`, `indexer`, `worker`) are:
- Running in the intended region set
- Reporting healthy machine state
- Showing recent log activity
- Exposing the same runtime identity across `/api/health`, `/api/indexer-health`, and `/api/worker-health`

### 6. API Endpoint Health

Hit these endpoints (adjust base URL for the target environment):

| Endpoint | Expected | What it proves |
|----------|----------|---------------|
| `GET /api/health` | `{"ok":true}` + `runtimeVersion` | API is ready, reports its deploy version |
| `GET /healthz` | `{"ok":true}` | Fly liveness route is up |
| `GET /api/indexer-health` | `status: "ok"` or `"warning"` | Indexer is polling, not critically behind |
| `GET /api/worker-health` | `healthyWorkersForActiveRuntimeVersion > 0` | Worker is scoring-ready |
| `GET /api/submissions/public-key` | `version: "sealed_submission_v2"` | Sealing keys are configured |

### 7. Cross-Service Alignment

Verify these values are consistent across all services:

| Value | Where to check |
|-------|---------------|
| **Deploy commit** | Vercel deployment SHA vs Fly runtime SHA vs `/api/health` runtimeVersion |
| **Factory address** | `AGORA_FACTORY_ADDRESS` in env, `/api/indexer-health` response, chain config |
| **Chain ID** | `AGORA_CHAIN_ID` in env, wagmi config in `apps/web/src/lib/wagmi.tsx` |
| **USDC address** | `AGORA_USDC_ADDRESS` in env, common config |
| **Runtime version** | `/api/health` runtimeVersion vs `/api/worker-health` apiVersion vs worker runtimeVersions |
| **Contract version** | `contract_version` in DB challenges vs factory `contractVersion()` |

Any mismatch means services were deployed from different commits or with inconsistent env vars.

### 8. Database Consistency Spot-Check

Use Supabase MCP `execute_sql` to check:

```sql
-- Orphaned score jobs (running but worker gone)
SELECT id, challenge_id, status, locked_at, locked_by
FROM score_jobs
WHERE status = 'running' AND locked_at < NOW() - INTERVAL '10 minutes';

-- Submissions missing result_cid (broken reconciliation)
SELECT id, challenge_id, solver_address, scored
FROM submissions
WHERE result_cid IS NULL AND scored = false;

-- Unmatched submission intents past deadline
SELECT si.id, si.challenge_id, si.solver_address, c.deadline
FROM submission_intents si
JOIN challenges c ON c.id = si.challenge_id
WHERE si.matched_submission_id IS NULL AND c.deadline < NOW();

-- Challenges with potential status drift
SELECT id, title, status, deadline
FROM challenges
WHERE status = 'open' AND deadline < NOW();
```

### 9. Docker / Executor (if remote)

If `AGORA_SCORER_EXECUTOR_BACKEND=remote_http`:
- `GET <executor-url>/healthz` returns `{"ok":true,"service":"executor","backend":"local_docker"}`
- Executor can pull official scorer images
- Shared bearer token matches between worker and executor

## Environment Detection

| Signal | Environment |
|--------|------------|
| `localhost:3000` | Local dev |
| `agora-market.vercel.app` | Production (web) |
| `*.fly.dev` | Production/runtime (API/worker/indexer) |

For local dev, Fly and remote executor checks may not apply — skip and note.

## Output Format

```
## Ops Consistency Report — [environment] — [date]

| Check | Status | Detail |
|-------|--------|--------|
| Build | pass/fail | ... |
| Schema (local) | pass/fail | ... |
| Schema (Supabase) | pass/fail | ... |
| Scorers | pass/fail | ... |
| Vercel deployment | pass/fail | commit SHA, status |
| Fly runtime | pass/fail/skipped | ... |
| API endpoints | pass/fail | ... |
| Cross-service alignment | pass/fail | ... |
| Indexer lag | ok/warning/critical | X blocks behind |
| Worker readiness | pass/fail | ... |
| DB consistency | pass/fail | ... |
| Executor | pass/fail/skipped | ... |

### Issues Found
- (list or "None")

### Recommended Actions
- (list or "All clear")
```

## Gotchas

1. **Web proxy vs API origin.** `agora-market.vercel.app/api/*` proxies to the backend API. Check both the web proxy and direct API origin if you have access.
2. **Runtime version mismatch after deploy.** Fly now deploys one image across `app`, `worker`, and `indexer`, so runtime identity should converge quickly. A mismatch that persists beyond the rollout window is a real problem, not a normal provider race.
3. **Indexer health uses factory high-water cursor**, not the replay cursor. Don't confuse replay lag with actual indexing lag.
4. **PostgREST schema cache.** After applying Supabase migrations, the schema cache may be stale. If `schema:verify` passes but API queries fail, reload the PostgREST schema cache.
5. **`agora doctor` is complementary, not redundant.** It checks RPC/Supabase/factory connectivity from the CLI perspective. This skill checks the full service mesh. Run both.
6. **Fly CLI requires login.** If `flyctl` returns auth errors, run `fly auth login` first. If CLI is not installed, skip Fly checks and note it — don't fail the report.
7. **Supabase MCP vs local schema:verify.** They check different things. Local checks code-side migration files. MCP checks the actual deployed database. Both should pass.
