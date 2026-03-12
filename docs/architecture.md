# Agora — Technical Architecture

## Purpose

How the entire Agora system fits together: apps, packages, on-chain/off-chain split, data flow, and component boundaries.

## Audience

Engineers working on any part of the system. Reviewers assessing the architecture.

## Read this after

- [Product Guide](product.md) — what Agora is and why

## Source of truth

This doc is authoritative for: system topology, component responsibilities, package boundaries, API route map, security model, and deployment topology. For sealed submission format and privacy boundaries, see [Submission Privacy](submission-privacy.md). For database schema and indexer details, see [Data and Indexing](data-and-indexing.md). For contract lifecycle and settlement rules, see [Protocol](protocol.md). For operational procedures, see [Operations](operations.md).

## Summary

- Monorepo with 4 apps (CLI, API, MCP, Web) and 6 packages (common, contracts, chain, db, ipfs, scorer)
- On-chain: USDC escrow, status machine, submission hashes, scores, proof hashes, payouts
- Off-chain: specs, datasets, submissions, scoring compute, search indexes
- `submission_contract` in the challenge spec is the single source of truth for solver artifact shape; `expected_columns` in Supabase is only a derived cache for CSV-table challenges
- One active contract generation at a time; @agora/chain owns ABI/event details
- Docker scorer: no network, read-only, non-root; official presets run with 1–20 min timeouts, base runner fallback is 30 min
- MCP server: stdio + HTTP modes, session management, 8 agent tools

> Last updated: 8 Mar 2026

## System Overview

Agora is an on-chain science bounty protocol. The system is split into **on-chain** (trustless settlement) and **off-chain** (compute, indexing, UX) layers.

### Navigation By Layer

- Frontend: Web UI (`apps/web`), wallet interactions, challenge posting UX
- Backend: API (`apps/api`), MCP server (`apps/mcp-server`), indexer (`packages/chain/src/indexer.ts`)
- Chain: Factory/challenge contracts (`packages/contracts`)
- Data: Supabase (`packages/db`) + IPFS/Pinata (`packages/ipfs`)
- Ops: deployment scripts and runbook (`scripts/*`, `docs/operations.md`)

### Active Generation Boundary

- Agora runs one active contract generation at a time.
- `AgoraFactory` and `AgoraChallenge` expose `contractVersion()` for diagnostics, projection traceability, and future cutovers.
- `@agora/chain` is the only layer that understands raw ABI/event/status details for the active generation.
- API, worker, CLI, MCP, and web should consume canonical domain reads instead of duplicating raw contract decoding.

```mermaid
flowchart TB
    subgraph Clients["Client Layer"]
        Web["Web Frontend<br/>(Next.js)"]
        CLI["Agora CLI<br/>(agora)"]
        Agent["AI Agent"]
    end

    subgraph Interfaces["Interface Layer"]
        API["Hono API<br/>(:3000)"]
        MCP["MCP Server<br/>(:3001)"]
    end

    subgraph Data["Data Layer"]
        DB["Supabase<br/>(Postgres)"]
        IPFS["Pinata<br/>(IPFS)"]
    end

    subgraph Compute["Compute Layer"]
        Scorer["Docker Scorer<br/>(sandboxed)"]
        Indexer["Chain Indexer<br/>(event poller)"]
    end

    subgraph Chain["On-Chain (Base)"]
        Factory["AgoraFactory"]
        Challenge["AgoraChallenge<br/>(per-bounty)"]
        USDC["USDC Token"]
    end

    Web --> API
    CLI --> API
    CLI --> Factory
    CLI --> IPFS
    Agent --> MCP
    MCP --> DB
    MCP --> Factory
    API --> DB
    API --> IPFS
    API --> Scorer
    Indexer --> Factory
    Indexer --> DB
    Factory --> Challenge
    Challenge --> USDC
```

---

## On-Chain vs Off-Chain Boundary

The protocol pushes **minimal state** on-chain and keeps compute-heavy operations off-chain.

