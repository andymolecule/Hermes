import { randomUUID } from "node:crypto";
import http from "node:http";
import process from "node:process";
import { loadConfig, readFeaturePolicy } from "@agora/common";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { agoraClaimPayout } from "./tools/claim-payout.js";
import { agoraGetChallenge } from "./tools/get-challenge.js";
import { agoraGetLeaderboard } from "./tools/get-leaderboard.js";
import { agoraGetSubmissionStatus } from "./tools/get-submission-status.js";
import { agoraListChallenges } from "./tools/list-challenges.js";
import { agoraScoreLocal } from "./tools/score-local.js";
import { agoraSubmitSolution } from "./tools/submit-solution.js";
import { agoraVerifySubmission } from "./tools/verify-submission.js";
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
    name: "agora-mcp",
    version: "0.1.0",
  });

  server.registerTool(
    "agora-list-challenges",
    {
      description:
        "List open science bounties. Filter by status (open, scoring, finalized), domain (longevity, drug_discovery, protein_design, omics, other), minimum USDC reward, or limit. Returns challenge UUID, title, reward, deadline, and current status.",
      inputSchema: z.object({
        status: z
          .string()
          .optional()
          .describe("Filter: open, scoring, finalized, cancelled"),
        domain: z
          .string()
          .optional()
          .describe(
            "Filter: longevity, drug_discovery, protein_design, omics, other",
          ),
        minReward: z
          .number()
          .optional()
          .describe("Minimum USDC reward (e.g. 10 for $10+)"),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Max results to return"),
      }),
    },
    async (input) => asToolResult(await agoraListChallenges(input)),
  );

  server.registerTool(
    "agora-get-challenge",
    {
      description:
        "Get full challenge details including description, datasets, submissions, and leaderboard. Response includes 'datasets' object with both canonical IPFS CIDs (train_cid, test_cid, spec_cid) and HTTP gateway download URLs (train_url, test_url, spec_url).",
      inputSchema: z.object({
        challengeId: z
          .string()
          .uuid()
          .describe("Challenge UUID from agora-list-challenges"),
      }),
    },
    async (input) => asToolResult(await agoraGetChallenge(input)),
  );

  server.registerTool(
    "agora-score-local",
    {
      description:
        "Dry-run the Docker scorer on your submission file without submitting on-chain. Free and unlimited — use this to test your solution before committing gas. Returns score (0-1), details, and container digest.",
      inputSchema: z.object({
        challengeId: z.string().uuid().describe("Challenge UUID"),
        filePath: z
          .string()
          .min(1)
          .describe("Absolute path to your submission file (e.g. results.csv)"),
      }),
    },
    async (input) => asToolResult(await agoraScoreLocal(input)),
  );

  server.registerTool(
    "agora-submit-solution",
    {
      description:
        "Pin a submission file to IPFS and submit its hash on-chain. Costs gas. Use agora-score-local first to verify your score. The submission is automatically queued for scoring by the oracle worker. In stdio mode, uses the server's configured wallet. SECURITY: Only provide privateKey in local stdio mode. Never send private keys over HTTP/network connections — keys are transmitted in plaintext and could be intercepted.",
      inputSchema: z.object({
        challengeId: z.string().uuid().describe("Challenge UUID"),
        filePath: z
          .string()
          .min(1)
          .describe("Absolute path to submission file"),
        privateKey: z
          .string()
          .regex(/^0x[a-fA-F0-9]{64}$/)
          .optional()
          .describe(
            "0x-prefixed 32-byte hex private key. ONLY use in local stdio mode — never send over HTTP.",
          ),
      }),
    },
    async (input) =>
      asToolResult(
        await agoraSubmitSolution(input, {
          allowRemotePrivateKey: options?.allowRemotePrivateKey ?? false,
        }),
      ),
  );

  server.registerTool(
    "agora-claim-payout",
    {
      description:
        "Claim your USDC payout after a challenge is finalized. Only callable by winning solvers. The challenge must be in 'finalized' status (deadline passed + dispute window elapsed + finalize() called). Returns the claim transaction hash. SECURITY: Only provide privateKey in local stdio mode. Never send private keys over HTTP/network connections.",
      inputSchema: z.object({
        challengeId: z.string().uuid().describe("Challenge UUID"),
        privateKey: z
          .string()
          .regex(/^0x[a-fA-F0-9]{64}$/)
          .optional()
          .describe(
            "0x-prefixed 32-byte hex private key. ONLY use in local stdio mode — never send over HTTP.",
          ),
      }),
    },
    async (input) =>
      asToolResult(
        await agoraClaimPayout(input, {
          allowRemotePrivateKey: options?.allowRemotePrivateKey ?? false,
        }),
      ),
  );

  server.registerTool(
    "agora-get-leaderboard",
    {
      description:
        "Get ranked submissions for a challenge, sorted by score (highest first). Each entry includes solver address, score, and submission ID.",
      inputSchema: z.object({
        challengeId: z.string().uuid().describe("Challenge UUID"),
      }),
    },
    async (input) => asToolResult(await agoraGetLeaderboard(input)),
  );

  server.registerTool(
    "agora-get-submission-status",
    {
      description:
        "Check the scoring status of a specific submission. Returns score, proof bundle CID, and whether the submission has been scored on-chain.",
      inputSchema: z.object({
        submissionId: z
          .string()
          .uuid()
          .describe(
            "Submission UUID from agora-get-challenge or agora-submit-solution",
          ),
      }),
    },
    async (input) => asToolResult(await agoraGetSubmissionStatus(input)),
  );

  server.registerTool(
    "agora-verify-submission",
    {
      description:
        "Re-run the Docker scorer independently and compare against the on-chain score. Returns MATCH if scores agree within tolerance, MISMATCH otherwise. Requires Docker.",
      inputSchema: z.object({
        challengeId: z.string().uuid().describe("Challenge UUID"),
        submissionId: z.string().uuid().describe("Submission UUID"),
        tolerance: z
          .number()
          .optional()
          .describe("Score comparison tolerance (default 0.001)"),
      }),
    },
    async (input) => asToolResult(await agoraVerifySubmission(input)),
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

function assertRequiredConfig() {
  const config = loadConfig();
  if (!config.AGORA_PINATA_JWT) {
    throw new Error(
      "AGORA_PINATA_JWT is not set. Submissions require IPFS pinning. Set it in .env or environment.",
    );
  }
}

async function startStdioMode() {
  assertRequiredConfig();
  const server = createServer({ allowRemotePrivateKey: true });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function startHttpMode() {
  assertRequiredConfig();
  const port = Number(process.env.AGORA_MCP_PORT ?? 3001);
  const allowRemotePrivateKey = readFeaturePolicy().allowMcpRemotePrivateKeys;
  const sessions = new Map<string, HttpMcpSession>();

  const gcTimer = setInterval(() => {
    const now = Date.now();
    for (const [sessionId, session] of sessions) {
      if (now - session.lastSeenAt <= MCP_SESSION_TTL_MS) continue;
      const anyTransport = session.transport as unknown as {
        close?: () => void;
      };
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

  const host = process.env.AGORA_MCP_HOST ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "localhost" && allowRemotePrivateKey) {
    console.warn(
      "WARNING: MCP HTTP server bound to non-localhost with remote private keys enabled. " +
        "Private keys sent over the network can be intercepted.",
    );
  }

  server.listen(port, host, () => {
    console.log(`Agora MCP server listening on http://${host}:${port}`);
  });
}

if (process.argv.includes("--stdio")) {
  void startStdioMode();
} else {
  startHttpMode();
}
