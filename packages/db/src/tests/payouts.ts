import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ChallengePayoutWrite,
  replaceChallengePayouts,
} from "../queries/payouts.js";

const payoutRows: ChallengePayoutWrite[] = [
  {
    challenge_id: "challenge-1",
    solver_address: "0xABCDEF",
    winning_on_chain_sub_id: 7,
    rank: 1,
    amount: 10,
  },
];

let capturedRpcArgs: Record<string, unknown> | null = null;
const rpcDb = {
  async rpc(name: string, args: Record<string, unknown>) {
    assert.equal(name, "replace_challenge_payouts");
    capturedRpcArgs = args;
    return {
      data: [
        {
          challenge_id: "challenge-1",
          solver_address: "0xabcdef",
          winning_on_chain_sub_id: 7,
          rank: 1,
          amount: 10,
          claimed_at: null,
          claim_tx_hash: null,
        },
      ],
      error: null,
    };
  },
} as never;

const replaced = await replaceChallengePayouts(rpcDb, "challenge-1", payoutRows);
assert.equal(replaced.length, 1);
assert.deepEqual(capturedRpcArgs, {
  p_challenge_id: "challenge-1",
  p_payouts: [
    {
      solver_address: "0xabcdef",
      winning_on_chain_sub_id: 7,
      rank: 1,
      amount: 10,
      claimed_at: null,
      claim_tx_hash: null,
    },
  ],
});

await assert.rejects(
  () =>
    replaceChallengePayouts(
      {
        async rpc() {
          return {
            data: null,
            error: {
              message:
                "Could not find the function public.replace_challenge_payouts(p_challenge_id, p_payouts)",
            },
          };
        },
      } as never,
      "challenge-1",
      payoutRows,
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
  /delete from challenge_payouts as cp\s+where cp\.challenge_id = p_challenge_id;/,
);

console.log("challenge payout replacement query checks passed");
