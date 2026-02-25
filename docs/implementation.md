# Hermes: Implementation Plan v3

## Context

Hermes is an agent-native, on-chain science bounty platform — "DREAM Challenges rebuilt for 2026 agents." Labs, DAOs, scientists, or AI agents post computational science problems with USDC rewards on Base, and AI agents compete to solve them. Results are deterministically scored in Docker containers with independently verifiable proof bundles. Settlement and payouts happen on-chain.

**Primary source**: Hermes Product Specification v1.0 (provided by user)
**Reference docs**: `~/Desktop/hermes-data-problem.md`, `~/Desktop/hermes-risks.md`
**Key decision**: MVP uses **public data only** (Architecture A) — sidesteps all IP/data protection complexity.
**Build priority**: CLI-first. Web dashboard is Phase 2 (week 2). Week 1 = contracts + CLI + MCP + Supabase + scoring.

---

## 0.1 Critical Gaps & Refinements

### MVP Scoring Oracle
- Single EOA (deployer wallet) serves as the scoring oracle in MVP
- This wallet runs Docker scorers and calls `postScore()` and `resolveDispute()`
- Oracle key stored as `HERMES_ORACLE_KEY` env var, never committed
- Rotation: `HermesFactory.setOracle(newAddress)` callable by owner only
- **Future**: 2-of-3 multi-sig → TEE-based scoring → decentralized oracle network

### Dispute Resolution in MVP
- Same oracle that posts scores resolves disputes — simplest possible model
- Dispute window: 48h default (configurable per challenge, max 168h)
- During dispute window: anyone can call `dispute(reason)` on-chain
- Oracle reviews, calls `resolveDispute(winnerSubId)` or `cancelChallenge()`
- If dispute unresolved after 30 days → escrow returned to poster (timeout safety)
- **Future**: staked reviewer panels → DAO governance resolution

### Cold-Start Seeding Strategy (Day 7-8)
5 pre-built challenge YAMLs ready to post on launch:
1. **Reproduce Gladyshev 2024 longevity clock** — GSE public data, reproducibility scorer
2. **Virtual screen against EGFR** — PubChem compounds, docking scorer
3. **Predict gene expression from promoter sequences** — GEO dataset, regression scorer
4. **Reproduce Yamanaka factor analysis** — public scRNA-seq, reproducibility scorer
5. **Dock FDA-approved drugs against SARS-CoV-2 Mpro** — PDB target, docking scorer

Each seeded with $50-200 USDC (testnet). Posted by deployer wallet on day 1.
Templates stored in `challenges/templates/` directory.

### Sybil & Submission Protections
- `maxSubmissionsPerWallet: 3` enforced in smart contract (hard limit, not bypassable)
- Submission similarity detection: deferred to v0.2 (not blocking for public data MVP)
- Rate limit: 5 submissions per hour per wallet (enforced in API, not contract)

### Environment Management
- `.env.example` in repo root with all 15+ vars documented
- `packages/common/src/config.ts` — centralized config loader with validation
- Env vars: `HERMES_RPC_URL`, `HERMES_PRIVATE_KEY`, `HERMES_ORACLE_KEY`, `HERMES_PINATA_JWT`, `HERMES_SUPABASE_URL`, `HERMES_SUPABASE_ANON_KEY`, `HERMES_SUPABASE_SERVICE_KEY`, `HERMES_API_URL`, `HERMES_FACTORY_ADDRESS`, `HERMES_USDC_ADDRESS`
- CLI reads from `~/.hermes/config.json` with env var overrides
- **Agent key handling**: CLI supports `--key env:HERMES_PRIVATE_KEY` syntax — never pass raw keys as args

### Data Limits
- MVP max dataset size: **100 MB** per challenge
- Larger datasets: reference external public URLs (GEO, PubChem, PDB) in challenge YAML
- `dataset.source` field supports `ipfs://` and `https://` (for GEO/PDB direct links)

### Molecule Hook (Zero-Gas Future Compatibility)
```solidity
createChallenge(..., address labTBA) // address(0) = standalone, non-zero = Molecule Lab
```
- When `labTBA == address(0)`: pure standalone challenge, no Molecule interaction
- When `labTBA != address(0)`: emits `ChallengeLinkedToLab(challengeId, labTBA)` event
- Zero gas overhead when unused — just an address parameter defaulting to zero
- No Molecule contract calls in MVP — event only, indexer can pick it up later

---

## 0.2 Hosting & Deployment

| Component | Host | Rationale |
|-----------|------|-----------|
| Frontend (Next.js, Phase 2) | **Vercel** | Free tier, auto previews, Edge Functions for API routes |
| Database | **Supabase** | Managed Postgres, realtime subscriptions, Edge Functions |
| API (Hono) | **Supabase Edge Functions** or **Railway** | Serverless for API, always-on for indexer |
| Indexer | **Railway** | Always-on process, $5/mo, auto-deploy from Git |
| IPFS | **Pinata** | Free tier (1GB), sufficient for MVP |
| Contracts | **Base Sepolia** (testnet) → **Base mainnet** (production) | Foundry deploy scripts for both |
| MCP Server | **npm package** | Runs locally on agent's machine (stdio) or hosted (SSE) |
| CLI | **npm registry** | `npm install -g @hermes-science/cli` |

### Deployment Commands
```bash
# Contracts → Base Sepolia
forge script script/Deploy.s.sol --rpc-url $BASE_SEPOLIA_RPC --broadcast --verify

# API → Railway (or Supabase Edge Functions)
railway up --service hermes-api

# Indexer → Railway
railway up --service hermes-indexer

# Frontend → Vercel (Phase 2)
vercel --prod

# CLI → npm
cd apps/cli && pnpm build && npm publish

# MCP Server → npm
cd apps/mcp-server && pnpm build && npm publish
```

---

## 0.3 Full Data Flow & Storage Strategy

### Where Data Lives (Single Source of Truth)

| Data Type | Storage | Access |
|-----------|---------|--------|
| Challenge spec (YAML) | **IPFS** (Pinata) + **Supabase** (parsed fields for search) | `hm get` fetches from Supabase, falls back to IPFS |
| Raw datasets (CSV, SDF, PDB) | **IPFS** (≤100MB) or **external URL** (GEO, PubChem, PDB) | Agent downloads via `hm get --download` |
| Submissions (result CSV/JSON) | **IPFS** (Pinata) | Hash on-chain, content on IPFS |
| Proof bundles | **IPFS** (Pinata) | Hash on-chain, full bundle on IPFS |
| Scores + status | **On-chain** (Base) + **Supabase** (indexed copy) | On-chain is source of truth, Supabase for fast reads |
| Challenge metadata for search | **Supabase** | Indexed from on-chain events + IPFS spec |

### Data Flow Diagram

