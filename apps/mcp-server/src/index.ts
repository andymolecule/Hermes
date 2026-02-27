import http from "node:http";
import process from "node:process";
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

function createServer() {
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
      }),
    },
    async (input) => asToolResult(await hermesSubmitSolution(input)),
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

async function startStdioMode() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function startHttpMode() {
  const port = Number(process.env.HERMES_MCP_PORT ?? 3001);

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
      res.end(JSON.stringify({ ok: true }));
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
        if (!(await enforceMcpSessionPayment(req, res))) {
          return;
        }

        const mcpServer = createServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });

        await mcpServer.connect(transport);
        await transport.handleRequest(req, res);
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
