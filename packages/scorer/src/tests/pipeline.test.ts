import assert from "node:assert/strict";
import test from "node:test";
import { createCsvTableSubmissionContract } from "@agora/common";
import { executeScoringPipeline } from "../pipeline.js";

test("executeScoringPipeline rejects contract-invalid CSV before Docker runs", async () => {
  const run = await executeScoringPipeline({
    image: "ghcr.io/example/unused:latest",
    submission: {
      content: "sample_id,normalized_signal\ns1,0.5\n",
    },
    submissionContract: createCsvTableSubmissionContract({
      requiredColumns: ["sample_id", "normalized_signal", "condition"],
      idColumn: "sample_id",
      valueColumn: "normalized_signal",
    }),
  });

  assert.equal(run.result.ok, false);
  assert.match(run.result.error ?? "", /Missing: condition/);
  await run.cleanup();
});