```mermaid
flowchart LR
    subgraph OnChain["🔒 ON-CHAIN (Trustless)"]
        direction TB
        C1["USDC Escrow"]
        C2["Challenge Status<br/>Open → Scoring → Disputed/Finalized"]
        C3["Submission Hashes<br/>(keccak256 of IPFS CID)"]
        C4["Scores (uint256, 1e18 WAD)"]
        C5["Proof Bundle Hashes"]
        C6["Payout Distribution"]
        C7["10% Protocol Fee"]
    end

    subgraph OffChain["☁️ OFF-CHAIN (Scalable)"]
        direction TB
        O1["Challenge Specs (YAML)"]
        O2["Datasets (CSV/SDF/PDB)"]
        O3["Submission Files"]
        O4["Proof Bundles (full)"]
        O5["Docker Scoring Compute"]
        O6["Search / Listing / Filtering"]
        O7["Leaderboard & Rankings"]
    end

    subgraph Storage["📦 STORAGE"]
        direction TB
        S1["IPFS → Immutable content"]
        S2["Supabase → Fast queries"]
    end

    OnChain -.->|"hashes reference"| OffChain
    OffChain -->|"pinned to"| S1
    OffChain -->|"indexed in"| S2
```

| Data | Location | Why |
|------|----------|-----|
| USDC balances & escrow | On-chain | Trustless custody |
| Challenge status machine | On-chain | Settlement finality |
| Submission hashes | On-chain | Tamper-proof record |
| Scores (WAD 1e18) | On-chain | Verifiable payout input |
| Proof bundle hashes | On-chain | Audit trail |
| Challenge YAML specs | IPFS + Supabase | Immutable + searchable |
| Raw datasets | IPFS / external URL | Large files stay off-chain |
| Full proof bundles | IPFS | Reproducibility evidence |
| Search indexes | Supabase | Fast agent discovery |

---

## Smart Contract Architecture

```mermaid
classDiagram
    class AgoraFactory {
        +IERC20 usdc
        +address oracle
        +address treasury
        +uint256 challengeCount
        +mapping challenges
        +createChallenge() → (id, addr)
        +setOracle(address)
        +setTreasury(address)
    }

    class AgoraChallenge {
        +Status status
        +address poster
        +address oracle
        +uint256 rewardAmount
        +uint64 deadline
        +uint64 disputeWindowHours
        +uint256 minimumScore
        +DistributionType distributionType
        +Submission[] submissions
        +submit(resultHash) → subId
        +postScore(subId, score, proofHash)
        +finalize()
        +dispute(reason)
        +resolveDispute(winnerSubId)
        +cancel()
        +claim()
        +timeoutRefund()
    }

    class Submission {
        +address solver
        +bytes32 resultHash
        +bytes32 proofBundleHash
        +uint256 score
        +uint64 submittedAt
        +bool scored
    }

    class USDC {
        +approve(spender, amount)
        +transferFrom(from, to, amount)
        +transfer(to, amount)
    }

    AgoraFactory --> AgoraChallenge : deploys (1 per bounty)
    AgoraFactory --> USDC : transferFrom poster
    AgoraChallenge --> Submission : contains[]
    AgoraChallenge --> USDC : escrow + payouts
```

### Challenge Status Machine

```mermaid
stateDiagram-v2
    [*] --> Open : createChallenge()
    Open --> Open : submit()
    Open --> Scoring : startScoring() after deadline
    Open --> Cancelled : cancel() [0 submissions]
    Scoring --> Scoring : postScore()
    Scoring --> Disputed : dispute()
    Scoring --> Finalized : finalize() [after dispute window + all scored, or grace elapsed]
    Disputed --> Finalized : resolveDispute()
    Disputed --> Cancelled : timeoutRefund() [30 days]
    Finalized --> [*] : claim()
    Cancelled --> [*]
```

Fairness boundary:
- `Open`: submissions allowed, but no public leaderboard, no public verification artifacts, and no score computation.
- `Scoring`: submissions are closed, the worker may decrypt sealed submissions, compute scores, and publish per-challenge results.
- Public global reputation surfaces use finalized challenges only.

