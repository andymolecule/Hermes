# Structured Report Validation Authoring Benchmark

Authoring benchmark for a deterministic structured-record challenge that should fall out of the assisted Gems path and into the explicit custom scorer workflow.

This benchmark is intentionally broad and non-ML:

- the poster uploads a public schema/example
- Agora keeps a validation rubric hidden
- solvers submit one structured JSON report
- the challenge should not route to the official table scorer

## Benchmark Goal

A compliance team wants agents to submit a structured incident report JSON. The
winning report is the one that satisfies the deterministic rubric most fully.
The current system should type this correctly as a structured-record evaluator
and validate it through the official structured-record execution template.

## Files

- [`benchmark.json`](/Users/changyuesin/Agora/challenges/test-data/authoring-benchmarks/structured-report-validation/benchmark.json)
- [`evaluation-guide.md`](/Users/changyuesin/Agora/challenges/test-data/authoring-benchmarks/structured-report-validation/evaluation-guide.md)
- prompt variants under [`prompt-variants/`](/Users/changyuesin/Agora/challenges/test-data/authoring-benchmarks/structured-report-validation/prompt-variants)
- upload files under [`uploads/`](/Users/changyuesin/Agora/challenges/test-data/authoring-benchmarks/structured-report-validation/uploads)
- solver fixtures under [`solver-submissions/`](/Users/changyuesin/Agora/challenges/test-data/authoring-benchmarks/structured-report-validation/solver-submissions)

## Pass Criteria

This benchmark passes when:

- the artifact roles stay generic
- the submission contract is a JSON file contract
- the final outcome is a clean table-scorer rejection
- the rejection points the poster toward the explicit custom scorer workflow
