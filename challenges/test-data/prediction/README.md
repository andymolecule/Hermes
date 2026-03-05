# Prediction Test Data

Test fixtures for the **regression scorer** (`containers/regression-scorer`).

Tiny synthetic dataset: 20 training rows, 10 test rows, 3 features. The underlying relationship is roughly `label ~ 3*feature_a - 0.5*feature_b + 5*feature_c + noise`.

## Files

| File | Role | Who uses it |
|------|------|-------------|
| `train.csv` | Public training data with labels | Solver downloads to build model |
| `test.csv` | Public test inputs (no labels) | Solver predicts on these |
| `hidden_labels.csv` | Private ground truth for test set | Scorer compares predictions against this |
| `sample_submission.csv` | Example solver output | Quick testing without building a model |

## Posting a Challenge (Web UI)

Go to `/post`, select **Prediction** type, then fill each section:

### Section 1: Problem

| Field | What to enter | Example |
|-------|---------------|---------|
| **Title** | Short description of the prediction task | "Predict label from 3 synthetic features" |
| **Domain** | Scientific domain dropdown | Omics (or any) |
| **Description** | Explain what solvers need to predict and why | "Given features a, b, c — predict the numeric label." |
| **Tags** | Comma-separated keywords | prediction, regression, synthetic |

### Section 2: Data

| Field | Upload this file | What it contains |
|-------|-----------------|------------------|
| **Training Data** | `train.csv` | `id, feature_a, feature_b, feature_c, label` (20 rows) |
| **Test Data** | `test.csv` | `id, feature_a, feature_b, feature_c` — no label column (10 rows) |
| **Hidden Labels** | `hidden_labels.csv` | `id, label` — the ground truth (10 rows, kept private) |

### Section 3: Evaluation

| Field | What to enter | Example |
|-------|---------------|---------|
| **ID column** | Column name that joins test + submission | `id` |
| **Label column** | Column name solvers must predict | `prediction` |
| **Metric** | Primary scoring metric | R² (default) |
| **Scoring detail** | Optional extra context | "Evaluated on held-out test split" |
| **Minimum score** | Threshold for a valid submission | `0` (accept all) or `0.5` |

### Section 4: Reward & Execution

| Field | What to enter | Example |
|-------|---------------|---------|
| **Reward (USDC)** | Bounty amount (1–30 on testnet) | `10` |
| **Winner selection** | How reward is split | Top 3 |
| **Deadline** | Days until submissions close | 7 |
| **Dispute window** | Hours for dispute period (168–2160) | 168 (minimum, 7 days) |

## Submitting as a Solver

Upload `sample_submission.csv` (or your own predictions). The file must have:
- `id` column matching the IDs in `test.csv`
- `prediction` column with numeric values

Example (`sample_submission.csv`):
```csv
id,prediction
11,38.42
12,9.15
13,30.87
...
```

## Expected Scores (sample_submission.csv)

The sample submission contains near-correct predictions with small offsets:

| Metric | Value |
|--------|-------|
| R² (primary score) | ~0.99 |
| RMSE | ~0.50 |
| MAE | ~0.43 |
| Pearson | ~0.998 |
| Spearman | ~0.988 |

## Scorer Details

- **Container:** `ghcr.io/hermes-science/regression-scorer:v1`
- **Primary metric:** R² (clamped to 0-1, higher is better)
- **All metrics:** R², RMSE, MAE, Pearson, Spearman (all reported in `details`)
- **Dependencies:** None (pure Python stdlib)

## Testing Locally

```bash
# Build the scorer
docker build -t regression-scorer containers/regression-scorer/

# Run against sample data
docker run --rm \
  -v $(pwd)/challenges/test-data/prediction:/input:ro \
  -v /tmp/regression-output:/output \
  regression-scorer

# Check the score
cat /tmp/regression-output/score.json | python -m json.tool
```

Note: For local Docker testing, rename `hidden_labels.csv` to `ground_truth.csv` in the input directory, or create a symlink — the scorer expects `/input/ground_truth.csv`.
