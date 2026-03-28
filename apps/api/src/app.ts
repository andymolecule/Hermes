import {
  getAgoraReleaseMetadata,
  isProductionRuntime,
  readApiServerRuntimeConfig,
} from "@agora/common";
import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import { jsonError, toApiErrorResponse } from "./lib/api-error.js";
import {
  captureApiException,
  createApiRequestObservabilityMiddleware,
  getRequestId,
  getRequestLogger,
  initApiObservability,
} from "./lib/observability.js";
import { buildOpenApiDocument } from "./lib/openapi.js";
import { createApiRuntimeReadinessProbe } from "./lib/runtime-readiness.js";
import { buildX402Metadata, createX402Middleware } from "./middleware/x402.js";
import agentRoutes from "./routes/agents.js";
import analyticsRoutes from "./routes/analytics.js";
import authRoutes from "./routes/auth.js";
import authoringSessionRoutes from "./routes/authoring-sessions.js";
import challengeRoutes from "./routes/challenges.js";
import indexerHealthRoutes from "./routes/indexer-health.js";
import internalAuthoringRoutes from "./routes/internal-authoring.js";
import internalRunRoutes from "./routes/internal-runs.js";
import internalSubmissionRoutes from "./routes/internal-submissions.js";
import leaderboardRoutes from "./routes/leaderboard.js";
import pinSpecRoutes from "./routes/pin-spec.js";
import portfolioRoutes from "./routes/portfolio.js";
import statsRoutes from "./routes/stats.js";
import submissionRoutes from "./routes/submissions.js";
import verifyRoutes from "./routes/verify.js";
import workerHealthRoutes from "./routes/worker-health.js";
import type { ApiEnv } from "./types.js";

