# CLAUDE.md — Agora

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
- **Fix root causes, not symptoms** — Don't ship short-term patch fixes when a bug points to a deeper design or contract problem. Trace failures to the real source, fix them at the boundary or source of truth, and call out when the right answer is a structural refactor.
- **Composition over inheritance** — Small, focused modules composed together. No god objects.
- **Single responsibility** — Each file, function, and package does one thing well.

## Key Documents

- @docs/product.md — Product guide (the "what and why")
- @docs/architecture.md — System architecture with diagrams (the "how")
- @docs/protocol.md — On-chain protocol, lifecycle, settlement (the "rules")
- @docs/data-and-indexing.md — DB schema, projections, source-of-truth boundaries
- @docs/operations.md — Running, deploying, monitoring, incident response
- @docs/contributing/agent-guide.md — Agent getting-started guide
- @.claude/skills/agora-design-system/SKILL.md — Frontend design system, UI best practices, and component guidelines (canonical visual identity)

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
@agora/scorer-runtime  ← Docker execution + workspace utilities
    ↓
@agora/scorer          ← Docker scorer orchestration
@agora/agent-runtime   ← shared submit/score/verify/claim workflows
    ↓
@agora/cli             ← `agora` CLI (via agent-runtime)
@agora/api             ← Hono REST API
@agora/mcp-server      ← MCP for AI agents (via agent-runtime)
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

## Code Quality Best Practices

These are 30 universal principles distilled from Kent Beck's *Smalltalk Best Practice Patterns*, generalized for any codebase.

1. **Composed Method** — Divide every function into sub-functions that each perform one identifiable task. Keep all operations in a method at the same level of abstraction.
2. **Intention-Revealing Names** — Name methods and functions after what they accomplish, never how they accomplish it.
3. **Replace Comments with Clear Code** — Delete comments that restate the code. Reserve comments for why, not what.
4. **Constructor Clarity** — Provide constructors or factory functions that create well-formed instances with all required parameters upfront.
5. **Single Responsibility for Methods** — Each method should have exactly one reason to change.
6. **Say Things Once and Only Once** — Every piece of knowledge or logic should exist in exactly one place.
7. **Behavior Over State** — Get the public behavior right first; keep internal representation hidden and changeable.
8. **Intention-Revealing Selectors / Function Names** — Name functions after the concept they represent, not the algorithm they use.
9. **Guard Clauses Over Deep Nesting** — Handle edge cases early so the main path reads clearly.
10. **Query Methods Return; Commands Mutate** — Separate side-effect-free questions from state-changing operations.
11. **Explaining Variables** — Use well-named local variables to explain complex expressions.
12. **Role-Suggesting Names** — Name variables after the role they play, not their type.
13. **Use Polymorphism Instead of Conditionals** — Replace repeated branching structures with branch-specific implementations.
14. **Delegate, Don't Inherit (Prefer Composition)** — Share behavior through collaborators rather than deep inheritance.
15. **Method Object for Complex Logic** — Extract large computations into focused objects when a method grows too complex.
16. **Execute Around (Resource Bracketing)** — Wrap paired setup/teardown actions in one function so callers cannot forget cleanup.
17. **Explicit Initialization** — Initialize all state at construction time instead of relying on callers to set it correctly later.
18. **Lazy Initialization** — Defer expensive work until first use when it may not always be needed.
19. **Constant Methods / Named Constants** — Replace magic literals with named constants or zero-argument methods.
20. **Indirect Variable Access (Encapsulate Fields)** — Access fields through one controlled interface when you need future validation or hooks.
21. **Collection Accessor Safety** — Never expose raw mutable collections directly.
22. **Equality and Hashing Contract** — If equality is overridden, hashing must follow the same fields.
23. **Mediating Protocol** — Make heavily used object-to-object message patterns explicit and consistent.
24. **Double Dispatch for Cross-Type Operations** — Use double dispatch when behavior depends on the types of two collaborating objects.
25. **Pluggable Behavior Over Subclass Explosion** — Use strategies or callbacks when variations are narrow.
26. **Collecting Parameter** — Pass a shared result collection when multiple helpers contribute to one output.
27. **Interesting Return Values Only** — Return values only when callers need them.
28. **Reversing Method for Readable Flow** — Add convenience methods when they make message flow easier to read left to right.
29. **Debug Printing for Developer Ergonomics** — Provide useful debug representations for developers; keep user-facing display separate.
30. **Adopt Patterns Incrementally** — Apply these patterns as refactoring tools when friction appears, not as ceremony upfront.

### How to Use This Section

Use these principles as a shared review vocabulary for code review, pair programming, and AI-assisted development. When giving feedback, reference the relevant principle directly, for example: `Principle 8: name after the concept, not the algorithm`.

## Environment Variables

All defined in `.env.example`. Loaded via `@agora/common` config loader with Zod validation.

Key groups: Chain (RPC, keys, addresses), IPFS (Pinata JWT), Database (Supabase), API (port, CORS), Frontend (`NEXT_PUBLIC_*` vars).

See @.env.example for the full documented list.

## Smart Contract Quick Reference

- **AgoraFactory** — creates challenges, manages oracle/treasury, 10% fee (1000 bps)
- **AgoraChallenge** — submissions, scoring, dispute flow, payouts
- Status flow: Open → Scoring → Finalized | Disputed → Finalized | Cancelled
- Distribution types: WinnerTakeAll, TopThree (60/25/15), Proportional
- Dispute window: poster-configurable, 168–2160 hours (7–90 days)
- See @docs/architecture.md for full contract diagrams

## When You're Stuck

1. Re-read this file
2. Check the relevant doc (architecture, spec, design system)
3. Run `pnpm turbo build` — the error is often in an upstream package
4. For chain issues: check Anvil is running and contracts are deployed
5. For IPFS issues: check `AGORA_PINATA_JWT` is set
6. For DB issues: check Supabase connection
