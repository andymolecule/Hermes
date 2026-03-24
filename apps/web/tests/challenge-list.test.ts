import assert from "node:assert/strict";
import test from "node:test";
import { sortChallenges } from "../src/lib/challenge-list";
import type { Challenge } from "../src/lib/types";

function makeChallenge(
  id: string,
  overrides: Partial<Challenge> = {},
): Challenge {
  return {
    id,
    title: id,
    description: `${id} description`,
    domain: "other",
    status: "open",
    reward_amount: 10,
    deadline: "2026-03-20T00:00:00.000Z",
    challenge_type: "reproducibility",
    contract_address: "0x0000000000000000000000000000000000000001",
    factory_address: "0x0000000000000000000000000000000000000002",
    factory_challenge_id: 1,
    created_at: "2026-03-10T00:00:00.000Z",
    refs: {
      challengeId: id,
      challengeAddress: "0x0000000000000000000000000000000000000001",
      factoryAddress: "0x0000000000000000000000000000000000000002",
      factoryChallengeId: 1,
    },
    ...overrides,
  };
}

test("challenge list defaults can sort newest first by created_at", () => {
  const rows = sortChallenges(
    [
      makeChallenge("older", {
        created_at: "2026-03-10T00:00:00.000Z",
      }),
      makeChallenge("newest", {
        created_at: "2026-03-12T00:00:00.000Z",
      }),
      makeChallenge("middle", {
        created_at: "2026-03-11T00:00:00.000Z",
      }),
    ],
    "newest",
  );

  assert.deepEqual(
    rows.map((row) => row.id),
    ["newest", "middle", "older"],
  );
});

test("challenge list falls back to deadline ordering when created_at is missing", () => {
  const rows = sortChallenges(
    [
      makeChallenge("later", {
        created_at: undefined,
        deadline: "2026-03-21T00:00:00.000Z",
      }),
      makeChallenge("sooner", {
        created_at: undefined,
        deadline: "2026-03-19T00:00:00.000Z",
      }),
    ],
    "newest",
  );

  assert.deepEqual(
    rows.map((row) => row.id),
    ["later", "sooner"],
  );
});
