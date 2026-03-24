import assert from "node:assert/strict";
import test from "node:test";
import { CHALLENGE_STATUS } from "@agora/common";
import {
  type TransactionReceipt,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  parseAbiItem,
} from "viem";
import { parseSubmittedReceipt } from "../challenge.js";
import {
  parseChallengeCreatedReceipt,
  parseChallengeCreationCall,
} from "../factory.js";
import { processChallengeLog } from "../indexer/challenge-events.js";
import { persistChallengeCursors } from "../indexer/cursors.js";
import { processFactoryLog } from "../indexer/factory-events.js";
import { DEFAULT_INDEXER_POLLING_CONFIG } from "../indexer/polling.js";

type FakeIndexedEvent = {
  tx_hash: string;
  log_index: number;
  event_name: string;
  block_number: number;
  block_hash?: string | null;
};

type FakeChallengeRow = {
  id: string;
  status: string;
  tx_hash?: string | null;
  contract_address?: string | null;
  winning_on_chain_sub_id?: number | null;
  winner_solver_address?: string | null;
};

function createFakeDb() {
  const indexedEvents = new Map<string, FakeIndexedEvent>();
  const challengeRows = new Map<string, FakeChallengeRow>();
  const challengePayouts = new Map<string, Array<Record<string, unknown>>>();
  const indexerCursors = new Map<string, string>();

  return {
    indexedEvents,
    challengeRows,
    challengePayouts,
    indexerCursors,
    async rpc(name: string, args: Record<string, unknown>) {
      if (name === "replace_challenge_payouts") {
        const challengeId = String(args.p_challenge_id);
        const payouts = Array.isArray(args.p_payouts) ? args.p_payouts : [];
        const normalized = payouts.map((row) => ({
          challenge_id: challengeId,
          solver_address: String(row.solver_address).toLowerCase(),
          winning_on_chain_sub_id: Number(row.winning_on_chain_sub_id),
          rank: Number(row.rank),
          amount: row.amount,
          claimed_at: row.claimed_at ?? null,
          claim_tx_hash: row.claim_tx_hash ?? null,
        }));
        challengePayouts.set(challengeId, normalized);
        return { data: normalized, error: null };
      }

      throw new Error(`Unexpected rpc access in fake db: ${name}`);
    },
    from(table: string) {
      if (table === "indexed_events") {
        return {
          select() {
            return {
              eq(_column: string, txHash: string) {
                return {
                  eq(_nestedColumn: string, logIndex: number) {
                    return {
                      async maybeSingle() {
                        const data =
                          indexedEvents.get(`${txHash}:${logIndex}`) ?? null;
                        return { data, error: null };
                      },
                    };
                  },
                };
              },
            };
          },
          async upsert(payload: FakeIndexedEvent) {
            indexedEvents.set(
              `${payload.tx_hash}:${payload.log_index}`,
              payload,
            );
            return { error: null };
          },
        };
      }

      if (table === "challenges") {
        return {
          select() {
            return {
              eq(column: string, value: string) {
                const rows = [...challengeRows.values()];
                const match =
                  column === "id"
                    ? rows.find((row) => row.id === value) ?? null
                    : column === "tx_hash"
                      ? rows.find((row) => row.tx_hash === value) ?? null
                      : column === "contract_address"
                        ? rows.find(
                            (row) =>
                              row.contract_address?.toLowerCase() ===
                              value.toLowerCase(),
                          ) ?? null
                        : null;
                return {
                  async maybeSingle() {
                    return { data: match, error: null };
                  },
                  async single() {
                    if (match) {
                      return { data: match, error: null };
                    }
                    return {
                      data: null,
                      error: { message: "Row not found", code: "PGRST116" },
                    };
                  },
                };
              },
            };
          },
          update(payload: Record<string, unknown>) {
            return {
              eq(_column: string, challengeId: string) {
                return {
                  select() {
                    return {
                      async single() {
                        const current = challengeRows.get(challengeId) ?? {
                          id: challengeId,
                          status: CHALLENGE_STATUS.open,
                        };
                        const row = { ...current, ...payload, id: challengeId };
                        challengeRows.set(challengeId, row);
                        return { data: row, error: null };
                      },
                    };
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
              eq(_challengeColumn: string, challengeId: string) {
                return {
                  eq(_solverColumn: string, solverAddress: string) {
                    return {
                      eq(_rankColumn: string, rank: number) {
                        return {
                          async maybeSingle() {
                            const rows =
                              challengePayouts.get(challengeId) ?? [];
                            const match =
                              rows.find(
                                (row) =>
                                  String(row.solver_address) ===
                                    solverAddress.toLowerCase() &&
                                  Number(row.rank) === rank,
                              ) ?? null;
                            return { data: match, error: null };
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          },
          upsert(payload: Record<string, unknown>) {
            return {
              select() {
                return {
                  async single() {
                    const challengeId = String(payload.challenge_id);
                    const existing = challengePayouts.get(challengeId) ?? [];
                    const nextRows = existing.filter(
                      (row) =>
                        !(
                          String(row.solver_address) ===
                            String(payload.solver_address).toLowerCase() &&
                          Number(row.rank) === Number(payload.rank)
                        ),
                    );
                    const normalized = {
                      ...payload,
                      solver_address: String(
                        payload.solver_address,
                      ).toLowerCase(),
                    };
                    challengePayouts.set(challengeId, [
                      ...nextRows,
                      normalized,
                    ]);
                    return { data: normalized, error: null };
                  },
                };
              },
            };
          },
          update(payload: Record<string, unknown>) {
            return {
              eq(_challengeColumn: string, challengeId: string) {
                return {
                  eq(_solverColumn: string, solverAddress: string) {
                    return {
                      async select() {
                        const existing =
                          challengePayouts.get(challengeId) ?? [];
                        const updated = existing.map((row) =>
                          String(row.solver_address) ===
                          solverAddress.toLowerCase()
                            ? { ...row, ...payload }
                            : row,
                        );
                        challengePayouts.set(challengeId, updated);
                        return {
                          data: updated.filter(
                            (row) =>
                              String(row.solver_address) ===
                              solverAddress.toLowerCase(),
                          ),
                          error: null,
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }

      if (table === "indexer_cursors") {
        return {
          async upsert(payload: {
            cursor_key: string;
            block_number: string;
            updated_at: string;
          }) {
            indexerCursors.set(payload.cursor_key, payload.block_number);
            return { error: null };
          },
        };
      }

      throw new Error(`Unexpected table access in fake db: ${table}`);
    },
  };
}

function buildReceiptLog(input: {
  address: `0x${string}`;
  topics: [] | [`0x${string}`, ...`0x${string}`[]];
  data: `0x${string}`;
}) {
  return {
    address: input.address,
    blockHash: `0x${"c".repeat(64)}` as `0x${string}`,
    blockNumber: 1n,
    logIndex: 0,
    transactionHash: `0x${"d".repeat(64)}` as `0x${string}`,
    transactionIndex: 0,
    removed: false,
    topics: input.topics,
    data: input.data,
  } as TransactionReceipt["logs"][number];
}

function encodeTopics(
  topics: ReturnType<typeof encodeEventTopics>,
): [] | [`0x${string}`, ...`0x${string}`[]] {
  const flattened = (Array.isArray(topics) ? topics : [topics]).flat();
  const normalized = flattened.filter(
    (topic): topic is `0x${string}` => typeof topic === "string",
  );
  if (normalized.length === 0) {
    throw new Error("Event topics unexpectedly encoded to null.");
  }
  return normalized as [`0x${string}`, ...`0x${string}`[]];
}

test("StatusChanged projects scoring status and marks the event indexed", async () => {
  const db = createFakeDb();
  const txHash = `0x${"a".repeat(64)}` as `0x${string}`;

  await processChallengeLog({
    db: db as never,
    publicClient: {} as never,
    challenge: {
      id: "challenge-1",
      contract_address: "0x0000000000000000000000000000000000000001",
      tx_hash: txHash,
      status: CHALLENGE_STATUS.open,
    },
    log: {
      eventName: "StatusChanged",
      args: {
        fromStatus: 0n,
        toStatus: 1n,
      },
      transactionHash: txHash,
      logIndex: 7,
      blockNumber: 123n,
      blockHash: `0x${"b".repeat(64)}`,
    },
    fromBlock: 120n,
    challengeFromBlock: 120n,
    challengeCursorKey: "challenge-1",
    challengePersistTargets: new Map(),
  });

  assert.deepEqual(db.challengeRows.get("challenge-1"), {
    id: "challenge-1",
    status: CHALLENGE_STATUS.scoring,
    winning_on_chain_sub_id: null,
    winner_solver_address: null,
  });
  assert.deepEqual(db.indexedEvents.get(`${txHash}:7`), {
    tx_hash: txHash,
    log_index: 7,
    event_name: "StatusChanged",
    block_number: 123,
    block_hash: `0x${"b".repeat(64)}`,
  });
});

test("Submitted flags targeted repair when the on-chain submission cannot be matched to a registered intent", async () => {
  const db = createFakeDb();
  const txHash = `0x${"9".repeat(64)}` as `0x${string}`;

  const result = await processChallengeLog({
    db: db as never,
    publicClient: {} as never,
    challenge: {
      id: "challenge-orphaned-submission",
      contract_address: "0x0000000000000000000000000000000000000011",
      tx_hash: txHash,
      status: CHALLENGE_STATUS.open,
    },
    log: {
      eventName: "Submitted",
      args: {
        submissionId: 4n,
      },
      transactionHash: txHash,
      logIndex: 8,
      blockNumber: 124n,
      blockHash: `0x${"c".repeat(64)}`,
    },
    fromBlock: 120n,
    challengeFromBlock: 120n,
    challengeCursorKey: "challenge-orphaned-submission",
    challengePersistTargets: new Map(),
    getOnChainSubmissionImpl: async () => ({
      solver: "0x0000000000000000000000000000000000000012",
      resultHash: "0xhash",
      proofBundleHash: "0x0000000000000000000000000000000000000013",
      score: 0n,
      scored: false,
      submittedAt: 1_700_000_000n,
    }),
    getSubmissionByChainIdImpl: async () => null,
    projectOnChainSubmissionFromRegistrationImpl: async () => null,
  });

  assert.equal(result.needsRepair, true);
  assert.deepEqual(db.indexedEvents.get(`${txHash}:8`), {
    tx_hash: txHash,
    log_index: 8,
    event_name: "Submitted",
    block_number: 124,
    block_hash: `0x${"c".repeat(64)}`,
  });
});

test("parseChallengeCreatedReceipt decodes the canonical factory event", () => {
  const challengeAddress =
    "0x0000000000000000000000000000000000000002" as `0x${string}`;
  const posterAddress =
    "0x0000000000000000000000000000000000000003" as `0x${string}`;
  const reward = 10_000_000n;

  const challengeCreatedEvent = parseAbiItem(
    "event ChallengeCreated(uint256 indexed id, address indexed challenge, address indexed poster, uint256 reward)",
  );
  const receipt: Pick<TransactionReceipt, "logs"> = {
    logs: [
      buildReceiptLog({
        address: "0x0000000000000000000000000000000000000001",
        topics: encodeTopics(
          encodeEventTopics({
            abi: [challengeCreatedEvent],
            eventName: "ChallengeCreated",
            args: {
              id: 7n,
              challenge: challengeAddress,
              poster: posterAddress,
            },
          }),
        ),
        data: encodeAbiParameters(
          [{ name: "reward", type: "uint256" }],
          [reward],
        ),
      }),
    ],
  };

  assert.deepEqual(parseChallengeCreatedReceipt(receipt), {
    challengeId: 7n,
    challengeAddress,
    posterAddress,
    reward,
  });
});

test("parseChallengeCreationCall decodes createChallenge calldata", () => {
  const data = encodeFunctionData({
    abi: [
      parseAbiItem(
        "function createChallenge(string specCid,uint256 rewardAmount,uint64 deadline,uint64 disputeWindowHours,uint256 minimumScore,uint8 distributionType,address labTBA,uint256 maxSubmissions_,uint256 maxSubmissionsPerSolver_)",
      ),
    ],
    functionName: "createChallenge",
    args: [
      "ipfs://bafkreitest",
      10_000_000n,
      1_742_000_000n,
      24n,
      0n,
      0,
      "0x0000000000000000000000000000000000000004",
      100n,
      3n,
    ],
  });

  assert.deepEqual(parseChallengeCreationCall(data), {
    specCid: "ipfs://bafkreitest",
    rewardAmount: 10_000_000n,
    deadline: 1_742_000_000n,
    disputeWindowHours: 24n,
    minimumScore: 0n,
    distributionType: 0,
    labTba: "0x0000000000000000000000000000000000000004",
    maxSubmissions: 100n,
    maxSubmissionsPerSolver: 3n,
  });
});

test("parseChallengeCreationCall decodes createChallengeWithPermit calldata", () => {
  const data = encodeFunctionData({
    abi: [
      parseAbiItem(
        "function createChallengeWithPermit(string specCid,uint256 rewardAmount,uint64 deadline,uint64 disputeWindowHours,uint256 minimumScore,uint8 distributionType,address labTBA,uint256 maxSubmissions_,uint256 maxSubmissionsPerSolver_,uint256 permitDeadline,uint8 v,bytes32 r,bytes32 s)",
      ),
    ],
    functionName: "createChallengeWithPermit",
    args: [
      "ipfs://bafkreitestpermit",
      25_000_000n,
      1_742_100_000n,
      0n,
      100_000_000_000_000_000n,
      2,
      "0x0000000000000000000000000000000000000005",
      50n,
      2n,
      1_742_100_100n,
      28,
      `0x${"1".repeat(64)}`,
      `0x${"2".repeat(64)}`,
    ],
  });

  assert.deepEqual(parseChallengeCreationCall(data), {
    specCid: "ipfs://bafkreitestpermit",
    rewardAmount: 25_000_000n,
    deadline: 1_742_100_000n,
    disputeWindowHours: 0n,
    minimumScore: 100_000_000_000_000_000n,
    distributionType: 2,
    labTba: "0x0000000000000000000000000000000000000005",
    maxSubmissions: 50n,
    maxSubmissionsPerSolver: 2n,
  });
});

test("parseSubmittedReceipt decodes the canonical challenge event", () => {
  const challengeAddress =
    "0x0000000000000000000000000000000000000009" as `0x${string}`;
  const solver = "0x0000000000000000000000000000000000000004" as `0x${string}`;
  const resultHash = `0x${"ab".repeat(32)}` as `0x${string}`;

  const submittedEvent = parseAbiItem(
    "event Submitted(uint256 indexed submissionId, address indexed solver, bytes32 resultHash)",
  );
  const receipt: Pick<TransactionReceipt, "logs"> = {
    logs: [
      buildReceiptLog({
        address: challengeAddress,
        topics: encodeTopics(
          encodeEventTopics({
            abi: [submittedEvent],
            eventName: "Submitted",
            args: {
              submissionId: 3n,
              solver,
            },
          }),
        ),
        data: encodeAbiParameters(
          [{ name: "resultHash", type: "bytes32" }],
          [resultHash],
        ),
      }),
    ],
  };

  assert.deepEqual(parseSubmittedReceipt(receipt, challengeAddress), {
    submissionId: 3n,
  });
});

test("Claimed flags targeted repair when payout rows are missing", async () => {
  const db = createFakeDb();
  const txHash = `0x${"e".repeat(64)}` as `0x${string}`;

  const result = await processChallengeLog({
    db: db as never,
    publicClient: {
      async getBlock() {
        return { timestamp: 1n };
      },
    } as never,
    challenge: {
      id: "challenge-claim",
      contract_address: "0x0000000000000000000000000000000000000007",
      tx_hash: txHash,
      status: CHALLENGE_STATUS.finalized,
    },
    log: {
      eventName: "Claimed",
      args: {
        claimant: "0x0000000000000000000000000000000000000008",
      },
      transactionHash: txHash,
      logIndex: 9,
      blockNumber: 456n,
      blockHash: `0x${"f".repeat(64)}`,
    },
    fromBlock: 450n,
    challengeFromBlock: 450n,
    challengeCursorKey: "challenge-claim",
    challengePersistTargets: new Map(),
  });

  assert.equal(result.needsRepair, true);
  assert.deepEqual(db.indexedEvents.get(`${txHash}:9`), {
    tx_hash: txHash,
    log_index: 9,
    event_name: "Claimed",
    block_number: 456,
    block_hash: `0x${"f".repeat(64)}`,
  });
});

test("PayoutAllocated accepts numeric rank values and stores payout rows", async () => {
  const db = createFakeDb();
  const txHash = `0x${"1".repeat(64)}` as `0x${string}`;

  const result = await processChallengeLog({
    db: db as never,
    publicClient: {} as never,
    challenge: {
      id: "challenge-payout",
      contract_address: "0x0000000000000000000000000000000000000007",
      tx_hash: txHash,
      status: CHALLENGE_STATUS.finalized,
    },
    log: {
      eventName: "PayoutAllocated",
      args: {
        solver: "0x0000000000000000000000000000000000000008",
        submissionId: 0n,
        rank: 1,
        amount: 18_000_000n,
      },
      transactionHash: txHash,
      logIndex: 10,
      blockNumber: 457n,
      blockHash: `0x${"e".repeat(64)}`,
    },
    fromBlock: 450n,
    challengeFromBlock: 450n,
    challengeCursorKey: "challenge-payout",
    challengePersistTargets: new Map(),
  });

  assert.equal(result.needsRepair, false);
  assert.deepEqual(db.indexedEvents.get(`${txHash}:10`), {
    tx_hash: txHash,
    log_index: 10,
    event_name: "PayoutAllocated",
    block_number: 457,
    block_hash: `0x${"e".repeat(64)}`,
  });
  assert.deepEqual(
    (db.challengePayouts.get("challenge-payout") ?? []).map((row) => ({
      challenge_id: row.challenge_id,
      solver_address: row.solver_address,
      winning_on_chain_sub_id: row.winning_on_chain_sub_id,
      rank: row.rank,
      amount: row.amount,
      claimed_at: row.claimed_at,
      claim_tx_hash: row.claim_tx_hash,
    })),
    [
      {
        challenge_id: "challenge-payout",
        solver_address: "0x0000000000000000000000000000000000000008",
        winning_on_chain_sub_id: 0,
        rank: 1,
        amount: 18,
        claimed_at: null,
        claim_tx_hash: null,
      },
    ],
  );
});

test("retry-exhausted challenge events fail loud instead of being marked indexed", async () => {
  const db = createFakeDb();
  const txHash = `0x${"9".repeat(64)}` as `0x${string}`;

  await assert.rejects(
    () =>
      processChallengeLog({
        db: db as never,
        publicClient: {
          async getBlock() {
            throw new Error("network timeout");
          },
        } as never,
        challenge: {
          id: "challenge-retry",
          contract_address: "0x0000000000000000000000000000000000000007",
          tx_hash: txHash,
          status: CHALLENGE_STATUS.finalized,
        },
        pollingConfig: {
          ...DEFAULT_INDEXER_POLLING_CONFIG,
          retryableEventMaxAttempts: 1,
        },
        log: {
          eventName: "Claimed",
          args: {
            claimant: "0x0000000000000000000000000000000000000008",
          },
          transactionHash: txHash,
          logIndex: 11,
          blockNumber: 458n,
          blockHash: `0x${"a".repeat(64)}`,
        },
        fromBlock: 450n,
        challengeFromBlock: 450n,
        challengeCursorKey: "challenge-retry",
        challengePersistTargets: new Map(),
      }),
    /Retryable challenge event exhausted max attempts/,
  );

  assert.equal(db.indexedEvents.get(`${txHash}:11`), undefined);
});

test("retry-exhausted factory events fail loud instead of being marked indexed", async () => {
  const db = createFakeDb();
  const txHash = `0x${"8".repeat(64)}` as `0x${string}`;

  await assert.rejects(
    () =>
      processFactoryLog({
        db: db as never,
        publicClient: {
          async readContract() {
            throw new Error("network timeout");
          },
        } as never,
        config: {
          AGORA_CHAIN_ID: 8453,
          AGORA_FACTORY_ADDRESS:
            "0x0000000000000000000000000000000000000010" as `0x${string}`,
        } as never,
        pollingConfig: {
          ...DEFAULT_INDEXER_POLLING_CONFIG,
          retryableEventMaxAttempts: 1,
        },
        log: {
          eventName: "ChallengeCreated",
          args: {
            id: 1n,
            challenge: "0x0000000000000000000000000000000000000001",
            poster: "0x0000000000000000000000000000000000000002",
            reward: 10_000_000n,
          },
          transactionHash: txHash,
          logIndex: 12,
          blockNumber: 459n,
          blockHash: `0x${"b".repeat(64)}`,
        },
        fromBlock: 450n,
      }),
    /Retryable factory event exhausted max attempts/,
  );

  assert.equal(db.indexedEvents.get(`${txHash}:12`), undefined);
});

test("persistChallengeCursors replays a safety window for quiet challenges", async () => {
  const db = createFakeDb();

  await persistChallengeCursors({
    db: db as never,
    resolvedChallengeKeys: new Set(["challenge:test:1"]),
    challengePersistTargets: new Map(),
    nextBlock: 500n,
    pollingConfig: {
      ...DEFAULT_INDEXER_POLLING_CONFIG,
      replayWindowBlocks: 25n,
    },
  });

  assert.equal(db.indexerCursors.get("challenge:test:1"), "475");
});

test("persistChallengeCursors keeps the earliest explicit replay target", async () => {
  const db = createFakeDb();

  await persistChallengeCursors({
    db: db as never,
    resolvedChallengeKeys: new Set(["challenge:test:1"]),
    challengePersistTargets: new Map([["challenge:test:1", 410n]]),
    nextBlock: 500n,
    pollingConfig: {
      ...DEFAULT_INDEXER_POLLING_CONFIG,
      replayWindowBlocks: 25n,
    },
  });

  assert.equal(db.indexerCursors.get("challenge:test:1"), "410");
});
