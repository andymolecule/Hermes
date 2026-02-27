import http from "node:http";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { hermesGetChallenge } from "./tools/get-challenge.js";
import { hermesGetLeaderboard } from "./tools/get-leaderboard.js";
import { hermesGetSubmissionStatus } from "./tools/get-submission-status.js";
import { hermesListChallenges } from "./tools/list-challenges.js";
import { hermesSubmitSolution } from "./tools/submit-solution.js";
import { hermesVerifySubmission } from "./tools/verify-submission.js";
import { enforceMcpSessionPayment, getMcpX402Metadata } from "./x402.js";

function asToolResult(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function createServer(options?: { allowRemotePrivateKey?: boolean }) {
  const server = new McpServer({
    name: "hermes-mcp",
    version: "0.1.0",
  });

  server.registerTool(
    "hermes-list-challenges",
    {
      description: "List challenges filtered by status/domain/minReward.",
      inputSchema: z.object({
        status: z.string().optional(),
        domain: z.string().optional(),
        minReward: z.number().optional(),
        limit: z.number().int().positive().optional(),
      }),
    },
    async (input) => asToolResult(await hermesListChallenges(input)),
  );

  server.registerTool(
    "hermes-get-challenge",
    {
      description: "Return challenge details, submissions, and leaderboard.",
      inputSchema: z.object({
        challengeId: z.string().uuid(),
      }),
    },
    async (input) => asToolResult(await hermesGetChallenge(input)),
  );

  server.registerTool(
    "hermes-submit-solution",
    {
      description: "Pin a submission file and submit on-chain.",
      inputSchema: z.object({
        challengeId: z.string().uuid(),
        filePath: z.string().min(1),
        privateKey: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
      }),
    },
    async (input) =>
      asToolResult(
        await hermesSubmitSolution(input, {
          allowRemotePrivateKey: options?.allowRemotePrivateKey ?? false,
        }),
      ),
  );

  server.registerTool(
    "hermes-get-leaderboard",
    {
      description: "Return ranked submissions for a challenge.",
      inputSchema: z.object({
        challengeId: z.string().uuid(),
      }),
    },
    async (input) => asToolResult(await hermesGetLeaderboard(input)),
  );

  server.registerTool(
    "hermes-get-submission-status",
    {
      description: "Return score/rank/proof-bundle status for a submission.",
      inputSchema: z.object({
        submissionId: z.string().uuid(),
      }),
    },
    async (input) => asToolResult(await hermesGetSubmissionStatus(input)),
  );

  server.registerTool(
    "hermes-verify-submission",
    {
      description:
        "Re-run scoring and return MATCH/MISMATCH against on-chain score.",
      inputSchema: z.object({
        challengeId: z.string().uuid(),
        submissionId: z.string().uuid(),
        tolerance: z.number().optional(),
      }),
    },
    async (input) => asToolResult(await hermesVerifySubmission(input)),
  );

  return server;
}

const MCP_SESSION_TTL_MS = 30 * 60 * 1000;
const MCP_SESSION_GC_INTERVAL_MS = 5 * 60 * 1000;

type HttpMcpSession = {
  id: string;
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  createdAt: number;
  lastSeenAt: number;
};

function headerValue(value: string | string[] | undefined) {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

async function createHttpMcpSession(
  sessions: Map<string, HttpMcpSession>,
  options: { allowRemotePrivateKey: boolean },
): Promise<HttpMcpSession> {
  const id = randomUUID();
  const server = createServer({
    allowRemotePrivateKey: options.allowRemotePrivateKey,
  });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => id,
  });
  await server.connect(transport);

  const session: HttpMcpSession = {
    id,
    server,
    transport,
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
  };
  sessions.set(id, session);

  const anyTransport = transport as unknown as { onclose?: () => void };
  anyTransport.onclose = () => {
    sessions.delete(id);
  };

  return session;
}

async function startStdioMode() {
  const server = createServer({ allowRemotePrivateKey: true });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function startHttpMode() {
  const port = Number(process.env.HERMES_MCP_PORT ?? 3001);
  const allowRemotePrivateKey = parseBoolean(
    process.env.HERMES_MCP_ALLOW_REMOTE_PRIVATE_KEYS,
    false,
  );
  const sessions = new Map<string, HttpMcpSession>();

  const gcTimer = setInterval(() => {
    const now = Date.now();
    for (const [sessionId, session] of sessions) {
      if (now - session.lastSeenAt <= MCP_SESSION_TTL_MS) continue;
      const anyTransport = session.transport as unknown as { close?: () => void };
      try {
        anyTransport.close?.();
      } catch {
        // best-effort close
      }
      sessions.delete(sessionId);
    }
  }, MCP_SESSION_GC_INTERVAL_MS);
  gcTimer.unref();

  const server = http.createServer((req, res) => {
    if (!req.url) {
      res.statusCode = 400;
      res.end("Missing URL");
      return;
    }

    const url = new URL(req.url, `http://localhost:${port}`);

    if (req.method === "OPTIONS") {
      res.statusCode = 200;
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, mcp-session-id, mcp-protocol-version, Last-Event-ID, X-PAYMENT, X-PAYMENT-RESPONSE, X-402-PAYMENT",
      );
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/healthz") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: true, activeSessions: sessions.size }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/.well-known/x402") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify(getMcpX402Metadata()));
      return;
    }

    if (url.pathname !== "/mcp") {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    void (async () => {
      try {
        const sessionId = headerValue(req.headers["mcp-session-id"]);
        const existingSession = sessionId ? sessions.get(sessionId) : null;

        if (sessionId && !existingSession) {
          res.statusCode = 404;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: "Unknown MCP session id." }));
          return;
        }

        if (!existingSession && !(await enforceMcpSessionPayment(req, res))) {
          return;
        }

        const session =
          existingSession ??
          (await createHttpMcpSession(sessions, { allowRemotePrivateKey }));
        session.lastSeenAt = Date.now();
        await session.transport.handleRequest(req, res);
      } catch (error) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(
          JSON.stringify({
            error:
              error instanceof Error ? error.message : "MCP request failed",
          }),
        );
      }
    })();
  });

  server.listen(port, () => {
    console.log(`Hermes MCP server listening on http://localhost:${port}`);
  });
}

if (process.argv.includes("--stdio")) {
  void startStdioMode();
} else {
  startHttpMode();
}
