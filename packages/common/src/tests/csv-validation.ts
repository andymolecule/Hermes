import assert from "node:assert/strict";
import { parseCsvHeaders, validateCsvHeaders } from "../validation/csv.js";

assert.deepEqual(
  parseCsvHeaders(
    "\uFEFFsample_id,normalized_signal,condition\r\n1,0.5,treated",
  ),
  ["sample_id", "normalized_signal", "condition"],
  "parseCsvHeaders should strip UTF-8 BOM and CRLF from the first row",
);

const validCsv = validateCsvHeaders(
  "sample_id,normalized_signal,condition\n1,0.5,treated",
  ["sample_id", "normalized_signal", "condition"],
);
assert.equal(validCsv.valid, true);
assert.deepEqual(validCsv.missingColumns, []);

const invalidCsv = validateCsvHeaders("sample_id,normalized_signal\n1,0.5", [
  "sample_id",
  "normalized_signal",
  "condition",
]);
assert.equal(invalidCsv.valid, false);
assert.deepEqual(invalidCsv.missingColumns, ["condition"]);
assert.deepEqual(invalidCsv.extraColumns, []);

console.log("csv validation passed");
