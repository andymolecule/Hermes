# PR Summary: Phase 1 + Phase 2 (Foundation + Contracts)

## Overview
This change set bootstraps the Hermes monorepo (Phase 1) and delivers the full smart-contract system with comprehensive tests and >90% coverage (Phase 2). It establishes workspace tooling, shared types/schemas/config, and the Foundry contracts with thorough validation logic and dispute-safe payout handling.

## Phase 1 — Foundation (T-001 + T-002)
- Monorepo scaffold with pnpm workspaces, Turborepo, TypeScript base config, and Biome.
- `.env.example` with the full set of documented variables.
- Local dev compose with Postgres + Anvil.
- `@hermes/common` provides:
  - Challenge/Submission/Scoring types.
  - Zod schema for challenge YAML (ipfs/https sources, distribution types, enums).
  - Centralized config loader with human-readable validation errors.
  - Constants and ABI exports.
  - Schema validation test.

## Phase 2 — Smart Contracts (T-003 + T-004)
- Contracts:
  - `HermesFactory` (creates challenges, manages oracle/treasury).
  - `HermesChallenge` (submissions, scoring, dispute flow, payouts).
- Libraries:
  - `HermesErrors` custom errors.
  - `HermesEvents` event set.
  - `IHermesChallenge` interface.
- Security/validations:
  - Reject zero USDC address in factory constructor.
  - Enforce `maxSubmissionsPerWallet <= 3` (hard cap).
  - Reject deadlines in the past.
  - Enforce dispute window bounds.
- Dispute resolution now honors `winnerSubId` for proportional payouts (dust goes to the resolved winner).
- Mock USDC for local/testnet flows.
- Deploy scripts for factory and mock USDC.

## Tests & Coverage
- Unit, fuzz, and invariant tests added across factory/challenge.
- Coverage achieved:
  - `HermesChallenge.sol`: >90% line coverage
  - `HermesFactory.sol`: 100% line coverage

### Commands
```bash
# Common package validation
pnpm --filter @hermes/common test

# Contracts
NO_PROXY='*' forge test -vv
NO_PROXY='*' forge coverage --ir-minimum
```

## Notable Files
- `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `biome.json`
- `packages/common/src/*` (types, schemas, config, ABI exports)
- `packages/contracts/src/*` (factory + challenge + errors + events)
- `packages/contracts/test/*` (unit/fuzz/invariant)
- `packages/contracts/script/*` (deploy scripts)

## Notes
- Foundry on macOS may crash during tests/coverage unless `NO_PROXY='*'` is set.
- ABI JSONs are generated from `forge build` output and stored in `packages/common/src/abi/`.
