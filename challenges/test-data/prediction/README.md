# Prediction Test Data

Test fixtures for the current Agora prediction flow using the tabular scorer in `containers/gems-tabular-scorer`.

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

These fixtures are aligned to the current managed runtime.

Important current constraint:
- the official `tabular_regression` runtime family currently resolves to the default mount layout:
  - evaluation bundle -> `ground_truth.csv`
  - solver artifact -> `submission.csv`
- the regression scorer reads `/input/agora-runtime.json` staged by the pipeline
- the evaluation bundle still uses `id,label`
- solver submission column names now come from the challenge `submission_contract`

For simple human UI testing, the default prediction field names are still the easiest path:
- `Row ID column`: `id`
- `Target column`: `prediction`

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
| `bad_submission_partial_ids.csv` | Invalid | Missing required prediction rows |
| `bad_submission_nonnumeric.csv` | Invalid | Contains non-numeric prediction value |
| `bad_submission_duplicate_ids.csv` | Invalid | Contains duplicate prediction ids |

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
- matches the actual runtime-family + scorer contract
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
- rejected as an invalid submission
- all prediction rows must be numeric for `regression_v1`

## 5. Test edge-case acceptance behavior

### Partial submission
Use:
- `bad_submission_partial_ids.csv`

Why:
- checks whether partial predictions are accepted
- useful for deciding whether the platform should require complete coverage in the future

Expected current behavior:
- rejected as an invalid submission
- missing evaluation ids are not scored partially for `regression_v1`

### Duplicate IDs
Use:
- `bad_submission_duplicate_ids.csv`

Why:
- checks whether duplicates are rejected or double-counted
- useful robustness test because duplicates are common in real CSV mistakes

Expected current behavior:
- rejected as an invalid submission
- each evaluation id must appear at most once

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
docker build -t gems-tabular-scorer containers/gems-tabular-scorer/

docker run --rm \
  -v $(pwd)/challenges/test-data/prediction:/input:ro \
  -v /tmp/regression-output:/output \
  gems-tabular-scorer

cat /tmp/regression-output/score.json
```

For local direct runs:
- `ground_truth.csv` is provided as a convenience alias
- `sample_submission.csv` should be copied or mounted as `/input/submission.csv` if you are not using the Agora staging pipeline

## Robustness Gaps These Fixtures Expose

These fixtures are intentionally useful for product review, not just happy-path demos.

Current runtime rules this folder verifies:
- solver-facing prediction column names come from the challenge `submission_contract`
- partial submissions are rejected
- duplicate submission IDs are rejected
- non-numeric predictions are rejected

If you want stricter production behavior later, these are the first places to tighten.
