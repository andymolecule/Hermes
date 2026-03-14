import assert from "node:assert/strict";
import test from "node:test";
import {
  createChallengePostStatus,
  getChallengePostIndexingFailureStatus,
  getChallengePostSuccessStatus,
} from "../src/lib/challenge-post";

const txHash =
  "0xdd60f9f79410607e32fbbf447f91b71a82a7fa52f0b2f5b2f282a3aa8ef5c233";

test("successful challenge post status stays explicitly indexed", () => {
  assert.deepEqual(getChallengePostSuccessStatus(txHash), {
    tone: "success",
    message: `Challenge posted on-chain and registered in Agora. tx=${txHash}.`,
    postedOnChain: true,
  });
});

test("failed challenge registration status includes the next action", () => {
  const message = getChallengePostIndexingFailureStatus(
    txHash,
    "API request failed (503): indexer backlog",
  );

  assert.equal(message.tone, "warning");
  assert.equal(message.postedOnChain, true);
  assert.match(message.message, /could not register it immediately/i);
  assert.match(message.message, /retry in a few seconds and refresh the challenge list/i);
  assert.match(message.message, /retry \/api\/challenges with this tx hash/i);
});

test("generic status defaults to non-terminal info", () => {
  assert.deepEqual(createChallengePostStatus("Pinning spec to IPFS..."), {
    tone: "info",
    message: "Pinning spec to IPFS...",
    postedOnChain: false,
  });
});