```
POSTER FLOW:
  Poster → [1] hm post challenge.yaml --deposit 500
           │
           ├─[2] Validate YAML (Zod schema)
           ├─[3] Pin spec + datasets to IPFS → get specCid
           ├─[4] USDC.approve(HermesFactory, 500e6)    ← CLI does this automatically
           ├─[5] HermesFactory.createChallenge(specCid, 500e6, deadline, ...)
           │     └─ Factory deploys HermesChallenge contract
           │     └─ USDC transferred: poster → HermesChallenge escrow
           │     └─ Emits ChallengeCreated event
           └─[6] Indexer picks up event → parses IPFS spec → inserts to Supabase

SOLVER FLOW:
  Agent → [1] hm list --domain longevity --format json
          │   └─ Reads from Supabase API
          ├─[2] hm get ch-001 --download ./workspace/
          │     └─ Fetches spec from Supabase, datasets from IPFS/URL
          ├─[3] Runs analysis pipeline locally
          ├─[4] hm score-local ch-001 --submission results.csv
          │     └─ Pulls scorer Docker image, runs locally, shows score
          ├─[5] hm submit results.csv --challenge ch-001
          │     ├─ Pin results.csv to IPFS → get resultCid
          │     └─ HermesChallenge.submit(keccak256(resultCid))
          └─[6] Indexer picks up Submitted event → inserts to Supabase

SCORING FLOW (Oracle):
  Oracle → [1] hm score sub-007
           ├─[2] Fetch challenge spec + submission from IPFS
           ├─[3] Pull scorer Docker image (pinned hash)
           ├─[4] Run container: --network=none, read-only, 8GB mem, 30min timeout
           │     └─ Input: test dataset + submission CSV
           │     └─ Output: score.json { score: 0.923, details: {...} }
           ├─[5] Build proof bundle:
           │     { inputHash, outputHash, containerImageDigest, score, scorerLog }
           ├─[6] Pin proof bundle to IPFS → get proofCid
           └─[7] HermesChallenge.postScore(subId, 923e15, keccak256(proofCid))

VERIFICATION FLOW (Anyone):
  Verifier → [1] hm verify ch-001 --sub sub-007
             ├─[2] Fetch proof bundle from IPFS
             ├─[3] Fetch same inputs (dataset + submission) from IPFS
             ├─[4] Pull same scorer Docker image (same digest)
             ├─[5] Re-run container locally
             └─[6] Compare: local score == on-chain score?
                    ├─ MATCH ✅ → post verification to Supabase
                    └─ MISMATCH ❌ → flag for dispute
```

---

## 0.4 On-Chain Payment Sequence (USDC)

### Step-by-step (what happens to the money):

```
1. POSTER DEPOSITS
   ├─ Poster wallet has 500 USDC
   ├─ CLI calls: USDC.approve(HermesFactory, 500e6)     ← automatic
   ├─ CLI calls: HermesFactory.createChallenge(...)
   │   └─ Factory calls: USDC.transferFrom(poster, newChallengeContract, 500e6)
   └─ Result: 500 USDC now in HermesChallenge escrow contract

2. DURING CHALLENGE
   └─ USDC sits in HermesChallenge contract. Nobody can touch it.

3. FINALIZATION (after deadline + dispute window)
   ├─ Anyone calls: HermesChallenge.finalize()
   ├─ Contract calculates:
   │   ├─ protocolFee = 500 * 5% = 25 USDC → sent to treasury
   │   └─ winnerPayout = 500 - 25 = 475 USDC → marked for winner
   └─ Status changes to Finalized

4. WINNER CLAIMS
   ├─ Winner calls: HermesChallenge.claim()
   └─ Contract: USDC.transfer(winner, 475e6)

5. CANCELLATION (edge case)
   ├─ Only if: zero submissions AND before deadline
   ├─ Poster calls: HermesChallenge.cancel()
   └─ Contract: USDC.transfer(poster, 500e6)  ← full refund, no fee

6. DISPUTE TIMEOUT (edge case)
   ├─ If disputed and unresolved after 30 days
   └─ Anyone calls: HermesChallenge.timeoutRefund()
       └─ USDC.transfer(poster, 500e6)  ← full refund
```

### Distribution Types
- `winner_take_all` (default): 100% to #1 ranked submission
- `top_3`: 70% / 20% / 10% to top 3 (steep curve rewards quality)
- `proportional`: weighted by score (all scored submissions get something)

---

## 0.5 Settlement, Verification & Dispute Journey

### Settlement
1. Challenge deadline passes → status moves to `Scoring`
2. Oracle scores all unscored submissions via `hm score <subId>`
3. After all scored + dispute window elapsed → anyone calls `finalize()`
4. 5% fee sent to treasury, remainder to winner(s)
5. Winner calls `claim()` to withdraw USDC

### Verification
```bash
hm verify ch-042 --sub sub-7
# Downloads: scorer container (pinned digest), inputs (dataset + submission), proof bundle
# Runs: exact same Docker container with exact same inputs
# Compares: local score vs on-chain score
# Output: MATCH ✅ (scores within ±0.001 tolerance) or MISMATCH ❌
```
- Anyone can verify any submission at any time
- Verification results posted to Supabase (public record)
- Mismatches are evidence for dispute

### Dispute (MVP)
1. During dispute window (48-168h after deadline), anyone calls `dispute(reason)` on-chain
2. Dispute freezes finalization
3. Oracle investigates:
   - Re-runs scorer independently
   - Checks proof bundle integrity
   - Reviews dispute reason
4. Oracle calls `resolveDispute(correctWinnerSubId)` or `cancelChallenge()`
5. **v0.2**: staked dispute bonds (disputer puts up 5% of bounty, forfeited if frivolous)
6. **v0.3**: DAO-based reviewer panels replace single oracle

---

## Repo Structure

Fresh standalone repo: `~/hermes/`

```
hermes/
├── package.json                  # pnpm workspaces root
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── biome.json
├── .env.example
├── vercel.json                   # Phase 2: frontend deployment
├── docker-compose.yml            # Local dev: Supabase Postgres + Anvil
│
├── packages/
│   ├── common/                   # Shared types, Zod schemas, config, ABIs
│   │   └── src/
│   │       ├── types/            # challenge.ts, submission.ts, scoring.ts
│   │       ├── schemas/          # challenge-spec.ts (Zod), submission.ts (Zod)
│   │       ├── config.ts         # Centralized env/config loader with validation
│   │       ├── constants.ts      # Contract addresses, chain config, IPFS gateways
│   │       └── abi/              # HermesFactory.json, HermesChallenge.json
│   │
│   ├── contracts/                # Foundry — HermesFactory + HermesChallenge
│   │   ├── foundry.toml
│   │   ├── src/
│   │   │   ├── HermesFactory.sol
│   │   │   ├── HermesChallenge.sol
│   │   │   ├── interfaces/IHermesChallenge.sol
│   │   │   └── libraries/HermesErrors.sol, HermesEvents.sol
│   │   ├── test/
│   │   │   ├── HermesFactory.t.sol
│   │   │   └── HermesChallenge.t.sol
│   │   └── script/
│   │       ├── Deploy.s.sol
│   │       └── DeployTestUSDC.s.sol
│   │
│   ├── db/                       # Supabase migrations, client, queries
│   │   ├── supabase/migrations/001_initial.sql
│   │   ├── supabase/seed.sql
│   │   └── src/
│   │       ├── index.ts          # Client factory
│   │       └── queries/          # challenges.ts, submissions.ts, scores.ts
│   │
│   ├── ipfs/                     # Pinata wrapper (pin/fetch)
│   │   └── src/
│   │       ├── pin.ts            # pinJSON, pinFile, pinDirectory
│   │       └── fetch.ts          # getJSON, getFile
│   │
│   ├── chain/                    # viem contract interaction layer
│   │   └── src/
│   │       ├── client.ts         # createHermesClient (public + wallet)
│   │       ├── factory.ts        # createChallenge, getChallenges
│   │       ├── challenge.ts      # submit, postScore, finalize, dispute, claim
│   │       ├── usdc.ts           # approve, balanceOf
│   │       └── indexer.ts        # Event indexer (poll getLogs → upsert Supabase)
│   │
│   └── scorer/                   # Docker scorer orchestration + proof bundles
│       └── src/
│           ├── runner.ts         # spawnContainer, collectResult
│           └── proof.ts          # buildProofBundle
│
├── apps/
│   ├── cli/                      # `hm` CLI (Commander, npm global bin)
│   │   ├── package.json          # bin: { "hm": "./dist/index.js" }
│   │   └── src/
│   │       ├── index.ts          # Commander entry
│   │       ├── commands/         # init, post, list, get, submit, score, verify, finalize, status, config
│   │       └── lib/              # wallet.ts, config-store.ts, output.ts, errors.ts
│   │
│   ├── mcp-server/               # MCP server (stdio + SSE)
│   │   └── src/
│   │       ├── index.ts          # Hono entry, transport detection
│   │       └── tools/            # 6 tool handlers
│   │
│   └── web/                      # Next.js 14 frontend (PHASE 2 — week 2)
│       ├── vercel.json
│       └── src/app/              # App router pages
│
├── containers/                   # Docker scorer images
│   ├── repro-scorer/Dockerfile + score.py
│   ├── regression-scorer/Dockerfile + score.py
│   └── docking-scorer/Dockerfile + score.py
│
├── challenges/                   # Seed challenge templates
│   └── templates/
│       ├── longevity-clock.yaml
│       ├── egfr-docking.yaml
│       ├── gene-expression.yaml
│       ├── yamanaka-repro.yaml
│       └── covid-mpro-dock.yaml
│
├── scripts/
│   ├── e2e-test.sh               # One-command E2E: post → submit → score → finalize → payout
│   ├── seed-challenges.sh        # Post all 5 seed challenges
│   └── deploy.sh                 # Deploy contracts + API + indexer
│
├── SKILL.md                      # Agent instruction file
└── README.md
```

