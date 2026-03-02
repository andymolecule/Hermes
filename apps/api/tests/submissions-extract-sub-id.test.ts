import test from "node:test";
import assert from "node:assert/strict";
import { extractSubmissionIdFromSubmittedEvent } from "../src/routes/submissions.js";

test("extracts submissionId from named event args", () => {
  const subId = extractSubmissionIdFromSubmittedEvent({
    submissionId: 7n,
    solver: "0x1234",
  });
  assert.equal(subId, 7n);
});

test("extracts subId for backward compatibility", () => {
  const subId = extractSubmissionIdFromSubmittedEvent({ subId: 9n });
  assert.equal(subId, 9n);
});

test("extracts submission id from positional args", () => {
  const subId = extractSubmissionIdFromSubmittedEvent([11n, "0x1234"]);
  assert.equal(subId, 11n);
});

test("accepts numeric string ids", () => {
  const subId = extractSubmissionIdFromSubmittedEvent({ submissionId: "13" });
  assert.equal(subId, 13n);
});

test("returns undefined for invalid payload", () => {
  const subId = extractSubmissionIdFromSubmittedEvent({ submissionId: "bad" });
  assert.equal(subId, undefined);
});
