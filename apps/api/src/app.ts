import { Hono } from "hono";
import { cors } from "hono/cors";
import authRoutes from "./routes/auth.js";
import challengeRoutes from "./routes/challenges.js";
import statsRoutes from "./routes/stats.js";
import submissionRoutes from "./routes/submissions.js";
import verifyRoutes from "./routes/verify.js";
import type { ApiEnv } from "./types.js";

const MAX_JSON_BODY_BYTES = 1024 * 1024;
const corsOrigins = (process.env.HERMES_CORS_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export function createApp() {
  const app = new Hono<ApiEnv>();

  app.use(
    "*",
    cors({
      origin: (origin) => {
        if (!origin) return undefined;
        if (corsOrigins.length === 0) {
          return process.env.NODE_ENV === "production" ? undefined : origin;
        }
        return corsOrigins.includes(origin) ? origin : undefined;
      },
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type"],
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

  app.get("/healthz", (c) => c.json({ ok: true }));

  app.route("/api/auth", authRoutes);
  app.route("/api/challenges", challengeRoutes);
  app.route("/api/submissions", submissionRoutes);
  app.route("/api/verify", verifyRoutes);
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
