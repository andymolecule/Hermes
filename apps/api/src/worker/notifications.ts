import crypto from "node:crypto";
import os from "node:os";
import { pathToFileURL } from "node:url";
import {
  readAgentNotificationRuntimeConfig,
  readNotificationWorkerTimingConfig,
} from "@agora/common";
import {
  type AgentNotificationOutboxRow,
  claimNextAgentNotification,
  createSupabaseClient,
  getAgentNotificationEndpointById,
  heartbeatAgentNotificationLease,
  markAgentNotificationDelivered,
  markAgentNotificationFailed,
} from "@agora/db";
import {
  decryptAgentNotificationSigningSecret,
  signAgentNotificationPayload,
} from "../lib/agent-notification-secrets.js";
import {
  captureApiException,
  initWorkerObservability,
  workerLogger,
} from "../lib/observability.js";
import { sleep } from "./policy.js";
import type { WorkerLogFn } from "./types.js";

const NOTIFICATION_WORKER_INSTANCE_ID = crypto.randomBytes(4).toString("hex");
const LOG_NOTIFICATION_WORKER_ID = `notification-${NOTIFICATION_WORKER_INSTANCE_ID}`;
const WORKER_HOST = os.hostname();
const REQUEST_TIMEOUT_MS = 30_000;
const RETRY_DELAYS_MS = [
  30_000,
  2 * 60_000,
  10 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
];

const structuredLogger = workerLogger.child({
  workerId: LOG_NOTIFICATION_WORKER_ID,
  host: WORKER_HOST,
  workerType: "notification",
});

const log: WorkerLogFn = (level, message, meta) => {
  structuredLogger[level](meta ?? {}, message);
};

function resolveNotificationWorkerId() {
  return `${WORKER_HOST}-${LOG_NOTIFICATION_WORKER_ID}`;
}

function getRetryDelayMs(attempts: number) {
  return (
    RETRY_DELAYS_MS[Math.max(0, attempts - 1)] ??
    RETRY_DELAYS_MS.at(-1) ??
    30_000
  );
}

function isRetriableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function classifyDeliveryFailure(error: unknown) {
  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return { retriable: true, message: "Notification request timed out." };
    }
    return { retriable: true, message: error.message };
  }
  return { retriable: true, message: String(error) };
}

