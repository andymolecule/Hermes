import assert from "node:assert/strict";
import test from "node:test";
import {
  getPortfolioAccessState,
  hasMatchingPortfolioSession,
} from "../src/app/portfolio/portfolio-access";

test("portfolio prompts wallet connection first", () => {
  assert.equal(
    getPortfolioAccessState({
      isConnected: false,
      requiredChainId: 84532,
    }),
    "connect",
  );
});

test("portfolio requires the configured chain before SIWE", () => {
  assert.equal(
    getPortfolioAccessState({
      isConnected: true,
      address: "0xabc",
      chainId: 1,
      requiredChainId: 84532,
    }),
    "switch_chain",
  );
});

test("portfolio requires a matching SIWE session", () => {
  assert.equal(
    hasMatchingPortfolioSession("0xabc", {
      authenticated: true,
      address: "0xdef",
    }),
    false,
  );
  assert.equal(
    getPortfolioAccessState({
      isConnected: true,
      address: "0xabc",
      chainId: 84532,
      requiredChainId: 84532,
      session: {
        authenticated: true,
        address: "0xdef",
      },
    }),
    "sign_in",
  );
});

test("portfolio unlocks once chain and SIWE session match", () => {
  assert.equal(
    hasMatchingPortfolioSession("0xAbC", {
      authenticated: true,
      address: "0xabc",
    }),
    true,
  );
  assert.equal(
    getPortfolioAccessState({
      isConnected: true,
      address: "0xabc",
      chainId: 84532,
      requiredChainId: 84532,
      session: {
        authenticated: true,
        address: "0xabc",
      },
    }),
    "ready",
  );
});