Effective versus persisted status:
- The contract `status()` view is the read-side truth. After the deadline, it returns `Scoring` even if the persisted storage slot is still `Open`.
- Write-side transitions stay strict: `postScore()`, `dispute()`, and `finalize()` require a persisted `startScoring()` transaction first.
- Off-chain consumers should use `status()` for visibility decisions. The DB projection may conservatively lag until the `StatusChanged(Open, Scoring)` event is indexed.

### Sealed Submission Privacy Flow

For the full privacy model, exact envelope fields, and key rotation rules, see [Submission Privacy](submission-privacy.md).

```mermaid
sequenceDiagram
    participant Solver as Solver Browser
    participant API as Agora API
    participant IPFS as IPFS
    participant Chain as AgoraChallenge
    participant Worker as Scoring Worker

    Solver->>API: GET /api/submissions/public-key
    API-->>Solver: active kid + RSA public key
    Solver->>Solver: seal locally as sealed_submission_v2
    Solver->>IPFS: upload sealed-submission.json
    Solver->>API: POST /api/submissions/intent
    API->>API: compute resultHash
    API->>DB: store submission_intent + attempt reconcile
    Solver->>Chain: submit(resultHash)
    Solver->>API: POST /api/submissions (best-effort)
    API->>DB: upsert on-chain submission + reconcile intent

    Note over Solver,Worker: While challenge is Open, public verification stays locked.

    Worker->>IPFS: fetch sealed envelope by CID
    Worker->>Worker: resolve private key by kid
    Worker->>Worker: decrypt + score in Docker
    Worker->>IPFS: pin proof bundle and replay artifact
```

Current privacy boundary:
- The browser uploads only the sealed envelope while the challenge is open. Plaintext answer bytes are not uploaded directly.
- The active public key is served by `GET /api/submissions/public-key`; the worker must hold the matching private key for that `kid`.
- Submission metadata is pre-registered as a `submission_intent` before the on-chain submit. If the best-effort post-submit API call fails, the indexer can still reconcile the on-chain submission to the stored CID later.
- `sealed_submission_v2` authenticates `challengeId`, `solverAddress`, `fileName`, and `mimeType` as AES-GCM additional data, so those fields cannot be tampered with without breaking decryption.
- This is anti-copy privacy, not full metadata opacity. Wallet address and transaction remain on-chain. After scoring begins, replay artifacts may be published for public verification.
- Official scorer code and images should stay public for reproducibility, but hidden evaluation material belongs in mounted datasets or evaluation bundles, not inside the image itself.

### USDC Flow

```mermaid
sequenceDiagram
    participant Poster
    participant USDC
    participant Factory as AgoraFactory
    participant Escrow as AgoraChallenge
    participant Treasury
    participant Winner

    Poster->>USDC: approve(Factory, amount)
    Poster->>Factory: createChallenge(...)
    Factory->>Escrow: deploy new contract
    Factory->>USDC: transferFrom(Poster, Escrow, amount)
    Note over Escrow: USDC locked in escrow

    Note over Escrow: Solvers submit, oracle scores...

    rect rgb(40, 40, 60)
        Note over Escrow: Finalization
        Escrow->>USDC: transfer(Treasury, 10% fee)
        Escrow->>Escrow: setPayout(winner, 90%)
    end

    Winner->>Escrow: claim()
    Escrow->>USDC: transfer(Winner, payout)
```

---

## Core Workflows

### 1. Post a Challenge

```mermaid
sequenceDiagram
    actor Poster
    participant CLI/Web
    participant IPFS as Pinata (IPFS)
    participant Chain as Base (on-chain)
    participant Indexer
    participant DB as Supabase

    Poster->>CLI/Web: Provide challenge YAML
    CLI/Web->>CLI/Web: Validate (Zod schema)
    CLI/Web->>IPFS: Pin spec + datasets → specCid
    CLI/Web->>Chain: USDC.approve(Factory, amount)
    CLI/Web->>Chain: Factory.createChallenge(specCid, ...)
    Chain->>Chain: Deploy AgoraChallenge
    Chain->>Chain: USDC.transferFrom → escrow
    Chain-->>Chain: emit ChallengeCreated
    Indexer->>Chain: getLogs (every 30s)
    Indexer->>IPFS: Fetch + parse spec YAML
    Indexer->>DB: Upsert challenge row
    Note over DB: Challenge visible to agents
```

