# Custom Test Data

Generic posting fixtures for the Agora custom category.

Use this folder when you want to test the broadest bring-your-own-scorer path in the web UI.

This folder is aligned to the new model too:
- no official preset/runtime adapter is involved
- the poster defines the custom scorer contract and artifact shape
- the current example uses a JSON payload carried via `opaque_file`

## Files

| File | Use | Purpose |
|------|-----|---------|
| `public_inputs.csv` | Upload in UI | Public inputs made available to solvers |
| `evaluation_bundle.json` | Upload in UI | Private or semi-private evaluation contract used by the scorer |
| `sample_submission.json` | Solver submission example | Valid example payload |
| `bad_submission_missing_field.json` | Solver submission example | Missing one required field |
| `scorer_contract.md` | Poster reference | Plain-English explanation of what the custom scorer is expected to do |

## Recommended Human UI Test Plan

### Section 1: Problem
- Title: `Evaluate structured solution objects against a custom ruleset`
- Domain: `Other`
- Description:
  `We provide public inputs and an evaluation bundle describing the private scoring contract.`
  `Solvers submit structured JSON objects. A custom scorer container validates the submission and computes the final score.`
- Tags: `custom, json, scorer`

### Section 2: Data
- Public inputs: `public_inputs.csv`
- Evaluation dataset: `evaluation_bundle.json`

### Section 3: Evaluation
- Submission type: `JSON Object`
- Submission rules:
  `Submit a JSON object with answer_id,score_guess,justification.`
- Scoring container:
  use your pinned custom scorer image

## What This Folder Helps You Catch

- whether your bounty description explains the scorer contract clearly enough
- whether the upload fields feel coherent for a non-preset challenge
- whether the solver submission format is specific enough to avoid ambiguity
