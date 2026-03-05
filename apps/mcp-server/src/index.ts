import http from "node:http";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { readFeaturePolicy } from "@hermes/common";
import { z } from "zod";
import { hermesClaimPayout } from "./tools/claim-payout.js";
import { hermesGetChallenge } from "./tools/get-challenge.js";
import { hermesGetLeaderboard } from "./tools/get-leaderboard.js";
import { hermesGetSubmissionStatus } from "./tools/get-submission-status.js";
import { hermesListChallenges } from "./tools/list-challenges.js";
import { hermesScoreLocal } from "./tools/score-local.js";
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

function createServer(options?: { allowRemotePrivateKey?: boolean }) {
  const server = new McpServer({
    name: "hermes-mcp",
    version: "0.1.0",
  });

  server.registerTool(
    "hermes-list-challenges",
    {
      description:
        "List open science bounties. Filter by status (active, scoring, finalized), domain (longevity, drug_discovery, protein_design, omics, other), minimum USDC reward, or limit. Returns challenge UUID, title, reward, deadline, and current status.",
      inputSchema: z.object({
        status: z.string().optional().describe("Filter: active, scoring, finalized, cancelled"),
        domain: z.string().optional().describe("Filter: longevity, drug_discovery, protein_design, omics, other"),
        minReward: z.number().optional().describe("Minimum USDC reward (e.g. 10 for $10+)"),
        limit: z.number().int().positive().optional().describe("Max results to return"),
      }),
    },
    async (input) => asToolResult(await hermesListChallenges(input)),
  );

  server.registerTool(
    "hermes-get-challenge",
    {
      description:
        "Get full challenge details including description, datasets, submissions, and leaderboard. Response includes 'datasets' object with direct download URLs (train_url, test_url, spec_url) for IPFS-pinned files.",
      inputSchema: z.object({
        challengeId: z.string().uuid().describe("Challenge UUID from hermes-list-challenges"),
      }),
    },
    async (input) => asToolResult(await hermesGetChallenge(input)),
  );

  server.registerTool(
    "hermes-score-local",
    {
      description:
        "Dry-run the Docker scorer on your submission file without submitting on-chain. Free and unlimited — use this to test your solution before committing gas. Returns score (0-1), details, and container digest.",
      inputSchema: z.object({
        challengeId: z.string().uuid().describe("Challenge UUID"),
        filePath: z.string().min(1).describe("Absolute path to your submission file (e.g. results.csv)"),
      }),
    },
    async (input) => asToolResult(await hermesScoreLocal(input)),
  );

  server.registerTool(
    "hermes-submit-solution",
    {
      description:
        "Pin a submission file to IPFS and submit its hash on-chain. Costs gas. Use hermes-score-local first to verify your score. The submission is automatically queued for scoring by the oracle worker. In stdio mode, uses the server's configured wallet. In HTTP mode, provide a privateKey.",
      inputSchema: z.object({
        challengeId: z.string().uuid().describe("Challenge UUID"),
        filePath: z.string().min(1).describe("Absolute path to submission file"),
        privateKey: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional().describe("0x-prefixed 32-byte hex private key (required in HTTP mode)"),
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
    "hermes-claim-payout",
    {
      description:
        "Claim your USDC payout after a challenge is finalized. Only callable by winning solvers. The challenge must be in 'finalized' status (deadline passed + dispute window elapsed + finalize() called). Returns the claim transaction hash.",
      inputSchema: z.object({
        challengeId: z.string().uuid().describe("Challenge UUID"),
        privateKey: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional().describe("0x-prefixed 32-byte hex private key (required in HTTP mode)"),
      }),
    },
    async (input) =>
      asToolResult(
        await hermesClaimPayout(input, {
          allowRemotePrivateKey: options?.allowRemotePrivateKey ?? false,
        }),
      ),
  );

  server.registerTool(
    "hermes-get-leaderboard",
    {
      description:
        "Get ranked submissions for a challenge, sorted by score (highest first). Each entry includes solver address, score, and submission ID.",
      inputSchema: z.object({
        challengeId: z.string().uuid().describe("Challenge UUID"),
      }),
    },
    async (input) => asToolResult(await hermesGetLeaderboard(input)),
  );

  server.registerTool(
    "hermes-get-submission-status",
    {
      description:
        "Check the scoring status of a specific submission. Returns score, proof bundle CID, and whether the submission has been scored on-chain.",
      inputSchema: z.object({
        submissionId: z.string().uuid().describe("Submission UUID from hermes-get-challenge or hermes-submit-solution"),
      }),
    },
    async (input) => asToolResult(await hermesGetSubmissionStatus(input)),
  );

  server.registerTool(
    "hermes-verify-submission",
    {
      description:
        "Re-run the Docker scorer independently and compare against the on-chain score. Returns MATCH if scores agree within tolerance, MISMATCH otherwise. Requires Docker.",
      inputSchema: z.object({
        challengeId: z.string().uuid().describe("Challenge UUID"),
        submissionId: z.string().uuid().describe("Submission UUID"),
        tolerance: z.number().optional().describe("Score comparison tolerance (default 0.001)"),
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
  const allowRemotePrivateKey = readFeaturePolicy().allowMcpRemotePrivateKeys;
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
