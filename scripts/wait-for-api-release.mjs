import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeGitSha,
  normalizeRuntimeVersion,
} from "./release-metadata.mjs";

function parseArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--api-url") {
      options.apiUrl = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--expected-git-sha") {
      options.expectedGitSha = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--expected-runtime-version") {
      options.expectedRuntimeVersion = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--timeout-seconds") {
      options.timeoutSeconds = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--interval-seconds") {
      options.intervalSeconds = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg.startsWith("--api-url=")) {
      options.apiUrl = arg.slice("--api-url=".length);
      continue;
    }
    if (arg.startsWith("--expected-git-sha=")) {
      options.expectedGitSha = arg.slice("--expected-git-sha=".length);
      continue;
    }
    if (arg.startsWith("--expected-runtime-version=")) {
      options.expectedRuntimeVersion = arg.slice(
        "--expected-runtime-version=".length,
      );
      continue;
    }
    if (arg.startsWith("--timeout-seconds=")) {
      options.timeoutSeconds = arg.slice("--timeout-seconds=".length);
      continue;
    }
    if (arg.startsWith("--interval-seconds=")) {
      options.intervalSeconds = arg.slice("--interval-seconds=".length);
      continue;
    }
    throw new Error(
      `Unknown argument: ${arg}. Next step: use --api-url, optional --expected-git-sha, optional --expected-runtime-version, optional --timeout-seconds, and optional --interval-seconds.`,
    );
  }

  return options;
}

function normalizeTimeoutSeconds(value, fallback) {
  if (value == null) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid timeout value (${value}). Next step: provide a positive number of seconds and retry.`,
    );
  }
  return parsed;
}

function normalizeBaseUrl(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      "API URL is required. Next step: pass --api-url or set AGORA_API_URL and retry.",
    );
  }

  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    throw new Error(
      `API URL is invalid (${value}). Next step: provide a full https:// URL and retry.`,
    );
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchApiHealth(apiUrl) {
  const response = await fetch(`${apiUrl}/api/health`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(
      `API /api/health returned non-JSON output (${response.status}). Next step: verify AGORA_API_URL points at the deployed Agora API and retry.`,
    );
  }

  return {
    status: response.status,
    payload,
  };
}

function describeObservedRelease(payload) {
  return {
    releaseId: normalizeRuntimeVersion(payload?.releaseId ?? null),
    runtimeVersion: normalizeRuntimeVersion(payload?.runtimeVersion ?? null),
    gitSha: normalizeGitSha(payload?.gitSha ?? null),
    service: payload?.service ?? null,
  };
}

function matchesExpectedRelease(input) {
  const expectedRuntimeVersion =
    normalizeRuntimeVersion(input.expectedRuntimeVersion) ??
    (input.expectedGitSha ? input.expectedGitSha.slice(0, 12) : null);

  const gitShaMatches = input.expectedGitSha
    ? input.observed.gitSha === input.expectedGitSha
    : false;
  const releaseIdMatches = expectedRuntimeVersion
    ? input.observed.releaseId === expectedRuntimeVersion ||
      input.observed.runtimeVersion === expectedRuntimeVersion
    : false;

  return gitShaMatches || releaseIdMatches;
}

function formatExpectedRuntimeVersion(expectedGitSha, expectedRuntimeVersion) {
  return (
    expectedRuntimeVersion ??
    (expectedGitSha ? expectedGitSha.slice(0, 12) : "n/a")
  );
}

function printUsage() {
  console.log(`Usage: node scripts/wait-for-api-release.mjs \\
  --api-url <https://api.example.com> \\
  [--expected-git-sha <40-char sha>] \\
  [--expected-runtime-version <release id>] \\
  [--timeout-seconds 600] \\
  [--interval-seconds 15]

This waits until /api/health reports the expected hosted API release metadata.
It accepts both healthy and unhealthy /api/health responses so schema alignment
can wait for the hosted runtime to finish rolling out the new code before a reset.`);
}

async function waitForApiRelease(input) {
  const deadline = Date.now() + input.timeoutSeconds * 1000;
  let lastObserved = null;
  let attempt = 1;

  while (Date.now() < deadline) {
    try {
      const { status, payload } = await fetchApiHealth(input.apiUrl);
      const observed = describeObservedRelease(payload);
      lastObserved = { status, ...observed };

      if (observed.service !== "api") {
        throw new Error(
          `API /api/health returned service=${String(observed.service)}. Next step: verify AGORA_API_URL points at the deployed Agora API and retry.`,
        );
      }

      if (
        matchesExpectedRelease({
          expectedGitSha: input.expectedGitSha,
          expectedRuntimeVersion: input.expectedRuntimeVersion,
          observed,
        })
      ) {
        return { status, observed };
      }

      console.log(
        `[INFO] Waiting for API release metadata (attempt ${attempt}): expected gitSha=${input.expectedGitSha ?? "n/a"} runtimeVersion=${formatExpectedRuntimeVersion(input.expectedGitSha, input.expectedRuntimeVersion)}; observed releaseId=${observed.releaseId ?? "null"} runtimeVersion=${observed.runtimeVersion ?? "null"} gitSha=${observed.gitSha ?? "null"} health=${status}`,
      );
    } catch (error) {
      console.log(
        `[INFO] Waiting for API release metadata (attempt ${attempt}) failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    attempt += 1;
    await sleep(input.intervalSeconds * 1000);
  }

  throw new Error(
    `Timed out waiting for hosted API release metadata. Next step: verify the hosted runtime deployed the intended revision and that /api/health reports releaseId/runtimeVersion/gitSha. Last observed state: ${JSON.stringify(lastObserved)}`,
  );
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printUsage();
    return;
  }

  const apiUrl = normalizeBaseUrl(options.apiUrl ?? process.env.AGORA_API_URL);
  const expectedGitSha = normalizeGitSha(
    options.expectedGitSha ?? process.env.AGORA_EXPECTED_GIT_SHA,
  );
  const expectedRuntimeVersion = normalizeRuntimeVersion(
    options.expectedRuntimeVersion ??
      process.env.AGORA_EXPECTED_RUNTIME_VERSION,
  );
  const timeoutSeconds = normalizeTimeoutSeconds(
    options.timeoutSeconds ?? process.env.AGORA_RELEASE_WAIT_TIMEOUT_SECONDS,
    600,
  );
  const intervalSeconds = normalizeTimeoutSeconds(
    options.intervalSeconds ?? process.env.AGORA_RELEASE_WAIT_INTERVAL_SECONDS,
    15,
  );

  if (!expectedGitSha && !expectedRuntimeVersion) {
    throw new Error(
      "Expected release metadata is required. Next step: set AGORA_EXPECTED_GIT_SHA or AGORA_EXPECTED_RUNTIME_VERSION and retry.",
    );
  }

  const { status, observed } = await waitForApiRelease({
    apiUrl,
    expectedGitSha,
    expectedRuntimeVersion,
    timeoutSeconds,
    intervalSeconds,
  });

  console.log(
    `[OK] API release metadata is live on ${apiUrl}: releaseId=${observed.releaseId ?? "null"} runtimeVersion=${observed.runtimeVersion ?? "null"} gitSha=${observed.gitSha ?? "null"} health=${status}`,
  );
}

const isDirectExecution =
  process.argv[1] != null &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  await main();
}
