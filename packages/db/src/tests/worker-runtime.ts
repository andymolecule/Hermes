import assert from "node:assert/strict";
import {
  heartbeatWorkerRuntimeState,
  isWorkerRuntimeReadyForSealKey,
  pruneWorkerRuntimeStates,
  summarizeWorkerRuntimeStates,
  upsertWorkerRuntimeState,
} from "../queries/worker-runtime.js";

async function testUpsertWorkerRuntimeStateUsesWorkerIdConflictKey() {
  let capturedPayload: Record<string, unknown> | undefined;
  let capturedOptions: Record<string, unknown> | undefined;

  const db = {
    from(table: string) {
      assert.equal(table, "worker_runtime_state");
      return {
        upsert(
          payload: Record<string, unknown>,
          options: Record<string, unknown>,
        ) {
          capturedPayload = payload;
          capturedOptions = options;
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
  } as never;

  const row = await upsertWorkerRuntimeState(db, {
    worker_id: "worker-1",
    host: "droplet-1",
    runtime_version: "sha-123",
    ready: true,
    docker_ready: true,
    seal_enabled: true,
    seal_key_id: "kid-1",
    seal_self_check_ok: true,
  });

  assert.equal(row.worker_id, "worker-1");
  assert.equal(capturedPayload?.worker_type, "scoring");
  assert.equal(capturedPayload?.runtime_version, "sha-123");
  assert.equal(capturedOptions?.onConflict, "worker_id");
}

async function testHeartbeatWorkerRuntimeStateRefreshesTimestamp() {
  let capturedPayload: Record<string, unknown> | undefined;
  let capturedWorkerId: unknown;

  const db = {
    from(table: string) {
      assert.equal(table, "worker_runtime_state");
      return {
        update(payload: Record<string, unknown>) {
          capturedPayload = payload;
          return {
            eq(field: string, value: unknown) {
              assert.equal(field, "worker_id");
              capturedWorkerId = value;
              return {
                select(selection: string) {
                  assert.equal(selection, "worker_id");
                  return {
                    async maybeSingle() {
                      return { data: { worker_id: "worker-1" }, error: null };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  } as never;

  const refreshed = await heartbeatWorkerRuntimeState(db, "worker-1", {
    runtime_version: "sha-123",
    ready: true,
    last_error: null,
  });

  assert.equal(refreshed, true);
  assert.equal(capturedWorkerId, "worker-1");
  assert.equal(capturedPayload?.runtime_version, "sha-123");
  assert.equal(capturedPayload?.ready, true);
  assert.ok(typeof capturedPayload?.last_heartbeat_at === "string");
}

async function testPruneWorkerRuntimeStatesDeletesStaleRows() {
  let capturedTable: unknown;
  let capturedWorkerType: unknown;
  let capturedHost: unknown;
  let capturedExcludeWorkerId: unknown;
  let capturedCutoff: unknown;

  const db = {
    from(table: string) {
      capturedTable = table;
      return {
        delete() {
          return {
            eq(field: string, value: unknown) {
              assert.equal(field, "worker_type");
              capturedWorkerType = value;
              return {
                lt(fieldName: string, cutoff: unknown) {
                  assert.equal(fieldName, "last_heartbeat_at");
                  capturedCutoff = cutoff;
                  return {
                    eq(hostField: string, host: unknown) {
                      assert.equal(hostField, "host");
                      capturedHost = host;
                      return {
                        neq(idField: string, workerId: unknown) {
                          assert.equal(idField, "worker_id");
                          capturedExcludeWorkerId = workerId;
                          return {
                            async select(selection: string) {
                              assert.equal(selection, "worker_id");
                              return {
                                data: [{ worker_id: "stale-1" }],
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
            },
          };
        },
      };
    },
  } as never;

  const pruned = await pruneWorkerRuntimeStates(db, {
    host: "droplet-1",
    excludeWorkerId: "worker-current",
    staleAfterMs: 30_000,
    nowMs: Date.parse("2026-03-10T00:01:00.000Z"),
  });

  assert.equal(pruned, 1);
  assert.equal(capturedTable, "worker_runtime_state");
  assert.equal(capturedWorkerType, "scoring");
  assert.equal(capturedHost, "droplet-1");
  assert.equal(capturedExcludeWorkerId, "worker-current");
  assert.equal(capturedCutoff, "2026-03-10T00:00:30.000Z");
}

function testSummarizeWorkerRuntimeStatesCountsHealthySealWorkers() {
  const summary = summarizeWorkerRuntimeStates(
    [
      {
        worker_id: "worker-healthy",
        worker_type: "scoring",
        host: "droplet-a",
        runtime_version: "sha-a",
        ready: true,
        docker_ready: true,
        seal_enabled: true,
        seal_key_id: "kid-1",
        seal_self_check_ok: true,
        last_error: null,
        started_at: "2026-03-10T00:00:00.000Z",
        last_heartbeat_at: "2026-03-10T00:00:50.000Z",
        created_at: "2026-03-10T00:00:00.000Z",
        updated_at: "2026-03-10T00:00:50.000Z",
      },
      {
        worker_id: "worker-stale",
        worker_type: "scoring",
        host: "droplet-b",
        runtime_version: "sha-a",
        ready: true,
        docker_ready: true,
        seal_enabled: true,
        seal_key_id: "kid-1",
        seal_self_check_ok: true,
        last_error: null,
        started_at: "2026-03-10T00:00:00.000Z",
        last_heartbeat_at: "2026-03-10T00:00:00.000Z",
        created_at: "2026-03-10T00:00:00.000Z",
        updated_at: "2026-03-10T00:00:00.000Z",
      },
      {
        worker_id: "worker-wrong-kid",
        worker_type: "scoring",
        host: "droplet-c",
        runtime_version: "sha-b",
        ready: true,
        docker_ready: true,
        seal_enabled: true,
        seal_key_id: "kid-2",
        seal_self_check_ok: true,
        last_error: null,
        started_at: "2026-03-10T00:00:00.000Z",
        last_heartbeat_at: "2026-03-10T00:00:45.000Z",
        created_at: "2026-03-10T00:00:00.000Z",
        updated_at: "2026-03-10T00:00:45.000Z",
      },
    ],
    {
      activeSealKeyId: "kid-1",
      activeRuntimeVersion: "sha-a",
      staleAfterMs: 30_000,
      nowMs: Date.parse("2026-03-10T00:01:00.000Z"),
    },
  );

  assert.equal(summary.totalWorkers, 3);
  assert.equal(summary.readyWorkers, 3);
  assert.equal(summary.healthyWorkers, 2);
  assert.equal(summary.staleWorkers, 1);
  assert.deepEqual(summary.runtimeVersions, ["sha-a", "sha-b"]);
  assert.equal(summary.healthyWorkersForActiveSealKey, 1);
  assert.equal(summary.healthyWorkersForActiveRuntimeVersion, 1);
  assert.equal(summary.healthyWorkersNotOnActiveRuntimeVersion, 1);
  assert.equal(summary.latestHeartbeatAt, "2026-03-10T00:00:50.000Z");
}

function testIsWorkerRuntimeReadyForSealKeyRequiresFreshMatchingWorker() {
  const ready = isWorkerRuntimeReadyForSealKey(
    {
      worker_id: "worker-1",
      worker_type: "scoring",
      host: "droplet-a",
      runtime_version: "sha-a",
      ready: true,
      docker_ready: true,
      seal_enabled: true,
      seal_key_id: "kid-1",
      seal_self_check_ok: true,
      last_error: null,
      started_at: "2026-03-10T00:00:00.000Z",
      last_heartbeat_at: "2026-03-10T00:00:55.000Z",
      created_at: "2026-03-10T00:00:00.000Z",
      updated_at: "2026-03-10T00:00:55.000Z",
    },
    "kid-1",
    30_000,
    Date.parse("2026-03-10T00:01:00.000Z"),
  );

  assert.equal(ready, true);
}

await testUpsertWorkerRuntimeStateUsesWorkerIdConflictKey();
await testHeartbeatWorkerRuntimeStateRefreshesTimestamp();
await testPruneWorkerRuntimeStatesDeletesStaleRows();
testSummarizeWorkerRuntimeStatesCountsHealthySealWorkers();
testIsWorkerRuntimeReadyForSealKeyRequiresFreshMatchingWorker();
console.log("worker runtime state tests passed");
