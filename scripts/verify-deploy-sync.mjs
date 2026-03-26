const COMMIT_SHA_PATTERN = /^[a-fA-F0-9]{7,64}$/;
const FULL_GIT_SHA_PATTERN = /^[a-fA-F0-9]{40}$/;

function parseArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--api-url") {
      options.apiUrl = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--web-url") {
      options.webUrl = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--expected") {
      options.expectedRuntimeVersion = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--expected-api") {
      options.expectedApiRuntimeVersion = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--expected-web") {
      options.expectedWebRuntimeVersion = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--expected-git-sha") {
      options.expectedApiGitSha = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--api-url=")) {
      options.apiUrl = arg.slice("--api-url=".length);
      continue;
    }
    if (arg.startsWith("--web-url=")) {
      options.webUrl = arg.slice("--web-url=".length);
      continue;
    }
    if (arg.startsWith("--expected=")) {
      options.expectedRuntimeVersion = arg.slice("--expected=".length);
      continue;
    }
    if (arg.startsWith("--expected-api=")) {
      options.expectedApiRuntimeVersion = arg.slice("--expected-api=".length);
      continue;
    }
    if (arg.startsWith("--expected-web=")) {
      options.expectedWebRuntimeVersion = arg.slice("--expected-web=".length);
      continue;
    }
    if (arg.startsWith("--expected-git-sha=")) {
      options.expectedApiGitSha = arg.slice("--expected-git-sha=".length);
      continue;
    }
    if (arg === "--skip-worker") {
      options.skipWorker = true;
      continue;
    }
    if (arg === "--skip-web") {
      options.skipWeb = true;
      continue;
    }
    throw new Error(
      `Unknown argument: ${arg}. Next step: use --api-url, optional --web-url, optional --expected/--expected-api/--expected-web, optional --expected-git-sha, and optional --skip-worker/--skip-web.`,
    );
  }

  return options;
}

function normalizeRuntimeVersion(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (COMMIT_SHA_PATTERN.test(trimmed)) {
    return trimmed.toLowerCase().slice(0, 12);
  }
  return trimmed;
}

function normalizeGitSha(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!FULL_GIT_SHA_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed.toLowerCase();
}

function normalizeBaseUrl(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      `${label} is required. Next step: pass ${label === "API URL" ? "--api-url" : "--web-url"} or set the matching environment variable and retry.`,
    );
  }

  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    throw new Error(
      `${label} is invalid (${value}). Next step: provide a full https:// URL and retry.`,
    );
  }
}

async function fetchJson(url, label) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(
      `${label} returned non-JSON output. Next step: verify the URL points at the deployed Agora service and retry.`,
    );
  }

  if (!response.ok) {
    const detail =
      typeof payload?.error === "string" && payload.error.trim().length > 0
        ? payload.error
        : `HTTP ${response.status}`;
    throw new Error(
      `${label} check failed (${response.status}): ${detail}. Next step: verify the service is deployed and reachable, then retry.`,
    );
  }

  return payload;
}

function compareRuntimeVersion(input) {
  if (input.actual === input.expected) {
    console.log(
      `[OK] ${input.label} runtime version matches expected ${input.expected}`,
    );
    return true;
  }

  console.error(
    `[FAIL] ${input.label} runtime version mismatch: expected ${input.expected}, got ${input.actual}. Next step: redeploy the intended ${input.label.toLowerCase()} build or update the expected runtime version and retry.`,
  );
  return false;
}

function compareGitSha(input) {
  if (input.actual === input.expected) {
    console.log(`[OK] ${input.label} git SHA matches ${input.expected}`);
    return true;
  }

  console.error(
    `[FAIL] ${input.label} git SHA mismatch: expected ${input.expected}, got ${input.actual}. Next step: redeploy the intended ${input.label.toLowerCase()} build or update the expected git SHA and retry.`,
  );
  return false;
}

function readReportedReleaseValue(payload) {
  return normalizeRuntimeVersion(payload?.releaseId ?? payload?.runtimeVersion);
}

function readReportedGitSha(payload) {
  return normalizeGitSha(payload?.gitSha);
}

const options = parseArgs(process.argv.slice(2));
const apiUrl = normalizeBaseUrl(
  options.apiUrl ?? process.env.AGORA_API_URL,
  "API URL",
);
const webUrl = options.skipWeb
  ? null
  : normalizeBaseUrl(options.webUrl ?? process.env.AGORA_WEB_URL, "Web URL");
const expectedApiRuntimeVersion =
  normalizeRuntimeVersion(options.expectedApiRuntimeVersion) ||
  normalizeRuntimeVersion(options.expectedRuntimeVersion);
const expectedWebRuntimeVersion =
  normalizeRuntimeVersion(options.expectedWebRuntimeVersion) ||
  normalizeRuntimeVersion(options.expectedRuntimeVersion);
const expectedApiGitSha = normalizeGitSha(options.expectedApiGitSha);

const apiHealth = await fetchJson(`${apiUrl}/api/health`, "API /api/health");
const webVersion = webUrl
  ? await fetchJson(`${webUrl}/api/version`, "Web /api/version")
  : null;
