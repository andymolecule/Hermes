import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendAuthoringSessionConversationLog,
  AuthoringSessionWriteConflictError,
} from "../queries/authoring-sessions.js";

const appendedRow = {
  id: "session-1",
  poster_address: null,
  creator_type: "agent",
  creator_agent_id: "agent-1",
  state: "awaiting_input",
  intent_json: null,
  authoring_ir_json: null,
  uploaded_artifacts_json: [],
  compilation_json: null,
  conversation_log_json: [
    {
      timestamp: "2026-03-23T12:00:00.000Z",
      request_id: "req-1",
      route: "patch",
      event: "turn.validation_failed",
      actor: "system",
      summary: "Agora rejected the turn before state changed.",
      state_before: "awaiting_input",
      state_after: "awaiting_input",
      error: {
        message: "Invalid patch payload.",
      },
    },
  ],
  published_challenge_id: null,
  published_spec_json: null,
  published_spec_cid: null,
  published_at: null,
  failure_message: null,
  expires_at: "2026-03-24T00:00:00.000Z",
  created_at: "2026-03-23T10:00:00.000Z",
  updated_at: "2026-03-23T12:00:00.000Z",
};

let capturedRpcArgs: Record<string, unknown> | null = null;
const rpcDb = {
  async rpc(name: string, args: Record<string, unknown>) {
    assert.equal(name, "append_authoring_session_conversation_log");
    capturedRpcArgs = args;
    return { data: [appendedRow], error: null };
  },
} as never;

const appended = await appendAuthoringSessionConversationLog(rpcDb, {
  id: "session-1",
  entries: [
    {
      timestamp: "2026-03-23T12:00:00.000Z",
      request_id: "req-1",
      route: "patch",
      event: "turn.validation_failed",
      actor: "system",
      summary: "Agora rejected the turn before state changed.",
      state_before: "awaiting_input",
      state_after: "awaiting_input",
      error: {
        message: "Invalid patch payload.",
      },
    },
  ],
  expected_updated_at: "2026-03-23T11:59:00.000Z",
});
assert.equal(appended.id, "session-1");
assert.deepEqual(capturedRpcArgs, {
  p_session_id: "session-1",
  p_entries: [
    {
      timestamp: "2026-03-23T12:00:00.000Z",
      request_id: "req-1",
      route: "patch",
      event: "turn.validation_failed",
      actor: "system",
      summary: "Agora rejected the turn before state changed.",
      state_before: "awaiting_input",
      state_after: "awaiting_input",
      error: {
        message: "Invalid patch payload.",
      },
    },
  ],
  p_expected_updated_at: "2026-03-23T11:59:00.000Z",
});

await assert.rejects(
  () =>
    appendAuthoringSessionConversationLog(
      {
        async rpc() {
          return {
            data: [],
            error: null,
          };
        },
      } as never,
      {
        id: "session-1",
        entries: [],
        expected_updated_at: "2026-03-23T11:59:00.000Z",
      },
    ),
  AuthoringSessionWriteConflictError,
);

await assert.rejects(
  () =>
    appendAuthoringSessionConversationLog(
      {
        async rpc() {
          return {
            data: null,
            error: {
              message:
                "Could not find the function public.append_authoring_session_conversation_log(p_session_id, p_entries, p_expected_updated_at)",
            },
          };
        },
      } as never,
      {
        id: "session-1",
        entries: [],
      },
    ),
  /001_baseline\.sql/,
);

const baselineMigration = readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../supabase/migrations/001_baseline.sql",
  ),
  "utf8",
);
assert.match(
  baselineMigration,
  /create or replace function append_authoring_session_conversation_log\(/,
);

console.log("authoring session conversation log query checks passed");
