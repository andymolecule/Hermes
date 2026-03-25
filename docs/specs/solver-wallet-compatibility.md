# Solver Wallet Compatibility Spec

> Status: Draft 0 for alignment
> Date: March 24, 2026
> Scope: Solver wallet compatibility for agent submission and payout claim flows, with emphasis on Telegram/OpenClaw-style agents.

---

## 0. Why This Doc Exists

Agora's current contracts already support wallet-agnostic EVM callers, but the product and runtime do not yet have a clear compatibility model for agent wallets.

The recurring ambiguities are:

- whether an "agent wallet" means a bot-owned wallet, a delegated user wallet, or a generic payment credential
- whether Agora should align to one wallet vendor or to the shared patterns used across vendors
- whether machine-payment protocols such as x402, AP2, or ACP matter for bounty submission and claim
- whether Agora should loosen payout semantics by letting one wallet submit while another arbitrary wallet claims
- whether supporting smart accounts or delegated user wallets requires contract changes

This doc exists to lock the planning model before implementation work starts.

## 0.1 What This Doc Is Authoritative For

- the compatibility model for solver wallets
- the product and protocol assumptions Agora should preserve for solver identity and payout claimability
- the phased implementation plan for supporting agent wallets without vendor lock-in
- the distinction between direct agent-owned wallets, smart accounts, and delegated user-wallet flows

## 0.2 What This Doc Is Not For

- sponsor-funded authoring publish for challenge creation
- consumer checkout or commerce flows
- API pay-per-request monetization
- card-network agent payment rails
- a final decision on adding new contract methods

## 0.3 Current Constraint

Today, Agora's solver payout model is address-bound:

- `submit()` records `msg.sender` as the solver
- payout entitlement is allocated to that solver address
- `claim()` pays `claimableByAddress[msg.sender]` to `msg.sender`

That model is simple, auditable, and already compatible with any EVM account that can produce a valid call.

The current implementation gap is not the contract. The gap is the runtime signer abstraction.

## 0.4 Agent Key Custody Rule

Hard requirement:

- Agora-hosted services must never read, store, ingest, or transport an agent-owned solver private key

Implications:

- hosted agent wallet support must use a remote signer model
- Phase 1's real provider target should be Coinbase CDP / Coinbase Dev Wallet or another external signer service
- any remaining raw private-key path is for local operator-controlled tooling only, not for Agora-hosted agent execution

---

## 1. Terms

| Term | Meaning |
|------|---------|
| **Solver account** | The stable onchain account that owns a submission and is entitled to any payout. |
| **Signer backend** | The security infrastructure that authorizes transactions for the solver account. Examples: TEE, MPC, KMS, browser wallet, passkey, delegated permission chain. |
| **Transport** | How the transaction reaches chain. Examples: direct transaction, relayed transaction, user operation. |
| **Agent-owned wallet** | A persistent wallet controlled by the agent or its operator. The agent earns to this wallet. |
| **Delegated wallet** | A user-owned or org-owned wallet that grants scoped authority to an agent. |
| **Machine payment protocol** | A protocol for paying for APIs or services, such as x402, AP2, or ACP. Not the same as a bounty escrow beneficiary model. |

---

## 2. Industry Landscape Summary

As of March 24, 2026, the top wallet infrastructure providers differ in implementation details, but they mostly converge on a shared shape:

- a stable EVM account is the primary identity
- signing security is handled by a backend such as TEE, MPC, KMS, or a hybrid system
- policy controls are increasingly common
- smart-account and delegated-permission flows are growing, but are not the only valid model
- machine-payment protocols are a separate layer from escrow settlement

### 2.1 Provider Matrix

