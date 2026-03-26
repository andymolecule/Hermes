import assert from "node:assert/strict";
import test from "node:test";
import { syncWorkerRuntimeStateRegistration } from "../src/worker.js";

function createWorkerRuntimeDb({
  heartbeatReturns,
}: {
  heartbeatReturns: boolean;
}) {
  const writes: Array<Record<string, unknown>> = [];

  return {
    writes,
    db: {
      from(table: string) {
        assert.equal(table, "worker_runtime_state");
        return {
          update(payload: Record<string, unknown>) {
            writes.push({ kind: "update", payload });
            return {
              eq(column: string, value: string) {
                assert.equal(column, "worker_id");
                return {
                  select(selection: string) {
                    assert.equal(selection, "worker_id");
                    return {
                      async maybeSingle() {
                        return {
                          data: heartbeatReturns ? { worker_id: value } : null,
                          error: null,
                        };
                      },
                    };
                  },
                };
              },
            };
          },
          upsert(payload: Record<string, unknown>, options: Record<string, unknown>) {
            writes.push({ kind: "upsert", payload, options });
            return {
              select(selection: string) {
                assert.equal(selection, "*");
                return {
                  async single() {
                    return { data: payload, error: null };
                  },
                };
              },
            };
          },
        };
      },
    } as never,
  };
}

const runtimeState = {
  ready: true,
  executor_ready: true,
  seal_enabled: true,
  seal_key_id: "kid-1",
  seal_self_check_ok: true,
  runtime_version: "abc123def456",
  last_error: null,
};

test("worker runtime registration self-heals after the row is deleted", async () => {
  const { db, writes } = createWorkerRuntimeDb({ heartbeatReturns: false });

  const result = await syncWorkerRuntimeStateRegistration(
    db,
    "worker-1",
    runtimeState,
  );

  assert.equal(result, "re-registered");
  assert.equal(writes[0]?.kind, "update");
  assert.equal(writes[1]?.kind, "upsert");
  assert.equal(writes[1]?.payload?.worker_id, "worker-1");
  assert.equal(writes[1]?.payload?.runtime_version, runtimeState.runtime_version);
});
