import {
  AGORA_TRACE_ID_HEADER,
  type AgoraObservabilityRuntimeConfig,
  readObservabilityRuntimeConfig,
} from "@agora/common";
import {
  AGORA_REQUEST_ID_HEADER,
  type AgoraLogBindings,
  type AgoraLogger,
  buildAgoraSentryInitOptions,
  buildErrorLogFields,
  createAgoraLogger,
  normalizeRequestId,
  resolveRequestId,
} from "@agora/common/server-observability";
import * as Sentry from "@sentry/node";
import type { Context, MiddlewareHandler } from "hono";
import type { ApiEnv } from "../types.js";

const observability = readObservabilityRuntimeConfig();
const apiLogger = createServiceLogger("api");
const workerLogger = createServiceLogger("worker");
let sentryInitialized = false;

function createServiceLogger(
  service: string,
  bindings?: AgoraLogBindings,
  runtime: AgoraObservabilityRuntimeConfig = observability,
) {
  return createAgoraLogger({
    service,
    observability: runtime,
    bindings,
  });
}

function initServiceSentry(service: string) {
  if (sentryInitialized) return;

  const sentry = buildAgoraSentryInitOptions(service, observability);
  if (sentry.enabled) {
    Sentry.init({
      ...sentry,
      sendDefaultPii: false,
    });
  }
  sentryInitialized = true;
}

export function initApiObservability() {
  initServiceSentry("api");
  return apiLogger;
}

export function initWorkerObservability() {
  initServiceSentry("worker");
  return workerLogger;
}

export function getRequestId(c: Pick<Context<ApiEnv>, "get">) {
  return c.get("requestId");
}

export function getRequestLogger(c: Pick<Context<ApiEnv>, "get">) {
  return c.get("logger");
}

export function getTraceId(c: Pick<Context<ApiEnv>, "get">) {
  return c.get("traceId");
}

export function bindRequestLogger(
  c: Pick<Context<ApiEnv>, "get" | "set">,
  bindings: AgoraLogBindings,
): AgoraLogger {
  const logger = (c.get("logger") ?? apiLogger).child(bindings);
  c.set("logger", logger);
  return logger;
}

export function createApiRequestObservabilityMiddleware(): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const requestId = resolveRequestId(c.req.header(AGORA_REQUEST_ID_HEADER));
    const traceId =
      normalizeRequestId(c.req.header(AGORA_TRACE_ID_HEADER)) ?? requestId;
    const path = new URL(c.req.url).pathname;
    const logger = apiLogger.child({
      requestId,
      traceId,
      method: c.req.method,
      path,
    });
    const startedAt = Date.now();

    c.set("requestId", requestId);
    c.set("traceId", traceId);
    c.set("logger", logger);
    c.header(AGORA_REQUEST_ID_HEADER, requestId);
    c.header(AGORA_TRACE_ID_HEADER, traceId);

    await next();

    logger.info(
      {
        event: "http.request.completed",
        status: c.res.status,
        durationMs: Date.now() - startedAt,
      },
      "Request completed",
    );
  };
}

export function captureApiException(
  error: unknown,
  input: {
    service: "api" | "worker";
    logger?: AgoraLogger;
    requestId?: string;
    method?: string;
    path?: string;
    bindings?: AgoraLogBindings;
  },
) {
  const logger =
    input.logger ?? (input.service === "worker" ? workerLogger : apiLogger);
  logger.error(
    buildErrorLogFields(error, {
      event: "unhandled.error",
      requestId: input.requestId,
      method: input.method,
      path: input.path,
      ...input.bindings,
    }),
    "Unhandled service error",
  );

  if (!observability.sentryDsn) {
    return;
  }

  const errorObject = error instanceof Error ? error : new Error(String(error));
  Sentry.withScope((scope) => {
    scope.setTag("service", input.service);
    if (input.requestId) {
      scope.setTag("request_id", input.requestId);
    }
    if (input.method) {
      scope.setTag("http.method", input.method);
    }
    if (input.path) {
      scope.setTag("http.path", input.path);
    }
    for (const [key, value] of Object.entries(input.bindings ?? {})) {
      if (value !== undefined) {
        scope.setExtra(key, value);
      }
    }
    Sentry.captureException(errorObject);
  });
}

export { AGORA_REQUEST_ID_HEADER, apiLogger, workerLogger };