const MAX_JSON_BODY_BYTES = 1024 * 1024;
export function createApp(
  dependencies: {
    getRuntimeReadiness?: ReturnType<typeof createApiRuntimeReadinessProbe>;
  } = {},
) {
  const runtimeConfig = readApiServerRuntimeConfig();
  initApiObservability();
  const app = new Hono<ApiEnv>();
  const x402Middleware = createX402Middleware();
  const getRuntimeReadiness =
    dependencies.getRuntimeReadiness ?? createApiRuntimeReadinessProbe();

  function buildApiHealthPayload(
    readiness: Awaited<ReturnType<typeof getRuntimeReadiness>>,
  ) {
    const release = getAgoraReleaseMetadata();
    return {
      ok: readiness.ok,
      service: "api",
      releaseId: release.releaseId,
      gitSha: release.gitSha,
      runtimeVersion: release.runtimeVersion,
      identitySource: release.identitySource,
      checkedAt: readiness.checkedAt,
      readiness: readiness.readiness,
    };
  }

  function collectRuntimeReadinessNextAction(
    readiness: Awaited<ReturnType<typeof getRuntimeReadiness>>,
  ) {
    const nextActions = [
      ...readiness.readiness.databaseSchema.failures.map((failure) =>
        failure.nextStep.trim(),
      ),
      ...readiness.readiness.authoringPublishConfig.failures.map((failure) =>
        failure.nextStep.trim(),
      ),
    ].filter(Boolean);
    return (
      nextActions[0] ??
      "Restore the runtime schema and authoring publish configuration before accepting traffic."
    );
  }

  function buildRuntimeReadinessFailureMessage(
    readiness: Awaited<ReturnType<typeof getRuntimeReadiness>>,
  ) {
    const schemaFailed = !readiness.readiness.databaseSchema.ok;
    const publishConfigFailed = !readiness.readiness.authoringPublishConfig.ok;

    if (schemaFailed && publishConfigFailed) {
      return "API runtime database schema and authoring publish config are incompatible with the current deployment.";
    }
    if (schemaFailed) {
      return "API runtime database schema is incompatible with the current deployment.";
    }
    return "API runtime authoring publish config is incompatible with the current deployment.";
  }

  async function respondWithApiHealth(c: Context<ApiEnv>) {
    const readiness = await getRuntimeReadiness();
    const status = readiness.ok ? 200 : 503;
    const host = c.req.header("host") ?? null;
    const forwardedHost = c.req.header("x-forwarded-host") ?? null;
    const forwardedProto = c.req.header("x-forwarded-proto") ?? null;
    const origin = c.req.header("origin") ?? null;
    const userAgent = c.req.header("user-agent") ?? null;
    getRequestLogger(c).info(
      {
        event: "api.health.probe",
        readinessOk: readiness.ok,
        status,
        host,
        forwardedHost,
        forwardedProto,
        origin,
        userAgent,
        checkedAt: readiness.checkedAt,
        databaseSchemaOk: readiness.readiness.databaseSchema.ok,
        authoringPublishConfigOk: readiness.readiness.authoringPublishConfig.ok,
      },
      "API health probe served",
    );

    if (c.req.method === "HEAD") {
      return c.body(null, status);
    }

    return c.json(buildApiHealthPayload(readiness), status);
  }

  app.use("*", createApiRequestObservabilityMiddleware());

  app.use(
    "*",
    cors({
      origin: (origin) => {
        if (!origin) return undefined;
        if (runtimeConfig.corsOrigins.length === 0) {
          return isProductionRuntime(runtimeConfig) ? undefined : origin;
        }
        return runtimeConfig.corsOrigins.includes(origin) ? origin : undefined;
      },
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: [
        "Content-Type",
        "Authorization",
        "If-None-Match",
        "X-PAYMENT",
        "X-PAYMENT-RESPONSE",
        "X-402-PAYMENT",
        "X-Request-Id",
        "X-Agora-Trace-Id",
        "X-Agora-Client-Name",
        "X-Agora-Client-Version",
        "X-Agora-Decision-Summary",
      ],
      exposeHeaders: ["X-Request-Id"],
      credentials: true,
    }),
  );

  app.use("*", async (c, next) => {
    if (["POST", "PUT", "PATCH"].includes(c.req.method)) {
      const contentLength = c.req.header("content-length");
      if (contentLength && Number(contentLength) > MAX_JSON_BODY_BYTES) {
        return jsonError(c, {
          status: 413,
          code: "REQUEST_TOO_LARGE",
          message: "JSON body too large.",
        });
      }
    }
    await next();
  });

  app.on(["GET", "HEAD"], "/healthz", respondWithApiHealth);
  // Alias under /api/ so Railway's edge proxy cannot shadow it.
  app.on(["GET", "HEAD"], "/api/health", respondWithApiHealth);
  app.get("/.well-known/openapi.json", (c) =>
    c.json(buildOpenApiDocument(runtimeConfig.apiUrl)),
  );
  app.get("/.well-known/x402", (c) => c.json(buildX402Metadata()));

  app.use("/api/*", async (c, next) => {
    const readiness = await getRuntimeReadiness();
    if (readiness.ok) {
      await next();
      return;
    }

    return jsonError(c, {
      status: 503,
      code: "SERVICE_UNAVAILABLE",
      message: buildRuntimeReadinessFailureMessage(readiness),
      retriable: true,
      nextAction: collectRuntimeReadinessNextAction(readiness),
      extras: {
        readiness: readiness.readiness,
      },
    });
  });

  app.use("*", x402Middleware);

  app.route("/api/analytics", analyticsRoutes);
  app.route("/api/agents", agentRoutes);
  app.route("/api/auth", authRoutes);
  app.route("/api/challenges", challengeRoutes);
  app.route("/api/indexer-health", indexerHealthRoutes);
  app.route("/api/leaderboard", leaderboardRoutes);
  app.route("/api/internal/authoring", internalAuthoringRoutes);
  app.route("/api/internal/runs", internalRunRoutes);
  app.route("/api/internal/submissions", internalSubmissionRoutes);
  app.route("/api/pin-spec", pinSpecRoutes);
  app.route("/api/authoring", authoringSessionRoutes);
  app.route("/api/worker-health", workerHealthRoutes);
  app.route("/api/submissions", submissionRoutes);
  app.route("/api/verify", verifyRoutes);
  app.route("/api/me/portfolio", portfolioRoutes);
  app.route("/api/stats", statsRoutes);

  app.notFound((c) =>
    jsonError(c, {
      status: 404,
      code: "NOT_FOUND",
      message: "Not found",
    }),
  );

  app.onError((error, c) => {
    captureApiException(error, {
      service: "api",
      logger: getRequestLogger(c),
      requestId: getRequestId(c),
      method: c.req.method,
      path: new URL(c.req.url).pathname,
    });
    const response = toApiErrorResponse(error);
    c.header("x-request-id", getRequestId(c));
    return c.json(response.body, response.status);
  });

  return app;
}
