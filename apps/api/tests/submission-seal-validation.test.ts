import assert from "node:assert/strict";
import test from "node:test";
import {
  SubmissionSealValidationClientError,
  validateSealedSubmissionForIntent,
} from "../src/lib/submission-seal-validation.js";

test("validateSealedSubmissionForIntent surfaces worker validation diagnostics", async () => {
  let requestedAuthorization: string | null = null;

  await assert.rejects(
    validateSealedSubmissionForIntent({
      resultCid: "ipfs://bafy-sealed",
      challengeId: "11111111-1111-4111-8111-111111111111",
      solverAddress: "0x2222222222222222222222222222222222222222",
      runtimeConfig: {
        sealingConfigured: true,
        workerInternalUrl: "http://worker.internal",
        workerInternalToken: "worker-token",
      },
      fetchImpl: async (_input, init) => {
        requestedAuthorization =
          (init?.headers as Record<string, string> | undefined)
            ?.authorization ?? null;
        return new Response(
          JSON.stringify({
            ok: false,
            code: "ciphertext_auth_failed",
            message: "Failed to authenticate the sealed submission ciphertext.",
            retriable: false,
            keyId: "submission-seal-test",
            publicKeyFingerprint: "0xabc",
            derivedPublicKeyFingerprint: "0xabc",
          }),
          {
            status: 400,
            headers: {
              "content-type": "application/json",
            },
          },
        );
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof SubmissionSealValidationClientError);
      assert.equal(error.status, 400);
      assert.equal(error.code, "SEALED_SUBMISSION_INVALID");
      assert.match(
        error.message,
        /authenticate the sealed submission ciphertext/i,
      );
      assert.deepEqual(error.options?.extras, {
        sealed_submission_validation: {
          validation_code: "ciphertext_auth_failed",
          worker_message:
            "Failed to authenticate the sealed submission ciphertext.",
          key_id: "submission-seal-test",
          public_key_fingerprint: "0xabc",
          derived_public_key_fingerprint: "0xabc",
        },
        submission_helper: {
          mode: "official_helper_required",
          workflow_version: "submission_helper_v1",
          prepare_command:
            "agora prepare-submission ./submission.csv --challenge <challenge_uuid> --key env:AGORA_PRIVATE_KEY --format json",
          submit_command:
            "agora submit ./submission.csv --challenge <challenge_uuid> --key env:AGORA_PRIVATE_KEY --format json",
          note: "Autonomous agents should call the official local helper instead of implementing submission transport or submission crypto directly. Raw HTTP submission routes and custom sealers are advanced interop only.",
        },
      });
      return true;
    },
  );

  assert.equal(requestedAuthorization, "Bearer worker-token");
});

test("validateSealedSubmissionForIntent maps key unwrap failures into actionable guidance", async () => {
  await assert.rejects(
    validateSealedSubmissionForIntent({
      resultCid: "ipfs://bafy-sealed",
      challengeId: "11111111-1111-4111-8111-111111111111",
      solverAddress: "0x2222222222222222222222222222222222222222",
      runtimeConfig: {
        sealingConfigured: true,
        workerInternalUrl: "http://worker.internal",
        workerInternalToken: "worker-token",
      },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            ok: false,
            code: "key_unwrap_failed",
            message: "Failed to unwrap the sealed submission AES key.",
            retriable: false,
            keyId: "submission-seal-test",
            publicKeyFingerprint: "0xabc",
            derivedPublicKeyFingerprint: "0xabc",
          }),
          {
            status: 400,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
    }),
    (error: unknown) => {
      assert.ok(error instanceof SubmissionSealValidationClientError);
      assert.equal(error.status, 400);
      assert.equal(error.code, "SEALED_SUBMISSION_INVALID");
      assert.match(error.message, /RSA-OAEP.*SHA-256/i);
      return true;
    },
  );
});