| Provider | Docs-visible primary model | Account shapes | Policy / controls | Natural Agora fit |
|----------|----------------------------|----------------|-------------------|-------------------|
| **Coinbase CDP** | Server-managed wallets and smart accounts | EOA, smart account | Spend permissions, gas sponsorship | Strong fit for agent-owned solver wallets |
| **Privy** | Secure server wallets with auth keys, quorums, policies | EOA, smart account | Rich policy and approval controls | Strong fit for agent-owned or delegated flows |
| **Turnkey** | Agentic wallets plus transaction policy engine | EOA and delegated control patterns | Explicit policy engine | Strong fit for agent-owned or delegated flows |
| **Crossmint** | Wallet signers and custody architecture | Wallets with multiple signer patterns | Depends on signer configuration | Good fit for agent-owned server wallets |
| **Fireblocks** | Wallet-as-a-service with MPC and policy controls | Custodial / embedded wallet patterns | Mature policy controls | Good fit for institutional solver wallets |
| **MetaMask** | Smart accounts and advanced permissions | Embedded wallet, smart account, delegated user control | Advanced permissions | Best fit for delegated user-owned wallet flows |

### 2.2 Wallet Mode Matrix

| Mode | Stable beneficiary address | Typical transport | Industry adoption | Agora fit |
|------|----------------------------|-------------------|-------------------|-----------|
| **Agent-owned EOA server wallet** | Yes | direct transaction | High | Best initial target |
| **Agent-owned smart account** | Yes | user operation or smart-account relayer | Growing fast | Good second target |
| **Delegated user wallet** | Yes | smart-account delegation or wallet-native permission flow | Growing | Useful later |
| **Ephemeral bot session wallet** | No | varies | Exists, but weak for payout continuity | Poor fit |
| **Machine-payment credential only** | No | HTTP/API payment | Growing for services | Not sufficient |

### 2.3 Key Conclusion

The best common standard for Agora is not a single vendor and not a single signing technology.

The best common standard is:

1. a stable solver account
2. a pluggable signer backend
3. a transport-agnostic write path
4. optional policy and delegation layers

---

## 3. Locked Design Decisions

### 3.1 Solver Identity Is a Stable Onchain Account

Agora should treat the solver account as the canonical identity for submission ownership and payout entitlement.

Rules:

- the solver account must be known before `submission_intent` creation
- the sealed submission envelope must continue to bind `solverAddress`
- payout entitlement should continue to derive from the solver account
- claimability should continue to be address-based

### 3.2 Wallet Vendor Is Not a Protocol Dependency

Agora must not encode wallet-vendor assumptions into:

- contract ABI
- submission-intent semantics
- payout semantics
- DB identity model

Vendor integrations belong in the runtime adapter layer.

### 3.3 Submission Intent Lifecycle Stays The Same

Phase 1 should preserve Agora's existing submission lifecycle:

1. create a `submission_intent` record before the wallet write
2. broadcast the onchain `submit()` transaction from the solver account
3. let the indexer observe the `Submitted` event and link the confirmed submission back to the intent

Rules:

- the intent is the pre-chain pending record
- the indexed submission is the confirmed record
- a transaction hash alone does not create a confirmed submission
- CDP support should only replace how step 2 is signed and sent
- steps 1 and 3 should remain unchanged in Phase 1

### 3.4 Submission and Claim Continuity Matter More Than Flexible Redirection

The simplest and strongest solver rule is still:

- the account that owns the submission is the account that owns the payout

Agora should not introduce "submit from one address, freely pay to another address later" as a default model.

If a separate beneficiary is ever introduced, it must be fixed at submission time and bound into the signed or sealed authorization data.

### 3.4 Machine-Payment Protocols Are Out of Scope for Core Solver Settlement

x402, AP2, ACP, and similar protocols may matter later for:

- paid APIs
- paid model access
- paid solver tooling

They are not required to support bounty submit and claim.

### 3.5 Smart Accounts Are First-Class Compatible

Agora should treat the following as compatible solver accounts:

- EOAs
- ERC-4337 smart accounts
- EIP-7702-capable delegated account flows
- wallet-native delegated accounts that still preserve a stable beneficiary address

The contracts should remain wallet-type neutral.

### 3.6 Delegated User Wallets Are a Separate Product Mode

There are two different product modes:

| Mode | Meaning |
|------|---------|
| **Agent-owned** | The agent owns the solver account and earns the reward itself. |
| **Delegated** | A human or organization owns the solver account and grants scoped authority to an agent. |

Agora should implement agent-owned mode first.

---

## 4. Recommended Agora Model

### 4.1 V1: Agent-Owned Stable Wallet

`V1` means:

