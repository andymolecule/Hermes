import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

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
    if (arg.startsWith("--expected-api=")) {
      options.expectedApiRuntimeVersion = arg.slice("--expected-api=".length);
      continue;
    }
    if (arg.startsWith("--expected-web=")) {
      options.expectedWebRuntimeVersion = arg.slice("--expected-web=".length);
      continue;
    }
    if (arg === "--manifest") {
      options.manifestPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--manifest=")) {
      options.manifestPath = arg.slice("--manifest=".length);
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
      `Unknown argument: ${arg}. Next step: use --api-url, optional --web-url, optional --manifest, optional --expected/--expected-api/--expected-web, and optional --skip-worker/--skip-web.`,
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

function normalizeManifestPath(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      "Manifest path is invalid. Next step: pass --manifest with a runtime release manifest JSON file and retry.",
    );
  }

  return path.isAbsolute(value) ? value : path.join(process.cwd(), value);
}

function readRuntimeReleaseManifest(manifestPath) {
  const resolvedPath = normalizeManifestPath(manifestPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(
      `Runtime release manifest not found at ${resolvedPath}. Next step: generate or download the manifest artifact and retry.`,
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Runtime release manifest is not valid JSON (${resolvedPath}). Next step: regenerate the manifest artifact and retry. (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  const releaseId = normalizeRuntimeVersion(parsed?.releaseId);
  const gitSha = normalizeGitSha(parsed?.gitSha);
  if (!releaseId || !gitSha) {
    throw new Error(
      `Runtime release manifest is missing releaseId or gitSha (${resolvedPath}). Next step: regenerate the manifest artifact and retry.`,
    );
  }

  return {
    path: resolvedPath,
    releaseId,
    gitSha,
  };
}

function resolveGitRuntimeVersion() {
  const result = spawnSync("git", ["rev-parse", "--short=12", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status === 0) {
    const runtimeVersion = result.stdout.trim();
    if (runtimeVersion.length > 0) {
      return runtimeVersion;
    }
  }

  throw new Error(
    "Could not resolve the current git SHA. Next step: run this command from the Agora repo or pass --expected explicitly.",
  );
}

function resolveSharedExpectedRuntimeVersion(options) {
  const explicitRuntimeVersion = normalizeRuntimeVersion(
    options.expectedRuntimeVersion,
  );
  if (explicitRuntimeVersion) {
    return explicitRuntimeVersion;
  }

  const envRuntimeVersion = normalizeRuntimeVersion(
    process.env.AGORA_RUNTIME_VERSION,
  );
  if (!envRuntimeVersion) {
    return null;
  }

  try {
    const headRuntimeVersion = resolveGitRuntimeVersion();
    return envRuntimeVersion === headRuntimeVersion ? null : envRuntimeVersion;
  } catch {
    return envRuntimeVersion;
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
    `[FAIL] ${input.label} runtime version mismatch: expected ${input.expected}, got ${input.actual}. Next step: redeploy ${input.label.toLowerCase()} from the target revision and retry.`,
  );
  return false;
}

function readReportedReleaseValue(payload) {
  return normalizeRuntimeVersion(payload?.releaseId ?? payload?.runtimeVersion);
}

function readReportedReleaseId(payload) {
  return normalizeRuntimeVersion(payload?.releaseId);
}

function readReportedGitSha(payload) {
  return normalizeGitSha(payload?.gitSha);
}

const options = parseArgs(process.argv.slice(2));
const manifest = options.manifestPath
  ? readRuntimeReleaseManifest(options.manifestPath)
  : null;
const apiUrl = normalizeBaseUrl(
  options.apiUrl ?? process.env.AGORA_API_URL,
  "API URL",
);
const webUrl = options.skipWeb
  ? null
  : normalizeBaseUrl(options.webUrl ?? process.env.AGORA_WEB_URL, "Web URL");
const sharedExpectedRuntimeVersion =
  resolveSharedExpectedRuntimeVersion(options);
const expectedApiRuntimeVersion =
  normalizeRuntimeVersion(options.expectedApiRuntimeVersion) ||
  manifest?.releaseId ||
  sharedExpectedRuntimeVersion ||
  resolveGitRuntimeVersion();
const expectedWebRuntimeVersion =
  normalizeRuntimeVersion(options.expectedWebRuntimeVersion) ||
  sharedExpectedRuntimeVersion ||
  resolveGitRuntimeVersion();

const apiHealth = await fetchJson(`${apiUrl}/api/health`, "API /api/health");
const webVersion = webUrl
  ? await fetchJson(`${webUrl}/api/version`, "Web /api/version")
  : null;
const workerHealth = options.skipWorker
  ? null
  : await fetchJson(`${apiUrl}/api/worker-health`, "API /api/worker-health");

const apiRuntimeVersion = readReportedReleaseValue(apiHealth);
const apiReleaseId = readReportedReleaseId(apiHealth);
const apiGitSha = readReportedGitSha(apiHealth);
const webRuntimeVersion = readReportedReleaseValue(webVersion);

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

console.log(
  `[INFO] Expected API runtime version: ${expectedApiRuntimeVersion}`,
);
ok =
  compareRuntimeVersion({
    label: "API",
    expected: expectedApiRuntimeVersion,
    actual: apiRuntimeVersion,
  }) && ok;

if (manifest) {
  console.log(
    `[INFO] Expected API manifest release: ${manifest.releaseId} (${manifest.gitSha})`,
  );

  if (!apiReleaseId) {
    console.error(
      "[FAIL] API /api/health did not report releaseId. Next step: deploy a runtime image with baked release metadata and retry.",
    );
    ok = false;
  } else if (apiReleaseId !== manifest.releaseId) {
    console.error(
      `[FAIL] API releaseId mismatch: expected ${manifest.releaseId}, got ${apiReleaseId}. Next step: redeploy the API from the manifest artifact and retry.`,
    );
    ok = false;
  } else {
    console.log(`[OK] API releaseId matches manifest ${manifest.releaseId}`);
  }

  if (!apiGitSha) {
    console.error(
      "[FAIL] API /api/health did not report gitSha. Next step: deploy a runtime image with baked release metadata and retry.",
    );
    ok = false;
  } else if (apiGitSha !== manifest.gitSha) {
    console.error(
      `[FAIL] API gitSha mismatch: expected ${manifest.gitSha}, got ${apiGitSha}. Next step: redeploy the API from the manifest artifact and retry.`,
    );
    ok = false;
  } else {
    console.log(`[OK] API gitSha matches manifest ${manifest.gitSha}`);
  }
}

if (webUrl) {
  console.log(
    `[INFO] Expected Web runtime version: ${expectedWebRuntimeVersion}`,
  );
  ok =
    compareRuntimeVersion({
      label: "Web",
      expected: expectedWebRuntimeVersion,
      actual: webRuntimeVersion,
    }) && ok;

  if (apiRuntimeVersion === webRuntimeVersion) {
    console.log(`[OK] Web and API are aligned on runtime ${apiRuntimeVersion}`);
  } else {
    console.log(
      `[INFO] Web/API runtime versions differ (web=${webRuntimeVersion}, api=${apiRuntimeVersion}). This can be acceptable during rollout when each service still matches the revision you intended to deploy.`,
    );
  }
} else {
  console.log("[INFO] Skipping web runtime verification");
}

if (workerHealth) {
  const workerApiRuntimeVersion =
    typeof workerHealth?.runtime?.apiVersion === "string"
      ? workerHealth.runtime.apiVersion
      : null;
  const healthyWorkersForActiveRuntimeVersion = Number(
    workerHealth?.workers?.healthyWorkersForActiveRuntimeVersion ?? 0,
  );

  if (workerApiRuntimeVersion !== apiRuntimeVersion) {
    console.error(
      `[FAIL] Worker health runtime reports apiVersion=${workerApiRuntimeVersion}, expected API runtime ${apiRuntimeVersion}. Next step: redeploy the stale API/worker service and retry.`,
    );
    ok = false;
  } else {
    console.log(
      `[OK] Worker health is aligned with API runtime ${apiRuntimeVersion}`,
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
