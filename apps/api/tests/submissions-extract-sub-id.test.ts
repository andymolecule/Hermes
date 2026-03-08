import test from "node:test";
import assert from "node:assert/strict";
import { canReadPublicSubmissionVerification } from "../src/routes/submissions.js";
import { CHALLENGE_STATUS } from "@agora/common";

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
