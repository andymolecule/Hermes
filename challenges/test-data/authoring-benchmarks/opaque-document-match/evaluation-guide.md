# Evaluation Guide

## Intent

This benchmark checks that Agora cleanly rejects a deterministic opaque exact-match task from the assisted Gems path and points the poster toward the explicit custom scorer workflow.

## What Should Happen

- The draft should fail out of the official table-scorer path.
- Agora should keep the role vocabulary generic:
  - `source_packet.pdf` -> `public_inputs`
  - `reference_output.pdf` -> `hidden_reference`
- The submission contract expectations should stay `opaque_file` with PDF metadata.
- The final outcome should be a clean table-scorer rejection with an explicit custom-scorer next step.

## What Should Not Happen

- It should not collapse into the legacy `reproducibility` family.
- It should not relabel the source packet as hidden just because both files are
  PDFs.

## Follow-Up Expectations

Good follow-up questions, if they appear, should stay focused on:

- confirming that the winning rule is exact match
- confirming which PDF remains hidden
- confirming reward, distribution, and deadline

Bad follow-up behavior would include:

- treating the task as a prediction challenge
- assuming a CSV submission
- pretending the assisted Gems path can publish the challenge directly
