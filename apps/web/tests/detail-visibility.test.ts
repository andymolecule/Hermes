import assert from "node:assert/strict";
import test from "node:test";
import { CHALLENGE_STATUS } from "@agora/common";
import {
  canShowChallengeResults,
  getChallengeLeaderboardEntries,
  getPublicVerificationTarget,
} from "../src/app/challenges/[id]/detail-visibility";
import type { ChallengeDetails } from "../src/lib/types";

const emptyArtifacts = {
  public: [],
  private: [],
  spec_cid: null,
  spec_url: null,
};

function buildChallengeDetail(status: ChallengeDetails["challenge"]["status"]) {
  return {
    challenge: {
      id: "challenge-1",
      title: "Challenge",
      description: "desc",
      domain: "other",
      status,
      reward_amount: 10,
      deadline: "2026-04-01T00:00:00.000Z",
      challenge_type: "prediction",
      contract_address: "0x0000000000000000000000000000000000000001",
      factory_address: "0x0000000000000000000000000000000000000002",
      factory_challenge_id: 1,
      refs: {
        challengeId: "challenge-1",
        challengeAddress: "0x0000000000000000000000000000000000000001",
        factoryAddress: "0x0000000000000000000000000000000000000002",
        factoryChallengeId: 1,
      },
      execution: {
        template: "official_table_metric_v1",
        metric: "spearman",
        comparator: "maximize",
        scorer_image: "ghcr.io/andymolecule/gems-tabular-scorer:v1",
      },
    },
    artifacts: emptyArtifacts,
    submissions: [],
    leaderboard: [],
  } satisfies ChallengeDetails;
}

test("challenge detail keeps results hidden while open", () => {
  const detail: ChallengeDetails = {
    ...buildChallengeDetail(CHALLENGE_STATUS.open),
    submissions: [{ id: "sub-1", scored: true, score: "10" }] as never,
    leaderboard: [{ id: "sub-1", scored: true, score: "10" }] as never,
  };

  assert.equal(canShowChallengeResults(CHALLENGE_STATUS.open), false);
  assert.deepEqual(getChallengeLeaderboardEntries(detail), []);
});

test("challenge detail shows leaderboard and verification once scoring begins", () => {
  const detail: ChallengeDetails = {
    ...buildChallengeDetail(CHALLENGE_STATUS.scoring),
    submissions: [{ id: "sub-1", scored: true, score: "10" }] as never,
    leaderboard: [
      {
        id: "sub-2",
        scored: true,
        score: "20",
        has_public_verification: true,
      },
    ] as never,
  };

  assert.equal(canShowChallengeResults(CHALLENGE_STATUS.scoring), true);
  assert.deepEqual(getChallengeLeaderboardEntries(detail), detail.leaderboard);
});

test("challenge detail falls back to submissions when leaderboard is empty", () => {
  const detail: ChallengeDetails = {
    ...buildChallengeDetail(CHALLENGE_STATUS.disputed),
    submissions: [{ id: "sub-3", scored: true, score: "15" }] as never,
    leaderboard: [],
  };

  assert.deepEqual(getChallengeLeaderboardEntries(detail), detail.submissions);
});

test("challenge detail prefers scored submissions with public verification artifacts", () => {
  const detail: ChallengeDetails = {
    ...buildChallengeDetail(CHALLENGE_STATUS.finalized),
    submissions: [],
    leaderboard: [
      {
        id: "sub-1",
        scored: true,
        score: "25",
        has_public_verification: false,
      },
      {
        id: "sub-2",
        scored: true,
        score: "20",
        has_public_verification: true,
      },
    ] as never,
  };

  assert.equal(getPublicVerificationTarget(detail)?.id, "sub-2");
});

test("challenge detail skips verification fetch when no public artifacts exist yet", () => {
  const detail: ChallengeDetails = {
    ...buildChallengeDetail(CHALLENGE_STATUS.scoring),
    submissions: [],
    leaderboard: [
      {
        id: "sub-1",
        scored: true,
        score: "25",
        has_public_verification: false,
      },
    ] as never,
  };

  assert.equal(getPublicVerificationTarget(detail)?.id, "sub-1");
  assert.equal(
    getPublicVerificationTarget(detail)?.has_public_verification,
    false,
  );
});
