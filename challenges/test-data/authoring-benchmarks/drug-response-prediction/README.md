# Drug Response Prediction Authoring Benchmark

Authoring benchmark for a realistic small-molecule response prediction bounty.

This benchmark is for the new `/post` abstraction, not the old YAML path. It is
meant to answer a different question from the category fixtures:

- not "does this exact canned example compile?"
- but "does the managed posting flow stay correct when a real poster describes a
  supported task in ambiguous, domain-heavy language?"

The scientific task still fits the current managed runtime surface:

- challenge type: `prediction`
- execution template: `official_table_metric_v1`
- metric: `r2`

## Benchmark Goal

A translational biology team has screened a panel of cancer cell lines against a
small set of targeted compounds at matched doses. The poster wants solvers to
predict normalized drug-response AUC for held-out compound and cell-line pairs.

The benchmark intentionally uses realistic terminology:

- drug response
- sensitivity
- viability
- normalized AUC

The onboarding flow should still land on the same managed regression family
without forcing the poster to think in schema vocabulary.

## Files

- [`benchmark.json`](/Users/changyuesin/Agora/challenges/test-data/authoring-benchmarks/drug-response-prediction/benchmark.json)
- [`evaluation-guide.md`](/Users/changyuesin/Agora/challenges/test-data/authoring-benchmarks/drug-response-prediction/evaluation-guide.md)
- prompt variants under [`prompt-variants/`](/Users/changyuesin/Agora/challenges/test-data/authoring-benchmarks/drug-response-prediction/prompt-variants)
- upload files under [`uploads/`](/Users/changyuesin/Agora/challenges/test-data/authoring-benchmarks/drug-response-prediction/uploads)
- solver fixtures under [`solver-submissions/`](/Users/changyuesin/Agora/challenges/test-data/authoring-benchmarks/drug-response-prediction/solver-submissions)

## How To Run It

1. Choose one prompt variant.
2. Paste that language into `/post`.
3. Upload the files from `uploads/`.
4. Answer the guided follow-up questions.
5. Compare the compile result against `benchmark.json`.
6. Score and submit the valid and invalid solver fixtures.

## Pass Criteria

This benchmark passes when the managed flow preserves the intended invariants:

- it stays in a supported managed path
- it classifies the task as tabular prediction
- it keeps hidden labels private
- it converges on the canonical `id,prediction` submission contract

It does **not** require one exact compile payload, one exact clarification list,
or one exact wording sequence.
