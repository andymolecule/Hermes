# Docking Test Data

Realistic posting fixtures for the Agora docking category.

This folder is useful for:
- testing the web posting flow for docking challenges
- checking that the UI field descriptions make sense to a human poster
- validating submission-format expectations for solvers

Important current limitation:
- the official docking runtime family exists
- and `containers/gems-ranking-scorer/score.py` now evaluates CSV docking predictions against hidden reference scores
- so this folder can be used as a realistic managed-authoring benchmark as long as the challenge fits the built-in CSV docking contract

This folder is still aligned to the new model:
- the official `docking` runtime family is the runtime config surface
- the current example assumes the built-in CSV docking contract with `ligand_id` and `docking_score`

## Files

### Challenge posting inputs

| File | Use in UI | Purpose |
|------|-----------|---------|
| `target_structure.pdb` | Target structure | Protein target / structure reference |
| `ligand_set.csv` | Ligand set | Molecules that solvers are expected to rank |
| `reference_scores.csv` | Reference-only support file | Example of the private scoring target you would eventually want packed into a true evaluation bundle |

### Solver submission fixtures

| File | Purpose |
|------|---------|
| `sample_submission.csv` | Valid-looking ranked docking output |
| `bad_submission_missing_score.csv` | Missing required score column |
| `bad_submission_wrong_id.csv` | Uses the wrong identifier column |

## Recommended Human UI Test Plan

## 1. Post a realistic docking challenge

Use these values in `/post`:

### Section 1: Problem
- Title: `Rank candidate ligands against a kinase binding pocket`
- Domain: `Drug Discovery`
- Description:
  `We provide a target protein structure and a ligand set. Solvers should predict docking scores and rank ligands by expected binding strength.`
  `Submissions should be CSV files with one row per ligand and a predicted docking score.`
- Tags: `docking, ranking, drug-discovery`

### Section 2: Data
- Target structure: `target_structure.pdb`
- Ligand set: `ligand_set.csv`

### Section 3: Evaluation
- Keep the official docking runtime family selected
- Metric: `Spearman`
- Submission format: `CSV with columns: ligand_id, docking_score`
- Scoring description:
  `Submissions are ranked by correlation to reference docking scores.`

## What To Test As A Human

1. Does the UI clearly communicate that the target and ligand set are different artifacts?
2. Does the solver-output format preview match what a cheminformatics poster would expect?
3. Does the confirmation contract match what a cheminformatics poster expects to publish?

## Current Gap Exposed By This Folder

A truly executable docking challenge needs a real evaluation bundle, typically containing:
- target structure
- ligand identities
- reference docking scores or labels
- any scorer-specific config

The current managed path expects a target structure, ligand set, and hidden reference score file.