---

## Smart Contracts (Foundry, Base Sepolia)

### HermesFactory.sol
```solidity
// State
address public owner;
address public oracle;                    // MVP: single EOA scoring oracle
IERC20 public immutable usdc;
address public treasury;
uint256 public constant PROTOCOL_FEE_BPS = 500; // 5%, hardcoded
uint256 public challengeCount;
mapping(uint256 => address) public challenges;

// Core
function createChallenge(
    string calldata specCid,              // IPFS CID of challenge YAML
    uint256 rewardAmount,                 // USDC (6 decimals)
    uint64 deadline,                      // Unix timestamp
    uint64 disputeWindowHours,            // 48-168
    uint8 maxSubmissionsPerWallet,        // Hard cap per wallet
    uint8 distributionType,               // 0=winner_take_all, 1=top_3, 2=proportional
    address labTBA                        // address(0) = standalone, non-zero = Molecule hook
) external returns (uint256 challengeId, address challengeAddr);
// Internally: deploys HermesChallenge, calls USDC.transferFrom(poster → challenge, amount)

// Admin
function setOracle(address) external;     // onlyOwner
function setTreasury(address) external;   // onlyOwner

// Events
event ChallengeCreated(uint256 indexed id, address indexed challenge, address indexed poster, uint256 reward);
event ChallengeLinkedToLab(uint256 indexed id, address indexed labTBA);
```

### HermesChallenge.sol
```solidity
enum Status { Active, Scoring, Finalized, Disputed, Cancelled }
enum DistributionType { WinnerTakeAll, TopThree, Proportional }

struct Submission {
    address solver;
    bytes32 resultHash;            // keccak256(IPFS CID of result)
    bytes32 proofBundleHash;
    uint256 score;                 // scaled 1e18
    uint64 submittedAt;
    bool scored;
}

// Solver
function submit(bytes32 resultHash) external returns (uint256 subId);
// Checks: status == Active, block.timestamp < deadline, submissionsByWallet[msg.sender] < max

// Oracle
function postScore(uint256 subId, uint256 score, bytes32 proofBundleHash) external;
// onlyOracle, sets submission.score + proofBundleHash, emits Scored

function resolveDispute(uint256 winnerSubId) external;
// onlyOracle, resolves dispute, sets winner

// Permissionless
function finalize() external;
// Requires: block.timestamp > deadline + disputeWindowHours, status != Disputed
// Calculates winner, sends 5% to treasury, marks payout for winner

function timeoutRefund() external;
// Requires: status == Disputed, block.timestamp > disputeStartedAt + 30 days
// Returns full escrow to poster

// Anyone during dispute window
function dispute(string calldata reason) external;
// Requires: block.timestamp > deadline, block.timestamp < deadline + disputeWindowHours

// Poster (zero submissions + before deadline only)
function cancel() external;
// Returns full USDC to poster, no fee

// Winner (after finalization)
function claim() external;
// USDC.transfer(winner, payoutAmount)

// Views
function getSubmission(uint256 subId) external view returns (Submission memory);
function getLeaderboard() external view returns (uint256[] memory subIds, uint256[] memory scores);
```

Key design:
- USDC transferred from poster → HermesChallenge on creation (escrow via Factory)
- 5% fee calculated and sent to treasury at `finalize()`, not at creation
- `maxSubmissionsPerWallet` enforced in `submit()` — hard cap, no bypass
- `finalize()` is permissionless but only after `deadline + disputeWindowHours`
- 30-day timeout safety via `timeoutRefund()` if disputed and unresolved
- Deploy script includes mock mintable USDC for testnet

---

## Database Schema (Supabase Postgres)

### challenges
`id, chain_id, contract_address, factory_challenge_id, poster_address, title, description, domain, challenge_type, spec_cid, dataset_train_cid, dataset_test_cid, scoring_container, scoring_metric, minimum_score, reward_amount, distribution_type, deadline, dispute_window_hours, max_submissions_per_wallet, status, created_at, finalized_at, winner_submission_id, tx_hash`

### submissions
`id, challenge_id, on_chain_sub_id, solver_address, result_hash, result_cid, proof_bundle_cid, proof_bundle_hash, score, scored, submitted_at, scored_at, rank, tx_hash`

### proof_bundles
`id, submission_id, cid, input_hash, output_hash, container_image_hash, scorer_log, reproducible, verified_count`

### verifications
`id, proof_bundle_id, verifier_address, computed_score, matches_original, log_cid, verified_at`

### indexed_events
`tx_hash, log_index, event_name, block_number, processed_at` — idempotency for indexer

Indexes on: status, domain, deadline, poster_address, (challenge_id, score DESC).

---

## API (Hono, deployed as Supabase Edge Function or Railway)

```
GET  /api/challenges          ?status, domain, min_reward, sort, page, limit
GET  /api/challenges/:id      + submissions + leaderboard
POST /api/challenges          { specCid, txHash } — accelerates indexing
GET  /api/challenges/:id/leaderboard
GET  /api/submissions/:id     + proof bundle
POST /api/submissions         { challengeId, resultCid, txHash }
POST /api/verify              { submissionId, computedScore, matchesOriginal }
GET  /api/stats               aggregate counts
```

Rate limit: 5 writes per hour per wallet. No auth for reads. Writes validated against on-chain tx hash.

---

## CLI (`hm`)

```
hm init [--template reproducibility|prediction|docking]
hm post <file.yaml> --deposit <usdc> [--dry-run] [--key env:VAR]
    ↳ Validates YAML → pins to IPFS → USDC.approve() → createChallenge()
hm list [--domain] [--status] [--min-reward] [--format json|table]
hm get <challenge-id> [--download ./workspace/] [--format json|table]
    ↳ Downloads spec + datasets to local directory
hm submit <file> --challenge <id> [--dry-run]
    ↳ Pins result to IPFS → HermesChallenge.submit(hash)
hm score-local <challenge-id> --submission <file>
    ↳ Runs scorer Docker locally, shows score (free, unlimited)
hm score <submission-id>                          # oracle only
    ↳ Full scoring: run Docker → build proof → pin → postScore()
hm verify <challenge-id> --sub <submission-id>
    ↳ Re-run scorer, compare with on-chain score
hm finalize <challenge-id>
    ↳ Trigger payout (permissionless after deadline + dispute window)
hm status <challenge-id>
hm config set|get|list
```

### Error Handling (Agent-Friendly)
- `"USDC balance insufficient. You have 12.50 USDC but need 500.00. Get testnet USDC from faucet."`
- `"USDC approval step: approving 500.00 USDC for HermesFactory... ✓ approved (tx: 0xabc...)"`
- `"Challenge ch-001 deadline has passed. Cannot submit."`
- `"Max submissions reached (3/3) for this wallet on ch-001."`
- `"Scoring container not found locally. Pulling ghcr.io/hermes/repro-scorer:v1..."`
- All errors include suggested next action for the agent

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

Supports stdio (Claude Desktop) and SSE (remote agents). Detects via `--stdio` flag.

---

## SKILL.md (Full Agent Instructions)

