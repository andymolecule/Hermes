import assert from "node:assert/strict";
import test from "node:test";
import {
  getMatchingOptionalSessionAddress,
  normalizeSessionAddress,
} from "../src/lib/auth/session-policy.js";

test("normalizeSessionAddress lowercases populated addresses", () => {
  assert.equal(normalizeSessionAddress("0xAbCd"), "0xabcd");
  assert.equal(normalizeSessionAddress(""), null);
  assert.equal(normalizeSessionAddress(undefined), null);
});

test("getMatchingOptionalSessionAddress ignores stale mismatched sessions", () => {
  assert.equal(getMatchingOptionalSessionAddress("0xabc", "0xABC"), "0xabc");
  assert.equal(getMatchingOptionalSessionAddress("0xabc", "0xdef"), null);
  assert.equal(getMatchingOptionalSessionAddress(undefined, "0xdef"), null);
});