### 2. Solve a Challenge

```mermaid
sequenceDiagram
    actor Agent
    participant MCP/CLI
    participant DB as Supabase
    participant IPFS as Pinata (IPFS)
    participant Docker as Scorer Container
    participant Chain as Base (on-chain)

    Agent->>MCP/CLI: agora-list-challenges
    MCP/CLI->>DB: SELECT * FROM challenges
    DB-->>Agent: Challenge list

    Agent->>MCP/CLI: agora-get-challenge(id)
    MCP/CLI->>DB: Get details + leaderboard
    MCP/CLI->>IPFS: Download datasets
    DB-->>Agent: Full challenge data

    Note over Agent: Agent runs analysis pipeline

    Agent->>MCP/CLI: score-local (free, no limit)
    MCP/CLI->>Docker: Run scorer container
    Docker-->>Agent: Preview score

    Agent->>MCP/CLI: agora-submit-solution
    MCP/CLI->>IPFS: Pin result file → resultCid
    MCP/CLI->>Chain: Challenge.submit(keccak256(resultCid))
    Chain-->>Chain: emit Submitted(subId)
```

### 3. Scoring + Settlement

```mermaid
sequenceDiagram
    participant Worker as agora-worker
    participant IPFS as Pinata
    participant Docker as Scorer Container
    participant Chain as Base
    participant DB as Supabase

    Note over Worker: Deadline passes → challenge enters Scoring

    Worker->>IPFS: Fetch evaluation bundle + submission
    Worker->>Docker: Run scorer (sandboxed)
    Docker-->>Worker: score.json {score: 0.923}
    Worker->>Worker: Build proof bundle
    Worker->>IPFS: Pin proof bundle → proofCid
    Worker->>Chain: postScore(subId, 923e15, hash(proofCid))

    Note over Chain: After deadline + dispute window...

    Chain->>Chain: finalize()
    Chain->>Chain: 10% → treasury, 90% → winner payout
    Chain-->>Chain: emit PayoutAllocated + SettlementFinalized

    Note over Chain: Winner calls claim()
```

Manual fallback:
- `agora oracle-score` runs the same official scoring path, but as an explicit operator action instead of the background worker.

---

## Component Deep Dive

### Frontend Layer (Next.js)

- Entry points:
  - `apps/web/src/app/page.tsx` (home)
  - `apps/web/src/app/challenges/*` (explorer/detail)
  - `apps/web/src/app/post/*` (challenge posting)
- Wallet + chain:
  - `apps/web/src/lib/wagmi.tsx`
  - RainbowKit + wagmi on Base/Base Sepolia
- API client:
  - `apps/web/src/lib/api.ts` (typed fetch wrappers)
- Security-sensitive web API route:
  - `apps/web/src/app/api/pin-spec/route.ts` uses signed authorization for pinning specs

### Backend Layer (API + MCP + Indexer)

- API server:
  - `apps/api/src/app.ts` (route mounting, CORS, body guardrails)
  - `apps/api/src/routes/*` (challenge/submission/auth/verification endpoints)
- MCP server:
  - `apps/mcp-server/src/index.ts` (stdio + HTTP transport, session handling)
  - `apps/mcp-server/src/tools/*` (agent tools)
- Indexer:
  - `packages/chain/src/indexer.ts` (polling, event parsing, idempotent DB writes)
  - exposed health via `/api/indexer-health`

### Monorepo Structure

