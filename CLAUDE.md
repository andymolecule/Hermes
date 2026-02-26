# CLAUDE.md — Hermes Build Instructions

> **Read this file completely before writing any code.**
> This is the canonical reference for all agents working on the Hermes codebase.

## What Is Hermes?

Hermes is an agent-native, on-chain science bounty platform on Base. Labs, DAOs, scientists, or AI agents post computational science problems with USDC rewards. AI agents compete to solve them. Results are deterministically scored in Docker containers with verifiable proof bundles. Settlement and payouts happen on-chain via USDC escrow.

**Tagline:** DREAM Challenges rebuilt for 2026 agents.

## Project Principles

- **Build for agents.** CLI is the primary interface. Web is secondary.
- **Permissionless.** Anyone with a wallet can post or solve.
- **Deterministic + verifiable.** Same inputs → same score, every time. Anyone can re-run `hm verify`.
- **Public data only** in MVP. Zero IP risk.
- **5% protocol fee**, hardcoded, flows to treasury on finalization.
- **Safety-first.** Always `--dry-run` before on-chain. Always `hm score-local` before `hm submit`.

## Key Documents

- `docs/spec.md` — Product specification v1.0 (the "what")
- `docs/implementation.md` — Full implementation plan with tickets T-001 through T-025 (the "how")
- `SKILL.md` — Instructions for solver agents using Hermes post-launch (NOT for building it)
- This file (`CLAUDE.md`) — Instructions for agents building Hermes

**Source of truth hierarchy**
- Architecture + acceptance criteria: `docs/implementation.md`
- Conventions + constraints + build rules: `CLAUDE.md`
- Product scope + UX flows: `docs/spec.md`

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Language | TypeScript (strict mode), Solidity 0.8.x |
| Monorepo | pnpm workspaces + Turborepo |
| Linting/Formatting | Biome (not ESLint/Prettier) |
| Validation | Zod (all external inputs, all config, all YAML parsing) |
| Chain interaction | viem (not ethers.js) |
| RPC Provider | Alchemy (dedicated RPC, free tier — not public RPCs) |
| Smart contracts | Foundry (forge, not Hardhat) |
| Database | Supabase (Postgres + client SDK) |
| IPFS | Pinata (official SDK) |
| Blockchain Indexer | Custom event poller (`getLogs` → Supabase). **Production upgrade:** Ponder |
| Scoring | Docker (dockerode for programmatic control) |
| CLI framework | Commander.js + ora (spinners) + chalk (colors) |
| API framework | Hono (deployed to Fly.io or Railway) |
| API Auth | SIWE (Sign-In with Ethereum, EIP-4361) |
| Rate Limiting | In-memory Map (MVP). **Production upgrade:** Upstash Redis |
| MCP server | @modelcontextprotocol/sdk + Hono |
| Frontend (Phase 2) | Next.js 14 (app router) + Tailwind + shadcn/ui + wagmi + RainbowKit |

**Production upgrades (pre-mainnet):** Ponder indexer, Cloudflare Workers API, Upstash Redis, Safe multisig, Tenderly + Sentry monitoring, contract audit (Cantina/Code4rena)

---

## Monorepo Structure

