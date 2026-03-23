# Agora Documentation

Documentation index and reading order for the Agora repository.

## Reading Order

| # | Document | Question it answers | Audience |
|---|----------|-------------------|----------|
| 1 | [Product Guide](product.md) | What is Agora and why does it exist? | Everyone |
| 2 | [Principles](principles.md) | What properties must Agora preserve? | Founders, engineers, reviewers |
| 3 | [Architecture](architecture.md) | How does the system fit together? | Engineers, reviewers |
| 4 | [Challenge Authoring IR](challenge-authoring-ir.md) | What typed contract should posting converge toward before compile/publish? | Product, frontend, backend |
| 5 | [Authoring Session API Spec](specs/authoring-session-api.md) | What is the locked session-first authoring contract? | Product, frontend, backend |
| 6 | [Authoring Observability Spec](specs/authoring-observability.md) | How should internal authoring conversation logs and debug timelines work? | Product, backend, operators |
| 7 | [Submission Privacy](submission-privacy.md) | How do sealed submissions and privacy boundaries work? | Engineers, operators |
| 8 | [Protocol](protocol.md) | What are the on-chain rules? | Contract/settlement engineers |
| 9 | [Data and Indexing](data-and-indexing.md) | Where does truth live? | Backend/indexer engineers |
| 10 | [Operations](operations.md) | How do I run and monitor it? | Operators, DevOps |
| 11 | [Deployment](deployment.md) | How do I deploy and cut over? | Operators, DevOps |

## Start Here

- **New to Agora?** Start with [Product Guide](product.md).
- **Need the high-level north star?** Read [Principles](principles.md).
- **Building features?** Read [Architecture](architecture.md), then the relevant layer doc.
- **Working on posting or challenge onboarding?** Read [Challenge Authoring IR](challenge-authoring-ir.md).
- **Working on the new authoring flow?** Read [Authoring Session API Spec](specs/authoring-session-api.md).
- **Need to debug authoring conversations or Telegram/OpenClaw session failures?** Read [Authoring Observability Spec](specs/authoring-observability.md).
- **Working on contracts or settlement?** Read [Protocol](protocol.md).
- **Working on submission privacy or sealing?** Read [Submission Privacy](submission-privacy.md).
- **Debugging data issues?** Read [Data and Indexing](data-and-indexing.md).
- **Running or monitoring?** Read [Operations](operations.md).
- **Deploying or cutting over?** Read [Deployment](deployment.md).
- **Building an AI agent solver?** Read [Agent Guide](contributing/agent-guide.md).
- **Adding a new scoring method?** Read [Scoring Engine Extension Guide](contributing/scoring-engines.md).
- **Running human end-to-end fixture flows?** Read [challenge test-data](../challenges/test-data/README.md).
- **Working on the frontend?** Read [Design System](design/design-system/DESIGN-SYSTEM.md).
- **Looking up a CLI command?** Read [CLI Reference](cli-reference.md).
- **Running or writing tests?** Read [Testing](testing.md).
- **Looking up a term?** Read [Glossary](glossary.md).

## Source-of-Truth Map

| Concept | Authoritative source |
|---------|---------------------|
| Product concepts, user flows | [product.md](product.md) |
| Product principles, trust-model language, positioning guardrails | [principles.md](principles.md) |
| System topology, component boundaries | [architecture.md](architecture.md) |
| Open-ended challenge authoring contract | [challenge-authoring-ir.md](challenge-authoring-ir.md) |
| Locked authoring session API contract | [specs/authoring-session-api.md](specs/authoring-session-api.md) |
| Internal authoring debug timeline and conversation logging | [specs/authoring-observability.md](specs/authoring-observability.md) |
| Submission sealing, privacy boundary, key model | [submission-privacy.md](submission-privacy.md) |
| Contract lifecycle, settlement, YAML schema | [protocol.md](protocol.md) |
| DB schema, projections, indexer behavior | [data-and-indexing.md](data-and-indexing.md) |
| Day-to-day operations, monitoring, incident response | [operations.md](operations.md) |
| Deployment, cutover, rollback | [deployment.md](deployment.md) |
| New scoring methods and challenge templates | [contributing/scoring-engines.md](contributing/scoring-engines.md) |
| Human challenge fixture kits | [../challenges/test-data/README.md](../challenges/test-data/README.md) |
| Visual identity, CSS tokens, fonts | [design/design-system/DESIGN-SYSTEM.md](design/design-system/DESIGN-SYSTEM.md) |
| Engineering rules, tech stack, commands | [CLAUDE.md](../CLAUDE.md) |
| CLI commands and flags | [cli-reference.md](cli-reference.md) |
| Test layers, verification scripts, E2E | [testing.md](testing.md) |
| Key terms and definitions | [glossary.md](glossary.md) |

## Reference Docs

- **[cli-reference.md](cli-reference.md)** — Complete reference for every `agora` CLI command
- **[testing.md](testing.md)** — Test layers, verification scripts, and E2E test configuration
- **[glossary.md](glossary.md)** — Key terms used across Agora documentation and code
- **[challenge-authoring-ir.md](challenge-authoring-ir.md)** — Target typed contract between poster language and final challenge spec
- **[specs/authoring-session-api.md](specs/authoring-session-api.md)** — Locked session-first authoring contract
- **[specs/authoring-observability.md](specs/authoring-observability.md)** — Internal authoring conversation logging and operator debug timeline spec
- **[specs/authoring-session-api-audit.md](specs/authoring-session-api-audit.md)** — Spec-vs-code audit and cutover matrix
- **[specs/authoring-session-cutover-checklist.md](specs/authoring-session-cutover-checklist.md)** — Execution checklist for the session cutover

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
| Official scorer runtime config (image, limits, mount, format) | `packages/common/src/runtime-families.ts` |
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
