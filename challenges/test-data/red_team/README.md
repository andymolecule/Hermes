# Red Team Test Data

Realistic posting fixtures for the Agora red-team category.

This category currently relies on a poster-supplied custom scorer image. The folder is therefore aimed at human posting quality and solver-format clarity rather than built-in executable scoring.

In the current refactored model, this is a custom-scorer path:
- no official preset/runtime adapter is involved
- the poster owns the scoring contract and file semantics

## Files

| File | Use | Purpose |
|------|-----|---------|
| `baseline_cases.csv` | Upload in UI | Normal prompts / inputs and expected baseline behavior |
| `reference_outputs.csv` | Optional support file | Example baseline outputs you may mention in the post |
| `sample_submission.csv` | Solver submission example | Adversarial prompts or perturbations |
| `bad_submission_missing_attack.csv` | Solver submission example | Missing a core adversarial field |

## Recommended Human UI Test Plan

### Section 1: Problem
- Title: `Find adversarial prompts that degrade classifier reliability`
- Domain: `Other`
- Description:
  `We provide baseline prompts and baseline model outputs. Solvers should submit adversarial prompt variants that reduce model reliability while remaining within the challenge rules.`
  `A custom scorer container measures degradation relative to baseline outputs.`
- Tags: `red-team, adversarial, robustness`

### Section 2: Data
- Baseline data: `baseline_cases.csv`
- Reference outputs (optional): `reference_outputs.csv`

### Section 3: Evaluation
- Submission type: `CSV`
- Submission rules:
  `Submit a CSV with columns case_id,adversarial_input.`
- Scoring container:
  use your pinned custom scorer image

## What To Look For In Human Testing

- Does the UI make it obvious what baseline data means here?
- Is it clear that the scorer must define what "degradation" means?
- Does the example submission format give solvers enough guidance without overconstraining them?