```
hermes/
├── CLAUDE.md                         ← YOU ARE HERE
├── SKILL.md                          ← Solver agent instructions (post-launch)
├── package.json                      ← pnpm workspaces root
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── biome.json
├── .env.example                      ← All 15+ env vars documented
├── docker-compose.yml                ← Local dev: Supabase Postgres + Anvil
│
├── docs/
│   ├── spec.md
│   └── implementation.md
│
├── packages/
│   ├── common/                       ← Shared types, Zod schemas, config, ABIs
│   │   └── src/
│   │       ├── types/                  challenge.ts, submission.ts, scoring.ts
│   │       ├── schemas/                challenge-spec.ts (Zod), submission.ts (Zod)
│   │       ├── config.ts               Centralized env/config loader with Zod validation
│   │       ├── constants.ts            Contract addresses, chain IDs, IPFS gateways
│   │       └── abi/                    HermesFactory.json, HermesChallenge.json
│   │
│   ├── contracts/                    ← Foundry — HermesFactory + HermesChallenge
│   │   ├── foundry.toml
│   │   ├── src/                        HermesFactory.sol, HermesChallenge.sol, interfaces/, libraries/
│   │   ├── test/                       HermesFactory.t.sol, HermesChallenge.t.sol
│   │   └── script/                     Deploy.s.sol, DeployTestUSDC.s.sol
│   │
│   ├── db/                           ← Supabase migrations, client, typed queries
│   │   ├── supabase/migrations/        001_initial.sql
│   │   ├── supabase/seed.sql
│   │   └── src/
│   │       ├── index.ts                Client factory (anon key for reads, service key for writes)
│   │       └── queries/                challenges.ts, submissions.ts, scores.ts
│   │
│   ├── ipfs/                         ← Pinata wrapper
│   │   └── src/
│   │       ├── pin.ts                  pinJSON, pinFile, pinDirectory
│   │       └── fetch.ts               getJSON, getFile, downloadToPath
│   │
│   ├── chain/                        ← viem contract interactions + event indexer
│   │   └── src/
│   │       ├── client.ts               createPublicClient, createWalletClient
│   │       ├── factory.ts              createChallenge, getChallengeAddress
│   │       ├── challenge.ts            submit, postScore, finalize, dispute, claim
│   │       ├── usdc.ts                 approve, balanceOf, allowance
│   │       └── indexer.ts              Event poller (getLogs every 30s → Supabase upsert)
│   │
│   └── scorer/                       ← Docker scorer orchestration + proof bundles
│       └── src/
│           ├── runner.ts               spawnContainer, collectResult
│           └── proof.ts                buildProofBundle
│
├── apps/
│   ├── cli/                          ← `hm` CLI (Commander, npm global bin)
│   │   ├── package.json                bin: { "hm": "./dist/index.js" }
│   │   └── src/
│   │       ├── index.ts                Commander entry, registers all subcommands
│   │       ├── commands/               init, post, list, get, submit, score, score-local, verify, finalize, status, config
│   │       └── lib/                    wallet.ts, config-store.ts, output.ts, errors.ts, spinner.ts
│   │
│   ├── api/                          ← Hono REST API (Fly.io or Railway)
│   │   └── src/
│   │       ├── index.ts                Hono app entry (standard Node.js)
│   │       ├── routes/                 challenges.ts, submissions.ts, stats.ts, verify.ts, auth.ts
│   │       └── middleware/             rate-limit.ts (in-memory), siwe.ts (SIWE session)
│   │
│   ├── mcp-server/                   ← MCP server (stdio + SSE)
│   │   └── src/
│   │       ├── index.ts                Hono entry, transport detection
│   │       └── tools/                  6 tool handlers
│   │
│   └── web/                          ← Next.js 14 (PHASE 2 — week 2, skip for now)
│
├── containers/                       ← Docker scorer images
│   ├── repro-scorer/                   Dockerfile + score.py
│   ├── regression-scorer/              Dockerfile + score.py
│   └── docking-scorer/                 Dockerfile + score.py
│
├── challenges/
│   └── templates/                    ← 5 seed challenge YAMLs
│
└── scripts/
    ├── e2e-test.sh                   ← Full E2E on Base Sepolia
    ├── seed-challenges.sh            ← Post all 5 seed challenges
    └── deploy.sh                     ← Deploy contracts + API + indexer
```

---

## Package Dependency Graph

```
@hermes/common          ← depends on nothing (foundation)
    ↓
@hermes/contracts       ← depends on common (ABIs flow back into common/abi/)
@hermes/ipfs            ← depends on common (types)
@hermes/db              ← depends on common (types, schemas)
@hermes/chain           ← depends on common (types, ABIs, config)
    ↓
@hermes/scorer          ← depends on common, ipfs, chain
    ↓
@hermes/cli             ← depends on common, ipfs, db, chain, scorer
@hermes/api             ← depends on common, db
@hermes/mcp-server      ← depends on common, ipfs, db, chain, scorer
```

