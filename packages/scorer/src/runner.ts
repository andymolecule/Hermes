import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { ScoreResult } from "@agora/common";

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_RUNNER_LIMITS = {
  memory: "256m",
  cpus: "0.5",
  pids: 32,
} as const;

const SCORER_INFRASTRUCTURE_ERROR_PATTERNS = [
  /docker is required/i,
  /docker.*not running/i,
  /docker info failed/i,
  /failed to pull scorer image/i,
  /not found locally\. run: docker pull/i,
  /error response from daemon:.*denied/i,
  /error response from daemon:.*unauthorized/i,
  /error response from daemon:.*toomanyrequests/i,
  /error response from daemon:.*rate/i,
  /error response from daemon:.*tls/i,
  /error response from daemon:.*connection/i,
  /error response from daemon:.*no such host/i,
  /error response from daemon:.*i\/o timeout/i,
  /error response from daemon:.*temporary failure/i,
] as const;

export interface RunScorerInput {
  image: string;
  inputDir: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  limits?: {
    memory?: string;
    cpus?: string;
    pids?: number;
  };
  /** When true, pull failures are fatal even if the image exists locally. */
  strictPull?: boolean;
}

export interface RunnerScoreResult extends ScoreResult {
  log: string;
  outputPath: string;
}

interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