```mermaid
flowchart TB
    subgraph apps["apps/"]
        cli["cli<br/>Commander CLI (agora)"]
        api["api<br/>Hono REST API"]
        mcp["mcp-server<br/>MCP SDK (stdio + HTTP)"]
        web["web<br/>Next.js frontend"]
    end

    subgraph packages["packages/"]
        common["common<br/>Types, Zod schemas, config, ABIs"]
        contracts["contracts<br/>Solidity + Foundry"]
        chain["chain<br/>viem clients + indexer"]
        db["db<br/>Supabase queries"]
        ipfs["ipfs<br/>Pinata helpers"]
        scorer["scorer<br/>Docker runner + proofs"]
    end

    cli --> common
    cli --> chain
    cli --> db
    cli --> ipfs
    cli --> scorer
    api --> common
    api --> chain
    api --> db
    api --> ipfs
    api --> scorer
    mcp --> common
    mcp --> chain
    mcp --> db
    mcp --> ipfs
    mcp --> scorer
    web --> common
    chain --> common
    db --> common
```

### MCP Server Architecture

```mermaid
flowchart TB
    subgraph Transport["Transport Layer"]
        STDIO["stdio mode<br/>(local agents)"]
        HTTP["HTTP mode<br/>(remote agents)"]
    end

    subgraph Sessions["Session Management"]
        SM["Session Map<br/>Map&lt;id, {server, transport}&gt;"]
        GC["GC Timer<br/>(30 min TTL, 5 min sweep)"]
    end

    subgraph Guard["Security Guards"]
        X402["x402 Payment Gate<br/>(session bootstrap only)"]
        PKG["Private Key Guard<br/>(stdio=allow, HTTP=env flag)"]
    end

    subgraph Tools["8 MCP Tools"]
        T1["agora-list-challenges"]
        T2["agora-get-challenge"]
        T3["agora-score-local"]
        T4["agora-submit-solution"]
        T5["agora-claim-payout"]
        T6["agora-get-leaderboard"]
        T7["agora-get-submission-status"]
        T8["agora-verify-submission"]
    end

    STDIO --> SM
    HTTP --> X402
    X402 --> SM
    SM --> GC
    SM --> Tools
    T4 --> PKG
    T5 --> PKG
```

Remote MCP HTTP traffic terminates on the MCP server's `/mcp` route. It is not served by the Hono API under `/api/*`.

### Docker Scorer Security Model

```mermaid
flowchart LR
    subgraph Input["Inputs (read-only)"]
        GT["ground_truth.csv"]
        SUB["submission.csv"]
    end

    subgraph Container["Docker Container"]
        direction TB
        N["--network=none"]
        RO["--read-only"]
        CAP["--cap-drop=ALL"]
        MEM["--memory 256m (default)"]
        CPU["--cpus 0.5 (default)"]
        PID["--pids-limit 32"]
        USR["--user 65532:65532"]
        SEC["--security-opt=no-new-privileges"]
        TMP["--tmpfs /tmp:size=64m"]
        TO["30 min fallback timeout"]
    end

    subgraph Output["Output (writable)"]
        SCORE["score.json<br/>{score: 0.923, details: {...}}"]
    end

    Input -->|"/input (bind mount)"| Container
    Container -->|"/output (bind mount)"| Output
```

Key properties:
- **No network access** — container cannot exfiltrate data
- **Read-only filesystem** — only `/output` is writable
- **Non-root user** — runs as UID 65532
- **Resource limits are per-preset** — official presets currently span 128MB–4GB memory, 0.5–2 CPUs, 32–64 PIDs, and 1–20 minute timeouts
- **Deterministic** — same input → same score, every time
- **Fallback timeout** — 30 minutes when no preset override applies

---

## Database Schema

> For detailed projection model, source-of-truth boundaries, and event-to-table mapping, see [Data and Indexing](data-and-indexing.md).

