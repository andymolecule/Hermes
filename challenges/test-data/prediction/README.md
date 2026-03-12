# Prediction Test Data

Test fixtures for the current Agora prediction flow using the regression scorer in `containers/regression-scorer`.

This folder is designed for two related workflows:
- posting a prediction challenge through the web UI as a human poster
- submitting solver outputs to verify scoring behavior and error handling

It is intentionally small and synthetic so you can repeat the full flow quickly.

## What This Fixture Set Covers

The dataset models a simple regression task:
- 20 training rows
- 10 test rows
- 3 numeric features
- 1 numeric target label

Underlying pattern:
- `label ~= 3*feature_a - 0.5*feature_b + 5*feature_c + noise`

This is enough to test:
- normal prediction challenge posting
- hidden-labels upload and private evaluation artifact flow
- successful solver submission scoring
- malformed solver submissions
- partial / duplicate / non-numeric prediction edge cases

It is not meant to simulate a full production-scale benchmark. It is meant to look like a believable small tabular-science bounty that a human can post and test quickly.

## Current Runtime Contract

These fixtures are aligned to the current preset-based runtime.

Important current constraint:
- the official `regression_v1` preset currently resolves to the default mount layout:
  - evaluation bundle -> `ground_truth.csv`
  - solver artifact -> `submission.csv`
- the current regression scorer still expects those mounted filenames with columns `id,label` and `id,prediction`
- the current web UI exposes `Row ID column` and `Target column`, but the scorer does not actually honor arbitrary custom column names yet

For human UI testing, use the default prediction field names:
- `Row ID column`: `id`
- `Target column`: `prediction`

Do not treat those two UI fields as truly configurable yet.

## Files

### Challenge posting inputs

| File | Use in UI | Purpose |
|------|-----------|---------|
| `train.csv` | Training dataset (with labels) | Public training set with labels |
| `test.csv` | Evaluation inputs (without labels) | Public held-out inputs with no labels |
| `hidden_labels.csv` | Hidden scoring labels | Private evaluation labels used during scoring |

### Solver submission fixtures

| File | Expected result | Purpose |
|------|-----------------|---------|
| `sample_submission.csv` | Valid, high score | Standard happy path |
| `perfect_submission.csv` | Valid, score = 1.0 | Proves best-case scoring path |
| `bad_submission_missing_prediction.csv` | Invalid | Missing required `prediction` column |
| `bad_submission_wrong_id_header.csv` | Invalid | Uses `sample_id` instead of `id` |
| `bad_submission_partial_ids.csv` | Valid but incomplete | Only predicts a subset of rows |
| `bad_submission_nonnumeric.csv` | Valid file, degraded/incomplete scoring | Contains non-numeric prediction value |
| `bad_submission_duplicate_ids.csv` | Accepted by current scorer | Exposes duplicate-row behavior |

### Local scorer convenience

| File | Purpose |
|------|---------|
| `ground_truth.csv` | Local alias for direct Docker scorer runs |

## Recommended Human UI Test Plan

## 1. Post a realistic prediction challenge

Use these values in `/post`:

### Step 1: Scientific Brief
- Bounty title: `Predict assay response from tabular feature measurements`
- Challenge brief:
  `We provide a public training set of samples with numeric feature measurements and observed response values.`
  `Your task is to predict the response for a held-out test set using the same feature schema.`
  `Submissions must be a CSV with columns id,prediction. Scores are computed against private labels using R².`
- Reference paper or protocol link (optional): add a paper, notebook, or methods page if you have one
- Marketplace category: `Omics`
- Keywords (optional): `prediction, regression, assay`

Why this is a better test post:
- it sounds like a normal applied science prediction bounty
- it tells solvers what the target is, what format to submit, and how scoring works
- it is still simple enough to debug end to end

### Step 2: Data & Reference Artifacts
- Training dataset (with labels): `train.csv`
- Evaluation inputs (without labels): `test.csv`
- Hidden scoring labels: `hidden_labels.csv`

Why this matters:
- verifies the canonical prediction path where hidden labels become the evaluation bundle
- matches the current scoreability gate for prediction challenges
- mirrors the common public-train / public-test / private-labels bounty pattern

### Step 3: Submission & Scoring
- Submission artifact: fixed to CSV predictions only
- Row ID column: `id`
- Target column: `prediction`
- Primary metric: `R²`
- Solver notes (optional):
  `Predictions are matched to the held-out test set by id and evaluated against private labels using R².`

Why this matters:
- matches the actual preset + scorer contract
- avoids the current runtime mismatch around custom column names
- gives solvers a realistic, explicit submission contract

### Step 4: Reward & Timeline
- Reward pool: `10`
- Payout rule: `Top 3`
- Submission window: `7 days`
- Review window before payout: pick any dropdown option you want to validate

