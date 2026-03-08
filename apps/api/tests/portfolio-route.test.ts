import assert from "node:assert/strict";
import test from "node:test";
import type { MiddlewareHandler } from "hono";
import { createPortfolioRouter } from "../src/routes/portfolio.js";
import type { ApiEnv } from "../src/types.js";

test("portfolio route requires a session", async () => {
  const rejectSession: MiddlewareHandler<ApiEnv> = async (c) =>
    c.json({ error: "Unauthorized." }, 401);

  const router = createPortfolioRouter({
    createSupabaseClient: () => ({}) as never,
    getChallengePayoutByAddress: async () => 0n,
    listChallengePayoutsBySolver: async () => [],
    listSubmissionsBySolver: async () => [],
    requireSiweSession: rejectSession,
  });

  const response = await router.request(new Request("http://localhost/"));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorized." });
});

test("portfolio route returns only the session wallet portfolio", async () => {
  const sessionAddress = "0x00000000000000000000000000000000000000aa";
  let requestedAddress = "";
  let requestedLimit = 0;

  const allowSession: MiddlewareHandler<ApiEnv> = async (c, next) => {
    c.set("sessionAddress", sessionAddress);
    await next();
  };

  const router = createPortfolioRouter({
    createSupabaseClient: () => ({}) as never,
    getChallengePayoutByAddress: async () => 5_000_000n,
    listChallengePayoutsBySolver: async () => [
      {
        challenge_id: "challenge-1",
        amount: "4.5",
        claimed_at: null,
        claim_tx_hash: null,
      },
      {
        challenge_id: "challenge-1",
        amount: "0.5",
        claimed_at: null,
        claim_tx_hash: null,
      },
    ],
    listSubmissionsBySolver: async (_db, address, limit) => {
      requestedAddress = address;
      requestedLimit = limit;
      return [
        {
          challenge_id: "challenge-1",
          on_chain_sub_id: 7,
          solver_address: sessionAddress,
          score: "100",
          scored: true,
          submitted_at: "2026-03-07T00:00:00.000Z",
          scored_at: "2026-03-07T01:00:00.000Z",
          challenges: {
            id: "challenge-1",
            title: "Finalized challenge",
            domain: "omics",
            challenge_type: "prediction",
            status: "finalized",
            reward_amount: 10,
            distribution_type: "winner_take_all",
            contract_address: "0x0000000000000000000000000000000000000001",
            deadline: "2026-03-06T00:00:00.000Z",
          },
        },
      ] as never[];
    },
    requireSiweSession: allowSession,
  });

  const response = await router.request(new Request("http://localhost/"));
  assert.equal(response.status, 200);

  const body = (await response.json()) as {
    data: {
      address: string;
      totalSubmissions: number;
      challengesParticipated: number;
      submissions: Array<{
        solver_address: string;
        payout_amount: string | number | null;
        payout_claimable_amount: string;
      }>;
    };
  };

  assert.equal(requestedAddress, sessionAddress);
  assert.equal(requestedLimit, 100);
  assert.equal(body.data.address, sessionAddress);
  assert.equal(body.data.totalSubmissions, 1);
  assert.equal(body.data.challengesParticipated, 1);
  assert.equal(body.data.submissions[0]?.solver_address, sessionAddress);
  assert.equal(body.data.submissions[0]?.payout_amount, "5");
  assert.equal(body.data.submissions[0]?.payout_claimable_amount, "5000000");
});