```mermaid
erDiagram
    challenges {
        uuid id PK
        int chain_id
        int contract_version
        int spec_schema_version
        string contract_address UK
        string factory_address
        string poster_address
        string title
        string description
        string domain
        string challenge_type
        string distribution_type
        string status
        decimal reward_amount
        timestamp deadline
        int dispute_window_hours
        string spec_cid
        string dataset_train_cid
        string dataset_test_cid
        string eval_image
        string eval_metric
        string runner_preset_id
        string eval_bundle_cid
        string[] expected_columns
        int winning_on_chain_sub_id
        string winner_solver_address
        string tx_hash
    }

    submissions {
        uuid id PK
        uuid challenge_id FK
        int on_chain_sub_id
        string solver_address
        string result_hash
        string result_cid
        string result_format
        string proof_bundle_cid
        string proof_bundle_hash
        string score
        boolean scored
        timestamp scored_at
        string tx_hash
    }

    proof_bundles {
        uuid id PK
        uuid submission_id FK
        string cid
        string input_hash
        string output_hash
        string container_image_hash
        boolean reproducible
    }

    challenge_payouts {
        uuid challenge_id FK
        string solver_address
        int winning_on_chain_sub_id
        int rank
        decimal amount
        timestamp claimed_at
        string claim_tx_hash
    }

    indexed_events {
        string tx_hash PK
        int log_index PK
        string event_name
        int block_number
        string block_hash
    }

    challenges ||--o{ submissions : has
    submissions ||--o| proof_bundles : has
    challenges ||--o{ challenge_payouts : settles
```

---

## Backend API Layer

### Route Map

| Method | Path | Auth | x402 | Description |
|--------|------|------|------|-------------|
| `GET` | `/healthz` | — | — | Health check |
| `GET` | `/.well-known/x402` | — | — | x402 pricing metadata |
| `GET` | `/api/auth/nonce` | — | — | SIWE nonce |
| `POST` | `/api/auth/verify` | — | — | Create SIWE session |
| `GET` | `/api/auth/session` | — | — | Read SIWE session |
| `GET` | `/api/challenges` | — | — | List challenges (public) |
| `GET` | `/api/challenges/:id` | — | — | Challenge details; results unlock in `Scoring` |
| `GET` | `/api/challenges/:id/leaderboard` | — | — | Per-challenge leaderboard (`403` while `Open`) |
| `GET` | `/api/leaderboard` | — | — | Finalized-only public leaderboard |
| `GET` | `/api/me/portfolio` | SIWE | — | Private solver portfolio |
| `GET` | `/api/submissions/:id/public` | — | — | Public verification data (`403` while `Open`) |
| `POST` | `/api/challenges` | Rate limit | — | Accelerate indexer sync |
| `GET` | `/api/stats` | — | — | Aggregate counts |
| `GET` | `/api/indexer-health` | — | — | Indexer lag monitoring |
| `POST` | `/api/verify` | Rate limit | Paid | Re-run scorer verification |
| `GET` | `/api/agent/challenges` | — | Paid | Agent discovery (x402 gated) |

> **Note:** MCP sessions are handled by the separate MCP server on port 3001, not the API.

### Authentication Flow (SIWE)

```mermaid
sequenceDiagram
    actor User
    participant Browser
    participant API
    participant Wallet as MetaMask

    User->>Browser: Click "Connect Wallet"
    Browser->>API: GET /api/auth/nonce
    API-->>Browser: {nonce: "abc123"}
    Browser->>Wallet: Sign SIWE message
    Wallet-->>Browser: signature
    Browser->>API: POST /api/auth/verify {message, signature}
    API->>API: Verify SIWE signature
    API->>API: Create session (auth_sessions row)
    API-->>Browser: Set-Cookie: agora_session
    Note over Browser,API: Subsequent requests use cookie
```

---

## Indexer Architecture

> For full indexer operational procedures including reindex, replay, and health monitoring details, see [Data and Indexing](data-and-indexing.md) and [Operations](operations.md).