- each Telegram or OpenClaw agent has its own persistent solver account
- that solver account is the account used for submit and claim
- the Telegram bot is the control plane, not the beneficiary identity

Examples:

- a Coinbase CDP server wallet EOA
- a Coinbase CDP smart account
- a Privy-controlled wallet
- a Turnkey-controlled wallet
- a Crossmint server wallet
- a Fireblocks-managed wallet

This is the best initial model because it aligns with Agora's current contract semantics with no protocol change.

### 4.2 V2: Agent-Owned Smart Account

This keeps the same product semantics as V1:

- same stable solver account
- same payout beneficiary
- same `submit()` and `claim()` contract calls

The only difference is transport:

- user operation instead of direct transaction
- possibly sponsored gas
- possibly bundled writes

This does not justify changing solver identity semantics.

### 4.3 V3: Delegated User Wallet

This mode is for cases where:

- the user wants the reward to belong to their wallet
- the agent acts under scoped authority

Agora should prefer wallet-native delegation where possible so the beneficiary account still appears as the effective solver account.

Agora should not add protocol-level delegation first if wallet-native delegation already solves the problem.

### 4.4 Anti-Goal

Agora should not start with:

- arbitrary payout-redirection fields
- offchain-only "proof of authorization" with no stable beneficiary account
- ephemeral session wallets that cannot safely reclaim or prove continuity later

---

## 5. Compatibility Model for Agora

### 5.1 Contract Layer

Contract requirements:

- accept any valid EVM caller
- never require a specific wallet vendor
- never require an EOA-only path
- never use `tx.origin` or similar EOA-only checks

Current state already satisfies this.

### 5.2 Runtime Layer

The runtime should support multiple write modes:

| Write mode | Description | Required for |
|-----------|-------------|--------------|
| `transaction` | direct EVM transaction from an account | V1 |
| `user_operation` | smart-account user operation | V2 |
| `delegated_transaction` | wallet-native delegated execution | V3 |

The runtime should not assume that all writes come from:

- a raw private key
- a browser wallet
- a single global process wallet

### 5.3 Submission Model

The canonical solver data for a submission should remain:

- `solverAddress`
- `resultHash`
- `submissionCid`

No DB schema changes are required for V1 or V2 beyond the sealed-only cleanup already in flight.

Optional observability fields may be added later for:

- solver wallet mode
- signer provider
- write transport

These should be debug metadata, not protocol truth, and they should not be required methods on the signer interface.

---

## 6. Proposed Runtime Interface

The implementation target should be a signer abstraction rather than more private-key branches.

Ownership rule:

- the signer interface is owned by `@agora/chain`
- solver workflows in `@agora/agent-runtime` consume that interface
- provider-specific signer construction belongs outside `@agora/chain`

Rationale:

- transaction writing and receipt confirmation are chain primitives
- this follows Agora's package dependency graph cleanly
- it avoids pushing wallet-vendor dependencies into the chain package
- it keeps the same signer contract reusable for future non-solver writes such as cancel, scoring, finalize, or admin flows

Locked minimum shape for Phase 1:

```ts
interface SolverSigner {
  getAddress(): Promise<`0x${string}`>;
  writeContract(input: {
    address: `0x${string}`;
    abi: Abi;
    functionName: string;
    args: readonly unknown[];
  }): Promise<{
    hash: `0x${string}`;
  }>;
  waitForFinality(input: {
    hash: `0x${string}`;
  }): Promise<{
    hash: `0x${string}`;
    success: boolean;
  }>;
}
```

Rules:

- this interface is intentionally minimal
- `getAddress()` must return the stable solver account, not an internal relayer address
- `writeContract(...)` must return the transaction hash so `waitForFinality(...)` can track the same write
- a returned transaction hash means the write was broadcast, not that it succeeded
- submit and claim must only be treated as successful after `waitForFinality(...)` confirms successful onchain inclusion
- submission sealing and intent registration must use this address
- claimability checks must use this address
- the write implementation may vary, but the account identity must not
- wallet mode, signer provider, and write transport may be tracked as optional adapter metadata, but they are not part of the minimum signer contract
- write paths must not accept a separate caller-supplied `solverAddress`; solver identity must be derived from `getAddress()` only
- each submit or claim flow should resolve the signer address once at the start and fail immediately if a later critical step observes a different address