Why this matters:
- the frontend/backend now align to the selected dropdown value instead of silently forcing a 168h minimum
- `7 days` / `Top 3` / moderate reward is a common default-shaped bounty setup

## 2. Submit a valid solver output

Use:
- `sample_submission.csv`

What this tests:
- standard valid submission path
- prediction scorer happy path
- proof/scoring generation with a realistic but not perfect score

Expected score characteristics:
- `matched_rows = 10`
- `missing_ids = 0`
- `r2 = 0.992235768329`
- `rmse = 0.531036721894`
- `mae = 0.52`
- `pearson = 0.99943662487`
- `spearman = 1`

## 3. Submit the perfect case

Use:
- `perfect_submission.csv`

What this tests:
- best-case scoring path
- sanity check that the scorer can produce a perfect result on aligned data

Expected score characteristics:
- `score = 1.0`
- all rows matched
- zero prediction error

## 4. Test malformed solver files intentionally

### Missing prediction column
Use:
- `bad_submission_missing_prediction.csv`

Why:
- verifies user-facing failure for wrong submission header

Expected scorer behavior:
- rejects because `submission.csv` must contain `id` and `prediction`

### Wrong ID header
Use:
- `bad_submission_wrong_id_header.csv`

Why:
- exposes the current limitation that the scorer is hardcoded to `id`
- important because the UI currently makes column names look configurable

Expected scorer behavior:
- rejects because `submission.csv` does not contain `id`

### Non-numeric prediction
Use:
- `bad_submission_nonnumeric.csv`

Why:
- verifies handling of parse failures inside otherwise valid CSV structure

Expected scorer behavior:
- row with non-numeric prediction is skipped as missing/invalid
- scoring may still succeed if other rows match

## 5. Test edge-case acceptance behavior

### Partial submission
Use:
- `bad_submission_partial_ids.csv`

Why:
- checks whether partial predictions are accepted
- useful for deciding whether the platform should require complete coverage in the future

Expected current behavior:
- accepted by scorer
- lower `matched_rows`
- non-zero `missing_ids`
- not necessarily treated as invalid

### Duplicate IDs
Use:
- `bad_submission_duplicate_ids.csv`

Why:
- checks whether duplicates are rejected or double-counted
- useful robustness test because duplicates are common in real CSV mistakes

Expected current behavior:
- accepted by current scorer
- duplicate rows are not explicitly rejected
- use this to confirm whether you want stricter validation later

## What Each Posting Field Means In Practice

| UI field | Recommended value | Why |
|----------|-------------------|-----|
| Training dataset (with labels) | `train.csv` | Gives solvers labeled examples they can train on |
| Evaluation inputs (without labels) | `test.csv` | Defines the held-out rows they must predict |
| Hidden scoring labels | `hidden_labels.csv` | Provides the private ground truth used only at scoring time |
| Row ID column | `id` | Must match the current scorer contract and the test set key |
| Target column | `prediction` | Must match the current scorer contract for solver uploads |
| Primary metric | `R²` | Matches the scorer's primary ranking score |
| Payout rule | `Top 3` | Reflects the current reward-distribution control in the form |

## If You Want It To Feel More Like A Real Bounty

When posting through the UI, a realistic poster usually answers four questions clearly:
- What is being predicted?
- What files are public vs private?
- What exact CSV format must solvers submit?
- What metric determines the leaderboard?

This fixture set is strongest when your post description answers those explicitly.

Recommended plain-English bounty summary:
- `Predict the numeric assay response for each held-out sample in the test set.`
- `Use the public training data to fit any model you want.`
- `Submit a CSV with columns id,prediction.`
- `Scores are computed against private labels using R², with higher scores ranked better.`

## Local Docker Testing

If you want to test the scorer directly without the app:

```bash
docker build -t regression-scorer containers/regression-scorer/

docker run --rm \
  -v $(pwd)/challenges/test-data/prediction:/input:ro \
  -v /tmp/regression-output:/output \
  regression-scorer

cat /tmp/regression-output/score.json
```

For local direct runs:
- `ground_truth.csv` is provided as a convenience alias
- `sample_submission.csv` should be copied or mounted as `/input/submission.csv` if you are not using the Agora staging pipeline

## Robustness Gaps These Fixtures Expose

These fixtures are intentionally useful for product review, not just happy-path demos.

Current codebase gaps exposed by this folder:
- prediction column-name fields in the UI are advisory only; scoring is still hardcoded to `id`, `label`, and `prediction`
- partial submissions are currently accepted instead of being explicitly rejected
- duplicate submission IDs are currently accepted instead of being explicitly rejected
- non-numeric predictions degrade matching rather than always hard-failing the submission

If you want stricter production behavior later, these are the first places to tighten.
