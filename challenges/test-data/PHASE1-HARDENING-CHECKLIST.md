# Phase 1 Hardening Checklist

Use this runbook while manually testing Agora's current public-benchmark product loop:

1. Poster posts challenge
2. Solver submits
3. Worker scores
4. Challenge finalizes
5. Solver claims

This checklist is for **Phase 1 hardening**, not new product scope. If these flows are not boring and repeatable yet, do not broaden into privacy tiers or more challenge categories.

## Scope

Phase 1 means:
- public challenge metadata
- public benchmark workflows
- sealed submissions until scoring
- deterministic official scoring
- on-chain settlement

Current turnkey categories:
- `reproducibility`
- `prediction`

These fixture runs now target the current preset-based scoring model:
- challenge-family defaults come from `@agora/common/challenges/templates.ts`
- official scoring runtime config comes from `@agora/common/presets.ts`
- worker scoring reads cached DB config first and only falls back to IPFS for legacy rows

## Before You Start

Confirm the environment is aligned:

- fresh active factory is deployed
- `AGORA_FACTORY_ADDRESS` is the same across API, indexer, worker, web, and local CLI
- `AGORA_INDEXER_START_BLOCK` matches the new factory deploy block
- Supabase was reset and all current migrations were applied, including [007_cache_challenge_scoring_config.sql](/Users/changyuesin/Agora/packages/db/supabase/migrations/007_cache_challenge_scoring_config.sql)
- Docker is running
- Pinata is configured
- worker is healthy
- indexer is healthy

Run:

```bash
./scripts/preflight-testnet.sh
```

Check:
- `/healthz`
- `/api/indexer-health`
- `/api/worker-health`

## Test Order

Run these in order:

1. Reproducibility happy path
2. Prediction happy path
3. Negative submission path
4. Worker/indexer interruption recovery
5. Fresh reset + replay check

## Test 1: Reproducibility Happy Path

Use:
- [reproducibility README](/Users/changyuesin/Agora/challenges/test-data/reproducibility/README.md)
- [input_dataset.csv](/Users/changyuesin/Agora/challenges/test-data/reproducibility/input_dataset.csv)
- [expected_output.csv](/Users/changyuesin/Agora/challenges/test-data/reproducibility/expected_output.csv)
- [sample_submission.csv](/Users/changyuesin/Agora/challenges/test-data/reproducibility/sample_submission.csv)

Recommended posting settings:
- reward: `10 USDC`
- payout rule: `Winner takes all`
- submission window: `30 min`
- review window before payout: `0`

Expected behavior:
- challenge appears in list/detail
- solver can submit while `Open`
- leaderboard and public verification stay hidden while `Open`
- after deadline, challenge enters `Scoring`
- worker picks up the score job
- proof bundle is created
- public verification becomes available
- finalize succeeds
- claim succeeds

Record:
- challenge tx hash
- submission tx hash
- score tx hash
- finalize tx hash
- claim tx hash

## Test 2: Prediction Happy Path

Use:
- [prediction README](/Users/changyuesin/Agora/challenges/test-data/prediction/README.md)
- [train.csv](/Users/changyuesin/Agora/challenges/test-data/prediction/train.csv)
- [test.csv](/Users/changyuesin/Agora/challenges/test-data/prediction/test.csv)
- [hidden_labels.csv](/Users/changyuesin/Agora/challenges/test-data/prediction/hidden_labels.csv)
- [sample_submission.csv](/Users/changyuesin/Agora/challenges/test-data/prediction/sample_submission.csv)

Expected behavior:
- challenge posts cleanly from the current `/post` flow
- solver submission succeeds
- worker scores after deadline
- challenge finalizes
- payout and portfolio surfaces reflect the canonical result

Important truth to keep in mind:
- this is still a Phase 1 benchmark workflow
- do not interpret it as strong private-label product validation

## Test 3: Negative Submission Path

Run at least one bad submission in each turnkey category.

Reproducibility options:
- [bad_submission_missing_column.csv](/Users/changyuesin/Agora/challenges/test-data/reproducibility/bad_submission_missing_column.csv)
- [bad_submission_extra_rows.csv](/Users/changyuesin/Agora/challenges/test-data/reproducibility/bad_submission_extra_rows.csv)

Prediction options:
- [bad_submission_missing_prediction.csv](/Users/changyuesin/Agora/challenges/test-data/prediction/bad_submission_missing_prediction.csv)
- [bad_submission_wrong_id_header.csv](/Users/changyuesin/Agora/challenges/test-data/prediction/bad_submission_wrong_id_header.csv)
- [bad_submission_nonnumeric.csv](/Users/changyuesin/Agora/challenges/test-data/prediction/bad_submission_nonnumeric.csv)

Expected behavior:
- failure is clear to the user
- no partial payout state is created
- no misleading public verification appears
- score jobs end in the correct failure or skip state

## Test 4: Operational Interruption Recovery

During an active challenge lifecycle:

1. restart the worker
2. confirm queued work resumes
3. restart the indexer
4. confirm it catches back up without manual DB fixes

Expected behavior:
- no duplicate payout projection
- no stuck lifecycle state
- no manual DB patching required

## Test 5: Fresh Reset + Replay

This is the replay sanity test.

1. reset Supabase
2. apply all current migrations
3. restart indexer against the active factory
4. confirm the DB rebuilds correctly from chain truth

Expected behavior:
- no old factory data reappears
- challenge and submission rows rebuild correctly
- payout and claim rows project correctly
- leaderboard and portfolio still reflect canonical settlement

## Watch During Every Run

Observe these surfaces while testing:

- `/healthz`
- `/api/indexer-health`
- `/api/worker-health`
- worker logs
- challenge list
- challenge detail
- public verification route
- portfolio
- leaderboard

## What Should Block Phase 2

Do not broaden into privacy or managed-private challenge work if any of these are still unstable:

- upload still intermittently fails
- worker scoring stalls or needs manual rescue
- finalize or claim sometimes requires manual intervention
- replay leaves wrong payout or claim state
- list/detail/worker disagree on lifecycle state
- docs or UI still misrepresent what the system does

## Exit Criteria

Phase 1 is hardened when all of these are true:

- 3 consecutive happy-path runs complete without manual fixes
- 1 negative-path run fails cleanly
- 1 restart/recovery run succeeds
- 1 reset/replay run succeeds
- no product copy contradicts runtime behavior

At that point, Phase 1 is stable enough to justify evaluating a protected-evaluation Phase 2.
