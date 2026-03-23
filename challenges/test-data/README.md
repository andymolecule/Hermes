# Test Data

Human-oriented fixture kits for posting and testing Agora challenge types through the web UI.

These folders are aligned to the **current managed-runtime scoring model**:
- challenge-family defaults come from `@agora/common/challenges/templates.ts`
- official scoring runtime config comes from `@agora/common/runtime-families.ts`
- the worker reads cached scoring config from the DB first, with IPFS fallback only for legacy rows

They are **not** written for the removed runtime engine-adapter layer.

For end-to-end stabilization work, also use:
- [PHASE1-HARDENING-CHECKLIST.md](/Users/changyuesin/Agora/challenges/test-data/PHASE1-HARDENING-CHECKLIST.md)

Each subdirectory is organized around one category and contains:
- a realistic posting walkthrough
- concrete files to upload in the UI
- one or more sample solver submissions
- notes on what the current codebase actually supports versus what is still scaffold-only

The next layer of this test-data system is an **authoring benchmark corpus**:
- realistic poster language instead of keyword-only prompts
- multiple prompt variants for the same scientific intent
- upload files grouped the way a human poster would think about them
- expected invariants instead of one exact hardcoded compile output
- acceptable compile states and required follow-up behavior
- valid and invalid solver submissions tied to the same post

## Directory Layout

```text
test-data/
  prediction/        fully executable prediction fixture kit
  reproducibility/   fully executable reproducibility fixture kit
  docking/           fully executable docking fixture kit
  optimization/      realistic posting kit; requires a custom scorer image
  red_team/          realistic posting kit; requires a custom scorer image
  custom/            generic custom bounty posting kit; requires a custom scorer image
  authoring-benchmarks/
    bundle-code-judge/
    drug-response-prediction/
    json-reference-match/
    opaque-document-match/
    structured-report-validation/
      README.md
      benchmark.json
      evaluation-guide.md
      prompt-variants/
      uploads/
      solver-submissions/
```

## How To Use These Folders

1. Pick a category directory.
2. Read its `README.md` first.
3. Use the listed files while posting through `/post`.
4. Submit the provided sample solver output.
5. Compare the observed behavior with the expected outcomes documented in that folder.

For authoring benchmarks:

1. Pick one prompt under `prompt-variants/`.
2. Post through `/post` using that prompt in natural language.
3. Upload the files under `uploads/`.
4. Compare the compile result with the invariants in `benchmark.json`.
5. Check the follow-up behavior against `evaluation-guide.md`.
6. Submit the files under `solver-submissions/valid/` and `solver-submissions/invalid/`.
7. Record where the guided flow handled ambiguity well and where it did not.

## Support Status By Category

| Category | Current status | Notes |
|----------|----------------|-------|
| Prediction | Executable, aligned to new model | Uses the official `official_table_metric_v1` template and the current default mount layout |
| Reproducibility | Historical exact-match example | Legacy scorer fixture carried as reference data, not the primary v1 table-template path |
| Docking | Historical scorer example | Legacy family-era docking fixture carried as reference data, not the primary v1 table-template path |
| Optimization | Posting scaffold on new model | Uses the custom-scorer path with `opaque_file` submissions |
| Red Team | Posting scaffold on new model | Uses the custom-scorer path with poster-defined scorer behavior |
| Custom | Posting scaffold on new model | Fully bring-your-own scoring contract and artifact shape |

## Authoring Benchmark Standard

Use this structure for realistic onboarding benchmarks:

- `benchmark.json`
  - the benchmark id, managed support status, compile invariants, acceptable states, and banned outcomes
- `prompt-variants/`
  - different ways a real poster might describe the same task
- `uploads/`
  - the files the poster uploads through `/post`
- `solver-submissions/valid/`
  - at least one accepted submission
- `solver-submissions/invalid/`
  - malformed or semantically wrong outputs
- `evaluation-guide.md`
  - what follow-up questions should happen, what ambiguity is intentional, and what counts as a pass

This keeps the onboarding abstraction honest:
- open-ended in language
- evaluated on invariants, not one exact output blob
- still bounded by the runtime families the backend can actually compile safely

## What To Use Tomorrow

If you are walking the stack end to end tomorrow:

1. Start with `reproducibility/`
2. Then run `prediction/`
3. Then run `docking/`
4. Then run `authoring-benchmarks/drug-response-prediction/`
5. Treat `optimization/`, `red_team/`, and `custom/` as posting-contract and UX walkthroughs unless you also have a real custom scorer image ready

## Why This Structure Exists

The goal is to keep human testing honest.

Where the repo already has a real scorer, the fixture folder tells you how to test end to end.
Where the repo does not yet have a real scorer, the fixture folder still helps you test posting UX, data organization, and solver-format expectations without pretending the scoring layer is complete.

The authoring benchmark corpus extends that idea one step further: it tests whether the posting abstraction still works when the poster speaks like a real operator, scientist, analyst, or reviewer instead of like an internal schema author.
