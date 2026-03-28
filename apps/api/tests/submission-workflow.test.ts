import assert from "node:assert/strict";
import test from "node:test";
import { SubmissionSealValidationClientError } from "../src/lib/submission-seal-validation.js";
import {
  SubmissionWorkflowError,
  buildSubmissionAgentAttributionWarning,
  cleanupSubmissionArtifact,
  reconcileTrackedSubmissionsForIntent,
  toSubmissionRegistrationResponse,
  validateSubmissionIntentPayloadBoundary,
} from "../src/lib/submission-workflow.js";

test("cleanupSubmissionArtifact refuses to delete a live submission intent", async () => {
  const db = {} as never;

  await assert.rejects(
    cleanupSubmissionArtifact({
      intentId: "2d931510-d99f-494a-8c67-87feb05e1594",
      resultCid: "ipfs://bafy-test",
      createSupabaseClientImpl: () => db,
      getSubmissionIntentByIdImpl: async () =>
        ({
          id: "2d931510-d99f-494a-8c67-87feb05e1594",
          challenge_id: "challenge-1",
          solver_address: "0xsolver",
          result_hash: "0xhash",
          submission_cid: "ipfs://bafy-test",
          trace_id: null,
          expires_at: "2026-03-31T00:00:00.000Z",
          created_at: "2026-03-20T00:00:00.000Z",
        }) as never,
      countSubmissionIntentsBySubmissionCidImpl: async () => 1,
      countSubmissionsBySubmissionCidImpl: async () => 0,
      unpinCidImpl: async () => {
        throw new Error("should not unpin");
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof SubmissionWorkflowError);
      assert.equal(error.code, "SUBMISSION_INTENT_RETENTION_REQUIRED");
      return true;
    },
  );
});

test("cleanupSubmissionArtifact unpins orphaned results when nothing references them", async () => {
  const unpinned: string[] = [];

  const result = await cleanupSubmissionArtifact({
    resultCid: "ipfs://bafy-orphan",
    createSupabaseClientImpl: () => ({}) as never,
    getSubmissionIntentByIdImpl: async () => null,
    countSubmissionIntentsBySubmissionCidImpl: async () => 0,
    countSubmissionsBySubmissionCidImpl: async () => 0,
    unpinCidImpl: async (cid) => {
      unpinned.push(cid);
    },
  });

  assert.deepEqual(result, {
    cleanedIntent: false,
    unpinned: true,
  });
  assert.deepEqual(unpinned, ["ipfs://bafy-orphan"]);
});

test("reconcileTrackedSubmissionsForIntent reprojects tracked unmatched rows after the intent arrives", async () => {
  const projected: Array<Record<string, unknown>> = [];
  const recordedTelemetry: Array<Record<string, unknown>> = [];
  const db = {
    from(table: string) {
      assert.equal(table, "submission_events");
      return {
        insert(rows: Array<Record<string, unknown>>) {
          recordedTelemetry.push(...rows);
          return {
            async select() {
              return {
                data: rows.map((row, index) => ({
                  id: `event-${index + 1}`,
                  created_at: "2026-03-26T12:00:00.000Z",
                  ...row,
                })),
                error: null,
              };
            },
          };
        },
      };
    },
  } as never;

  const result = await reconcileTrackedSubmissionsForIntent(
    {
      db,
      challenge: {
        id: "challenge-1",
        contract_address: "0x1111111111111111111111111111111111111111",
        tx_hash:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        status: "open",
        max_submissions_total: 5,
        max_submissions_per_solver: 2,
      } as never,
      intent: {
        id: "intent-1",
        solver_address: "0x2222222222222222222222222222222222222222",
        result_hash: "0xhash",
        trace_id: "trace-1",
      },
      requestId: "req-1",
      logger: {
        info: () => undefined,
      } as never,
    },
    {
      listUnmatchedSubmissionsByMatchImpl: async () => [
        {
          challenge_id: "challenge-1",
          on_chain_sub_id: 7,
          solver_address: "0x2222222222222222222222222222222222222222",
          result_hash: "0xhash",
          tx_hash:
            "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          scored: false,
          first_seen_at: "2026-03-24T00:00:00.000Z",
          last_seen_at: "2026-03-24T00:00:00.000Z",
        },
      ],
      getOnChainSubmissionImpl: async () =>
        ({
          solver: "0x2222222222222222222222222222222222222222",
          resultHash: "0xhash",
          proofBundleHash: "0xproof",
          score: 0n,
          scored: false,
          submittedAt: 1_700_000_000n,
        }) as never,
      getSubmissionByChainIdImpl: async () => null,
      projectOnChainSubmissionFromRegistrationImpl: async (_input) => {
        projected.push(_input as unknown as Record<string, unknown>);
        return {
          id: "submission-1",
        } as never;
      },
    },
  );

  assert.deepEqual(result, {
    attempted: 1,
    reconciled: 1,
  });
  assert.equal(projected.length, 1);
  assert.equal(projected[0]?.onChainSubmissionId, 7);
  assert.equal(
    projected[0]?.txHash,
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  );
  assert.equal(recordedTelemetry.length, 1);
  assert.equal(recordedTelemetry[0]?.event, "intent.reconciled_unmatched");
  assert.equal(
    recordedTelemetry[0]?.challenge_address,
    "0x1111111111111111111111111111111111111111",
  );
});

test("toSubmissionRegistrationResponse returns the canonical envelope and warning", () => {
  const response = toSubmissionRegistrationResponse({
    submission: {
      id: "submission-1",
      challenge_id: "challenge-1",
      on_chain_sub_id: 7,
      solver_address: "0x2222222222222222222222222222222222222222",
    } as never,
    challenge: {
      id: "challenge-1",
      contract_address: "0x1111111111111111111111111111111111111111",
    } as never,
    warning: {
      code: "FINALIZE_CLEANUP_FAILED",
      message: "cleanup warning",
    },
  });

  assert.deepEqual(response, {
    data: {
      submission: {
        id: "submission-1",
        challenge_id: "challenge-1",
        challenge_address: "0x1111111111111111111111111111111111111111",
        on_chain_sub_id: 7,
        solver_address: "0x2222222222222222222222222222222222222222",
        refs: {
          submissionId: "submission-1",
          challengeId: "challenge-1",
          challengeAddress: "0x1111111111111111111111111111111111111111",
          onChainSubmissionId: 7,
        },
      },
      phase: "registration_confirmed",
      warning: {
        code: "FINALIZE_CLEANUP_FAILED",
        message: "cleanup warning",
      },
    },
  });
});

test("buildSubmissionAgentAttributionWarning warns when registration is unauthenticated", () => {
  assert.deepEqual(buildSubmissionAgentAttributionWarning(null), {
    code: "AGENT_ATTRIBUTION_MISSING",
    message:
      "Submission registration succeeded without authenticated agent attribution, so payout webhooks will not fire for this run. Next step: retry future submission writes with Authorization: Bearer <api_key> if you want webhook delivery.",
  });
  assert.equal(
    buildSubmissionAgentAttributionWarning(
      "0992b396-a5b2-4cb1-97cd-94105cce2878",
    ),
    null,
  );
});

test("validateSubmissionIntentPayloadBoundary skips plain payloads", async () => {
  let called = false;

  await validateSubmissionIntentPayloadBoundary(
    {
      challengeId: "11111111-1111-4111-8111-111111111111",
      solverAddress: "0x2222222222222222222222222222222222222222",
      resultCid: "ipfs://bafy-plain",
      resultFormat: "plain_v0",
    },
    {
      validateSealedSubmissionForIntentImpl: async () => {
        called = true;
      },
    },
  );

  assert.equal(called, false);
});

test("validateSubmissionIntentPayloadBoundary maps worker validation failures into workflow errors", async () => {
  await assert.rejects(
    validateSubmissionIntentPayloadBoundary(
      {
        challengeId: "11111111-1111-4111-8111-111111111111",
        solverAddress: "0x2222222222222222222222222222222222222222",
        resultCid: "ipfs://bafy-sealed",
        resultFormat: "sealed_submission_v2",
      },
      {
        validateSealedSubmissionForIntentImpl: async () => {
          throw new SubmissionSealValidationClientError(
            400,
            "SEALED_SUBMISSION_INVALID",
            "Agora could not authenticate the sealed submission ciphertext. This usually means the AES-GCM authenticated data or ciphertext bytes do not match Agora's published sealed_submission_v2 contract exactly. Next step: reseal from the original plaintext with agora prepare-submission, or fix the custom sealer to match version, alg, kid, challengeId, lowercase solverAddress, fileName, mimeType, iv, and ciphertext exactly, then re-upload and retry.",
            {
              extras: {
                sealed_submission_validation: {
                  validation_code: "ciphertext_auth_failed",
                  key_id: "submission-seal-test",
                },
              },
            },
          );
        },
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof SubmissionWorkflowError);
      assert.equal(error.status, 400);
      assert.equal(error.code, "SEALED_SUBMISSION_INVALID");
      const validationExtras = error.options?.extras as
        | {
            sealed_submission_validation?: {
              validation_code?: string;
            };
          }
        | undefined;
      assert.equal(
        validationExtras?.sealed_submission_validation?.validation_code,
        "ciphertext_auth_failed",
      );
      return true;
    },
  );
});
