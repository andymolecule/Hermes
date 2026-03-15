# Data and Indexing

## Purpose

How data flows through Agora: from on-chain events through the indexer into the database, and how each layer relates to truth.

## Audience

Engineers working on the indexer, database, API, or any component that reads/writes data. Operators debugging data inconsistencies.

## Read this after

- [Architecture](architecture.md) — system overview
- [Protocol](protocol.md) — on-chain rules and events

## Source of truth

This doc is authoritative for: database schema, projection model, indexer behavior, and read/write truth boundaries. It is NOT authoritative for: sealed submission format details, smart contract logic, API route definitions, or frontend behavior. For the privacy model around `result_cid`, replay artifacts, and sealed envelopes, see [Submission Privacy](submission-privacy.md).

## Summary

- On-chain contracts are authoritative for lifecycle status, payout entitlements, and claimability
- Supabase is a projection and operational cache, not the source of truth
- The indexer polls chain events every 30s and writes idempotent projections to Supabase
- Fairness-sensitive visibility checks use chain `status()` rather than projected status
- Public leaderboard, win rate, and earned USDC derive from finalized `challenge_payouts` rows
- Worker scoring reads cached `submission_contract_json` and `scoring_env_json` from the DB first; IPFS spec fetch is legacy fallback only

---

## On-Chain vs Off-Chain Boundary

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

## Source-of-Truth Matrix

| Concept | Authoritative Source | Notes |
|---------|---------------------|-------|
| Lifecycle status | Contract `status()` | DB projection may conservatively lag |
| Payout entitlements | Contract (`PayoutAllocated` events) | `challenge_payouts` table is projection |
| Claimability | Contract (`claim()`) | — |
| Leaderboard display | DB (`challenge_payouts` from finalized) | Not score heuristics |
| UI status labels | API domain types derived from chain | — |
| Verification gate | Chain truth | Fairness-sensitive routes re-check |
| Challenge metadata | IPFS (immutable) + DB (searchable cache) | DB also caches resolved scoring config for worker hot-path reads |
| Submission fetch metadata (`result_cid`, `result_format`) | DB reconciliation (`submission_intents` + `submissions`) | Chain stores only `result_hash` |
| Submission content | IPFS | Hash anchored on-chain |

---