**Import rule:** Packages may only import from packages above them in this graph. Never create circular dependencies. If two packages need to share a type, it belongs in `@hermes/common`.

---

## Coding Conventions

### TypeScript
- **Strict mode** everywhere (`"strict": true` in tsconfig)
- All exported functions have explicit return types
- No `any` — use `unknown` and narrow with Zod or type guards
- Prefer `interface` for object shapes, `type` for unions/intersections
- Use barrel exports (`index.ts`) in each package for clean imports

### Validation
- **All external inputs** validated with Zod: env vars, YAML files, API request bodies, CLI args
- Config loading in `packages/common/src/config.ts` — uses Zod, throws human-readable errors on missing vars
- Never read `process.env` directly outside of `config.ts`

### Chain / viem
- Use viem, never ethers.js
- Wallet client created from env var: `HERMES_PRIVATE_KEY`
- All contract calls wrapped in try/catch with agent-friendly error messages
- USDC has 6 decimals — always use `parseUnits(amount, 6)` not `parseEther`

### Solidity
- Solidity 0.8.x with Foundry
- OpenZeppelin v5 for IERC20, Ownable
- Custom errors (not require strings) in `libraries/HermesErrors.sol`
- Events in `libraries/HermesEvents.sol`
- NatSpec comments on all public functions
- 5% fee = `PROTOCOL_FEE_BPS = 500` (basis points), hardcoded as constant
- USDC amounts stored as `uint256` in 6-decimal precision

### Error Messages
- All errors must be **agent-friendly**: describe what went wrong AND suggest what to do next
- Example: `"USDC balance insufficient. You have 12.50 USDC but need 500.00. Get testnet USDC from faucet."`
- Example: `"Challenge ch-001 deadline has passed. Cannot submit. Run hm list --status active for open challenges."`
- Never expose raw viem/Solidity errors to the user — catch and translate

### Formatting & Linting
- Run `biome check --apply .` before every commit
- Run `biome check .` in CI — must pass with zero errors
- No ESLint, no Prettier — Biome only

### Git
- Branch naming: `feat/<ticket-id>-<short-description>` (e.g., `feat/t001-monorepo-scaffold`)
- Commit messages: `T-001: Initialize monorepo scaffold`
- One PR per ticket (or per tightly-coupled pair like T-001+T-002)
- Always run `pnpm turbo build` before pushing — must succeed
- Always run tests before pushing (see Testing section below)

---

## Environment Variables

All defined in `.env.example` with comments. Loaded via `packages/common/src/config.ts`.

```bash
# Chain
HERMES_RPC_URL=https://sepolia.base.org          # Base Sepolia RPC
HERMES_PRIVATE_KEY=0x...                          # Solver/poster wallet (NEVER commit)
HERMES_ORACLE_KEY=0x...                           # Oracle wallet for scoring (NEVER commit)
HERMES_FACTORY_ADDRESS=0x...                      # HermesFactory contract address
HERMES_USDC_ADDRESS=0x...                         # USDC (or MockUSDC on testnet) address

# IPFS
HERMES_PINATA_JWT=ey...                           # Pinata API JWT

# Database
HERMES_SUPABASE_URL=https://xxx.supabase.co       # Supabase project URL
HERMES_SUPABASE_ANON_KEY=ey...                    # Supabase anon key (reads)
HERMES_SUPABASE_SERVICE_KEY=ey...                 # Supabase service key (writes, indexer only)

# API
HERMES_API_URL=http://localhost:3000              # Hermes API base URL

# CLI also reads from ~/.hermes/config.json — env vars override config file
```

**Key handling for agents:** CLI supports `--key env:HERMES_PRIVATE_KEY` syntax. Never pass raw private keys as CLI arguments.

---

## Testing Requirements

### Smart Contracts (Foundry)
```bash
cd packages/contracts
forge build          # Must compile with zero warnings
forge test -vv       # All tests must pass
forge coverage       # Must show >90% line coverage
```
- Unit tests for every public function (happy path + revert cases)
- Fuzz tests on `submit()` and `postScore()`
- Invariant: `escrowAmount == payoutToWinner + protocolFee` after finalization
- Invariant: submissions per wallet never exceeds `maxSubmissionsPerWallet`