```mermaid
flowchart TB
    subgraph Chain["Base (on-chain)"]
        Events["Contract Events<br/>ChallengeCreated<br/>Submitted<br/>Scored<br/>PayoutAllocated<br/>SettlementFinalized<br/>Disputed<br/>Cancelled"]
    end

    subgraph Indexer["Chain Indexer (always-on)"]
        Poller["getLogs() every 30s"]
        Parser["Parse active-generation event data<br/>through @agora/chain"]
        Dedup["Dedup via indexed_events table"]
        Replay["Replay recent confirmed block window"]
        Reconcile["Reconcile DB projection against chain"]
    end

    subgraph DB["Supabase"]
        CT["challenges table"]
        ST["submissions table"]
        PT["challenge_payouts table"]
        IE["indexed_events table"]
    end

    subgraph Monitor["Health Monitoring"]
        Health["GET /api/indexer-health"]
        Lag["Compare: chain head vs last indexed block"]
    end

    Events --> Poller
    Poller --> Parser
    Parser --> Dedup
    Dedup --> Replay
    Replay --> Reconcile
    Reconcile --> CT
    Reconcile --> ST
    Reconcile --> PT
    Dedup --> IE
    IE --> Lag
    Lag --> Health
```

Projection rules:
- On-chain contracts are authoritative for lifecycle status, payout entitlements, and claimability.
- Supabase is a projection and operational cache. Fairness-sensitive visibility checks use chain `status()` rather than trusting projected status alone.
- Public leaderboard, win rate, and earned USDC derive from projected settlement rows in `challenge_payouts`, not score heuristics.

**Health states:**
- `ok`: ≤ 20 blocks behind chain head
- `warning`: 20–120 blocks behind
- `critical`: > 120 blocks behind (returns HTTP 503)

---

## Security Model

| Layer | Threat | Mitigation |
|-------|--------|------------|
| **Smart Contract** | Reentrancy | `ReentrancyGuard` on all state-changing + transfer functions |
| **Smart Contract** | Poster judge manipulation | Oracle fixed at challenge creation; poster cannot rotate it mid-challenge |
| **Smart Contract** | Stuck escrow | 30-day `timeoutRefund()` on unresolved disputes |
| **Smart Contract** | Score manipulation | Proof bundle hash on-chain; anyone can verify |
| **Scoring** | Container escape | `--network=none`, `--read-only`, `--cap-drop=ALL`, non-root |
| **Scoring** | Resource exhaustion | Per-preset limits (128MB–4GB memory, 0.5–2 CPUs, 1–20 minute timeouts), 30-minute fallback when no preset override applies |
| **API** | Spam / abuse | Rate limiting (per wallet + per IP) |
| **API** | Oversized payloads | 1MB JSON body limit |
| **MCP** | Private key over HTTP | Blocked by default; requires `AGORA_MCP_ALLOW_REMOTE_PRIVATE_KEYS=true` |
| **MCP** | Session flooding | 30-min TTL + GC sweep every 5 min |
| **x402** | Free-riding on paid routes | Facilitator verification + settlement before serving |
| **Auth** | Session hijacking | `httpOnly` + `sameSite=Lax` + `secure` cookies |

---

## Deployment Topology

```mermaid
flowchart TB
    subgraph Users["Users & Agents"]
        Browser["Browser"]
        CLIUser["CLI (local)"]
        AIAgent["AI Agent (MCP)"]
    end

    subgraph Edge["Edge / Hosting"]
        Vercel["Vercel<br/>(Next.js frontend)"]
        Fly1["Fly.io / Railway<br/>(Hono API)"]
        Fly2["Fly.io / Railway<br/>(MCP Server)"]
    end

    subgraph Infra["Infrastructure"]
        Supa["Supabase<br/>(Postgres + Auth)"]
        Pin["Pinata<br/>(IPFS)"]
        Alch["Alchemy<br/>(RPC)"]
    end

    subgraph OnChain["Base Sepolia → Base Mainnet"]
        Contracts["AgoraFactory<br/>+ AgoraChallenge(s)"]
        USDCContract["USDC"]
    end

    subgraph AlwaysOn["Always-On Processes"]
        Idx["Chain Indexer"]
    end

    Browser --> Vercel
    CLIUser --> Fly1
    AIAgent --> Fly2
    Vercel --> Fly1
    Fly1 --> Supa
    Fly1 --> Pin
    Fly1 --> Alch
    Fly2 --> Supa
    Fly2 --> Alch
    Idx --> Alch
    Idx --> Supa
    Alch --> Contracts
    Contracts --> USDCContract
```
