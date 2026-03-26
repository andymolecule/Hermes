# Testing

## Purpose

How to run tests, what each test layer covers, and how to validate a deployment.

## Audience

Engineers writing or running tests. Operators validating deployments.

## Read this after

- [Architecture](architecture.md) — system overview
- [Operations](operations.md) — day-to-day service operations
- [specs/authoring-session-api.md](specs/authoring-session-api.md) — locked session-first authoring contract

## Source of truth

This doc is authoritative for: test commands, test file locations, verification scripts, and E2E test configuration. It is NOT authoritative for: contract logic, API routes, or database schema.

---

## Quick Start

```bash
# Run all tests
pnpm turbo test

# Run contract tests
cd packages/contracts && forge test -vv

# Run contract fork tests (requires AGORA_BASE_SEPOLIA_RPC_URL and env addresses)
pnpm contracts:test:fork

# Enforce contract coverage floor
pnpm contracts:coverage:check

# Run verification suite
pnpm schema:verify          # DB schema compatibility
pnpm scorers:verify         # Official scorer images pullable
pnpm abi:check              # ABI sync

# Full verification pipeline
pnpm verify                 # = abi:check && build && test

# Pre-launch validation
./scripts/preflight-testnet.sh

# Local deterministic lifecycle smoke
pnpm smoke:lifecycle

# External/testnet CLI smoke
pnpm smoke:lifecycle:testnet
```

---

## Test Layers

### 1. Smart Contract Tests (Foundry)

```bash
pnpm --filter @agora/contracts test
# or
cd packages/contracts && forge test -vv
```

| File | Coverage |
|------|----------|
| `AgoraFactory.t.sol` | Challenge creation, USDC transfers, oracle/treasury management |
| `AgoraChallenge.t.sol` | Status machine transitions, scoring, disputes, payouts |
| `AgoraInvariant.t.sol` | Protocol invariant constraints |
| `test/fork/*.t.sol` | Base Sepolia fork realism checks against live USDC + deployed factory |

Uses Foundry's `forge-std/Test.sol` with cheatcodes (`vm.prank`, `vm.warp`, etc.).

### 2. Package Unit Tests (Node.js)

All TypeScript packages use Node's built-in `node --test` runner with `assert/strict`. No external test framework.

```bash
pnpm --filter <package> test
```

| Package | Key Test Areas |
|---------|---------------|
| `@agora/common` | Spec validation, execution templates, CSV validation, submission contracts, sealing, x402 |
| `@agora/db` | Event projections, schema compatibility, score job lifecycle, submission intents, analytics |
| `@agora/chain` | Indexer status projection, confirmation depth, chain integration |
| `@agora/ipfs` | Fetch resilience, pin/fetch roundtrip |
| `@agora/scorer-runtime` | Docker execution, image preflight, workspace staging |
| `@agora/scorer` | Runtime config resolution, scoring pipeline orchestration, proof/replay handling |

### 3. App Tests

```bash
pnpm --filter @agora/api test
pnpm --filter @agora/cli test
pnpm --filter @agora/web test
```

| App | Key Test Areas |
|-----|---------------|
| `@agora/api` | Health endpoints, worker job claiming, fairness visibility, submission limits, scoring lifecycle, secret redaction, HTTP caching |
| `@agora/cli` | Command parsing, output formatting |
| `@agora/web` | Component rendering, browser API client behavior, wallet/session state helpers |

Useful focused API regression slices:

```bash
cd apps/api
node --import tsx --test tests/authoring-sessions-route.test.ts tests/authoring-artifacts.test.ts tests/challenge-registration.test.ts tests/authoring-ir.test.ts tests/authoring-compiler.test.ts
```

---

## Test File Locations

| Type | Location |
|------|----------|
| Contract tests | `packages/contracts/test/*.t.sol` |
| Common tests | `packages/common/src/tests/*.ts` |
| DB tests | `packages/db/src/tests/*.ts` |
| Scorer tests | `packages/scorer/src/tests/*.test.ts` |
| API tests | `apps/api/tests/*.test.ts` |
| E2E script | `scripts/e2e-test.sh` |
| Preflight script | `scripts/preflight-testnet.sh` |
| Verification scripts | `scripts/verify-*.mjs` |

---

## Verification Scripts

### `pnpm schema:verify`

Validates that the live Supabase/PostgREST schema exposes all runtime-critical columns. Does not require test data.

### `pnpm scorers:verify`

Validates that all official scorer images are:
- Anonymously resolvable from GHCR (digest resolution without auth)
- Anonymously pullable with Docker (public access)

Requires a running Docker daemon.

### `pnpm smoke:lifecycle`

Runs the TypeScript lifecycle smoke harness in `apps/api/src/e2e-test.ts` after first asserting runtime schema compatibility.

### `pnpm contracts:test:fork`

Runs the focused Base Sepolia fork pack. Requires:
- `AGORA_BASE_SEPOLIA_RPC_URL`
- `AGORA_FACTORY_ADDRESS`
- `AGORA_USDC_ADDRESS`
- optional `AGORA_FORK_BLOCK` for pinned deterministic runs

### `pnpm contracts:coverage:check`

Runs `forge coverage`, emits `lcov.info`, and fails if contract source line coverage drops below the configured floor.

### `pnpm abi:check`

Verifies ABI sync between Foundry output and `@agora/common` ABI exports.

### `pnpm verify`

Runs the full pipeline: `abi:check` + `build` + `test`.

Wallet/session hardening checks now live in:

- `apps/web/tests/api-client.test.ts` — browser auth/session requests stay same-origin under `/api/*`
- `apps/web/tests/wallet-session-state.test.ts` — stale SIWE sessions are cleared on disconnect or wallet switch
- `apps/web/tests/portfolio-access.test.ts` — portfolio access requires both the right chain and a matching SIWE session
- `apps/api/tests/session-policy.test.ts` — optional-auth API routes ignore stale mismatched SIWE sessions instead of treating them as authoritative

---

## End-to-End Test

`pnpm smoke:lifecycle` is the preferred local entrypoint for the challenge lifecycle smoke test on an Anvil-backed environment. It wraps the TypeScript harness in `apps/api/src/e2e-test.ts`.
`pnpm smoke:lifecycle:local` is the explicit alias for that same deterministic path.
`pnpm smoke:lifecycle:testnet` runs the CLI-driven shell smoke against the currently configured external environment.

`apps/api/src/e2e-test.ts` exercises the dispute branch (`create -> submit -> startScoring -> score -> dispute -> resolve -> claim`).
`scripts/e2e-test.sh` remains available as the CLI-driven shell harness for the direct finalization branch (`post -> submit -> verify -> finalize -> claim`).

Shared setup:

1. Create challenge YAML fixture
2. Post challenge on-chain
3. Wait for indexer sync
4. Download challenge data
5. Submit on-chain
6. Wait for the indexed submission to attach to the registered `submission_intent`
7. Wait for worker scoring
8. Verify public replay artifacts

Dispute branch (`pnpm smoke:lifecycle` / `pnpm smoke:lifecycle:local`):

1. Open a dispute
2. Resolve the dispute
3. Claim payout

Direct finalization branch (`pnpm smoke:lifecycle:testnet` / `./scripts/e2e-test.sh`):

1. Confirm the public CLI cannot run `score-local` for the private-evaluation challenge
2. Wait for the dispute window to elapse
3. Finalize challenge
4. Claim payout

### Configuration

```bash
# Required env vars
AGORA_RPC_URL
AGORA_FACTORY_ADDRESS
AGORA_USDC_ADDRESS
AGORA_SUPABASE_URL
AGORA_SUPABASE_ANON_KEY
AGORA_SUPABASE_SERVICE_KEY
AGORA_PINATA_JWT
AGORA_PRIVATE_KEY

# Optional overrides
AGORA_E2E_SCORER_IMAGE="ghcr.io/andymolecule/gems-match-scorer:v1"
AGORA_E2E_DEADLINE_MINUTES="10"
AGORA_E2E_DISPUTE_WINDOW_HOURS="168"    # contract minimum; use Anvil time travel for fast runs
AGORA_E2E_ENABLE_TIME_TRAVEL="1"         # allow evm_increaseTime on Anvil
AGORA_E2E_MAX_FINALIZE_WAIT_SECONDS="600"

# Optional fork-test vars
AGORA_BASE_SEPOLIA_RPC_URL="https://sepolia.base.org"
AGORA_FORK_BLOCK=""
```

For the full post-deadline path, run `pnpm smoke:lifecycle:local` against local Anvil with `AGORA_CHAIN_ID=31337` and `AGORA_E2E_ENABLE_TIME_TRAVEL=1`.
The local lifecycle config enforces the hardened 168 hour dispute window.
`pnpm smoke:lifecycle:testnet` is the external/manual lane against the currently deployed factory generation.

### Running

```bash
# Preferred smoke entrypoint
pnpm smoke:lifecycle

# Explicit local alias
pnpm smoke:lifecycle:local

# CLI-driven external/testnet harness
pnpm smoke:lifecycle:testnet

# Fast local mode (shorter deadline, minimum dispute window, Anvil time travel)
AGORA_CHAIN_ID=31337 \
AGORA_E2E_DEADLINE_MINUTES=30 \
AGORA_E2E_DISPUTE_WINDOW_HOURS=168 \
AGORA_E2E_ENABLE_TIME_TRAVEL=1 \
pnpm smoke:lifecycle:local
```

The scorer image must already be published and pullable. The E2E script does not build local scorer images.

---

## Preflight Testnet Script

`scripts/preflight-testnet.sh` validates a deployment is ready before going live. Checks:

1. Required CLI tools available (node, pnpm, docker, forge, cast, curl)
2. All required environment variables set
3. Docker daemon reachable
4. Build succeeds (`pnpm turbo build`)
5. Scorer images pullable (`pnpm scorers:verify`)
6. DB schema compatible (`pnpm schema:verify`)
7. CLI doctor passes (`agora doctor`)
8. API health returns 200
9. Required Supabase tables reachable
10. Indexer health (correct factory, acceptable lag)
11. Worker health (healthy workers on active runtime version)
12. Sealing readiness (if enabled)

Exit code 0 means all checks pass.

---

## Writing Tests

### TypeScript test pattern

```typescript
import assert from "node:assert/strict";
import test from "node:test";

test("description of what is being tested", async () => {
  const result = await functionUnderTest(input);
  assert.equal(result.ok, true);
  assert.match(result.message, /expected pattern/);
});
```

Run a single test file:

```bash
node --import tsx path/to/file.test.ts
```

### Solidity test pattern

```solidity
contract ExampleTest is Test {
    function testSomeBehavior() public {
        vm.prank(user);
        uint256 result = contract.action();
        assertEq(result, expected);
    }
}
```

Run a single contract test:

```bash
forge test --match-test testSomeBehavior -vv
```