const workerHealth = options.skipWorker
  ? null
  : await fetchJson(`${apiUrl}/api/worker-health`, "API /api/worker-health");

const apiRuntimeVersion = readReportedReleaseValue(apiHealth);
const apiGitSha = readReportedGitSha(apiHealth);
const webRuntimeVersion = readReportedReleaseValue(webVersion);

if (apiHealth?.ok !== true) {
  throw new Error(
    "API /api/health reported ok=false. Next step: inspect the hosted API and retry once it is healthy.",
  );
}

if (apiHealth?.service !== "api") {
  throw new Error(
    `API /api/health returned service=${String(apiHealth?.service)}. Next step: verify AGORA_API_URL points at the deployed Agora API and retry.`,
  );
}

if (!apiRuntimeVersion) {
  throw new Error(
    "API /api/health did not return releaseId or runtimeVersion. Next step: deploy the current API build and retry.",
  );
}

if (webUrl && !webRuntimeVersion) {
  throw new Error(
    "Web /api/version did not return releaseId or runtimeVersion. Next step: deploy the current web build and retry.",
  );
}

let ok = true;

console.log(`[OK] API /api/health is healthy`);
console.log(`[INFO] Reported API runtime version: ${apiRuntimeVersion}`);
if (apiGitSha) {
  console.log(`[INFO] Reported API git SHA: ${apiGitSha}`);
} else {
  console.log(
    "[INFO] API /api/health did not report gitSha. Railway git metadata is treated as best-effort in this verification mode.",
  );
}

if (expectedApiRuntimeVersion) {
  console.log(`[INFO] Expected API runtime version: ${expectedApiRuntimeVersion}`);
  ok =
    compareRuntimeVersion({
      label: "API",
      expected: expectedApiRuntimeVersion,
      actual: apiRuntimeVersion,
    }) && ok;
}

if (expectedApiGitSha) {
  if (!apiGitSha) {
    console.error(
      "[FAIL] API /api/health did not report gitSha. Next step: either remove the explicit git SHA expectation or deploy with provider metadata that surfaces gitSha.",
    );
    ok = false;
  } else {
    console.log(`[INFO] Expected API git SHA: ${expectedApiGitSha}`);
    ok =
      compareGitSha({
        label: "API",
        expected: expectedApiGitSha,
        actual: apiGitSha,
      }) && ok;
  }
}

if (webUrl) {
  console.log(`[INFO] Reported Web runtime version: ${webRuntimeVersion}`);
  if (expectedWebRuntimeVersion) {
    console.log(
      `[INFO] Expected Web runtime version: ${expectedWebRuntimeVersion}`,
    );
    ok =
      compareRuntimeVersion({
        label: "Web",
        expected: expectedWebRuntimeVersion,
        actual: webRuntimeVersion,
      }) && ok;
  }

  if (apiRuntimeVersion === webRuntimeVersion) {
    console.log(`[OK] Web and API are aligned on runtime ${apiRuntimeVersion}`);
  } else {
    console.log(
      `[INFO] Web/API runtime versions differ (web=${webRuntimeVersion}, api=${apiRuntimeVersion}). This can be acceptable during rollout when the hosted API is healthy and each service remains independently verifiable.`,
    );
  }
} else {
  console.log("[INFO] Skipping web runtime verification");
}

if (workerHealth) {
  const workerApiRuntimeVersion =
    normalizeRuntimeVersion(
      typeof workerHealth?.runtime?.apiVersion === "string"
        ? workerHealth.runtime.apiVersion
        : null,
    );
  const activeWorkerRuntimeVersion = normalizeRuntimeVersion(
    workerHealth?.workers?.activeRuntimeVersion,
  );
  const healthyWorkersForActiveRuntimeVersion = Number(
    workerHealth?.workers?.healthyWorkersForActiveRuntimeVersion ?? 0,
  );

  if (workerApiRuntimeVersion !== apiRuntimeVersion) {
    console.error(
      `[FAIL] Worker health runtime reports apiVersion=${workerApiRuntimeVersion}, expected API runtime ${apiRuntimeVersion}. Next step: redeploy or restart the stale API/worker service and retry.`,
    );
    ok = false;
  } else {
    console.log(
      `[OK] Worker health is aligned with API runtime ${apiRuntimeVersion}`,
    );
  }

  if (activeWorkerRuntimeVersion !== apiRuntimeVersion) {
    console.error(
      `[FAIL] Worker health reports activeRuntimeVersion=${activeWorkerRuntimeVersion}, expected API runtime ${apiRuntimeVersion}. Next step: inspect the runtime fence state and restart the stale worker if needed.`,
    );
    ok = false;
  } else {
    console.log(
      `[OK] Worker fence is aligned with API runtime ${apiRuntimeVersion}`,
    );
  }

  if (healthyWorkersForActiveRuntimeVersion > 0) {
    console.log(
      `[OK] Worker health reports ${healthyWorkersForActiveRuntimeVersion} healthy worker(s) on the active runtime`,
    );
  } else {
    console.error(
      "[FAIL] Worker health reports zero healthy workers on the active runtime. Next step: inspect the worker host, then retry.",
    );
    ok = false;
  }
}

if (!ok) {
  process.exit(1);
}
