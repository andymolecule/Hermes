# PR Summary: Phase 3 (IPFS + DB + Chain/Indexer)

## Overview
Implements the Phase 3 data layer and chain integration: Pinata IPFS helpers, Supabase schema + queries, and viem-based chain/indexer utilities. Adds minimal smoke tests that skip cleanly when required env vars are missing.

## T-006 — IPFS Package
- Pinata client wrapper with `pinJSON`, `pinFile`, and `pinDirectory`.
- Fetch utilities: `getJSON`, `getText`, `getFile`, `downloadToPath`.
- IPFS round-trip test (skips without Pinata env vars).

Key files:
- `/Users/changyuesin/Hermes/packages/ipfs/src/pin.ts`
- `/Users/changyuesin/Hermes/packages/ipfs/src/fetch.ts`
- `/Users/changyuesin/Hermes/packages/ipfs/src/tests/pinata-roundtrip.ts`

## T-007 — Database Package
- Supabase schema migration with all 5 tables + indexes.
- Supabase client factory (`anon` vs `service` key).
- Query helpers for challenges, submissions, scores, and indexed events.
- DB smoke test (skips without Supabase env vars).

Key files:
- `/Users/changyuesin/Hermes/packages/db/supabase/migrations/001_initial.sql`
- `/Users/changyuesin/Hermes/packages/db/src/index.ts`
- `/Users/changyuesin/Hermes/packages/db/src/queries/*.ts`
- `/Users/changyuesin/Hermes/packages/db/src/tests/db-queries.ts`

## T-008 — Chain + Indexer
- viem public/wallet clients (Base Sepolia default).
- Factory and challenge contract helpers (create, submit, score, finalize, dispute, claim).
- USDC helper (approve, balanceOf, allowance).
- Indexer that reads factory/challenge logs, fetches IPFS YAML specs, validates with Zod, and upserts to Supabase with idempotency.
- Scores are stored as strings to avoid BigInt precision loss.
- Indexer loop is serialized (no overlapping intervals).
- Chain smoke test (skips without RPC/factory/usdc env vars).

Key files:
- `/Users/changyuesin/Hermes/packages/chain/src/client.ts`
- `/Users/changyuesin/Hermes/packages/chain/src/factory.ts`
- `/Users/changyuesin/Hermes/packages/chain/src/challenge.ts`
- `/Users/changyuesin/Hermes/packages/chain/src/usdc.ts`
- `/Users/changyuesin/Hermes/packages/chain/src/indexer.ts`
- `/Users/changyuesin/Hermes/packages/chain/src/tests/chain-integration.ts`

## Build/Config Changes
- `tsconfig.base.json` updated to allow JSON module imports (ABI JSONs).
- `@hermes/common` now copies ABI JSONs into `dist/abi` and exposes them via `exports`.

## Tests
All Phase 3 tests are designed to skip cleanly when required env vars are missing.

```bash
pnpm --filter @hermes/ipfs test
pnpm --filter @hermes/db test
pnpm --filter @hermes/chain test
```

## Notes
- For full runtime verification, set Pinata + Supabase + RPC env vars and re-run tests.
- Indexer uses `indexed_events` table for idempotent processing.
