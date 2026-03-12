# Optimization Test Data

Realistic posting fixtures for the Agora optimization category.

This category is intentionally flexible and currently depends on a poster-supplied custom scorer image. That means this folder is primarily a human posting and submission-contract kit.

In the current refactored model, that means:
- no official preset/runtime adapter is required
- the poster owns the scorer image and its contract
- the example submission stays on the `opaque_file` path for now

## What This Folder Helps You Test

- whether the optimization UI reads like a plausible parameter-search bounty
- whether the evaluation bundle concept is understandable to a human poster
- whether the expected solver submission format is concrete enough
- whether your custom scorer contract is documented clearly before anyone submits

## Files

| File | Use | Purpose |
|------|-----|---------|
| `evaluation_bundle.json` | Upload in UI | Search space, constraints, and objective metadata |
| `sample_submission.json` | Solver submission example | Valid parameter proposal |
| `bad_submission_missing_param.json` | Solver submission example | Missing a required parameter |
| `baseline_results.csv` | Support file | Example benchmark results you may mention in the bounty description |

## Recommended Human UI Test Plan

### Section 1: Problem
- Title: `Optimize formulation parameters for a synthetic response objective`
- Domain: `Drug Discovery` or `Other`
- Description:
  `We provide an evaluation bundle describing the parameter space, constraints, and scoring objective.`
  `Solvers should submit candidate parameter sets that maximize the objective under the listed constraints.`
  `A custom scorer container evaluates each submission by running the simulation defined in the evaluation bundle.`
- Tags: `optimization, simulation, parameters`

### Section 2: Data
- Evaluation bundle: `evaluation_bundle.json`

### Section 3: Evaluation
- Submission type: `JSON Object`
- Submission rules:
  `Submit a JSON object containing temperature_c, ph, and catalyst_pct.`
- Scoring container:
  use your pinned custom scorer image

## Why This Folder Is Still Valuable

Even without an official built-in optimization scorer, this folder helps you test the most important product question:
- can a human poster express the optimization contract clearly enough that a solver knows what to submit?