### 6.1 Security Boundary

For Phase 1, the security boundary is the Agora contract, not the wallet driver.

The contract is what enforces:

- who can submit
- who can claim
- which address owns the payout

The signer only needs to deliver a valid signed write from the stable solver account.

Agora should not turn the signer interface into a policy engine. Provider-level policies such as spend limits, approvals, and time windows are valuable, but they belong in wallet infrastructure above the protocol.

### 6.2 Why This Interface Matters

This abstraction keeps Agora compatible with:

- raw viem private-key accounts
- CDP accounts exposed as viem-compatible accounts
- Privy or Turnkey write adapters
- smart-account senders
- future delegated-wallet adapters

without changing the rest of the solver flow.

### 6.3 Package Boundary

Locked package boundary:

| Concern | Owning package |
|---------|----------------|
| signer interface type | `@agora/chain` |
| contract write helpers that accept a signer | `@agora/chain` |
| solver submit / claim orchestration | `@agora/agent-runtime` |
| private-key signer construction | caller layer such as CLI or local runtime bootstrap |
| CDP signer construction | caller layer such as agent service or future adapter package |

Rules:

- `@agora/chain` may define the signer interface and consume generic viem-compatible inputs
- `@agora/chain` must not depend on a wallet vendor SDK such as CDP, Privy, Turnkey, or Crossmint
- `@agora/agent-runtime` must not define a competing signer contract
- provider-specific adapters should be built at the app or integration layer and then passed into the runtime

### 6.4 Provider Awareness Rule

Agora core packages should only know the generic signer contract.

That means:

- `@agora/chain` knows how to request a write from `SolverSigner`
- `@agora/agent-runtime` knows how to run the solver workflow using `SolverSigner`
- the core packages should not branch on CDP-specific concepts
- the core packages should not import CDP-specific SDKs
- the core packages should not mention provider-specific authentication models

Provider-specific knowledge belongs in adapter construction layers only.

Illustrative layering:

```text
@agora/chain
  defines SolverSigner
    ↓
adapter layer
  private-key adapter
  CDP adapter
  future Privy adapter
  future Turnkey adapter
    ↓
runtime bootstrap / app config
  selects one adapter
    ↓
@agora/agent-runtime
  consumes SolverSigner only
```

Locked implication:

- adding a new provider should require a new adapter and runtime selection wiring, not a redesign of Agora core workflow packages
- in the current repo, app-layer adapter construction belongs in entrypoints such as `apps/cli`
- there is no dedicated hosted Telegram agent app yet; if one is added later, that new app should own its provider adapter construction
- CDP SDK imports should be isolated to the specific app-layer adapter module that builds a `SolverSigner`
- no other package in the repo should import the CDP SDK directly

### 6.5 Runtime Bootstrap Rule

Backend selection must happen at the app or bootstrap layer, not inside core workflow packages.

Rules:

- config chooses which signer adapter to construct
- the bootstrap layer builds the signer
- the bootstrap layer passes the signer into runtime calls
- core packages must not read provider-selection config to decide which wallet backend to use

Preferred shape:

```text
app bootstrap
  reads config
  selects adapter
  builds SolverSigner
  passes SolverSigner into runtime
```

Not allowed:

```text
@agora/chain or @agora/agent-runtime
  reads provider config
  constructs CDP or private-key clients internally
```

### 6.6 Injection Rule

The signer should be passed into top-level `@agora/agent-runtime` entrypoints as an explicit parameter, not hidden behind a new global singleton.

Rationale:

- easier testing
- easier mocking
- less hidden state
- cleaner future support for multiple runtime environments
- avoids turning every lower-level helper into plumbing code

Locked implication:

- test code should be able to pass a mock signer directly
- app bootstrap should own signer construction
- public runtime entrypoints should accept only the signer explicitly, not a larger wallet context object
- for Phase 1, those public runtime entrypoints are the top-level submit workflow entrypoint and the top-level claim workflow entrypoint
- internal helpers may receive the signer only where needed as it is threaded down
- core logic should consume the injected signer dependency explicitly
- provider name, wallet mode, transport type, and similar metadata may exist for debugging, but they must stay outside the required runtime API

