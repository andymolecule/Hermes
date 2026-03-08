import assert from "node:assert/strict";
import test from "node:test";
import { CHALLENGE_STATUS } from "@agora/common";
import { processChallengeLog } from "../indexer/handlers.js";

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
  winning_on_chain_sub_id?: number | null;
  winner_solver_address?: string | null;
};

function createFakeDb() {
  const indexedEvents = new Map<string, FakeIndexedEvent>();
  const challengeRows = new Map<string, FakeChallengeRow>();
  const challengePayouts = new Map<string, Array<Record<string, unknown>>>();

  return {
    indexedEvents,
    challengeRows,
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
            indexedEvents.set(`${payload.tx_hash}:${payload.log_index}`, payload);
            return { error: null };
          },
        };
      }

      if (table === "challenges") {
        return {
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
          delete() {
            return {
              async eq(_column: string, challengeId: string) {
                challengePayouts.set(challengeId, []);
                return { error: null };
              },
            };
          },
          insert(payload: Array<Record<string, unknown>>) {
            return {
              async select() {
                for (const row of payload) {
                  const challengeId = String(row.challenge_id);
                  const existing = challengePayouts.get(challengeId) ?? [];
                  challengePayouts.set(challengeId, [...existing, row]);
                }
                return { data: payload, error: null };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table access in fake db: ${table}`);
    },
  };
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
