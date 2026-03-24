import {
  getAgoraRuntimeVersion,
  isProductionRuntime,
  readApiServerRuntimeConfig,
} from "@agora/common";
import { Hono } from "hono";
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
import { buildX402Metadata, createX402Middleware } from "./middleware/x402.js";
import agentChallengeRoutes from "./routes/agent-challenges.js";
import agentRoutes from "./routes/agents.js";
import analyticsRoutes from "./routes/analytics.js";
import authRoutes from "./routes/auth.js";
import authoringSessionRoutes from "./routes/authoring-sessions.js";
import challengeRoutes from "./routes/challenges.js";
import indexerHealthRoutes from "./routes/indexer-health.js";
import internalAuthoringRoutes from "./routes/internal-authoring.js";
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
export function createApp() {
  const runtimeConfig = readApiServerRuntimeConfig();
  initApiObservability();
  const app = new Hono<ApiEnv>();
  const x402Middleware = createX402Middleware();

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
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: [
        "Content-Type",
        "Authorization",
        "If-None-Match",
        "X-PAYMENT",
        "X-PAYMENT-RESPONSE",
        "X-402-PAYMENT",
        "X-Request-Id",
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

  app.get("/healthz", (c) => {
    return c.json({
      ok: true,
      service: "api",
      runtimeVersion: getAgoraRuntimeVersion(),
      checkedAt: new Date().toISOString(),
    });
  });
  app.get("/.well-known/openapi.json", (c) =>
    c.json(buildOpenApiDocument(runtimeConfig.apiUrl)),
  );
  app.get("/.well-known/x402", (c) => c.json(buildX402Metadata()));

  app.use("*", x402Middleware);

  app.route("/api/analytics", analyticsRoutes);
  app.route("/api/agents", agentRoutes);
  app.route("/api/auth", authRoutes);
  app.route("/api/challenges", challengeRoutes);
  app.route("/api/indexer-health", indexerHealthRoutes);
  app.route("/api/leaderboard", leaderboardRoutes);
  app.route("/api/internal/authoring", internalAuthoringRoutes);
  app.route("/api/internal/submissions", internalSubmissionRoutes);
  app.route("/api/pin-spec", pinSpecRoutes);
  app.route("/api/authoring", authoringSessionRoutes);
  app.route("/api/worker-health", workerHealthRoutes);
  app.route("/api/agent/challenges", agentChallengeRoutes);
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