---

## 7. Concrete Agora Implementation Plan

### Phase 0: Lock The Planning Model

Deliverables:

- this spec
- docs index update
- explicit confirmation that agent-owned stable wallets are the primary solver model

No code-path behavior changes.

### Phase 1: Introduce Signer Abstraction For Direct Transactions

Goal:

- support agent-owned server wallets without requiring Agora-hosted services to read raw private keys
- prove the abstraction against one real provider path: Coinbase CDP / Coinbase Dev Wallet

Scope:

- add a runtime signer abstraction in `@agora/chain` and `@agora/agent-runtime`
- make the top-level submit and claim workflow entrypoints accept an injected signer
- preserve the current private-key path only for local operator-controlled tooling
- support one first-class external provider path: CDP-backed direct account writes
- keep the provider surface modular so additional providers can be added later without redesigning the core interface

Expected supported accounts:

- local private-key EOAs
- CDP EOA-backed accounts
- any other provider that can expose a direct-transaction signer

Locked transport rule for Phase 1:

- Phase 1 supports direct transactions only
- smart-account or user-operation transport is explicitly deferred to Phase 2
- the signer interface should remain transport-agnostic so future adapters can map `writeContract(...)` onto user-op flows later without changing the runtime API

Locked Phase 1 interpretation:

- Agora will not attempt a multi-provider rollout in the first implementation phase
- Agora will ship a provider-neutral signer contract plus:
  - the existing private-key path for local tooling only
  - one real external provider path: Coinbase CDP / Coinbase Dev Wallet
- additional providers such as Privy, Turnkey, Crossmint, or Fireblocks should fit the same signer contract later

Planned changes:

- `packages/chain`
  - add a write adapter abstraction for challenge and factory writes
  - stop assuming `getWalletClient()` is the only source of writes
- `packages/agent-runtime`
  - accept a signer object or signer adapter instead of only `privateKey`
  - derive `solverAddress` from the signer abstraction
  - resolve the signer address once at flow start and reuse it for sealing, registration, and claimability checks
  - fail fast if any later critical step resolves a different signer address
- CLI and local stdio tooling
  - keep private-key path working for local self-custody use
  - add optional signer-adapter entry point later
- Agora-hosted agent services
  - must use remote signer adapters only
  - must not accept or load agent-owned raw private keys

No contract changes.

### Phase 1 Completion Definition

Phase 1 is only complete when an agent can use Telegram as the control plane and complete the full solver flow successfully with an agent-owned wallet.

Product-level definition of done:

1. the agent receives a solve instruction through Telegram
2. the agent uses its stable solver wallet address
3. the agent submits a solution to Agora successfully
4. the submission is registered and tracked correctly
5. if the agent wins, the same wallet can receive and claim the payout successfully end to end

For avoidance of doubt:

- a tx hash alone does not satisfy the definition of success
- submit and claim are only successful after confirmed onchain finality

Architecture work such as signer abstraction or adapter cleanup is necessary, but not sufficient by itself.

For hosted agent execution in Phase 1:

- the real production path is Coinbase CDP / Coinbase Dev Wallet
- local private-key tooling may remain for developer workflows, but does not satisfy the hosted-agent definition of done by itself

### Phase 1A: Common Denominator Rule

Phase 1 must optimize for the compatibility common denominator across providers.

That common denominator is:

- stable solver address
- contract write capability
- confirmation/finality capability

Agora must not bake provider-specific assumptions into the core workflow such as:

- CDP-specific account shapes
- vendor-specific policy models
- vendor-specific sponsorship semantics
- provider-specific authentication flows

CDP is the first concrete provider target, not the architectural center of gravity.

### Phase 1B: Runtime Selection Rule

For Phase 1, Agora uses one solver wallet backend per runtime.

Examples:

- this runtime uses local private-key signing for local operator-controlled tooling
- this runtime uses Coinbase CDP for hosted agent wallet execution

Agora will not support mixed per-agent backend selection in the same deployment during Phase 1.

Rationale:

- simpler configuration
- simpler testing
- simpler debugging
- one active code path per runtime
- sufficient for the first hosted CDP rollout

Illustrative configuration shape:

