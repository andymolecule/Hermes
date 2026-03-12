import assert from "node:assert/strict";
import {
  createCsvTableSubmissionContract,
  createOpaqueFileSubmissionContract,
  deriveExpectedColumns,
  describeSubmissionArtifact,
  validateSubmissionBytesAgainstContract,
  validateSubmissionTextAgainstContract,
} from "../schemas/submission-contract.js";

const csvContract = createCsvTableSubmissionContract({
  requiredColumns: ["sample_id", "normalized_signal", "condition"],
  idColumn: "sample_id",
  valueColumn: "normalized_signal",
});

assert.deepEqual(deriveExpectedColumns(csvContract), [
  "sample_id",
  "normalized_signal",
  "condition",
]);
assert.equal(describeSubmissionArtifact(csvContract), "CSV file");

const validCsv = validateSubmissionTextAgainstContract(
  "sample_id,normalized_signal,condition\ns1,0.5,treated\n",
  csvContract,
);
assert.equal(validCsv.valid, true);

const invalidCsv = validateSubmissionTextAgainstContract(
  "sample_id,normalized_signal\ns1,0.5\n",
  csvContract,
);
assert.equal(invalidCsv.valid, false);
assert.match(
  invalidCsv.message ?? "",
  /sample_id, normalized_signal, condition/,
);
assert.deepEqual(invalidCsv.missingColumns, ["condition"]);

const invalidBytes = validateSubmissionBytesAgainstContract(
  new Uint8Array([0xff, 0xfe, 0xfd]),
  csvContract,
);
assert.equal(invalidBytes.valid, false);
assert.match(invalidBytes.message ?? "", /UTF-8 encoded \.csv file/);

const opaqueContract = createOpaqueFileSubmissionContract({
  extension: ".zip",
});
assert.equal(describeSubmissionArtifact(opaqueContract), ".zip file");
assert.deepEqual(deriveExpectedColumns(opaqueContract), []);

console.log("submission contract tests passed");
