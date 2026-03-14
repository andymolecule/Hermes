import assert from "node:assert/strict";
import test from "node:test";
import {
  getChallengeRegistrationRetryMessage,
  toChallengeRegistrationChainReadErrorResponse,
} from "../src/routes/challenges.js";

test("challenge registration transient pinned reads return a retryable 409", () => {
  const response = toChallengeRegistrationChainReadErrorResponse(
    new Error("header not found"),
  );

  assert.deepEqual(response, {
    status: 409,
    error: getChallengeRegistrationRetryMessage(),
  });
});

test("challenge registration surfaces non-transient errors as 400", () => {
  const response = toChallengeRegistrationChainReadErrorResponse(
    new Error("Missing or invalid parameters"),
  );

  assert.deepEqual(response, {
    status: 400,
    error: "Missing or invalid parameters",
  });
});
