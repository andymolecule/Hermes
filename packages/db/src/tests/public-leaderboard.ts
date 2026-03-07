import assert from "node:assert/strict";
import { CHALLENGE_STATUS } from "@agora/common";
import { getPublicLeaderboard } from "../queries/leaderboard";

const calls: Array<{
  method: string;
  args: unknown[];
}> = [];

const chain = {
  select(...args: unknown[]) {
    calls.push({ method: "select", args });
    return chain;
  },
  eq(...args: unknown[]) {
    calls.push({ method: "eq", args });
    return chain;
  },
  order(...args: unknown[]) {
    calls.push({ method: "order", args });
    return Promise.resolve({ data: [], error: null });
  },
};

const db = {
  from(...args: unknown[]) {
    calls.push({ method: "from", args });
    return chain;
  },
};

await getPublicLeaderboard(db as never);

assert.deepEqual(calls[0], { method: "from", args: ["submissions"] });
assert.deepEqual(
  calls.find((call) => call.method === "eq"),
  {
    method: "eq",
    args: ["challenges.status", CHALLENGE_STATUS.finalized],
  },
  "public leaderboard query must be finalized-only",
);

console.log("public leaderboard query guard passed");
