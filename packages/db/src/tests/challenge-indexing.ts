import assert from "node:assert/strict";
import test from "node:test";
import { CHALLENGE_STATUS } from "@agora/common";
import { listChallengesForIndexing } from "../queries/challenges.js";

type ChallengeRow = {
  id: string;
  status: string;
  contract_address: string;
  factory_address: string;
  tx_hash: string;
  max_submissions_total: number | null;
  max_submissions_per_solver: number | null;
};

function createFakeDb(input: {
  challenges: ChallengeRow[];
  unclaimedPayoutChallengeIds: string[];
}) {
  return {
    from(table: string) {
      if (table === "challenges") {
        return {
          select() {
            return {
              in(column: string, values: string[]) {
                assert.equal(column, "status");
                return Promise.resolve({
                  data: input.challenges.filter((challenge) =>
                    values.includes(challenge.status),
                  ),
                  error: null,
                });
              },
              eq(column: string, value: string) {
                assert.equal(column, "status");
                return {
                  in(nestedColumn: string, ids: string[]) {
                    assert.equal(nestedColumn, "id");
                    return Promise.resolve({
                      data: input.challenges.filter(
                        (challenge) =>
                          challenge.status === value &&
                          ids.includes(challenge.id),
                      ),
                      error: null,
                    });
                  },
                };
              },
            };
          },
        };
      }

      if (table === "challenge_payouts") {
        return {
          select() {
            return {
              is(column: string, value: null) {
                assert.equal(column, "claimed_at");
                assert.equal(value, null);
                return Promise.resolve({
                  data: input.unclaimedPayoutChallengeIds.map(
                    (challengeId) => ({
                      challenge_id: challengeId,
                    }),
                  ),
                  error: null,
                });
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table access: ${table}`);
    },
  };
}

test("listChallengesForIndexing only returns active rows and finalized rows with unclaimed payouts", async () => {
  const rows: ChallengeRow[] = [
    {
      id: "open-1",
      status: CHALLENGE_STATUS.open,
      contract_address: "0x0000000000000000000000000000000000000001",
      factory_address: "0x000000000000000000000000000000000000000f",
      tx_hash: "0x1",
      max_submissions_total: 10,
      max_submissions_per_solver: 3,
    },
    {
      id: "scoring-1",
      status: CHALLENGE_STATUS.scoring,
      contract_address: "0x0000000000000000000000000000000000000002",
      factory_address: "0x000000000000000000000000000000000000000f",
      tx_hash: "0x2",
      max_submissions_total: 10,
      max_submissions_per_solver: 3,
    },
    {
      id: "disputed-1",
      status: CHALLENGE_STATUS.disputed,
      contract_address: "0x0000000000000000000000000000000000000003",
      factory_address: "0x000000000000000000000000000000000000000f",
      tx_hash: "0x3",
      max_submissions_total: 10,
      max_submissions_per_solver: 3,
    },
    {
      id: "finalized-claimable",
      status: CHALLENGE_STATUS.finalized,
      contract_address: "0x0000000000000000000000000000000000000004",
      factory_address: "0x000000000000000000000000000000000000000f",
      tx_hash: "0x4",
      max_submissions_total: 10,
      max_submissions_per_solver: 3,
    },
    {
      id: "finalized-complete",
      status: CHALLENGE_STATUS.finalized,
      contract_address: "0x0000000000000000000000000000000000000005",
      factory_address: "0x000000000000000000000000000000000000000f",
      tx_hash: "0x5",
      max_submissions_total: 10,
      max_submissions_per_solver: 3,
    },
    {
      id: "cancelled-1",
      status: CHALLENGE_STATUS.cancelled,
      contract_address: "0x0000000000000000000000000000000000000006",
      factory_address: "0x000000000000000000000000000000000000000f",
      tx_hash: "0x6",
      max_submissions_total: 10,
      max_submissions_per_solver: 3,
    },
  ];

  const result = await listChallengesForIndexing(
    createFakeDb({
      challenges: rows,
      unclaimedPayoutChallengeIds: [
        "finalized-claimable",
        "finalized-claimable",
      ],
    }) as never,
  );

  assert.deepEqual(result.map((row) => row.id).sort(), [
    "disputed-1",
    "finalized-claimable",
    "open-1",
    "scoring-1",
  ]);
});
