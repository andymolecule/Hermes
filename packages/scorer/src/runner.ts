import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

export interface RunScorerInput {
  image: string;
  inputDir: string;
  timeoutMs?: number;
}

export interface ScoreResult {
  score: number;
  details: Record<string, unknown>;
  log: string;
  outputPath: string;
  containerImageDigest: string;
}

interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

function runCommand(
  command: string,
  args: string[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(
          `Command timed out after ${timeoutMs}ms: ${command} ${args.join(" ")}`,
        ),
      );
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  });
}

async function ensureDockerReady() {
  try {
    const result = await runCommand("docker", ["info"], 30_000);
    if (result.code !== 0) {
      throw new Error(result.stderr || result.stdout || "docker info failed");
    }
  } catch {
    throw new Error("Docker is required for scoring. Please start Docker.");
  }
}

async function resolveImageDigest(image: string) {
  const inspect = await runCommand("docker", [
    "image",
    "inspect",
    image,
    "--format",
    "{{index .RepoDigests 0}}",
  ]);
  if (inspect.code !== 0) {
    throw new Error(
      `Scorer image not found locally: ${image}. Run: docker pull ${image}`,
    );
  }
  const digest = inspect.stdout.trim();
  return digest || image;
}

function parseScorePayload(raw: string) {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `Invalid scorer output JSON: ${error instanceof Error ? error.message : "parse failed"}`,
    );
  }
  const scoreValue = parsed.score;
  if (typeof scoreValue !== "number" || Number.isNaN(scoreValue)) {
    throw new Error("Invalid scorer output: score must be a number.");
  }
  const detailsBase =
    typeof parsed.details === "object" && parsed.details !== null
      ? (parsed.details as Record<string, unknown>)
      : {};
  const details = {
    ...detailsBase,
    matched_rows: parsed.matched_rows,
    total_rows: parsed.total_rows,
  };
  return {
    score: scoreValue,
    details,
  };
}

export async function runScorer(input: RunScorerInput): Promise<ScoreResult> {
  await ensureDockerReady();

  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const inputDir = path.resolve(input.inputDir);
  const outputDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "hermes-score-output-"),
  );
  const containerName = `hermes-score-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const pull = await runCommand("docker", ["pull", input.image], timeoutMs);
  if (pull.code !== 0) {
    // Pull failed — check if image exists locally
    const localCheck = await runCommand("docker", ["image", "inspect", input.image], 30_000);
    if (localCheck.code !== 0) {
      throw new Error(
        `Failed to pull scorer image ${input.image} and not found locally. Run: docker pull ${input.image}. ${pull.stderr || pull.stdout}`,
      );
    }
    // Image exists locally, continue with warning
    console.error(`Warning: pull failed for ${input.image}, using local image`);
  }

  const digest = await resolveImageDigest(input.image);

  const args = [
    "run",
    "--rm",
    "--network=none",
    "--read-only",
    "--name",
    containerName,
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--user",
    "65532:65532",
    "--memory",
    "8g",
    "--cpus",
    "4",
    "--mount",
    `type=bind,src=${inputDir},dst=/input,readonly`,
    "--mount",
    `type=bind,src=${outputDir},dst=/output`,
    input.image,
  ];

  let run: CommandResult;
  try {
    run = await runCommand("docker", args, timeoutMs);
  } catch (error) {
    if (error instanceof Error && error.message.includes("timed out")) {
      await runCommand("docker", ["rm", "-f", containerName], 30_000).catch(
        () => undefined,
      );
      throw new Error(
        `Scorer timed out after ${timeoutMs}ms and was terminated.`,
      );
    }
    throw error;
  }
  if (run.code !== 0) {
    throw new Error(
      `Scorer container failed for image ${input.image}. If image is missing, run: docker pull ${input.image}. ${run.stderr || run.stdout}`,
    );
  }

  const scorePath = path.join(outputDir, "score.json");
  let scoreRaw: string;
  try {
    scoreRaw = await fs.readFile(scorePath, "utf8");
  } catch {
    throw new Error("Scorer output missing: /output/score.json not found.");
  }

  const parsed = parseScorePayload(scoreRaw);

  return {
    score: parsed.score,
    details: parsed.details,
    log: [pull.stdout, pull.stderr, run.stdout, run.stderr]
      .filter(Boolean)
      .join("\n"),
    outputPath: scorePath,
    containerImageDigest: digest,
  };
}
