import {
  getAgoraRuntimeIdentity,
  getAgoraRuntimeVersion,
  loadConfig,
} from "@agora/common";
import {
  WORKER_RUNTIME_TYPE,
  createSupabaseClient,
  readRuntimeDatabaseSchemaStatus,
  upsertActiveWorkerRuntimeVersion,
} from "@agora/db";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import {
  apiLogger,
  captureApiException,
  initApiObservability,
} from "./lib/observability.js";
import { readPublicApiRuntimeSyncStatus } from "./lib/runtime-control-sync.js";

const API_RUNTIME_CONTROL_SYNC_INTERVAL_MS = 30_000;

function startActiveRuntimeVersionSyncLoop(
  db: ReturnType<typeof createSupabaseClient>,
  runtimeVersion: string,
  apiUrl?: string,
) {
  let lastSyncState: string | null = null;

  const tick = async () => {
    try {
      const schemaStatus = await readRuntimeDatabaseSchemaStatus(db);
      if (!schemaStatus.ok) {
        if (lastSyncState !== "schema_unhealthy") {
          apiLogger.warn(
            {
              event: "api.runtime_schema_parked",
              failures: schemaStatus.failures,
            },
            "API runtime control sync parked until database schema is healthy",
          );
        }
        lastSyncState = "schema_unhealthy";
        return;
      }

      const publicRuntimeStatus = await readPublicApiRuntimeSyncStatus({
        apiUrl,
        runtimeVersion,
      });
      if (!publicRuntimeStatus.ok) {
        const stateKey = [
          "waiting_for_public_release",
          publicRuntimeStatus.reason,
          publicRuntimeStatus.observedRuntimeVersion ?? "none",
          publicRuntimeStatus.status ?? "none",
        ].join(":");
        if (lastSyncState !== stateKey) {
          const logLevel =
            publicRuntimeStatus.reason === "request_failed" ||
            publicRuntimeStatus.reason === "unhealthy"
              ? apiLogger.warn.bind(apiLogger)
              : apiLogger.info.bind(apiLogger);
          logLevel(
            {
              event: "api.runtime_control_waiting_for_public_release",
              runtimeVersion,
              publicApiUrl: apiUrl ?? null,
              reason: publicRuntimeStatus.reason,
              observedRuntimeVersion:
                publicRuntimeStatus.observedRuntimeVersion,
              status: publicRuntimeStatus.status,
              detail: publicRuntimeStatus.detail,
            },
            "API runtime control sync is waiting for the public API release to match this runtime",
          );
        }
        lastSyncState = stateKey;
        return;
      }

      await upsertActiveWorkerRuntimeVersion(db, {
        worker_type: WORKER_RUNTIME_TYPE.scoring,
        active_runtime_version: runtimeVersion,
      });

      if (lastSyncState !== "active") {
        apiLogger.info(
          {
            event: "api.runtime_schema_ready",
            runtimeVersion,
            publicRuntimeVersion: publicRuntimeStatus.observedRuntimeVersion,
          },
          "API runtime control sync resumed",
        );
      }
      lastSyncState = "active";
    } catch (error) {
      lastSyncState = "sync_failed";
      apiLogger.warn(
        {
          event: "api.runtime_control_sync_failed",
          error: error instanceof Error ? error.message : String(error),
        },
        "API runtime control sync failed; will retry",
      );
    }
  };

  void tick();
  const timer = setInterval(() => {
    void tick();
  }, API_RUNTIME_CONTROL_SYNC_INTERVAL_MS);
  timer.unref?.();
}

async function start() {
  initApiObservability();
  const config = loadConfig();
  const port = config.AGORA_API_PORT ?? 3000;
  const db = createSupabaseClient(true);
  const runtimeVersion = getAgoraRuntimeVersion(config);
  const app = createApp();
  const runtimeIdentity = getAgoraRuntimeIdentity(config);

  serve({ fetch: app.fetch, port });
  startActiveRuntimeVersionSyncLoop(db, runtimeVersion, config.AGORA_API_URL);

  apiLogger.info(
    {
      event: "api.startup",
      port,
      runtimeIdentity,
    },
    "Agora API listening",
  );
}

start().catch((error) => {
  captureApiException(error, {
    service: "api",
    logger: apiLogger,
    bindings: { event: "api.startup.failed" },
  });
  process.exit(1);
});
