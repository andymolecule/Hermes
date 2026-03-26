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

const API_RUNTIME_CONTROL_SYNC_INTERVAL_MS = 30_000;

function startActiveRuntimeVersionSyncLoop(
  db: ReturnType<typeof createSupabaseClient>,
  runtimeVersion: string,
) {
  let lastHealthyState: boolean | null = null;

  const tick = async () => {
    try {
      const schemaStatus = await readRuntimeDatabaseSchemaStatus(db);
      if (!schemaStatus.ok) {
        if (lastHealthyState !== false) {
          apiLogger.warn(
            {
              event: "api.runtime_schema_parked",
              failures: schemaStatus.failures,
            },
            "API runtime control sync parked until database schema is healthy",
          );
        }
        lastHealthyState = false;
        return;
      }

      await upsertActiveWorkerRuntimeVersion(db, {
        worker_type: WORKER_RUNTIME_TYPE.scoring,
        active_runtime_version: runtimeVersion,
      });

      if (lastHealthyState !== true) {
        apiLogger.info(
          {
            event: "api.runtime_schema_ready",
            runtimeVersion,
          },
          "API runtime control sync resumed",
        );
      }
      lastHealthyState = true;
    } catch (error) {
      lastHealthyState = false;
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
  startActiveRuntimeVersionSyncLoop(db, runtimeVersion);

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
