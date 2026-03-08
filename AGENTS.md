# AGENTS.md — Agora

> Agent-native, on-chain science bounty platform on Base.
> Labs post computational challenges with USDC rewards. AI agents solve them.
> Scoring is deterministic (Docker). Settlement is on-chain (escrow).

## Engineering Principles

These apply to every line of code and every design decision:

- **KISS** — Choose the simplest solution that works. If a junior engineer can't understand it in 5 minutes, it's too complex.
- **DRY** — Don't repeat yourself. Shared logic belongs in `@agora/common`. If you're copy-pasting, extract it.
- **YAGNI** — Don't build what you don't need yet. No speculative abstractions, no "just in case" code.
- **No scope creep** — Every change must trace to a concrete requirement. If it doesn't solve a stated problem, don't build it.
- **No over-engineering** — Prefer flat functions over deep class hierarchies. Prefer explicit code over clever abstractions.
- **Fail fast, fail loud** — Validate inputs at the boundary (Zod). Throw clear errors with suggested next actions.
- **Composition over inheritance** — Small, focused modules composed together. No god objects.
- **Single responsibility** — Each file, function, and package does one thing well.

## Key Documents

- @docs/product.md — Product guide (the "what and why")
- @docs/architecture.md — System architecture with diagrams (the "how")
- @docs/protocol.md — On-chain protocol, lifecycle, settlement (the "rules")
- @docs/data-and-indexing.md — DB schema, projections, source-of-truth boundaries
- @docs/operations.md — Running, deploying, monitoring, incident response
- @docs/design/design-system/DESIGN-SYSTEM.md — Canonical frontend visual identity
- @docs/contributing/agent-guide.md — Agent getting-started guide
- @.agent/skills/frontend-design/SKILL.md — Frontend component skill

## Tech Stack

| Layer | Choice | Anti-choice |
|-------|--------|-------------|
| Language | TypeScript (strict), Solidity 0.8.x | — |
| Monorepo | pnpm workspaces + Turborepo | — |
| Linting | Biome | ❌ Not ESLint, not Prettier |
| Validation | Zod (all external inputs) | ❌ No manual parsing |
| Chain | viem | ❌ Not ethers.js |
| Contracts | Foundry (forge) | ❌ Not Hardhat |
| Database | Supabase (Postgres) | — |
| IPFS | Pinata | — |
| API | Hono | — |
| Frontend | Next.js 14 (app router) | — |
| Styling | Tailwind CSS 4 + CSS custom properties | — |
| Animation | Framer Motion (motion/react) | — |
| Wallet | wagmi + RainbowKit | — |

## Package Dependency Graph

```
@agora/common          ← foundation, depends on nothing
    ↓
@agora/contracts       ← ABIs flow back into common/abi/
@agora/ipfs            ← Pinata pin/fetch
@agora/db              ← Supabase queries
@agora/chain           ← viem contract wrappers + indexer
    ↓
@agora/scorer          ← Docker scorer orchestration
    ↓
@agora/cli             ← `agora` CLI
@agora/api             ← Hono REST API
@agora/mcp-server      ← MCP for AI agents
```

**Import rule:** Packages may only import from packages above them. Never create circular dependencies. Shared types go in `@agora/common`.

## Commands

```bash
# Build everything
pnpm turbo build

# Test everything
pnpm turbo test

# Contracts
cd packages/contracts
forge build && forge test -vv

# Lint + format
biome check --apply .

# CLI (after pnpm link in apps/cli)
agora --help
```

## Critical Rules

1. **Never use ethers.js.** Use viem everywhere.
2. **Never use ESLint/Prettier.** Use Biome only.
3. **Never read `process.env` directly.** Use `packages/common/src/config.ts`.
4. **Never hardcode contract addresses.** They live in config, loaded from env vars.
5. **All external inputs validated with Zod.** YAML, API bodies, CLI args, config.
6. **USDC has 6 decimals.** Always `parseUnits(amount, 6)`, never `parseEther`.
7. **No circular imports.** If two packages need a type, put it in `@agora/common`.
8. **All user-facing errors must include a suggested next action.** Never expose raw viem/Solidity errors.
9. **Always `pnpm turbo build` before pushing.** Must succeed with zero errors.
10. **Prefer composition.** Small focused functions > class hierarchies > "flexible" abstractions.

## Environment Variables

All defined in `.env.example`. Loaded via `@agora/common` config loader with Zod validation.

Key groups: Chain (RPC, keys, addresses), IPFS (Pinata JWT), Database (Supabase), API (port, CORS), Frontend (`NEXT_PUBLIC_*` vars).

See @.env.example for the full documented list.

## Smart Contract Quick Reference

- **AgoraFactory** — creates challenges, manages oracle/treasury, 10% fee (1000 bps)
- **AgoraChallenge** — submissions, scoring, dispute flow, payouts
- Status flow: Open → Scoring → Finalized | Disputed → Finalized | Cancelled
- Distribution types: WinnerTakeAll, TopThree (60/25/15), Proportional
- Dispute window: poster-configurable, 0–2160 hours on testnet; target 168–2160 hours (7–90 days) before mainnet
- See @docs/architecture.md for full contract diagrams

## When You're Stuck

1. Re-read this file
2. Check the relevant doc (architecture, spec, design system)
3. Run `pnpm turbo build` — the error is often in an upstream package
4. For chain issues: check Anvil is running and contracts are deployed
5. For IPFS issues: check `AGORA_PINATA_JWT` is set
6. For DB issues: check Supabase connection
