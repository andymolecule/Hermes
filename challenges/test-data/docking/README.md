# Docking Test Data

Realistic posting fixtures for the Agora docking category.

This folder is useful for:
- testing the web posting flow for docking challenges
- checking that the UI field descriptions make sense to a human poster
- validating submission-format expectations for solvers

Important current limitation:
- the official docking preset exists
- but `containers/docking-scorer/score.py` is still a placeholder in the current repo
- so this folder is a realistic posting kit, not yet a meaningful executable scoring benchmark

This folder is still aligned to the new model:
- the official `docking_v1` preset is the runtime config surface
- the current example assumes the preset's default mount layout until a real docking scorer is published

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
- Keep the official docking preset selected
- Metric: `Spearman`
- Submission format: `CSV with columns: ligand_id, docking_score`
- Scoring description:
  `Submissions are ranked by correlation to reference docking scores.`

## What To Test As A Human

1. Does the UI clearly communicate that the target and ligand set are different artifacts?
2. Does the solver-output format preview match what a cheminformatics poster would expect?
3. Does the challenge still feel coherent even though the built-in docking scorer is not implemented yet?

## Current Gap Exposed By This Folder

A truly executable docking challenge needs a real evaluation bundle, typically containing:
- target structure
- ligand identities
- reference docking scores or labels
- any scorer-specific config

The current UI path only gives you two uploads here, and the runtime docking scorer is still a placeholder.
