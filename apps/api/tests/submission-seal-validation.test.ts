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
            code: "decrypt_failed",
            message: "The operation failed for an operation-specific reason.",
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
      assert.deepEqual(error.options?.extras, {
        sealed_submission_validation: {
          validation_code: "decrypt_failed",
          worker_message: "The operation failed for an operation-specific reason.",
          key_id: "submission-seal-test",
          public_key_fingerprint: "0xabc",
          derived_public_key_fingerprint: "0xabc",
        },
      });
      return true;
    },
  );

  assert.equal(requestedAuthorization, "Bearer worker-token");
});