interface LocalImageInspection {
  available: boolean;
  repoDigest: string | null;
  imageId: string | null;
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

export async function ensureDockerReady() {
  try {
    const result = await runCommand("docker", ["info"], 30_000);
    if (result.code !== 0) {
      throw new Error(result.stderr || result.stdout || "docker info failed");
    }
  } catch {
    throw new Error("Docker is required for scoring. Please start Docker.");
  }
}

export function isScorerInfrastructureError(message: string): boolean {
  return SCORER_INFRASTRUCTURE_ERROR_PATTERNS.some((pattern) =>
    pattern.test(message),
  );
}

export async function ensureScorerImagePullable(
  image: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
) {
  await ensureDockerReady();
  const local = await inspectLocalImage(image, timeoutMs);
  if (local.available) {
    if (!local.repoDigest) {
      throw new Error(
        `Scorer image ${image} exists locally but has no registry digest. Next step: pull the published image from GHCR instead of relying on a locally built copy.`,
      );
    }
    return local.repoDigest;
  }

  const pull = await runCommand("docker", ["pull", image], timeoutMs);
  if (pull.code !== 0) {
    throw new Error(
      `Failed to pull scorer image ${image}. ${pull.stderr || pull.stdout || "docker pull failed"}`,
    );
  }
  return resolveImageDigest(image, timeoutMs);
}

export function parseDockerImageInspection(raw: string): {
  repoDigest: string | null;
  imageId: string | null;
} {
  const [repoDigestRaw = "", imageIdRaw = ""] = raw.trim().split("|", 2);
  return {
    repoDigest: repoDigestRaw.trim() || null,
    imageId: imageIdRaw.trim() || null,
  };
}

async function inspectLocalImage(
  image: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<LocalImageInspection> {
  const inspect = await runCommand(
    "docker",
    [
      "image",
      "inspect",
      image,
      "--format",
      "{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}|{{.Id}}",
    ],
    timeoutMs,
  );
  if (inspect.code !== 0) {
    return {
      available: false,
      repoDigest: null,
      imageId: null,
    };
  }

  const parsed = parseDockerImageInspection(inspect.stdout);
  return {
    available: true,
    repoDigest: parsed.repoDigest,
    imageId: parsed.imageId,
  };
}

async function resolveImageDigest(
  image: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
) {
  const local = await inspectLocalImage(image, timeoutMs);
  if (!local.available) {
    throw new Error(
      `Scorer image not found locally: ${image}. Run: docker pull ${image}`,
    );
  }
  if (!local.repoDigest) {
    throw new Error(
      `Scorer image ${image} is missing a registry digest locally. Next step: pull the published image from GHCR instead of using a locally built copy.`,
    );
  }
  return local.repoDigest;
}

async function prepareScorerImage(
  image: string,
  timeoutMs: number,
): Promise<{ digest: string; pull: CommandResult | null }> {
  const local = await inspectLocalImage(image, timeoutMs);
  if (local.available) {
    if (!local.repoDigest) {
      throw new Error(
        `Scorer image ${image} exists locally but has no registry digest. Next step: pull the published image from GHCR instead of relying on a locally built copy.`,
      );
    }
    return {
      digest: local.repoDigest,
      pull: null,
    };
  }

  const pull = await runCommand("docker", ["pull", image], timeoutMs);
  if (pull.code !== 0) {
    throw new Error(
      `Failed to pull scorer image ${image}. ${pull.stderr || pull.stdout || "docker pull failed"}`,
    );
  }

  return {
    digest: await resolveImageDigest(image, timeoutMs),
    pull,
  };
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

  // Determine ok/error state:
  // - Explicit "ok": false  → invalid submission
  // - Legacy "error" field present → treat as invalid
  // - Otherwise → valid
  const hasExplicitOk = typeof parsed.ok === "boolean";
  const errorMessage =
    typeof parsed.error === "string" ? parsed.error : undefined;
  const ok = hasExplicitOk ? (parsed.ok as boolean) : !errorMessage;

  const scoreValue =
    typeof parsed.score === "number" && !Number.isNaN(parsed.score)
      ? parsed.score
      : 0;

  if (ok && (typeof parsed.score !== "number" || Number.isNaN(parsed.score))) {
    throw new Error(
      "Invalid scorer output: score must be a number when ok is true.",
    );
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
    ok,
    score: scoreValue,
    error: errorMessage,
    details,
  };
}

export async function runScorer(
  input: RunScorerInput,
): Promise<RunnerScoreResult> {
  await ensureDockerReady();

  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const inputDir = path.resolve(input.inputDir);
  // Keep output under the scoring workspace so executeScoringPipeline cleanup
  // removes it reliably (prevents /tmp leak across runs).
  const outputDir = path.join(path.dirname(inputDir), "output");
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true, mode: 0o777 });
  const containerName = `agora-score-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const preparedImage = await prepareScorerImage(input.image, timeoutMs);
  const digest = preparedImage.digest;

  // Verify digest matches when image reference includes a pinned digest
  if (input.image.includes("@sha256:")) {
    const expectedDigest = input.image.slice(input.image.indexOf("@sha256:"));
    if (!digest.includes(expectedDigest)) {
      throw new Error(
        `Digest mismatch for ${input.image}: expected ${expectedDigest} but resolved ${digest}. This indicates the local image is different from the pinned reference.`,
      );
    }
  }

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
    input.limits?.memory ?? DEFAULT_RUNNER_LIMITS.memory,
    "--cpus",
    input.limits?.cpus ?? DEFAULT_RUNNER_LIMITS.cpus,
    "--pids-limit",
    String(input.limits?.pids ?? DEFAULT_RUNNER_LIMITS.pids),
    "--tmpfs",
    "/tmp:size=64m",
    "--mount",
    `type=bind,src=${inputDir},dst=/input,readonly`,
    "--mount",
    `type=bind,src=${outputDir},dst=/output`,
  ];
  for (const [key, value] of Object.entries(input.env ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    args.push("--env", `${key}=${value}`);
  }
  args.push(input.image);

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
  const scorePath = path.join(outputDir, "score.json");

  if (run.code !== 0) {
    // Try to read score.json for a structured error (scorer writes errors there before exiting)
    let scorerError: string | undefined;
    try {
      const raw = await fs.readFile(scorePath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (typeof parsed.error === "string") scorerError = parsed.error;
    } catch {
      // score.json doesn't exist or isn't valid — fall through to generic error
    }
    const containerOutput = [run.stderr, run.stdout]
      .filter(Boolean)
      .join("\n")
      .trim();
    const details = [scorerError, containerOutput].filter(Boolean).join(" | ");
    throw new Error(
      `Scorer container exited with code ${run.code} for image ${input.image}.${details ? ` ${details}` : ""} If image is missing, run: docker pull ${input.image}`,
    );
  }

  let scoreRaw: string;
  try {
    scoreRaw = await fs.readFile(scorePath, "utf8");
  } catch {
    throw new Error("Scorer output missing: /output/score.json not found.");
  }

  const parsed = parseScorePayload(scoreRaw);

  return {
    ok: parsed.ok,
    score: parsed.score,
    error: parsed.error,
    details: parsed.details,
    log: [
      preparedImage.pull?.stdout ?? "",
      preparedImage.pull?.stderr ?? "",
      run.stdout,
      run.stderr,
    ]
      .filter(Boolean)
      .join("\n"),
    outputPath: scorePath,
    containerImageDigest: digest,
  };
}