## Database Schema

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
        jsonb submission_contract_json
        jsonb scoring_env_json
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

    verifications {
        uuid id PK
        uuid proof_bundle_id FK
        string verifier_address
        numeric computed_score
        boolean matches_original
        string log_cid
        timestamp verified_at
    }

    indexer_cursors {
        string cursor_key PK
        bigint block_number
        timestamp updated_at
    }

    score_jobs {
        uuid id PK
        uuid submission_id FK
        uuid challenge_id FK
        string status
        int attempts
        int max_attempts
        timestamp next_attempt_at
        timestamp locked_at
        timestamp run_started_at
        string locked_by
        string last_error
        string score_tx_hash
        timestamp created_at
        timestamp updated_at
    }

    worker_runtime_control {
        string worker_type PK
        string active_runtime_version
        timestamp updated_at
    }

    worker_runtime_state {
        string worker_id PK
        string worker_type
        string host
        string runtime_version
        boolean ready
        boolean executor_ready
        boolean seal_enabled
        string seal_key_id
        boolean seal_self_check_ok
        string last_error
        timestamp started_at
        timestamp last_heartbeat_at
        timestamp created_at
        timestamp updated_at
    }

    submission_intents {
        uuid id PK
        uuid challenge_id FK
        string solver_address
        string result_hash
        string result_cid
        string result_format
        uuid matched_submission_id FK
        timestamp matched_at
        timestamp expires_at
        timestamp created_at
    }

    auth_nonces {
        string nonce PK
        string purpose
        string address
        timestamp expires_at
        timestamp consumed_at
        timestamp created_at
    }

    auth_sessions {
        string token_hash PK
        string address
        timestamp expires_at
        timestamp revoked_at
        timestamp created_at
    }

    challenges ||--o{ submissions : has
    submissions ||--o| proof_bundles : has
    challenges ||--o{ challenge_payouts : settles
    proof_bundles ||--o{ verifications : has
    submissions ||--o| score_jobs : queued_as
    challenges ||--o{ score_jobs : has
    challenges ||--o{ submission_intents : stages
    submissions ||--o| submission_intents : matched_by
```

### Table Descriptions

- **challenges** — Projected from `ChallengeCreated` events + IPFS spec parsing. Key fields: `contract_address` (unique on-chain identity), `status` (projected lifecycle state), `reward_amount` (USDC, 6 decimals), `deadline` (UTC timestamp), `spec_cid` (IPFS pointer to challenge YAML), `eval_image` (Docker scorer image reference). Additional columns: `contract_version` (on-chain contract version for generation tracking), `spec_schema_version` (YAML schema version), `dataset_train_cid` and `dataset_test_cid` (IPFS CIDs for training/test data), `expected_columns` (denormalized cache derived from `submission_contract.columns.required` for CSV-table challenges), `distribution_type` (payout distribution: `winner_take_all`, `top_3`, or `proportional`), `runner_preset_id` (scorer runner preset), `eval_bundle_cid` (IPFS CID for evaluation bundle), `submission_contract_json` (cached artifact contract for scoring), and `scoring_env_json` (cached resolved scoring env such as tolerance).

- **submissions** — Projected from `Submitted` + `Scored` events. Key fields: `on_chain_sub_id` (contract-level submission index), `result_hash` (keccak256 of result CID, anchored on-chain), `result_cid` (IPFS pointer to submission file once metadata is reconciled), `score` (WAD-scaled score string), `scored` (boolean, set true when `Scored` event is indexed). Additional columns: `result_format` (enum: `plain_v0` for direct/public payloads or `sealed_submission_v2` for sealed envelopes), `proof_bundle_cid` (IPFS CID of the proof bundle), `proof_bundle_hash` (on-chain hash of the proof bundle), `scored_at` (timestamp when the score was posted). For `sealed_submission_v2`, `result_cid` points to the sealed envelope, not the plaintext replay artifact.

- **submission_intents** — Pre-registered off-chain submission metadata. This is the durable bridge between the solver’s pinned IPFS payload and the later on-chain `Submitted` event. Rows are keyed by `(challenge_id, solver_address, result_hash)` at reconcile time, store `result_cid` + `result_format`, and optionally point at the matched `submissions` row via `matched_submission_id`. Unmatched rows expire after the challenge deadline plus a 30-day recovery window.

- **proof_bundles** — Created during scoring. Links a submission to its proof CID and reproducibility check. Fields include `input_hash`, `output_hash`, and `container_image_hash` for full audit trail. `reproducible` indicates whether independent re-runs match. `replaySubmissionCid` may point to a plaintext replay artifact once scoring begins, which is why public verification stays locked while the challenge is open.

- **challenge_payouts** — Projected from `PayoutAllocated` events. Primary key is `(challenge_id, solver_address, rank)`. Canonical source for leaderboard rankings and solver earnings. `claimed_at` and `claim_tx_hash` are updated when the `Claimed` event is indexed.

- **indexed_events** — Deduplication table keyed on `(tx_hash, log_index)`. Prevents reprocessing of already-handled events. Also used for health monitoring by comparing `block_number` against chain head.

- **score_jobs** — Worker coordination table. States: `queued` → `running` → `scored` | `failed` | `skipped`. Includes lease management via `locked_at`, `locked_by`, and stale-lease recovery. `max_attempts` defaults to 5. `next_attempt_at` gates delayed retries. Jobs are only created or revived after a `submissions` row has both the on-chain fields and reconciled metadata (`result_cid`, `result_format`). `skipped` means the submission exceeded per-challenge or per-solver scoring limits.

- **worker_runtime_state** — Worker heartbeat and readiness table. Each scoring worker publishes `worker_id`, `host`, `runtime_version`, scorer-backend readiness, sealing readiness, and `last_error`. The `executor_ready` column means “the configured scorer execution backend is ready,” regardless of whether that backend is local Docker in dev or the remote executor in production. The API reads this table for `/api/worker-health` and runtime-mismatch detection.
- **worker_runtime_control** — Active scoring-runtime control row. The API upserts the active runtime version on startup, and score-job claims are fenced against it so older workers cannot keep claiming jobs after a deploy.

- **verifications** — Records independent re-runs of the scorer. Links a proof_bundle to a verifier address, the computed score, whether it matches the original, and an optional log CID. Created by `agora verify`. `agora verify-public` is read-only and does not insert verification rows.

- **indexer_cursors** — Operational table tracking the last processed block number per cursor key. Used by the indexer to resume from the correct position after restart.

- **auth_nonces** — SIWE and pin-spec authentication nonces. Purpose is either `siwe` or `pin_spec`. Nonces expire and are consumed on use.

- **auth_sessions** — Authenticated session tokens for SIWE sessions. Keyed by `token_hash`. Includes revocation support.

---

## Indexer Architecture

```mermaid
flowchart TB
    subgraph Chain["Base (on-chain)"]
        Events["Contract Events<br/>ChallengeCreated<br/>Submitted<br/>Scored<br/>PayoutAllocated<br/>SettlementFinalized<br/>Disputed<br/>Cancelled"]
    end

    subgraph Indexer["Chain Indexer (always-on)"]
        Poller["Factory getLogs() every 30s"]
        Active["Poll active challenges only<br/>(open, scoring, disputed,<br/>finalized with unclaimed payouts)"]
        Parser["Apply challenge events incrementally<br/>through @agora/chain"]
        Dedup["Dedup via indexed_events table"]
        Replay["Replay recent confirmed block window"]
        Repair["Targeted repair only on drift<br/>or explicit operator command"]
    end

    subgraph DB["Supabase"]
        CT["challenges table"]
        ST["submissions table"]
        PT["challenge_payouts table"]
        IE["indexed_events table"]
        IC["indexer_cursors table<br/>replay + high-water"]
    end

    subgraph Monitor["Health Monitoring"]
        Health["GET /api/indexer-health"]
        Lag["Compare: finalized chain head vs factory high-water cursor"]
    end

    Events --> Poller
    Poller --> Active
    Active --> Parser
    Parser --> Dedup
    Dedup --> Replay
    Replay --> Repair
    Repair --> CT
    Repair --> ST
    Repair --> PT
    Repair --> IC
    Dedup --> IE
    IC --> Lag
    Lag --> Health
```

### How the indexer works

- **Polls every 30 seconds** using `getLogs` against the active factory and the active challenge set only: `open`, `scoring`, `disputed`, and `finalized` challenges with unclaimed payouts.
- **Confirmation depth:** Controlled by `AGORA_INDEXER_CONFIRMATION_DEPTH` (default 3). Events are only committed to the DB once they have this many confirmations, reducing reorg risk.
- **Deduplication** via the `indexed_events` table. Each event is keyed on `(tx_hash, log_index)`. `block_hash` is also stored for replay diagnostics and shallow reorg analysis. If the key already exists, the event handler is skipped.
- **Idempotent writes** — The indexer is safe to replay. Re-running the same block range produces the same DB state. UPSERTs and conditional writes ensure no duplicate or conflicting rows.
- **Hot path is event-driven** — submissions, scores, payout allocations, settlement winner fields, and claim state are updated directly from challenge events. Full `reconcileChallengeProjection()` is reserved for targeted drift repair or explicit operator repair.
- **Replay scope is split** — the factory cursor retains a replay window for reorg safety, while quiet challenge cursors advance to the exact next block by default and only rewind when that challenge actually fails.
- **`AGORA_INDEXER_START_BLOCK`** must be set for new factory deployments. This tells the indexer where to begin scanning. Without it, the indexer will not know which blocks to poll for the new factory's events.

---

## Event to Projection Mapping

| Event | Target Table | Action |
|-------|-------------|--------|
| `ChallengeCreated` | `challenges` | INSERT with IPFS spec fetch |
| `Submitted` | `submissions` | INSERT |
| `StatusChanged` | `challenges` | UPDATE status |
| `Scored` | `submissions` | UPDATE score, scored=true |
| `PayoutAllocated` | `challenge_payouts` | INSERT/UPSERT by `(challenge_id, solver_address, rank)` |
| `SettlementFinalized` | `challenges` | UPDATE status=finalized + winner fields |
| `Disputed` | `challenges` | Handled via `StatusChanged` event (status transitions to `disputed`) |
| `DisputeResolved` | `challenges` | UPDATE status + winner |
| `Cancelled` | `challenges` | Handled via `StatusChanged` event (status transitions to `cancelled`) |
| `Claimed` | `challenge_payouts` | UPDATE claimed_at, claim_tx_hash |

---

## Health Monitoring

- **Endpoint:** `GET /api/indexer-health`
- Compares the finalized chain head against the factory **high-water cursor**, not the replay cursor. This prevents the replay window from showing up as false lag.
- **States:**
  - `ok` — 20 blocks or fewer behind chain head
  - `warning` — 20-120 blocks behind
  - `critical` — more than 120 blocks behind (returns HTTP 503)
- Indexer health also reports the intended factory address, useful for confirming the correct contract generation is being indexed.

---

## Projection Rules

- **DB is a cache, not truth.** If DB and chain disagree, chain wins.
- **Fairness-sensitive visibility checks** (e.g., leaderboard during `Open` status) use chain `status()`, not projected status. This prevents premature leaderboard exposure due to indexer lag.
- **Public global reputation** surfaces use finalized challenges only. Win rate and earned USDC derive from `challenge_payouts` rows where the parent challenge is finalized.
- **Effective vs persisted status:** The contract `status()` view returns `Scoring` after the deadline even if the persisted storage slot is still `Open`. Off-chain consumers should use `status()` for visibility decisions. The DB projection may conservatively lag until the `StatusChanged(Open, Scoring)` event is indexed.
- **Submission reconciliation:** clients pre-register `submission_intents` before they submit on-chain. The API submit-accelerator path and the indexer both reconcile `(challenge_id, solver_address, result_hash)` against pending `submissions` rows. This keeps submissions scoreable even if the post-submit HTTP call fails.

- **Worker coordination:** The worker only claims `score_jobs` after the challenge enters `Scoring` at deadline and only when its `runtime_version` matches the active row in `worker_runtime_control`. Jobs move: `queued` → `running` → `scored` | `failed` | `skipped`. `skipped` indicates the submission exceeded per-challenge or per-solver scoring limits. The worker and API coordinate through Supabase: `score_jobs` drives scoring work, `worker_runtime_state` carries heartbeat/readiness/runtime-version state, `worker_runtime_control` fences mixed-runtime workers during deploys, the executor runs scorer containers, and `submission_intents` prevents on-chain-only submissions from becoming permanently unscoreable.

---

## Reindex / Replay

When the indexer falls behind, processes stale data, or a new factory is deployed, you may need to replay events.

- **Preview (dry-run):**
  ```bash
  agora reindex --from-block <block_number> --dry-run
  ```

- **Apply:**
  ```bash
  agora reindex --from-block <block_number>
  ```

- **Deep replay with purge:**
  ```bash
  agora reindex --from-block <block_number> --purge-indexed-events
  ```

- **Repair one projected challenge without replaying the full indexer:**
  ```bash
  agora repair-challenge --id <challenge_id>
  ```

### What each option does

- `--from-block` rewinds factory + challenge cursors for the active chain to the specified block number. The indexer will re-scan from that point on its next poll cycle.
- `--dry-run` shows what would be replayed without writing to the database.
- `--purge-indexed-events` deletes rows from `indexed_events` for the replayed range, forcing event handlers to run again even for previously processed events. Use this when you suspect corrupted projections.
- `repair-challenge` rebuilds one challenge projection from chain state at the current confirmed tip. Use this for challenge-local drift without replaying the whole factory.

### When to reindex

- After deploying a new factory (set `AGORA_INDEXER_START_BLOCK` to the deploy block first).
- After the factory address changes (align API/indexer/worker/web env first, restart all services, then reindex).
- When `GET /api/indexer-health` reports `critical` and a restart alone does not recover.
- When DB projections are visibly inconsistent with on-chain state.
