import test from "node:test";
import assert from "node:assert/strict";
import {
  canReadPublicSubmissionVerification,
  extractSubmissionIdFromSubmittedEvent,
} from "../src/routes/submissions.js";
import { CHALLENGE_STATUS } from "@agora/common";

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

test("public submission verification stays locked while challenge is open", () => {
  assert.equal(
    canReadPublicSubmissionVerification(CHALLENGE_STATUS.open),
    false,
  );
  assert.equal(
    canReadPublicSubmissionVerification(CHALLENGE_STATUS.scoring),
    true,
  );
  assert.equal(
    canReadPublicSubmissionVerification(CHALLENGE_STATUS.disputed),
    true,
  );
  assert.equal(
    canReadPublicSubmissionVerification(CHALLENGE_STATUS.finalized),
    true,
  );
});