function startNotificationLeaseHeartbeat(
  db: ReturnType<typeof createSupabaseClient>,
  notification: AgentNotificationOutboxRow,
  workerId: string,
  log: WorkerLogFn,
) {
  let stopped = false;
  let lostLease = false;
  const { heartbeatIntervalMs } = readNotificationWorkerTimingConfig();

  const tick = async () => {
    if (stopped) return;
    try {
      const refreshed = await heartbeatAgentNotificationLease(
        db,
        notification.id,
        workerId,
      );
      if (!refreshed && !stopped) {
        lostLease = true;
        log("warn", "Notification lease heartbeat lost ownership", {
          notificationId: notification.id,
          workerId,
        });
      }
    } catch (error) {
      if (!stopped) {
        log("warn", "Notification lease heartbeat failed", {
          notificationId: notification.id,
          workerId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, heartbeatIntervalMs);
  timer.unref?.();

  return {
    hasLostLease() {
      return lostLease;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
    },
  };
}

async function postAgentNotification(input: {
  url: string;
  body: string;
  eventType: string;
  deliveryId: string;
  signingSecret: string;
}) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = signAgentNotificationPayload({
    signingSecret: input.signingSecret,
    timestamp,
    body: input.body,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(input.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agora-event": input.eventType,
        "x-agora-delivery-id": input.deliveryId,
        "x-agora-timestamp": timestamp,
        "x-agora-signature": `sha256=${signature}`,
      },
      body: input.body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function deliverNotification(
  db: ReturnType<typeof createSupabaseClient>,
  notification: AgentNotificationOutboxRow,
  workerId: string,
  leaseGuard: { hasLostLease: () => boolean },
) {
  const endpoint = await getAgentNotificationEndpointById(
    db,
    notification.endpoint_id,
  );
  if (!endpoint) {
    await markAgentNotificationFailed(db, {
      notificationId: notification.id,
      endpointId: notification.endpoint_id,
      errorMessage:
        "Notification endpoint no longer exists. Next step: re-register the webhook and retry.",
      attempts: notification.attempts,
      maxAttempts: notification.max_attempts,
      permanent: true,
    });
    return;
  }

  if (endpoint.status !== "active") {
    await markAgentNotificationFailed(db, {
      notificationId: notification.id,
      endpointId: endpoint.id,
      errorMessage:
        "Notification endpoint is disabled. Next step: re-enable the webhook and retry delivery manually if needed.",
      attempts: notification.attempts,
      maxAttempts: notification.max_attempts,
      permanent: true,
    });
    return;
  }

  const runtime = readAgentNotificationRuntimeConfig();
  const signingSecret = decryptAgentNotificationSigningSecret(
    endpoint.signing_secret_ciphertext,
    runtime.masterKey,
  );
  const body = JSON.stringify(notification.payload_json);

  try {
    const response = await postAgentNotification({
      url: endpoint.webhook_url,
      body,
      eventType: notification.event_type,
      deliveryId: notification.id,
      signingSecret,
    });

    if (leaseGuard.hasLostLease()) {
      log("warn", "Notification delivery lost lease before completion", {
        notificationId: notification.id,
        workerId,
      });
      return;
    }

    if (response.ok) {
      await markAgentNotificationDelivered(db, {
        notificationId: notification.id,
        endpointId: endpoint.id,
      });
      return;
    }

    const message = `Notification webhook returned HTTP ${response.status}.`;
    await markAgentNotificationFailed(db, {
      notificationId: notification.id,
      endpointId: endpoint.id,
      errorMessage: message,
      attempts: notification.attempts,
      maxAttempts: notification.max_attempts,
      delayMs: isRetriableStatus(response.status)
        ? getRetryDelayMs(notification.attempts)
        : 0,
      permanent: !isRetriableStatus(response.status),
    });
  } catch (error) {
    const classified = classifyDeliveryFailure(error);
    await markAgentNotificationFailed(db, {
      notificationId: notification.id,
      endpointId: endpoint.id,
      errorMessage: classified.message,
      attempts: notification.attempts,
      maxAttempts: notification.max_attempts,
      delayMs: classified.retriable
        ? getRetryDelayMs(notification.attempts)
        : 0,
      permanent: !classified.retriable,
    });
  }
}

export async function startNotificationWorker() {
  initWorkerObservability();
  readAgentNotificationRuntimeConfig();
  const db = createSupabaseClient(true);
  const timing = readNotificationWorkerTimingConfig();
  const workerId = resolveNotificationWorkerId();

  log("info", "Notification worker started", {
    pollIntervalMs: timing.pollIntervalMs,
    leaseMs: timing.jobLeaseMs,
    workerId: LOG_NOTIFICATION_WORKER_ID,
    claimWorkerId: workerId,
    host: WORKER_HOST,
  });

  while (true) {
    let claimedNotification = false;
    try {
      const notification = await claimNextAgentNotification(
        db,
        workerId,
        timing.jobLeaseMs,
      );

      if (notification) {
        claimedNotification = true;
        log("info", "Claimed notification delivery job", {
          notificationId: notification.id,
          eventType: notification.event_type,
          agentId: notification.agent_id,
          challengeId: notification.challenge_id,
          attempts: notification.attempts,
          maxAttempts: notification.max_attempts,
        });

        const leaseGuard = startNotificationLeaseHeartbeat(
          db,
          notification,
          workerId,
          log,
        );
        try {
          await deliverNotification(db, notification, workerId, leaseGuard);
        } finally {
          leaseGuard.stop();
        }
      }
    } catch (error) {
      captureApiException(error, {
        service: "worker",
        logger: workerLogger,
        bindings: {
          event: "notification.worker.loop.error",
          workerId: LOG_NOTIFICATION_WORKER_ID,
        },
      });
      log("error", "Notification worker loop error", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (!claimedNotification) {
      await sleep(timing.pollIntervalMs);
    }
  }
}

export function maybeRunNotificationWorkerCli(
  importMetaUrl: string,
  argv1?: string,
) {
  const isEntrypoint = argv1
    ? pathToFileURL(argv1).href === importMetaUrl
    : false;
  if (!isEntrypoint) return;

  startNotificationWorker().catch((error) => {
    captureApiException(error, {
      service: "worker",
      logger: workerLogger,
      bindings: {
        event: "notification.worker.startup.failed",
        workerId: LOG_NOTIFICATION_WORKER_ID,
      },
    });
    log("error", "Notification worker failed to start", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}
