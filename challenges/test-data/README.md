# Test Data

Human-oriented fixture kits for posting and testing Agora challenge types through the web UI.

These folders are aligned to the **current preset-based scoring model**:
- challenge-family defaults come from `@agora/common/challenges/templates.ts`
- official scoring runtime config comes from `@agora/common/presets.ts`
- the worker reads cached scoring config from the DB first, with IPFS fallback only for legacy rows

They are **not** written for the removed runtime engine-adapter layer.

For end-to-end stabilization work, also use:
- [PHASE1-HARDENING-CHECKLIST.md](/Users/changyuesin/Agora/challenges/test-data/PHASE1-HARDENING-CHECKLIST.md)

Each subdirectory is organized around one category and contains:
- a realistic posting walkthrough
- concrete files to upload in the UI
- one or more sample solver submissions
- notes on what the current codebase actually supports versus what is still scaffold-only

## Directory Layout

```text
test-data/
  prediction/        fully executable prediction fixture kit
  reproducibility/   fully executable reproducibility fixture kit
  docking/           realistic posting kit; current scorer is still a placeholder
  optimization/      realistic posting kit; requires a custom scorer image
  red_team/          realistic posting kit; requires a custom scorer image
  custom/            generic custom bounty posting kit; requires a custom scorer image
```

## How To Use These Folders

1. Pick a category directory.
2. Read its `README.md` first.
3. Use the listed files while posting through `/post`.
4. Submit the provided sample solver output.
5. Compare the observed behavior with the expected outcomes documented in that folder.

## Support Status By Category

| Category | Current status | Notes |
|----------|----------------|-------|
| Prediction | Executable, aligned to new model | Uses the official `regression_v1` preset and its current default mount layout |
| Reproducibility | Executable, aligned to new model | Uses the official `csv_comparison_v1` preset and its current default mount layout |
| Docking | Posting scaffold on new model | Official `docking_v1` preset exists, but `containers/docking-scorer` is still a placeholder |
| Optimization | Posting scaffold on new model | Uses the custom-scorer path with `opaque_file` submissions |
| Red Team | Posting scaffold on new model | Uses the custom-scorer path with poster-defined scorer behavior |
| Custom | Posting scaffold on new model | Fully bring-your-own scoring contract and artifact shape |

## What To Use Tomorrow

If you are walking the stack end to end tomorrow:

1. Start with `reproducibility/`
2. Then run `prediction/`
3. Treat `docking/`, `optimization/`, `red_team/`, and `custom/` as posting-contract and UX walkthroughs unless you also have a real custom scorer image ready

## Why This Structure Exists

The goal is to keep human testing honest.

Where the repo already has a real scorer, the fixture folder tells you how to test end to end.
Where the repo does not yet have a real scorer, the fixture folder still helps you test posting UX, data organization, and solver-format expectations without pretending the scoring layer is complete.
