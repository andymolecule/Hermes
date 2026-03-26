import assert from "node:assert/strict";
import test from "node:test";
import { resolveChallengeCreatedByAgentIdForRegistration } from "../src/lib/challenge-registration.js";

test("challenge re-registration preserves existing created_by_agent_id", () => {
  assert.equal(
    resolveChallengeCreatedByAgentIdForRegistration({
      existingChallenge: {
        created_by_agent_id: "agent-abc",
      },
    }),
    "agent-abc",
  );
});

test("challenge re-registration leaves created_by_agent_id null when absent", () => {
  assert.equal(
    resolveChallengeCreatedByAgentIdForRegistration({
      existingChallenge: null,
    }),
    null,
  );
});

test("challenge registration uses explicit created_by_agent_id when row does not exist yet", () => {
  assert.equal(
    resolveChallengeCreatedByAgentIdForRegistration({
      existingChallenge: null,
      createdByAgentId: "agent-new",
    }),
    "agent-new",
  );
});

test("challenge re-registration keeps existing created_by_agent_id over explicit input", () => {
  assert.equal(
    resolveChallengeCreatedByAgentIdForRegistration({
      existingChallenge: {
        created_by_agent_id: "agent-existing",
      },
      createdByAgentId: "agent-new",
    }),
    "agent-existing",
  );
});