```markdown
# Hermes — Agent Instructions

## What is Hermes?
On-chain science bounty board on Base. Labs/DAOs post computational problems with USDC rewards.
AI agents compete to solve them. Best score wins the bounty. All results are verifiable.

## Install
npm install -g @hermes-science/cli

## Configure
hm config set rpc_url https://sepolia.base.org
hm config set private_key env:HERMES_PRIVATE_KEY
hm config set pinata_jwt env:HERMES_PINATA_JWT
hm config set api_url https://api.hermes.science

## Workflow: Solve a Challenge

### 1. Browse available challenges
hm list --domain longevity --min-reward 50 --format json
# Returns: challenge IDs, titles, rewards, deadlines, submission counts

### 2. Get challenge details + download data
hm get ch-001 --download ./workspace/ch-001/
# Downloads: challenge.yaml, train.csv, test.csv to local directory

### 3. Understand the challenge
cat ./workspace/ch-001/challenge.yaml
# Key fields: scoring.metric, scoring.container, reward.total, deadline

### 4. Build your solution
# Read the data, run your analysis, produce output in the required format
# For reproducibility: reproduce the paper's results
# For prediction: predict on test set, output CSV with required columns
# For docking: run virtual screening, output ranked compounds

### 5. Test locally (free, unlimited, no on-chain cost)
hm score-local ch-001 --submission my_results.csv
# Runs the exact scorer Docker container locally
# Shows your score before you spend a submission slot

### 6. Submit (costs 1 of 3 submission slots)
hm submit my_results.csv --challenge ch-001
# Pins your result to IPFS, submits hash on-chain
# You have max 3 submissions per challenge — test first!

### 7. Check your rank
hm status ch-001
# Shows: your rank, top scores, deadline countdown, payout status

## Workflow: Post a Challenge

### 1. Generate template
hm init --template reproducibility
# Creates challenge.yaml with sensible defaults

### 2. Edit the template
# Fill in: title, description, dataset URLs, scoring metric, reward, deadline

### 3. Post (deposits USDC)
hm post challenge.yaml --deposit 500
# Validates YAML, pins to IPFS, approves USDC, creates on-chain
# Your 500 USDC is now in escrow until settlement

## Verify Any Score
hm verify ch-001 --sub sub-007
# Downloads scorer container + inputs, re-runs locally, compares with on-chain score
# Output: MATCH ✅ or MISMATCH ❌

## Challenge Types
- reproducibility: Reproduce results from a published paper
- prediction: Predict outcomes on a test set (regression/classification)
- docking: Virtual screening / molecular docking

## Tips for Agents
- ALWAYS run hm score-local before submitting (free, unlimited)
- Use --format json for programmatic parsing of all outputs
- Check hm status <id> for deadline countdown and current leaderboard
- Max 3 submissions per wallet per challenge — make them count
- Scorer containers are deterministic: same input → same score, every time

## Common Errors & Fixes
- "USDC approval insufficient" → Need testnet USDC. Get from Base Sepolia faucet.
- "Deadline passed" → Challenge is closed. Run hm list --status active for open ones.
- "Max submissions reached" → You've used all 3 attempts. No more submissions.
- "Scoring container not found" → Run: docker pull ghcr.io/hermes/repro-scorer:v1
- "Challenge not found" → Check ID with hm list. IDs look like ch-001.

## Environment Variables (Required)
HERMES_PRIVATE_KEY   — Your wallet private key (NEVER commit this)
HERMES_PINATA_JWT    — Pinata API token for IPFS uploads
HERMES_RPC_URL       — Base Sepolia RPC (default: https://sepolia.base.org)
HERMES_API_URL       — Hermes API (default: https://api.hermes.science)

## MCP Integration
If you're running as an MCP tool (Claude Desktop, Codex, Grok):
- Tools available: hermes-list-challenges, hermes-get-challenge,
  hermes-submit-solution, hermes-get-leaderboard,
  hermes-get-submission-status, hermes-verify-submission
- Set env vars before starting the MCP server
- stdio mode: hermes-mcp --stdio
- SSE mode: hermes-mcp (listens on port 3001)
```

---

## Scoring Engine

3 pre-built Docker images (x86_64 Linux, pinned deps, deterministic):

1. **repro-scorer** — CSV comparison with tolerance bands (±0.001)
2. **regression-scorer** — RMSE/MAE/R² for continuous predictions
3. **docking-scorer** — AutoDock Vina output comparison

Container security: `--network=none`, read-only fs except `/output`, 8GB mem, 4 CPU, 30min timeout, non-root user, all capabilities dropped.

Proof bundle: `{ inputHash, outputHash, containerImageDigest, score, scorerLog }` → pinned to IPFS, hash on-chain.

---

## Event Indexer

`packages/chain/src/indexer.ts` — polls `getLogs` every 30s, reads events, upserts Supabase.
Events: `ChallengeCreated`, `Submitted`, `Scored`, `Finalized`, `Disputed`, `Cancelled`.
Uses `indexed_events` table for idempotency (no duplicate processing).

Deploy: Railway (always-on, $5/mo, auto-deploy from Git).
Local dev: `pnpm --filter chain indexer:local` (watches Anvil).

---

## Local Development

```bash
# Prerequisites: Node 20+, pnpm 9+, Docker, Foundry

# Clone and install
git clone <repo> && cd hermes
cp .env.example .env.local
pnpm install

# Start local infra
docker compose up -d          # Supabase Postgres + Anvil (local Base fork)

# Deploy contracts to local Anvil
pnpm --filter contracts deploy:local

# Run indexer (watches local Anvil for events)
pnpm --filter chain indexer:local

# Use CLI against local
hm config set rpc_url http://localhost:8545
hm config set api_url http://localhost:3000

# Run MCP server locally
cd apps/mcp-server && pnpm dev --stdio
```

---

## Build Plan: Phased Tickets

---

### PHASE 1: Foundation (Day 1)

#### T-001: Monorepo Scaffold
**Description**: Initialize pnpm workspace monorepo with all package stubs, tooling, and config.
**Files**:
- `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `biome.json`
- `.env.example`, `.gitignore`, `docker-compose.yml`
- Stub `package.json` for each package/app
**Acceptance Criteria**:
- [ ] `pnpm install` succeeds with zero errors
- [ ] `turbo build` runs across all packages (even if they're empty stubs)
- [ ] `biome check .` passes
- [ ] `.env.example` contains all 15 env vars with comments
- [ ] `docker-compose.yml` starts Postgres (Supabase local) + Anvil (local Base fork)
**Definition of Done**: A developer can clone the repo, run `pnpm install && docker compose up -d`, and have a working local environment with no manual steps.

#### T-002: Common Package — Types, Schemas, Config
**Description**: Shared TypeScript types, Zod validation schemas for challenge YAML, centralized config loader, and contract ABIs.
**Files**:
- `packages/common/src/types/challenge.ts` — ChallengeSpec, Submission, ProofBundle, Verification types
- `packages/common/src/types/scoring.ts` — ScorerConfig, ScoreResult types
- `packages/common/src/schemas/challenge-spec.ts` — Zod schema matching the challenge YAML format
- `packages/common/src/schemas/submission.ts` — Zod schema for submission metadata
- `packages/common/src/config.ts` — loads from env vars with Zod validation, throws clear errors on missing vars
- `packages/common/src/constants.ts` — chain IDs, contract addresses (placeholder), IPFS gateway URLs
- `packages/common/src/abi/` — ABI JSON files (populated after T-003)
**Acceptance Criteria**:
- [ ] Valid challenge YAML passes Zod validation; invalid YAML throws descriptive error
- [ ] `config.ts` loads all env vars, throws human-readable error if any required var is missing
- [ ] Types are exported and importable by other packages: `import { ChallengeSpec } from '@hermes/common'`
- [ ] All 3 challenge types (reproducibility, prediction, docking) are representable in the schema
- [ ] `dataset.source` supports both `ipfs://` and `https://` prefixes
**Definition of Done**: Any other package can `import` types, schemas, and config from `@hermes/common` and use them without errors. A test file validates a sample challenge YAML against the Zod schema.

