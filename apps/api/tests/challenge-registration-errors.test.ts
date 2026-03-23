import assert from "node:assert/strict";
import test from "node:test";
import {
  getChallengeRegistrationRetryMessage,
  toChallengeRegistrationChainReadErrorResponse,
} from "../src/lib/challenge-registration.js";

test("challenge registration transient pinned reads return a retryable 409", () => {
  const response = toChallengeRegistrationChainReadErrorResponse(
    new Error("header not found"),
  );

  assert.deepEqual(response, {
    status: 409,
    code: "CHAIN_READ_NOT_READY",
    error: getChallengeRegistrationRetryMessage(),
    retriable: true,
  });
});

test("challenge registration surfaces non-transient errors as 400", () => {
  const response = toChallengeRegistrationChainReadErrorResponse(
    new Error("Missing or invalid parameters"),
  );

  assert.deepEqual(response, {
    status: 400,
    code: "CHALLENGE_REGISTRATION_INVALID",
    error: "Missing or invalid parameters",
    retriable: false,
  });
});
