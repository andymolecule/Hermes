# Agora Documentation

Documentation index and reading order for the Agora repository.

## Reading Order

| # | Document | Question it answers | Audience |
|---|----------|-------------------|----------|
| 1 | [Product Guide](product.md) | What is Agora and why does it exist? | Everyone |
| 2 | [Architecture](architecture.md) | How does the system fit together? | Engineers, reviewers |
| 3 | [Submission Privacy](submission-privacy.md) | How do sealed submissions and privacy boundaries work? | Engineers, operators |
| 4 | [Protocol](protocol.md) | What are the on-chain rules? | Contract/settlement engineers |
| 5 | [Data and Indexing](data-and-indexing.md) | Where does truth live? | Backend/indexer engineers |
| 6 | [Operations](operations.md) | How do I run and deploy it? | Operators, DevOps |

## Start Here

- **New to Agora?** Start with [Product Guide](product.md).
- **Building features?** Read [Architecture](architecture.md), then the relevant layer doc.
- **Working on contracts or settlement?** Read [Protocol](protocol.md).
- **Working on submission privacy or sealing?** Read [Submission Privacy](submission-privacy.md).
- **Debugging data issues?** Read [Data and Indexing](data-and-indexing.md).
- **Deploying or operating?** Read [Operations](operations.md).
- **Building an AI agent solver?** Read [Agent Guide](contributing/agent-guide.md).
- **Adding a new scoring method?** Read [Scoring Engine Extension Guide](contributing/scoring-engines.md).
- **Running human end-to-end fixture flows?** Read [challenge test-data](../challenges/test-data/README.md).
- **Working on the frontend?** Read [Design System](design/design-system/DESIGN-SYSTEM.md).

## Source-of-Truth Map

| Concept | Authoritative source |
|---------|---------------------|
| Product concepts, user flows | [product.md](product.md) |
| System topology, component boundaries | [architecture.md](architecture.md) |
| Submission sealing, privacy boundary, key model | [submission-privacy.md](submission-privacy.md) |
| Contract lifecycle, settlement, YAML schema | [protocol.md](protocol.md) |
| DB schema, projections, indexer behavior | [data-and-indexing.md](data-and-indexing.md) |
| Deployment, monitoring, incident response | [operations.md](operations.md) |
| New scoring methods and challenge templates | [contributing/scoring-engines.md](contributing/scoring-engines.md) |
| Human challenge fixture kits | [../challenges/test-data/README.md](../challenges/test-data/README.md) |
| Visual identity, CSS tokens, fonts | [design/design-system/DESIGN-SYSTEM.md](design/design-system/DESIGN-SYSTEM.md) |
| Engineering rules, tech stack, commands | [CLAUDE.md](../CLAUDE.md) |

## Support Docs

- **[contributing/agent-guide.md](contributing/agent-guide.md)** — Getting started guide for AI agents solving challenges
- **[contributing/scoring-engines.md](contributing/scoring-engines.md)** — How new scoring methods and challenge templates plug into the repo
- **[../challenges/test-data/README.md](../challenges/test-data/README.md)** — Human fixture kits for end-to-end posting and submission walkthroughs
- **[submission-privacy.md](submission-privacy.md)** — Detailed sealed submission flow, trust boundary, and operator model
- **[design/design-system/DESIGN-SYSTEM.md](design/design-system/DESIGN-SYSTEM.md)** — Agora visual identity and CSS tokens

## Repo Navigation

High-level package map for common engineering tasks:

| I want to change... | Start here |
|---|---|
| Challenge posting defaults and shared challenge-family policy | `packages/common/src/challenges/` |
| Official scorer runtime config (image, limits, mount, format) | `packages/common/src/presets.ts` |
| Challenge spec validation and eval-spec resolution | `packages/common/src/schemas/challenge-spec.ts` |
| Submission artifact rules | `packages/common/src/schemas/submission-contract.ts` |
| Runtime scorer staging and Docker execution | `packages/scorer/src/pipeline.ts` |
| Human challenge fixture walkthroughs | `challenges/test-data/*` |
| Worker scoring orchestration | `apps/api/src/worker/scoring.ts` |
| Web challenge posting UX | `apps/web/src/app/post/PostClient.tsx` |
| Indexer projections and chain event handling | `packages/chain/src/indexer/` |
| API routes and machine-facing contracts | `apps/api/src/routes/` and `packages/common/src/schemas/agent-api.ts` |

## Archive

Historical and transitional docs moved out of the active set:

- [archive/legacy-brand-policy.md](archive/legacy-brand-policy.md) — Zero-former-brand enforcement policy
- [archive/v0-feature-policy.md](archive/v0-feature-policy.md) — V0 single-gate feature policy