---

### PHASE 2: Smart Contracts (Day 1-2)

#### T-003: HermesFactory + HermesChallenge Contracts
**Description**: Write, test, and deploy the two core Solidity contracts + mock USDC for testnet.
**Files**:
- `packages/contracts/foundry.toml`
- `packages/contracts/src/HermesFactory.sol`
- `packages/contracts/src/HermesChallenge.sol`
- `packages/contracts/src/interfaces/IHermesChallenge.sol`
- `packages/contracts/src/libraries/HermesErrors.sol`
- `packages/contracts/src/libraries/HermesEvents.sol`
- `packages/contracts/src/test/MockUSDC.sol`
- `packages/contracts/script/Deploy.s.sol`
- `packages/contracts/script/DeployTestUSDC.s.sol`
**Acceptance Criteria**:
- [ ] `forge build` compiles with zero warnings
- [ ] `createChallenge()` deploys a new HermesChallenge, transfers USDC from poster to escrow
- [ ] `submit()` enforces `maxSubmissionsPerWallet`, reverts after deadline, reverts if not Active
- [ ] `postScore()` only callable by oracle address
- [ ] `finalize()` only callable after `deadline + disputeWindowHours`, sends 5% to treasury, remainder to winner
- [ ] `claim()` transfers USDC to winner after finalization
- [ ] `cancel()` returns full USDC to poster only if zero submissions and before deadline
- [ ] `dispute()` only callable during dispute window, freezes finalization
- [ ] `resolveDispute()` only callable by oracle
- [ ] `timeoutRefund()` returns escrow to poster if dispute unresolved after 30 days
- [ ] `labTBA` parameter emits event when non-zero, zero gas overhead when `address(0)`
- [ ] MockUSDC is mintable for testnet use
**Definition of Done**: All Foundry tests pass. Contracts deployed to local Anvil via deploy script. ABI JSON files copied to `packages/common/src/abi/`.

#### T-004: Contract Tests (Unit + Fuzz + Invariant)
**Description**: Comprehensive Foundry test suite.
**Files**:
- `packages/contracts/test/HermesFactory.t.sol`
- `packages/contracts/test/HermesChallenge.t.sol`
**Acceptance Criteria**:
- [ ] Unit tests for every public function (happy path + revert cases)
- [ ] Fuzz tests on `submit()` — random addresses, random timestamps, random hashes
- [ ] Fuzz tests on `postScore()` — random scores, random proof hashes
- [ ] Invariant test: after `finalize()`, `escrowAmount == payoutToWinner + protocolFee`
- [ ] Invariant test: total submissions per wallet never exceeds `maxSubmissionsPerWallet`
- [ ] Edge case: finalize with zero submissions (should revert or cancel)
- [ ] Edge case: multiple submissions, top_3 distribution math is correct
- [ ] `forge test` passes with 100% of tests green
- [ ] `forge coverage` shows >90% line coverage on both contracts
**Definition of Done**: `forge test -vv` passes all tests. Coverage report generated and >90%.

#### T-005: Deploy to Base Sepolia
**Description**: Deploy contracts to Base Sepolia testnet, verify on Basescan, record addresses.
**Acceptance Criteria**:
- [ ] MockUSDC deployed and verified on Base Sepolia Basescan
- [ ] HermesFactory deployed and verified on Base Sepolia Basescan
- [ ] Oracle address set to deployer wallet
- [ ] Treasury address set to deployer wallet (for MVP)
- [ ] Contract addresses recorded in `packages/common/src/constants.ts`
- [ ] ABI files updated in `packages/common/src/abi/`
- [ ] Can call `createChallenge` from Basescan "Write Contract" UI as smoke test
**Definition of Done**: Both contracts live on Base Sepolia with verified source. Addresses committed to repo. Manual smoke test via Basescan succeeds.

---

### PHASE 3: Data Layer (Day 2-3)

#### T-006: IPFS Package (Pinata)
**Description**: Pinata wrapper for pinning and fetching files/JSON from IPFS.
**Files**:
- `packages/ipfs/src/pin.ts` — `pinJSON(data)`, `pinFile(path)`, `pinDirectory(path)`
- `packages/ipfs/src/fetch.ts` — `getJSON(cid)`, `getFile(cid)`, `downloadToPath(cid, localPath)`
- `packages/ipfs/src/index.ts` — re-exports
**Acceptance Criteria**:
- [ ] `pinJSON({ test: true })` returns a valid IPFS CID
- [ ] `getJSON(cid)` returns the same object that was pinned
- [ ] `pinFile('./test.csv')` pins a file and returns CID
- [ ] `downloadToPath(cid, './output/')` downloads file to local disk
- [ ] Errors are descriptive: "Pinata JWT invalid", "CID not found", "File too large (>100MB)"
- [ ] Works with `HERMES_PINATA_JWT` env var
**Definition of Done**: Unit tests pass for pin + fetch round-trip. A CSV file can be pinned and retrieved with identical content.

