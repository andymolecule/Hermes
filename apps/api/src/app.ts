import {
  getAgoraRuntimeVersion,
  isProductionRuntime,
  readApiServerRuntimeConfig,
} from "@agora/common";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { buildX402Metadata, createX402Middleware } from "./middleware/x402.js";
import agentChallengeRoutes from "./routes/agent-challenges.js";
import analyticsRoutes from "./routes/analytics.js";
import authRoutes from "./routes/auth.js";
import challengeRoutes from "./routes/challenges.js";
import indexerHealthRoutes from "./routes/indexer-health.js";
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
  const app = new Hono<ApiEnv>();
  const x402Middleware = createX402Middleware();

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
        "X-PAYMENT",
        "X-PAYMENT-RESPONSE",
        "X-402-PAYMENT",
      ],
      credentials: true,
    }),
  );

  app.use("*", async (c, next) => {
    if (["POST", "PUT", "PATCH"].includes(c.req.method)) {
      const contentLength = c.req.header("content-length");
      if (contentLength && Number(contentLength) > MAX_JSON_BODY_BYTES) {
        return c.json({ error: "JSON body too large." }, 413);
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
  app.get("/.well-known/x402", (c) => c.json(buildX402Metadata()));

  app.use("*", x402Middleware);

  app.route("/api/analytics", analyticsRoutes);
  app.route("/api/auth", authRoutes);
  app.route("/api/challenges", challengeRoutes);
  app.route("/api/indexer-health", indexerHealthRoutes);
  app.route("/api/leaderboard", leaderboardRoutes);
  app.route("/api/pin-spec", pinSpecRoutes);
  app.route("/api/worker-health", workerHealthRoutes);
  app.route("/api/agent/challenges", agentChallengeRoutes);
  app.route("/api/submissions", submissionRoutes);
  app.route("/api/verify", verifyRoutes);
  app.route("/api/me/portfolio", portfolioRoutes);
  app.route("/api/stats", statsRoutes);

  app.notFound((c) => c.json({ error: "Not found" }, 404));

  app.onError((error, c) => {
    return c.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      500,
    );
  });

  return app;
}
