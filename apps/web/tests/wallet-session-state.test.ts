import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient } from "@tanstack/react-query";
import {
  AUTH_SESSION_QUERY_KEY,
  MY_PORTFOLIO_QUERY_KEY,
  hasMatchingWalletSession,
  normalizeWalletAddress,
  resetWalletSessionQueries,
  shouldClearWalletSession,
} from "../src/lib/wallet/session-state";

test("normalizeWalletAddress lowercases populated addresses", () => {
  assert.equal(normalizeWalletAddress("0xAbCdEf"), "0xabcdef");
  assert.equal(normalizeWalletAddress(""), null);
  assert.equal(normalizeWalletAddress(undefined), null);
});

test("hasMatchingWalletSession requires an authenticated matching address", () => {
  assert.equal(
    hasMatchingWalletSession("0xAbc", {
      authenticated: true,
      address: "0xabc",
    }),
    true,
  );
  assert.equal(
    hasMatchingWalletSession("0xAbc", {
      authenticated: true,
      address: "0xdef",
    }),
    false,
  );
  assert.equal(
    hasMatchingWalletSession("0xAbc", {
      authenticated: false,
      address: "0xabc",
    }),
    false,
  );
});

test("shouldClearWalletSession clears stale sessions on disconnect or wallet switch", () => {
  assert.equal(
    shouldClearWalletSession({
      isConnected: false,
      session: { authenticated: true, address: "0xabc" },
    }),
    true,
  );
  assert.equal(
    shouldClearWalletSession({
      isConnected: true,
      address: "0xdef",
      session: { authenticated: true, address: "0xabc" },
    }),
    true,
  );
  assert.equal(
    shouldClearWalletSession({
      isConnected: true,
      address: "0xabc",
      session: { authenticated: true, address: "0xabc" },
    }),
    false,
  );
});

test("resetWalletSessionQueries clears wallet-bound cached state immediately", async () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(AUTH_SESSION_QUERY_KEY, {
    authenticated: true,
    address: "0xabc",
  });
  queryClient.setQueryData(MY_PORTFOLIO_QUERY_KEY, {
    address: "0xabc",
    submissions: [],
  });

  await resetWalletSessionQueries(queryClient);

  assert.deepEqual(queryClient.getQueryData(AUTH_SESSION_QUERY_KEY), {
    authenticated: false,
  });
  assert.equal(queryClient.getQueryData(MY_PORTFOLIO_QUERY_KEY), undefined);
});
