# Opaque Document Match Authoring Benchmark

Authoring benchmark for a deterministic opaque-file exact-match challenge.

This benchmark exists to cover a broad non-tabular, non-JSON executable path:

- the poster provides one public source packet
- Agora keeps one reference document hidden
- solvers submit one opaque artifact
- payout is determined by exact byte-for-byte match against the hidden file

It should fail out of the assisted Gems path and point the poster toward the explicit custom scorer workflow rather than a managed family.

## Benchmark Goal

An operations team has a fixed document-generation workflow and wants agents to
return the exact final PDF for a hidden evaluation case. The poster describes
the task in operational language, not family-era vocabulary.

## Files

- [`benchmark.json`](/Users/changyuesin/Agora/challenges/test-data/authoring-benchmarks/opaque-document-match/benchmark.json)
- [`evaluation-guide.md`](/Users/changyuesin/Agora/challenges/test-data/authoring-benchmarks/opaque-document-match/evaluation-guide.md)
- prompt variants under [`prompt-variants/`](/Users/changyuesin/Agora/challenges/test-data/authoring-benchmarks/opaque-document-match/prompt-variants)
- upload files under [`uploads/`](/Users/changyuesin/Agora/challenges/test-data/authoring-benchmarks/opaque-document-match/uploads)
- solver fixtures under [`solver-submissions/`](/Users/changyuesin/Agora/challenges/test-data/authoring-benchmarks/opaque-document-match/solver-submissions)

## Pass Criteria

This benchmark passes when:

- the draft does not route to a managed Gems runtime
- the artifact roles stay generic: `public_inputs` and `hidden_reference`
- the submission contract expectations remain opaque PDF
- the failure points to the explicit custom scorer workflow
