import http from "node:http";
import process from "node:process";
import { hermesGetChallenge } from "./tools/get-challenge";
import { hermesGetLeaderboard } from "./tools/get-leaderboard";
import { hermesGetSubmissionStatus } from "./tools/get-submission-status";
import { hermesListChallenges } from "./tools/list-challenges";
import { hermesSubmitSolution } from "./tools/submit-solution";
import { hermesVerifySubmission } from "./tools/verify-submission";

type ToolName =
  | "hermes-list-challenges"
  | "hermes-get-challenge"
  | "hermes-submit-solution"
  | "hermes-get-leaderboard"
  | "hermes-get-submission-status"
  | "hermes-verify-submission";

const tools: Record<
  ToolName,
  {
    description: string;
    inputSchema: Record<string, unknown>;
    run: (input: Record<string, unknown>) => Promise<unknown>;
  }
> = {
  "hermes-list-challenges": {
    description: "List challenges filtered by status/domain/minReward.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string" },
        domain: { type: "string" },
        minReward: { type: "number" },
        limit: { type: "number" },
      },
      additionalProperties: false,
    },
    run: async (input) =>
      hermesListChallenges({
        status: typeof input.status === "string" ? input.status : undefined,
        domain: typeof input.domain === "string" ? input.domain : undefined,
        minReward:
          typeof input.minReward === "number" ? input.minReward : undefined,
        limit: typeof input.limit === "number" ? input.limit : undefined,
      }),
  },
  "hermes-get-challenge": {
    description: "Return challenge details, submissions, and leaderboard.",
    inputSchema: {
      type: "object",
      properties: { challengeId: { type: "string" } },
      required: ["challengeId"],
      additionalProperties: false,
    },
    run: async (input) =>
      hermesGetChallenge({ challengeId: String(input.challengeId ?? "") }),
  },
  "hermes-submit-solution": {
    description: "Pin a submission file and submit on-chain.",
    inputSchema: {
      type: "object",
      properties: {
        challengeId: { type: "string" },
        filePath: { type: "string" },
      },
      required: ["challengeId", "filePath"],
      additionalProperties: false,
    },
    run: async (input) =>
      hermesSubmitSolution({
        challengeId: String(input.challengeId ?? ""),
        filePath: String(input.filePath ?? ""),
      }),
  },
  "hermes-get-leaderboard": {
    description: "Return ranked submissions for a challenge.",
    inputSchema: {
      type: "object",
      properties: { challengeId: { type: "string" } },
      required: ["challengeId"],
      additionalProperties: false,
    },
    run: async (input) =>
      hermesGetLeaderboard({ challengeId: String(input.challengeId ?? "") }),
  },
  "hermes-get-submission-status": {
    description: "Return score/rank/proof-bundle status for a submission.",
    inputSchema: {
      type: "object",
      properties: { submissionId: { type: "string" } },
      required: ["submissionId"],
      additionalProperties: false,
    },
    run: async (input) =>
      hermesGetSubmissionStatus({
        submissionId: String(input.submissionId ?? ""),
      }),
  },
  "hermes-verify-submission": {
    description:
      "Re-run scoring and return MATCH/MISMATCH against on-chain score.",
    inputSchema: {
      type: "object",
      properties: {
        challengeId: { type: "string" },
        submissionId: { type: "string" },
        tolerance: { type: "number" },
      },
      required: ["challengeId", "submissionId"],
      additionalProperties: false,
    },
    run: async (input) =>
      hermesVerifySubmission({
        challengeId: String(input.challengeId ?? ""),
        submissionId: String(input.submissionId ?? ""),
        tolerance:
          typeof input.tolerance === "number" ? input.tolerance : undefined,
      }),
  },
};

async function runTool(name: string, input: Record<string, unknown>) {
  if (!(name in tools)) throw new Error(`Unknown tool: ${name}`);
  const tool = tools[name as ToolName];
  return tool.run(input);
}

function listToolMetadata() {
  return Object.entries(tools).map(([name, tool]) => ({
    name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}

function writeJsonRpc(message: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function startStdioMode() {
  process.stdin.setEncoding("utf8");
  let buffer = "";
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) {
        void (async () => {
          try {
            const request = JSON.parse(line) as {
              id?: string | number;
              method?: string;
              params?: Record<string, unknown>;
            };
            if (request.method === "listTools") {
              writeJsonRpc({
                id: request.id ?? null,
                result: listToolMetadata(),
              });
              return;
            }
            if (request.method === "callTool") {
              const toolName = String(request.params?.name ?? "");
              const input =
                typeof request.params?.input === "object" &&
                request.params?.input !== null
                  ? (request.params.input as Record<string, unknown>)
                  : {};
              const result = await runTool(toolName, input);
              writeJsonRpc({ id: request.id ?? null, result });
              return;
            }
            writeJsonRpc({
              id: request.id ?? null,
              error: `Unknown method: ${request.method ?? ""}`,
            });
          } catch (error) {
            writeJsonRpc({
              id: null,
              error: error instanceof Error ? error.message : "Invalid request",
            });
          }
        })();
      }
      index = buffer.indexOf("\n");
    }
  });
}

function parseRequestBody(req: http.IncomingMessage) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(
          JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
            string,
            unknown
          >,
        );
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function startSseMode() {
  const port = Number(process.env.HERMES_MCP_PORT ?? 3001);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "OPTIONS") {
      res.statusCode = 200;
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/tools") {
      res.statusCode = 200;
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ tools: listToolMetadata() }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/call") {
      void (async () => {
        try {
          const body = await parseRequestBody(req);
          const name = String(body.name ?? "");
          const input =
            typeof body.input === "object" && body.input !== null
              ? (body.input as Record<string, unknown>)
              : {};
          const result = await runTool(name, input);
          res.statusCode = 200;
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ result }));
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(
            JSON.stringify({
              error: error instanceof Error ? error.message : "Request failed",
            }),
          );
        }
      })();
      return;
    }

    res.statusCode = 404;
    res.end("Not found");
  });

  server.listen(port, () => {
    console.log(`Hermes MCP SSE mode on http://localhost:${port}`);
  });
}

if (process.argv.includes("--stdio")) {
  startStdioMode();
} else {
  startSseMode();
}
