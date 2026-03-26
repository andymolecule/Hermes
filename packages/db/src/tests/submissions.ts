import assert from "node:assert/strict";
import test from "node:test";
import { AgoraError } from "@agora/common";
import {
  getSubmissionById,
  getSubmissionByIdOrNull,
} from "../queries/submissions.js";

test("getSubmissionByIdOrNull returns null when no submission row exists", async () => {
  const db = {
    from(table: string) {
      assert.equal(table, "submissions");
      return {
        select(selection: string) {
          assert.equal(selection, "*");
          return {
            eq(field: string, value: unknown) {
              assert.equal(field, "id");
              assert.equal(value, "11111111-1111-4111-8111-111111111111");
              return this;
            },
            async maybeSingle() {
              return { data: null, error: null };
            },
          };
        },
      };
    },
  } as never;

  const submission = await getSubmissionByIdOrNull(
    db,
    "11111111-1111-4111-8111-111111111111",
  );

  assert.equal(submission, null);
});

test("getSubmissionById throws a 404 AgoraError when no submission row exists", async () => {
  const db = {
    from(table: string) {
      assert.equal(table, "submissions");
      return {
        select(selection: string) {
          assert.equal(selection, "*");
          return {
            eq(field: string, value: unknown) {
              assert.equal(field, "id");
              assert.equal(value, "11111111-1111-4111-8111-111111111111");
              return this;
            },
            async maybeSingle() {
              return { data: null, error: null };
            },
          };
        },
      };
    },
  } as never;

  await assert.rejects(
    getSubmissionById(db, "11111111-1111-4111-8111-111111111111"),
    (error: unknown) => {
      assert.ok(error instanceof AgoraError);
      assert.equal(error.code, "SUBMISSION_NOT_FOUND");
      assert.equal(error.status, 404);
      assert.equal(error.nextAction, "Confirm the submission id and retry.");
      return true;
    },
  );
});