```bash
AGORA_SOLVER_WALLET_BACKEND=private_key
```

or

```bash
AGORA_SOLVER_WALLET_BACKEND=cdp
```

Rules:

- exactly one backend is active per runtime
- the backend selector should be a single enum-like config value loaded through `@agora/common` config, not ad hoc `process.env` checks scattered across apps
- Phase 1 should fail fast on missing or conflicting backend configuration
- if the selected backend's required credentials are missing or invalid, startup must fail immediately
- startup must not silently fall back from CDP to private-key mode, or vice versa
- per-agent or per-request backend routing is explicitly out of scope for Phase 1

Naming note:

- `AGORA_SOLVER_WALLET_BACKEND` is acceptable for a solver-only Phase 1
- if the same backend-selection mechanism is later reused for poster or oracle flows, it may be renamed to a broader key such as `AGORA_WALLET_BACKEND`

### Phase 1C: Failure Model

Phase 1 should expose a small explicit failure taxonomy with clear self-debug next actions.

Goal:

- let operators and agents distinguish config failures from signing failures, address mismatches, confirmation failures, and eligibility failures
- avoid surfacing raw provider, RPC, or SDK errors directly as the primary user-facing error
- preserve enough structured detail for logs and debugging

Minimum Phase 1 failure classes:

| Failure class | Meaning | Required next action guidance |
|---------------|---------|-------------------------------|
| `backend_config_invalid` | Selected backend is missing required config or has conflicting config | Check backend selection and required credentials, then restart the runtime |
| `signer_address_unavailable` | The configured signer could not produce a stable solver address | Verify the configured wallet/account and signer adapter wiring |
| `signer_address_mismatch` | The signer address changed between critical steps in the same flow | Check wallet rotation, changed credentials, or broken adapter wiring before retrying |
| `write_broadcast_failed` | The write could not be signed or sent, so no transaction hash was produced | Check wallet provider health, credentials, gas funding, and RPC connectivity |
| `write_not_confirmed` | A transaction hash exists, but the write did not confirm successfully onchain | Inspect the transaction hash onchain, understand the failure, then retry if appropriate |
| `claim_not_eligible` | The signer address is not currently eligible to claim the payout | Verify the finalized winning solver address and that the same wallet is being used |

Rules:

- all user-facing errors in this flow must include a suggested next action
- raw provider or RPC errors may be logged as supporting detail, but should not be the primary operator-facing message
- the error surface should provide enough information for an agent to self-debug without leaking custody material
- submit and claim should use the same failure model wherever the underlying condition is the same

### Phase 1D: Quality Proof

Phase 1 is not complete until the implementation is proven at three levels.

Required proof layers:

1. unit tests
2. workflow integration tests
3. one real CDP end-to-end validation

Minimum expectations:

- unit tests should cover the signer abstraction, address derivation rules, and failure mapping behavior
- workflow integration tests should cover submit and claim using an injected signer, including:
  - signer-derived solver identity
  - address mismatch fail-fast behavior
  - success only after confirmed finality
  - preservation of the existing intent-to-indexed-submission lifecycle
- the final acceptance check for Phase 1 should include one real CDP-backed agent wallet completing the full flow from control-plane instruction through onchain submit to payout claim

Rules:

- compile success alone is not sufficient
- mocked tests alone are not sufficient
- the Phase 1 definition of done is only satisfied once the real CDP path succeeds end to end

### Phase 2: Add Smart-Account Transport Support

Goal:

- support agent-owned smart accounts without changing solver identity semantics

Scope:

- allow submit and claim to resolve through `user_operation` transport
- support finality and receipt handling for smart-account writes

Expected supported accounts:

- CDP smart accounts
- Privy smart accounts
- Turnkey smart-account adapters where applicable
- wallet SDKs that expose a user-op sender with a stable beneficiary address

No contract changes.

### Phase 3: Add Wallet-Native Delegated Solver Mode

Goal:

- allow a human or organization to let an agent submit from a user-owned solver account

Scope:

- support delegated wallet adapters where the effective solver account remains stable
- keep payout beneficiary equal to the delegated wallet's account

Preferred approach:

- wallet-native delegation or advanced-permission flow first
- no Agora-specific protocol extension unless wallet-native delegation is insufficient