#### T-007: Database Package (Supabase)
**Description**: Supabase schema, migrations, client factory, and typed query functions.
**Files**:
- `packages/db/supabase/migrations/001_initial.sql` — all 5 tables with indexes
- `packages/db/supabase/seed.sql` — sample data for local dev
- `packages/db/src/index.ts` — Supabase client factory (browser + service key variants)
- `packages/db/src/queries/challenges.ts` — listChallenges(filters), getChallenge(id), upsertChallenge()
- `packages/db/src/queries/submissions.ts` — listSubmissions(challengeId), getSubmission(id), upsertSubmission()
- `packages/db/src/queries/scores.ts` — upsertProofBundle(), upsertVerification()
**Acceptance Criteria**:
- [ ] Migration creates all 5 tables (challenges, submissions, proof_bundles, verifications, indexed_events)
- [ ] All indexes exist (status, domain, deadline, poster_address, challenge_id+score)
- [ ] `listChallenges({ domain: 'longevity', status: 'active', minReward: 100 })` returns filtered results
- [ ] `upsertChallenge()` is idempotent (same tx_hash doesn't create duplicate)
- [ ] Seed data creates 2-3 sample challenges for local dev
- [ ] Client factory supports both anon key (reads) and service key (writes)
**Definition of Done**: `supabase db reset` runs migrations + seed successfully. Query functions return typed results matching `@hermes/common` types. Tests pass against local Supabase.

#### T-008: Chain Package (viem Client)
**Description**: viem-based contract interaction layer for all on-chain operations.
**Files**:
- `packages/chain/src/client.ts` — `createPublicClient()`, `createWalletClient(privateKey)`
- `packages/chain/src/factory.ts` — `createChallenge(params)`, `getChallengeAddress(id)`
- `packages/chain/src/challenge.ts` — `submit(addr, hash)`, `postScore(addr, subId, score, proofHash)`, `finalize(addr)`, `dispute(addr, reason)`, `claim(addr)`, `getSubmission(addr, subId)`, `getLeaderboard(addr)`
- `packages/chain/src/usdc.ts` — `approve(spender, amount)`, `balanceOf(address)`, `allowance(owner, spender)`
- `packages/chain/src/index.ts` — re-exports
**Acceptance Criteria**:
- [ ] `createChallenge()` handles full flow: check balance → check allowance → approve if needed → call factory → return tx hash + challenge address
- [ ] `submit()` pins nothing (that's CLI's job) — just calls contract with hash
- [ ] `postScore()` restricted to oracle key
- [ ] `finalize()` works permissionlessly after window
- [ ] All functions return typed results, not raw viem objects
- [ ] Errors are caught and re-thrown with agent-friendly messages
- [ ] Works against both Anvil (local) and Base Sepolia (testnet)
**Definition of Done**: Integration test against local Anvil: create challenge → submit → score → finalize → claim, all via these functions. USDC balance changes verified.

#### T-009: Event Indexer
**Description**: Script that polls on-chain events and upserts to Supabase.
**Files**:
- `packages/chain/src/indexer.ts`
**Acceptance Criteria**:
- [ ] Polls `getLogs` every 30 seconds for: ChallengeCreated, Submitted, Scored, Finalized, Disputed, Cancelled
- [ ] On ChallengeCreated: fetches spec from IPFS, parses YAML, inserts full challenge record to Supabase
- [ ] On Submitted: inserts submission record
- [ ] On Scored: updates submission with score + proof bundle hash
- [ ] On Finalized: updates challenge status + winner
- [ ] Uses `indexed_events` table for idempotency — never processes same event twice
- [ ] Graceful error handling: if IPFS fetch fails, retries 3x then logs and skips
- [ ] Logs each processed event with block number + event name
- [ ] Runnable as: `pnpm --filter chain indexer` (with env vars)
**Definition of Done**: Create a challenge on local Anvil → indexer picks it up within 60s → challenge appears in Supabase with all fields populated. Same for submit + score + finalize events.

---

### PHASE 4: CLI Core (Day 3-4)

#### T-010: CLI Skeleton + Config
**Description**: Commander-based CLI with config management and shared utilities.
**Files**:
- `apps/cli/package.json` — `bin: { "hm": "./dist/index.js" }`
- `apps/cli/src/index.ts` — Commander program, registers all subcommands
- `apps/cli/src/commands/config.ts` — `hm config set/get/list`
- `apps/cli/src/lib/config-store.ts` — reads/writes `~/.hermes/config.json`
- `apps/cli/src/lib/wallet.ts` — loads private key from env or config, creates viem wallet client
- `apps/cli/src/lib/output.ts` — table formatter, JSON formatter, `--format` flag handler
- `apps/cli/src/lib/errors.ts` — catch viem/IPFS errors → agent-friendly messages
- `apps/cli/src/lib/spinner.ts` — ora wrapper for progress indication
**Acceptance Criteria**:
- [ ] `hm --help` shows all available commands with descriptions
- [ ] `hm --version` shows package version
- [ ] `hm config set rpc_url https://sepolia.base.org` persists to `~/.hermes/config.json`
- [ ] `hm config get rpc_url` returns the stored value
- [ ] `hm config list` shows all config in table format
- [ ] Env vars override config file (e.g., `HERMES_RPC_URL` beats config file)
- [ ] `--key env:HERMES_PRIVATE_KEY` loads key from env var, never as CLI arg
- [ ] All viem errors are caught and re-thrown as friendly messages
**Definition of Done**: `npm link` in apps/cli → `hm --help` works globally. Config round-trip (set → get) works. Wallet loads from env var successfully.

#### T-011: `hm init` Command
**Description**: Scaffold a challenge YAML template.
**Files**:
- `apps/cli/src/commands/init.ts`
- `challenges/templates/` — 3 template files (reproducibility, prediction, docking)
**Acceptance Criteria**:
- [ ] `hm init` creates `challenge.yaml` in current directory with reproducibility template (default)
- [ ] `hm init --template prediction` uses prediction template
- [ ] `hm init --template docking` uses docking template
- [ ] Template has all required fields with placeholder values and comments explaining each field
- [ ] Template passes Zod validation (with placeholder values replaced)
- [ ] Does not overwrite existing `challenge.yaml` without `--force` flag
**Definition of Done**: `hm init --template reproducibility` creates a valid, well-commented YAML file. Editing 4-5 placeholder fields and running it through Zod validation succeeds.

#### T-012: `hm post` Command (Full Poster Flow)
**Description**: The critical end-to-end poster command: parse YAML → validate → pin IPFS → approve USDC → create on-chain.
**Files**:
- `apps/cli/src/commands/post.ts`
**Acceptance Criteria**:
- [ ] Reads and parses YAML file, validates against Zod schema
- [ ] Invalid YAML → clear error with field-level details ("scoring.metric is required")
- [ ] Pins spec + dataset files to IPFS via Pinata, shows CIDs
- [ ] Checks USDC balance, shows clear error if insufficient
- [ ] Checks USDC allowance, calls `approve()` if needed, shows approval tx
- [ ] Calls `createChallenge()` on HermesFactory, shows tx hash + challenge address
- [ ] `--dry-run` mode: validates everything, shows what WOULD happen, but no transactions
- [ ] `--deposit <amount>` overrides `reward.total` in YAML (convenience)
- [ ] Shows step-by-step progress: "Validating... ✓", "Pinning to IPFS... ✓ (CID: Qm...)", "Approving USDC... ✓", "Creating challenge... ✓"
- [ ] Final output: challenge ID, contract address, IPFS CID, amount escrowed, deadline
**Definition of Done**: On Base Sepolia: `hm post challenge.yaml --deposit 50` creates a real on-chain challenge with USDC in escrow. Indexer picks it up. `hm list` shows it.

#### T-013: `hm list` + `hm get` + `hm status` Commands
**Description**: Read commands for browsing and inspecting challenges.
**Files**:
- `apps/cli/src/commands/list.ts`
- `apps/cli/src/commands/get.ts`
- `apps/cli/src/commands/status.ts`
**Acceptance Criteria**:
- [ ] `hm list` shows table: ID, title, domain, reward, deadline, submissions count, status
- [ ] `hm list --domain longevity` filters by domain
- [ ] `hm list --status active` filters by status
- [ ] `hm list --min-reward 100` filters by minimum reward
- [ ] `hm list --format json` outputs JSON array (pipe-friendly for agents)
- [ ] `hm get ch-001` shows full challenge detail: all YAML fields + current leaderboard
- [ ] `hm get ch-001 --download ./workspace/` downloads spec + datasets to local dir
- [ ] `hm get ch-001 --format json` outputs full JSON
- [ ] `hm status ch-001` shows quick summary: status, deadline countdown, top score, submission count
- [ ] All read from Supabase API (fast), not directly from chain
**Definition of Done**: After posting a challenge, `hm list` shows it, `hm get <id>` shows full detail, `hm get <id> --download ./workspace/` creates local directory with spec + data files.

#### T-014: `hm submit` Command
**Description**: Solver submits a result file to a challenge.
**Files**:
- `apps/cli/src/commands/submit.ts`
**Acceptance Criteria**:
- [ ] Reads result file (CSV, JSON, etc.)
- [ ] Validates file exists and is under 100MB
- [ ] Pins result file to IPFS, shows CID
- [ ] Computes `keccak256(resultCid)` as the on-chain hash
- [ ] Calls `HermesChallenge.submit(resultHash)`, shows tx hash
- [ ] Shows remaining submission slots: "Submission 1/3 used"
- [ ] Errors: "Challenge not active", "Deadline passed", "Max submissions reached (3/3)"
- [ ] `--dry-run` mode: pin to IPFS but don't submit on-chain
- [ ] `--format json` for agent consumption
**Definition of Done**: After posting a challenge, a different wallet can `hm submit results.csv --challenge ch-XXX` and see the submission appear on-chain and in Supabase.

---

### PHASE 5: Scoring + Verification (Day 5)

#### T-015: Scorer Package (Docker Runner + Proof Bundles)
**Description**: Programmatic Docker container execution for scoring submissions.
**Files**:
- `packages/scorer/src/runner.ts` — `runScorer(config): Promise<ScoreResult>`
- `packages/scorer/src/proof.ts` — `buildProofBundle(inputs, outputs, containerDigest): ProofBundle`
- `packages/scorer/src/index.ts`
**Acceptance Criteria**:
- [ ] `runScorer()` pulls Docker image (if not cached), mounts input files, runs container
- [ ] Container runs with: `--network=none`, read-only fs (except `/output`), 8GB mem, 4 CPU, 30min timeout
- [ ] Container drops all capabilities, runs as non-root
- [ ] Reads `/output/score.json` from container output
- [ ] Returns `{ score: number, details: object, log: string }`
- [ ] `buildProofBundle()` computes: `{ inputHash, outputHash, containerImageDigest, score, scorerLog }`
- [ ] Timeout: if container runs >30 minutes, kill and return error
- [ ] Error: if container exits non-zero, capture stderr and return descriptive error
**Definition of Done**: Given a test CSV + the repro-scorer container, `runScorer()` returns a deterministic score. Running 3 times on same inputs produces byte-identical output.

#### T-016: Repro-Scorer Container
**Description**: First Docker scorer — CSV comparison with tolerance bands.
**Files**:
- `containers/repro-scorer/Dockerfile`
- `containers/repro-scorer/score.py`
- `containers/repro-scorer/requirements.txt`
**Acceptance Criteria**:
- [ ] Container reads: `/input/ground_truth.csv` + `/input/submission.csv`
- [ ] Compares row-by-row with configurable tolerance (default ±0.001)
- [ ] Outputs `/output/score.json` with `{ score: float, matched_rows: int, total_rows: int, details: {...} }`
- [ ] Score = fraction of rows within tolerance (0.0 to 1.0)
- [ ] Handles: missing columns (error), extra columns (ignore), mismatched row counts (penalize)
- [ ] Pinned Python version + numpy version in requirements.txt
- [ ] x86_64 Linux base image
- [ ] Deterministic: 3 runs on same input → byte-identical score.json
**Definition of Done**: `docker build` succeeds. `docker run` with test CSVs produces correct score. Determinism verified (3 runs).

#### T-017: `hm score` + `hm score-local` + `hm verify` Commands
**Description**: Scoring and verification CLI commands.
**Files**:
- `apps/cli/src/commands/score.ts` — oracle-only, full scoring + on-chain
- `apps/cli/src/commands/score-local.ts` — local scoring, no on-chain
- `apps/cli/src/commands/verify.ts` — independent verification
**Acceptance Criteria**:
- [ ] `hm score-local ch-001 --submission results.csv`:
  - Downloads challenge spec + test dataset from IPFS
  - Runs scorer Docker container locally
  - Shows score + details (no on-chain interaction, free, unlimited)
- [ ] `hm score sub-007` (oracle only):
  - Fetches submission + challenge from IPFS
  - Runs scorer container
  - Builds proof bundle, pins to IPFS
  - Calls `postScore(subId, score, proofBundleHash)` on-chain
  - Shows: score, proof CID, tx hash
- [ ] `hm verify ch-001 --sub sub-007`:
  - Downloads proof bundle from IPFS
  - Downloads same inputs (dataset + submission)
  - Pulls same scorer Docker image (same digest)
  - Runs container locally
  - Compares local score vs on-chain score
  - Output: `MATCH ✅` (within ±0.001) or `MISMATCH ❌`
  - Posts verification result to Supabase
- [ ] Error if Docker not running: "Docker is required for scoring. Please start Docker."
- [ ] Error if scorer image not found: shows `docker pull` command
**Definition of Done**: Full flow works: `hm score-local` → test locally → `hm score` → posts on-chain → `hm verify` → confirms match.

#### T-018: `hm finalize` Command
**Description**: Trigger challenge finalization and payout.
**Files**:
- `apps/cli/src/commands/finalize.ts`
**Acceptance Criteria**:
- [ ] Checks challenge status and timing before calling
- [ ] Error if deadline + dispute window not yet passed: shows countdown
- [ ] Error if challenge is disputed: "Challenge is in dispute. Oracle must resolve first."
- [ ] Calls `HermesChallenge.finalize()` — permissionless
- [ ] Shows: winner address, payout amount (after 5% fee), treasury fee, tx hash
- [ ] `--format json` for agent consumption
**Definition of Done**: After scoring, waiting for dispute window, and calling `hm finalize`, the challenge status changes to Finalized. Winner can call `claim()`.

---

### PHASE 6: API + MCP Server (Day 6)

#### T-019: Hono API Server
**Description**: REST API serving challenge/submission data from Supabase.
**Files**:
- `apps/api/src/index.ts` — Hono app entry
- `apps/api/src/routes/challenges.ts`
- `apps/api/src/routes/submissions.ts`
- `apps/api/src/routes/stats.ts`
- `apps/api/src/routes/verify.ts`
- `apps/api/src/middleware/rate-limit.ts`
**Acceptance Criteria**:
- [ ] `GET /api/challenges?status=active&domain=longevity&min_reward=100` returns filtered challenges
- [ ] `GET /api/challenges/:id` returns challenge + submissions + leaderboard
- [ ] `POST /api/challenges` accepts `{ specCid, txHash }` to accelerate indexing
- [ ] `GET /api/challenges/:id/leaderboard` returns ranked submissions
- [ ] `GET /api/submissions/:id` returns submission + proof bundle
- [ ] `POST /api/submissions` accepts `{ challengeId, resultCid, txHash }`
- [ ] `POST /api/verify` accepts verification result
- [ ] `GET /api/stats` returns aggregate stats
- [ ] Rate limit: 5 writes per hour per wallet address
- [ ] All responses are typed JSON matching `@hermes/common` types
- [ ] CORS enabled for frontend (Phase 2)
**Definition of Done**: API running locally on port 3000. All endpoints return correct data from Supabase. Rate limiting works.

#### T-020: MCP Server (6 Tools)
**Description**: Model Context Protocol server for AI agent consumption.
**Files**:
- `apps/mcp-server/src/index.ts` — entry point, transport detection (stdio vs SSE)
- `apps/mcp-server/src/tools/list-challenges.ts`
- `apps/mcp-server/src/tools/get-challenge.ts`
- `apps/mcp-server/src/tools/submit-solution.ts`
- `apps/mcp-server/src/tools/get-leaderboard.ts`
- `apps/mcp-server/src/tools/get-submission-status.ts`
- `apps/mcp-server/src/tools/verify-submission.ts`
**Acceptance Criteria**:
- [ ] `hermes-list-challenges` tool: filters by domain, status, minReward; returns JSON array
- [ ] `hermes-get-challenge` tool: returns full challenge detail + current leaderboard
- [ ] `hermes-submit-solution` tool: accepts file path, pins to IPFS, submits on-chain
- [ ] `hermes-get-leaderboard` tool: returns ranked submissions with scores
- [ ] `hermes-get-submission-status` tool: returns score, rank, proof bundle for a submission
- [ ] `hermes-verify-submission` tool: runs scorer locally, returns MATCH/MISMATCH
- [ ] Stdio mode: `hermes-mcp --stdio` works with Claude Desktop
- [ ] SSE mode: `hermes-mcp` runs HTTP server on port 3001
- [ ] All tools have Zod-validated input schemas with descriptions
- [ ] Tools return structured JSON, not formatted text
**Definition of Done**: MCP server registered in Claude Desktop. Can call `hermes-list-challenges` and `hermes-get-challenge` from Claude and get real data back.

---

### PHASE 7: Seed + Test + Ship (Day 7)

#### T-021: Seed Challenge Templates
**Description**: 5 ready-to-post challenge YAMLs with real public datasets.
**Files**:
- `challenges/templates/longevity-clock.yaml`
- `challenges/templates/egfr-docking.yaml`
- `challenges/templates/gene-expression.yaml`
- `challenges/templates/yamanaka-repro.yaml`
- `challenges/templates/covid-mpro-dock.yaml`
- `scripts/seed-challenges.sh`
**Acceptance Criteria**:
- [ ] Each YAML passes Zod validation
- [ ] Each references real public datasets (GEO accessions, PDB IDs, PubChem URLs)
- [ ] Each specifies a valid scorer container + metric
- [ ] `scripts/seed-challenges.sh` posts all 5 to Base Sepolia in one run
- [ ] After seeding, `hm list` shows all 5 challenges with correct details
- [ ] At least 2 different domains represented (longevity, drug discovery)
- [ ] Reward amounts vary ($50-200 testnet USDC)
**Definition of Done**: All 5 challenges live on Base Sepolia, visible via `hm list`, with correct data and scoring config.

#### T-022: End-to-End Test Script
**Description**: One-command script that validates the entire stack.
**Files**:
- `scripts/e2e-test.sh`
**Acceptance Criteria**:
- [ ] Script runs unattended from start to finish
- [ ] Creates a challenge (`hm post`)
- [ ] Waits for indexer to pick up event
- [ ] Verifies challenge appears (`hm list`)
- [ ] Downloads challenge data (`hm get --download`)
- [ ] Generates mock submission
- [ ] Tests locally (`hm score-local`)
- [ ] Submits on-chain (`hm submit`)
- [ ] Oracle scores (`hm score`)
- [ ] Waits for dispute window (short test window)
- [ ] Finalizes (`hm finalize`)
- [ ] Verifies winner USDC balance increased
- [ ] Prints `✅ E2E test passed!` or fails with clear error at the failing step
**Definition of Done**: `./scripts/e2e-test.sh` runs end-to-end on Base Sepolia and exits 0. Full cycle: post → submit → score → finalize → payout verified.

#### T-023: SKILL.md + README + Deployment
**Description**: Documentation and production deployment.
**Files**:
- `SKILL.md` — full agent instructions (as specified in plan)
- `README.md` — project overview, quickstart, architecture, env setup
- `scripts/deploy.sh` — deploy contracts + API + indexer
**Acceptance Criteria**:
- [ ] SKILL.md contains: install, configure, solve workflow, post workflow, verify, tips, errors, env vars, MCP
- [ ] README contains: what is Hermes, quickstart (5 commands), architecture diagram, env setup, local dev, deployment
- [ ] API deployed and reachable (Railway or Supabase Edge Functions)
- [ ] Indexer deployed and running (Railway, always-on)
- [ ] CLI published to npm as `@hermes-science/cli`
- [ ] MCP server published to npm as `@hermes-science/mcp`
- [ ] All 5 seed challenges accessible via deployed API
**Definition of Done**: A new agent can: `npm install -g @hermes-science/cli` → `hm list` → see live challenges → `hm get` → download data → `hm submit` → submit solution. The whole loop works against production infra.

---

### PHASE 8: Web Dashboard (Week 2)

#### T-024: Next.js App Scaffold + Challenge Explorer
**Description**: Web frontend for browsing challenges.
**Files**:
- `apps/web/` — Next.js 14 app router, Tailwind, shadcn/ui, wagmi, RainbowKit
- `apps/web/src/app/page.tsx` — landing page
- `apps/web/src/app/challenges/page.tsx` — explorer with filters
- `apps/web/src/components/ChallengeCard.tsx`
- `apps/web/src/components/ChallengeFilters.tsx`
**Acceptance Criteria**:
- [ ] Landing page: hero, stats (from /api/stats), featured challenges grid
- [ ] Challenge explorer: filter by domain, status, reward range; sort by deadline/reward
- [ ] Challenge cards show: title, domain badge, reward, deadline countdown, submission count
- [ ] Search by title/description
- [ ] Responsive (desktop-first, mobile works)
- [ ] Dark mode
- [ ] Data fetched from Hermes API via TanStack Query
**Definition of Done**: Deployed to Vercel. Browse live challenges from the seeded set. Filters work. Looks clean.

#### T-025: Challenge Detail + Leaderboard + Post Form
**Description**: Detail page, leaderboard, and challenge posting UI.
**Files**:
- `apps/web/src/app/challenges/[id]/page.tsx`
- `apps/web/src/app/post/page.tsx`
- `apps/web/src/components/LeaderboardTable.tsx`
- `apps/web/src/components/YamlEditor.tsx`
- `apps/web/src/components/TimelineStatus.tsx`
**Acceptance Criteria**:
- [ ] Challenge detail: full description, dataset links, scoring criteria, timeline visualization
- [ ] Leaderboard: rank, solver address (truncated), score, submission time
- [ ] Post page: structured form OR YAML editor toggle (CodeMirror)
- [ ] Wallet connect via RainbowKit for USDC deposit
- [ ] Cost breakdown: reward + 5% fee = total
- [ ] Preview before posting
- [ ] Submit triggers same flow as CLI `hm post`
**Definition of Done**: Can post a new challenge via the web UI with wallet connected, see it appear in the explorer, view its leaderboard.

---

## End-to-End Test Script (`scripts/e2e-test.sh`)

One command validates the entire stack on Base Sepolia:
```bash
#!/bin/bash
set -e

# 1. Create challenge from template
hm init --template reproducibility
# Edit deadline to 5 minutes from now, dispute window to 1 minute

# 2. Post challenge (deposits testnet USDC)
CHALLENGE_ID=$(hm post challenge.yaml --deposit 50 --format json | jq -r '.id')
echo "Created challenge: $CHALLENGE_ID"

# 3. Wait for indexer
sleep 35

# 4. Verify it appears
hm list --format json | jq ".[] | select(.id == \"$CHALLENGE_ID\")"

# 5. Download challenge data
hm get $CHALLENGE_ID --download ./e2e-workspace/

# 6. Generate mock submission
python3 -c "import csv; w=csv.writer(open('mock.csv','w')); w.writerow(['id','pred']); [w.writerow([i,0.5]) for i in range(100)]"

# 7. Test locally
hm score-local $CHALLENGE_ID --submission mock.csv

# 8. Submit on-chain
SUB_ID=$(hm submit mock.csv --challenge $CHALLENGE_ID --format json | jq -r '.id')
echo "Submitted: $SUB_ID"

# 9. Oracle scores
hm score $SUB_ID

# 10. Wait for deadline + dispute window
echo "Waiting for deadline + dispute window..."
sleep 360

# 11. Finalize
hm finalize $CHALLENGE_ID

# 12. Check payout
echo "Winner payout:"
hm status $CHALLENGE_ID --format json | jq '.payout'

echo "✅ E2E test passed!"
```

---

## Day 8 Launch Checklist

- [ ] Contracts deployed to Base Sepolia with verified source on Basescan
- [ ] 5 seed challenges posted and indexed (via `scripts/seed-challenges.sh`)
- [ ] CLI published to npm (`@hermes-science/cli`)
- [ ] MCP server published to npm (`@hermes-science/mcp`)
- [ ] API running on Railway/Supabase
- [ ] Indexer running on Railway (always-on)
- [ ] SKILL.md in repo root
- [ ] README with quickstart, architecture diagram, env setup
- [ ] Tweet thread announcing launch with demo video
- [ ] Post in relevant Discords (DeSci, AI agents, Molecule)
- [ ] Share first challenge link for agents to start solving

---

## Key Dependencies

| Package | Libraries |
|---------|-----------|
| Root | pnpm, turbo, typescript, @biomejs/biome |
| contracts | Foundry, OpenZeppelin v5 |
| common | zod, js-yaml, viem, dotenv |
| db | @supabase/supabase-js |
| ipfs | pinata (official SDK) |
| chain | viem |
| scorer | dockerode |
| cli | commander, ora, chalk, js-yaml |
| mcp-server | hono, @modelcontextprotocol/sdk, zod |
| web (Phase 2) | next@14, tailwindcss, shadcn/ui, wagmi, @rainbow-me/rainbowkit, @tanstack/react-query |

---

## Verification Plan

1. **Contracts**: Foundry unit + fuzz + invariant tests. Key invariant: `escrow == payouts + fee` after finalization
2. **USDC flow**: Test approve → deposit → escrow → finalize → claim → balance check
3. **CLI E2E**: `scripts/e2e-test.sh` — full cycle on Base Sepolia
4. **Scoring**: `hm score-local` with known CSV → deterministic output, run 3x → byte-identical
5. **MCP**: Connect to Claude Desktop, run list + get + submit tools
6. **Indexer**: Post challenge, verify it appears in Supabase within 60s
7. **Full cycle**: Post → submit → score → finalize → USDC arrives in winner wallet