### TypeScript Packages
```bash
pnpm turbo test      # Runs tests across all TS packages
```
- Each package has its own test files
- IPFS: pin + fetch round-trip test
- DB: query functions return typed results, idempotent upserts
- Chain: integration test against local Anvil (create → submit → score → finalize → claim)
- Scorer: determinism test (3 runs on same input → identical output)

### CLI
```bash
# After npm link in apps/cli:
hm --help            # Must show all commands
hm --version         # Must show version
hm config set rpc_url http://localhost:8545
hm config get rpc_url  # Must return what was set
```

### End-to-End
```bash
./scripts/e2e-test.sh   # Full cycle on Base Sepolia: post → submit → score → finalize → payout
```

**Before opening any PR:** `pnpm turbo build && pnpm turbo test` must both pass.

---

## Build Phases & Ticket Dependency Graph

**Read the full ticket details in `docs/implementation.md`.** Below is the dependency structure — never start a ticket until its dependencies are merged to main.

```
PHASE 1: Foundation
  T-001 (Monorepo scaffold)
  T-002 (Common package) ← depends on T-001
  
PHASE 2: Smart Contracts
  T-003 (Factory + Challenge contracts) ← depends on T-002
  T-004 (Contract tests) ← depends on T-003
  T-005 (Deploy to Base Sepolia) ← depends on T-004

PHASE 3: Data Layer ← ALL depend on T-002; T-008 also depends on T-003 (ABIs)
  T-006 (IPFS / Pinata)       ← CAN PARALLELIZE
  T-007 (Database / Supabase)  ← CAN PARALLELIZE
  T-008 (Chain / viem client)  ← CAN PARALLELIZE (needs T-003 ABIs)
  T-009 (Event indexer)        ← depends on T-007 + T-008

PHASE 4: CLI Core
  T-010 (CLI skeleton + config) ← depends on T-002
  T-011 (hm init)               ← depends on T-010
  T-012 (hm post)               ← depends on T-010 + T-006 + T-008
  T-013 (hm list/get/status)    ← depends on T-010 + T-007
  T-014 (hm submit)             ← depends on T-010 + T-006 + T-008

PHASE 5: Scoring + Verification
  T-015 (Scorer package)        ← depends on T-002
  T-016 (Repro-scorer Docker)   ← depends on T-015
  T-017 (hm score/score-local/verify) ← depends on T-015 + T-010 + T-006 + T-008
  T-018 (hm finalize)           ← depends on T-010 + T-008

PHASE 6: API + MCP
  T-019 (Hono API)              ← depends on T-007
  T-020 (MCP server)            ← depends on T-006 + T-007 + T-008 + T-015

PHASE 7: Seed + Ship
  T-021 (Seed challenge templates) ← depends on T-012
  T-022 (E2E test script)         ← depends on ALL of the above
  T-023 (SKILL.md + README + deploy) ← depends on T-022

PHASE 8: Web Dashboard (Week 2 — skip in week 1)
  T-024 (Next.js scaffold + explorer)
  T-025 (Detail + leaderboard + post form)
```

### Maximum Parallelism by Phase

| Phase | Max parallel agents | Tickets |
|-------|-------------------|---------|
| 1 | 1 | T-001, T-002 (sequential) |
| 2 | 1 | T-003, T-004, T-005 (sequential) |
| 3 | 3 | T-006 ∥ T-007 ∥ T-008, then T-009 |
| 4 | 3 | T-011 ∥ T-013 ∥ T-014 (after T-010 + Phase 3) |
| 5 | 2 | T-015/T-016 ∥ T-018 |
| 6 | 2 | T-019 ∥ T-020 |
| 7 | 1 | Sequential (integration) |

---

## Smart Contract Architecture (Quick Reference)

