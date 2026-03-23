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

# Run verification suite
pnpm schema:verify          # DB schema compatibility
pnpm scorers:verify         # Official scorer images pullable
pnpm abi:check              # ABI sync

# Full verification pipeline
pnpm verify                 # = abi:check && build && test

# Pre-launch validation
./scripts/preflight-testnet.sh

# End-to-end lifecycle
./scripts/e2e-test.sh
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
pnpm --filter @agora/mcp-server test
pnpm --filter @agora/web test
```

| App | Key Test Areas |
|-----|---------------|
| `@agora/api` | Health endpoints, worker job claiming, fairness visibility, submission limits, scoring lifecycle, secret redaction, HTTP caching |
| `@agora/cli` | Command parsing, output formatting |
| `@agora/mcp-server` | Tool catalog, challenge listing |
| `@agora/web` | Component rendering, browser API client behavior, wallet/session state helpers |

Useful focused API regression slices:

```bash
cd apps/api
node --import tsx --test tests/authoring-sessions-route.test.ts tests/authoring-artifacts.test.ts tests/authoring-sponsored-publish.test.ts tests/authoring-ir.test.ts tests/authoring-compiler.test.ts
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
| MCP tests | `apps/mcp-server/src/tests/*.test.ts` |
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

### `pnpm recover:authoring-publishes -- --stale-minutes=30`

Reconciles stale authoring sponsor-budget reservations after API/indexer interruptions:
- consumes reservations when a published link or challenge projection already exists
- releases reservations only when no challenge transaction was ever attached
- leaves tx-backed reservations pending for operator review if the challenge projection is still missing

### `pnpm smoke:lifecycle`

Runs the TypeScript lifecycle smoke harness in `apps/api/src/e2e-test.ts` after first asserting runtime schema compatibility.

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

`pnpm smoke:lifecycle` is the preferred entrypoint for the challenge lifecycle smoke test on a local Anvil-backed environment. It wraps the TypeScript harness in `apps/api/src/e2e-test.ts`.

`apps/api/src/e2e-test.ts` exercises the dispute branch (`create -> submit -> startScoring -> score -> dispute -> resolve -> claim`).
`scripts/e2e-test.sh` remains available as the CLI-driven shell harness for the direct finalization branch (`post -> submit -> verify -> finalize -> claim`).

1. Create challenge YAML fixture
2. Post challenge on-chain
3. Wait for indexer sync
4. Download challenge data
5. Run `score-local` (preview)
6. Submit on-chain
7. Wait for the indexed submission to attach to the registered `submission_intent`
8. Wait for worker scoring
9. Verify public replay artifacts
10. Wait for dispute window
11. Finalize challenge
12. Claim payout

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
```

For the full post-deadline path, run this against local Anvil with `AGORA_CHAIN_ID=31337` and `AGORA_E2E_ENABLE_TIME_TRAVEL=1`. The contracts now enforce a minimum 168 hour dispute window, so public RPC environments can validate challenge creation, submission intent binding, and open-gate enforcement, but they cannot complete settlement in one session.

### Running

```bash
# Preferred smoke entrypoint
pnpm smoke:lifecycle

# CLI-driven shell harness
./scripts/e2e-test.sh

# Fast local mode (shorter deadline, minimum dispute window, Anvil time travel)
AGORA_CHAIN_ID=31337 \
AGORA_E2E_DEADLINE_MINUTES=30 \
AGORA_E2E_DISPUTE_WINDOW_HOURS=168 \
AGORA_E2E_ENABLE_TIME_TRAVEL=1 \
./scripts/e2e-test.sh
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