Contract changes:

- none by default

### Phase 4: Reopen Protocol-Level Delegation Only If Needed

This phase should happen only if Phase 3 proves insufficient.

Possible direction:

- an Agora-specific `submitFor(...)` or equivalent typed-authorization flow

If reopened, the authorization must bind:

- challenge address
- result hash
- fixed beneficiary
- authorized executor or relayer scope
- chain id
- nonce
- deadline

This is explicitly not part of the initial implementation plan.

---

## 8. Security Invariants

These invariants should not be weakened during implementation.

### 8.1 Stable Beneficiary

The solver account used for:

- sealing
- submission-intent creation
- onchain submit
- payout claimability checks

must resolve to one stable beneficiary account.

### 8.2 No Arbitrary Post-Hoc Payout Redirection

Agora should not let someone submit first and later choose an unrelated payout address without cryptographically binding that choice up front.

### 8.3 Exact Authorization For Delegated Flows

If Agora later supports protocol-level delegated submission, the authorization must be exact, replay-safe, and challenge-scoped.

"The agent was generally allowed to act for me" is not enough.

### 8.4 Policy Controls Belong Above The Protocol

Spend limits, approved contracts, time windows, and quorum rules are valuable, but they belong in wallet infrastructure or signer policy layers, not in Agora's core settlement logic.

### 8.5 Machine-Payment Protocols Are Optional Add-Ons

Using x402 or similar protocols for paid solver tooling must not become a prerequisite for solver submit or claim.

### 8.6 No Agent Private Keys In Agora-Hosted Services

Agora-hosted services must never:

- accept an agent-owned solver private key over API
- store an agent-owned solver private key in config
- log an agent-owned solver private key
- derive solver wallet support from raw key custody on Agora infrastructure

Local operator-controlled tooling may still support raw private keys as a self-custody development path, but that is a separate trust model from hosted agent wallet support.

---

## 9. Current Agora Gaps

### 9.1 What Already Works

- contracts are wallet-type neutral
- solver identity is already address-based
- claimability is already address-based
- sealed submissions already bind `solverAddress`

### 9.2 What Does Not Yet Exist

- a generic solver signer interface
- a provider-neutral adapter model for wallet writes
- explicit support for user-operation transports
- first-class wallet-native delegated solver flows

### 9.3 What Should Not Be Mistaken For Support

The web app listing `coinbaseWallet` in RainbowKit is not the same as first-class support for CDP server wallets in the agent runtime.

The current private-key path is not a complete wallet-compatibility strategy and does not satisfy the hosted-agent custody requirement.

---

## 10. Initial Decision Matrix

| Question | Decision |
|----------|----------|
| What is `V1`? | Agent-owned stable wallet |
| Does the current CDP dev wallet model qualify? | Yes, if it uses one stable solver account for submit and claim |
| What should Agora optimize for first? | Agent-owned stable wallet compatibility |
| Do we need contract changes for V1? | No |
| Do we need contract changes for smart accounts? | No |
| Do we need x402 / ACP / AP2 for solver submit? | No |
| Should Agora support delegated user wallets eventually? | Yes, but after agent-owned mode |
| Should Agora add arbitrary payout redirection now? | No |
| Should Agora-hosted services ever read agent-owned solver private keys? | No |

---

## 11. Open Questions

- Do we want to expose solver wallet mode or signer provider in public APIs, or keep that internal-only?
- Do we want a first-party CDP adapter in the repo, or only a generic signer interface plus integration examples?
- Do we want to support gas-sponsored submit for agents in the first smart-account milestone, or only basic user-op compatibility?
- At what point do we need public agent reputation or account labeling tied to solver wallets?
- Do we need solver-wallet rotation or recovery semantics for long-lived Telegram agents?

---

## 12. Bottom Line

Agora should align to the industry's common structure, not to one vendor:

- stable solver account
- secure signer backend
- transport-agnostic write path
- optional delegation layer

The correct first implementation target is:

- agent-owned stable wallets
- signer abstraction in the runtime
- CDP-compatible direct account support first
- smart-account transport second
- delegated user-wallet mode later

That path preserves the strength of Agora's existing escrow model while making agent wallets a first-class product surface.
