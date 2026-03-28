import {
  getAgoraRuntimeIdentity,
  getAgoraRuntimeVersion,
  loadConfig,
} from "@agora/common";
import {
  WORKER_RUNTIME_TYPE,
  createSupabaseClient,
  upsertActiveWorkerRuntimeVersion,
} from "@agora/db";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import {
  apiLogger,
  captureApiException,
  initApiObservability,
} from "./lib/observability.js";
import { syncActiveRuntimeVersionOnce } from "./lib/runtime-control-sync.js";
import { createApiRuntimeReadinessProbe } from "./lib/runtime-readiness.js";

const API_RUNTIME_CONTROL_SYNC_INTERVAL_MS = 30_000;
const API_LISTEN_HOST = "0.0.0.0";

function startActiveRuntimeVersionSyncLoop(
  db: ReturnType<typeof createSupabaseClient>,
  runtimeVersion: string,
  getRuntimeReadiness: ReturnType<typeof createApiRuntimeReadinessProbe>,
  apiUrl?: string,
) {
  let lastSyncState: string | null = null;

  const tick = async () => {
    try {
      const result = await syncActiveRuntimeVersionOnce({
        apiUrl,
        runtimeVersion,
        getRuntimeReadiness,
        upsertActiveRuntimeVersion: async (activeRuntimeVersion) => {
          await upsertActiveWorkerRuntimeVersion(db, {
            worker_type: WORKER_RUNTIME_TYPE.scoring,
            active_runtime_version: activeRuntimeVersion,
          });
        },
      });

      if (!result.ok && result.state === "readiness_unhealthy") {
        if (lastSyncState !== "readiness_unhealthy") {
          apiLogger.warn(
            {
              event: "api.runtime_readiness_parked",
              readiness: result.readiness.readiness,
            },
            "API runtime control sync parked until API readiness is healthy",
          );
        }
        lastSyncState = "readiness_unhealthy";
        return;
      }

      if (!result.ok) {
        const publicRuntimeStatus = result.publicRuntimeStatus;
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

      if (lastSyncState !== "active") {
        apiLogger.info(
          {
            event: "api.runtime_schema_ready",
            runtimeVersion,
            publicRuntimeVersion:
              result.publicRuntimeStatus.observedRuntimeVersion,
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
  const getRuntimeReadiness = createApiRuntimeReadinessProbe({
    createSupabaseClientImpl: () => db,
  });
  const app = createApp({ getRuntimeReadiness });
  const runtimeIdentity = getAgoraRuntimeIdentity(config);

  serve({ fetch: app.fetch, port, hostname: API_LISTEN_HOST });
  startActiveRuntimeVersionSyncLoop(
    db,
    runtimeVersion,
    getRuntimeReadiness,
    config.AGORA_API_URL,
  );

  apiLogger.info(
    {
      event: "api.startup",
      port,
      host: API_LISTEN_HOST,
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