### HermesFactory.sol
- `createChallenge(specCid, rewardAmount, deadline, disputeWindowHours, maxSubmissionsPerWallet, distributionType, labTBA)` → deploys HermesChallenge, transfers USDC from poster to escrow
- `setOracle(address)` — onlyOwner
- `setTreasury(address)` — onlyOwner
- `PROTOCOL_FEE_BPS = 500` (5%, hardcoded constant)

### HermesChallenge.sol
- **Status enum:** Active → Scoring → Finalized | Disputed → Finalized | Cancelled
- **Distribution types:** WinnerTakeAll (100% to #1), TopThree (70/20/10), Proportional (weighted by score)
- `submit(resultHash)` — max 3 per wallet, before deadline only
- `postScore(subId, score, proofBundleHash)` — oracle only
- `finalize()` — permissionless, after deadline + dispute window, sends 5% to treasury
- `claim()` — winner withdraws USDC after finalization
- `dispute(reason)` — anyone, during dispute window only
- `resolveDispute(winnerSubId)` — oracle only
- `cancel()` — poster only, zero submissions + before deadline
- `timeoutRefund()` — if disputed + unresolved after 30 days

### USDC Flow
```
Poster → approve() → createChallenge() → USDC in escrow contract
                                              ↓ (after deadline + dispute window)
                                          finalize()
                                          ├── 5% → treasury
                                          └── 95% → winner (via claim())
```

---

## Database Tables (Supabase)

5 tables in the `public` schema:

1. **challenges** — id, chain_id, contract_address, factory_challenge_id, poster_address, title, description, domain, challenge_type, spec_cid, dataset_train_cid, dataset_test_cid, scoring_container, scoring_metric, minimum_score, reward_amount, distribution_type, deadline, dispute_window_hours, max_submissions_per_wallet, status, created_at, finalized_at, winner_submission_id, tx_hash
2. **submissions** — id, challenge_id, on_chain_sub_id, solver_address, result_hash, result_cid, proof_bundle_cid, proof_bundle_hash, score, scored, submitted_at, scored_at, rank, tx_hash
3. **proof_bundles** — id, submission_id, cid, input_hash, output_hash, container_image_hash, scorer_log, reproducible, verified_count
4. **verifications** — id, proof_bundle_id, verifier_address, computed_score, matches_original, log_cid, verified_at
5. **indexed_events** — tx_hash, log_index, event_name, block_number, processed_at (idempotency for indexer)

**Indexes:** status, domain, deadline, poster_address, (challenge_id + score DESC)

---

## API Endpoints (Hono)

```
GET  /api/challenges               ?status, domain, min_reward, sort, page, limit
GET  /api/challenges/:id           + submissions + leaderboard
POST /api/challenges               { specCid, txHash } — accelerates indexing
GET  /api/challenges/:id/leaderboard
GET  /api/submissions/:id          + proof bundle
POST /api/submissions              { challengeId, resultCid, txHash }
POST /api/verify                   { submissionId, computedScore, matchesOriginal }
GET  /api/stats                    aggregate counts
```

Authentication: **SIWE (EIP-4361)** for write endpoints. Read endpoints remain public.
Rate limit: 5 writes/hour/wallet, enforced via **in-memory Map** (MVP). **Production upgrade:** Upstash Redis.
SIWE session: `GET /api/auth/nonce` → client signs SIWE message → `POST /api/auth/verify` → session.

---

## CLI Commands Reference

```
hm init [--template reproducibility|prediction|docking]
hm post <file.yaml> --deposit <usdc> [--dry-run] [--key env:VAR]
hm list [--domain] [--status] [--min-reward] [--format json|table]
hm get <challenge-id> [--download ./dir/] [--format json|table]
hm submit <file> --challenge <id> [--dry-run] [--format json]
hm score-local <challenge-id> --submission <file>
hm score <submission-id>                                    # oracle only
hm verify <challenge-id> --sub <submission-id>
# planned in T-018
# hm finalize <challenge-id>
hm status <challenge-id> [--format json|table]
hm config set|get|list
```

All commands support `--format json` for agent consumption.

---

## MCP Server — 6 Tools

| Tool | Description |
|------|-------------|
| `hermes-list-challenges` | Browse/filter active challenges |
| `hermes-get-challenge` | Full detail + leaderboard |
| `hermes-submit-solution` | Pin to IPFS + submit on-chain |
| `hermes-get-leaderboard` | Ranked submissions |
| `hermes-get-submission-status` | Score, rank, proof bundle |
| `hermes-verify-submission` | Re-run scorer locally |

Supports stdio (`hermes-mcp --stdio` for Claude Desktop) and SSE (port 3001 for remote agents).
All tools have Zod-validated input schemas and return structured JSON.

---

## Docker Scorer Security

All scorer containers run with these constraints:
- `--network=none` (no internet access)
- Read-only filesystem except `/output`
- 8GB memory limit, 4 CPU limit
- 30-minute timeout (kill if exceeded)
- Non-root user, all capabilities dropped
- Pinned image digests (deterministic)

---

## Local Development

```bash
# Prerequisites: Node 20+, pnpm 9+, Docker, Foundry

# Setup
git clone <repo> && cd hermes
cp .env.example .env.local
pnpm install

# Start local infra
docker compose up -d              # Supabase Postgres + Anvil

# Deploy contracts to local Anvil
pnpm --filter contracts deploy:local

# Run indexer (watches local Anvil for events)
pnpm --filter chain indexer:local

# Use CLI locally
hm config set rpc_url http://localhost:8545
hm config set api_url http://localhost:3000
```

---

## Deployment Targets

### MVP Deployment

| Component | Host | Notes |
|-----------|------|-------|
| Contracts | Base Sepolia → Base mainnet | Foundry deploy scripts |
| API | Fly.io or Railway | Standard Node.js, `fly deploy` |
| Indexer | Fly.io or Railway | Custom event poller, always-on |
| RPC | Alchemy | Dedicated RPC, free tier |
| IPFS | Pinata | Free tier (1GB) |
| CLI | npm registry | `@hermes-science/cli` |
| MCP Server | npm registry | `@hermes-science/mcp` |
| Frontend (Phase 2) | Vercel | Auto-deploy from Git |

### Production Upgrades (pre-mainnet)

| Component | Upgrade To | Why |
|-----------|-----------|-----|
| Indexer | Ponder | Reorg handling, backfill, type-safe |
| API | Cloudflare Workers | Edge-deployed, auto-scaling |
| Rate Limiting | Upstash Redis | Multi-region rate limiting |
| Multisig | Safe | 2-of-3 for oracle + treasury |
| Monitoring (on-chain) | Tenderly | Contract alerts, tx tracing |
| Monitoring (off-chain) | Sentry | API errors, performance |
| Contract Audit | Cantina/Code4rena | Required before real USDC |

---

## Common Mistakes to Avoid

1. **Don't use ethers.js.** Use viem everywhere.
2. **Don't use ESLint or Prettier.** Use Biome only.
3. **Don't read `process.env` directly.** Always go through `packages/common/src/config.ts`.
4. **Don't hardcode contract addresses.** They live in `packages/common/src/constants.ts`.
5. **Don't skip Zod validation.** All YAML parsing, all API inputs, all config loading must use Zod.
6. **Don't forget USDC has 6 decimals.** Not 18. Use `parseUnits(amount, 6)`.
7. **Don't create cross-package circular imports.** If two packages both need a type, put it in `@hermes/common`.
8. **Don't submit without testing.** Always `hm score-local` before `hm submit`. Always `forge test` before pushing contracts.
9. **Don't expose raw errors.** All user-facing errors must include a suggested next action.
10. **Don't skip the dependency graph.** Check that all upstream tickets are merged before starting your ticket.

---

## When You're Stuck

1. Re-read this file (`CLAUDE.md`)
2. Re-read the ticket's acceptance criteria in `docs/implementation.md`
3. Check if a dependency hasn't been merged yet
4. Run `pnpm turbo build` — often the error is in an upstream package
5. For chain issues: check that Anvil is running and contracts are deployed
6. For IPFS issues: check that `HERMES_PINATA_JWT` is set
7. For DB issues: check that `docker compose up -d` is running (Supabase local)
8. Ask the human only as a last resort — include what you tried and the exact error
