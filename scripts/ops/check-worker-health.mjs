#!/usr/bin/env node

import fs from "node:fs";

const WORKER_STARTING_READINESS_ERROR = "Worker starting readiness checks.";
const DEFAULT_STARTING_GRACE_MS = 5 * 60 * 1000;

function readFlag(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

function readRequiredUrl(args, flagName, envName) {
  const value = readFlag(args, flagName) ?? process.env[envName] ?? "";
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(
      `Missing ${flagName}. Next step: provide ${flagName} or set ${envName}.`,
    );
  }
  return trimmed;
}

function readOptionalString(value) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function readOptionalNumber(value) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function readTimestampMs(value) {
  const raw = readOptionalString(value);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchJson(url, label) {
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `${label} failed (${response.status}). Next step: verify the service is reachable and retry. ${body}`.trim(),
    );
  }
  return response.json();
}

function evaluateWorkerHealth({
  apiHealth,
  workerHealth,
  expectedRuntimeVersion,
  startingGraceMs,
}) {
  const apiRuntime = readOptionalString(apiHealth?.runtimeVersion);
  if (!apiRuntime) {
    throw new Error(
      "API health did not include runtimeVersion. Next step: verify the API deploy completed, then retry.",
    );
  }

  const expectedRuntime = readOptionalString(expectedRuntimeVersion) ?? apiRuntime;
  const worker = workerHealth ?? {};
  const workers = worker.workers ?? {};
  const sealing = worker.sealing ?? {};

  const activeRuntime = readOptionalString(workers.activeRuntimeVersion);
  const healthyActive =
    readOptionalNumber(workers.healthyWorkersForActiveRuntimeVersion) ?? 0;
  const sealingConfigured = Boolean(sealing.configured);
  const sealingReady = Boolean(sealing.workerReady);
  const latestError = readOptionalString(workers.latestError);
  const latestRuntimeVersion = readOptionalString(workers.latestRuntimeVersion);
  const latestStartedAt = readOptionalString(workers.latestStartedAt);
  const checkedAtMs =
    readTimestampMs(worker.checkedAt) ??
    readTimestampMs(apiHealth?.checkedAt) ??
    Date.now();
  const latestStartedAtMs = readTimestampMs(latestStartedAt);
  const startingAgeMs =
    typeof latestStartedAtMs === "number" ? checkedAtMs - latestStartedAtMs : null;

  const startingWithinGrace =
    latestRuntimeVersion === expectedRuntime &&
    latestError === WORKER_STARTING_READINESS_ERROR &&
    typeof startingAgeMs === "number" &&
    startingAgeMs >= 0 &&
    startingAgeMs <= startingGraceMs;

  const healthy =
    activeRuntime === expectedRuntime &&
    healthyActive > 0 &&
    (!sealingConfigured || sealingReady);

  const reasons = [];
  if (!healthy && activeRuntime !== expectedRuntime) {
    reasons.push(
      `active runtime is '${activeRuntime ?? "unknown"}' instead of '${expectedRuntime}'`,
    );
  }
  if (!healthy && healthyActive <= 0) {
    reasons.push("zero healthy workers on the expected runtime");
  }
  if (!healthy && sealingConfigured && !sealingReady) {
    reasons.push("sealed-submission worker readiness is false");
  }

  let state = "unhealthy";
  let summary = reasons.join("; ");
  if (healthy) {
    state = "healthy";
    summary = `Worker is healthy on runtime ${expectedRuntime}.`;
  } else if (startingWithinGrace) {
    state = "starting";
    const ageSeconds = Math.max(0, Math.round((startingAgeMs ?? 0) / 1000));
    summary = `Worker is still starting on runtime ${expectedRuntime} (${ageSeconds}s since start).`;
  } else if (!summary) {
    summary = "Worker is not healthy on the expected runtime.";
  }

  return {
    apiRuntime,
    expectedRuntime,
    activeRuntime,
    healthy,
    startingWithinGrace,
    needsHeal: !healthy && !startingWithinGrace,
    reasons,
    latestError,
    latestRuntimeVersion,
    latestStartedAt,
    runningOverThreshold:
      readOptionalNumber(worker.runningOverThresholdCount) ?? 0,
    summary,
    state,
  };
}

function emitOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  const rendered = value ?? "";
  if (outputFile) {
    fs.appendFileSync(
      outputFile,
      `${name}<<__AGORA__\n${rendered}\n__AGORA__\n`,
    );
    return;
  }
  process.stdout.write(`${name}=${rendered}\n`);
}

async function main() {
  const [, , mode = "summary", ...args] = process.argv;
  const apiHealthUrl = readRequiredUrl(
    args,
    "--api-health-url",
    "AGORA_API_HEALTH_URL",
  );
  const workerHealthUrl = readRequiredUrl(
    args,
    "--worker-health-url",
    "AGORA_WORKER_HEALTH_URL",
  );
  const expectedRuntimeVersion = readFlag(args, "--expected-runtime-version");
  const startingGraceMs =
    readOptionalNumber(
      readFlag(args, "--starting-grace-ms") ??
        process.env.AGORA_WORKER_STARTING_GRACE_MS,
    ) ?? DEFAULT_STARTING_GRACE_MS;

  const [apiHealth, workerHealth] = await Promise.all([
    fetchJson(apiHealthUrl, "API /healthz"),
    fetchJson(workerHealthUrl, "API /api/worker-health"),
  ]);

  const result = evaluateWorkerHealth({
    apiHealth,
    workerHealth,
    expectedRuntimeVersion,
    startingGraceMs,
  });

  if (mode === "summary") {
    emitOutput("api_runtime", result.apiRuntime);
    emitOutput("expected_runtime", result.expectedRuntime);
    emitOutput("active_runtime", result.activeRuntime ?? "");
    emitOutput("healthy", String(result.healthy));
    emitOutput("starting_within_grace", String(result.startingWithinGrace));
    emitOutput("needs_heal", String(result.needsHeal));
    emitOutput("reasons", result.reasons.join(" ; "));
    emitOutput("latest_error", result.latestError ?? "");
    emitOutput("latest_runtime_version", result.latestRuntimeVersion ?? "");
    emitOutput("latest_started_at", result.latestStartedAt ?? "");
    emitOutput("running_over_threshold", String(result.runningOverThreshold));
    emitOutput("summary", result.summary);
    console.log(result.summary);
    return;
  }

  if (mode === "wait") {
    console.log(result.summary);
    if (result.healthy) {
      process.exit(0);
    }
    if (result.startingWithinGrace) {
      process.exit(10);
    }
    process.exit(1);
  }

  if (mode === "dump") {
    console.log(
      JSON.stringify(
        {
          apiHealth,
          workerHealth,
          evaluation: result,
        },
        null,
        2,
      ),
    );
    return;
  }

  throw new Error(
    `Unsupported mode '${mode}'. Next step: use summary, wait, or dump.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
