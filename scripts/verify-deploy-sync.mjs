import { spawnSync } from "node:child_process";

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
    throw new Error(
      `Unknown argument: ${arg}. Next step: use --api-url, --web-url, and optional --expected.`,
    );
  }

  return options;
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

const options = parseArgs(process.argv.slice(2));
const apiUrl = normalizeBaseUrl(
  options.apiUrl ?? process.env.AGORA_API_URL,
  "API URL",
);
const webUrl = normalizeBaseUrl(
  options.webUrl ?? process.env.AGORA_WEB_URL,
  "Web URL",
);
const expectedRuntimeVersion =
  options.expectedRuntimeVersion?.trim() ||
  process.env.AGORA_RUNTIME_VERSION?.trim() ||
  resolveGitRuntimeVersion();

const apiHealth = await fetchJson(`${apiUrl}/healthz`, "API /healthz");
const webVersion = await fetchJson(`${webUrl}/api/version`, "Web /api/version");

const apiRuntimeVersion =
  typeof apiHealth?.runtimeVersion === "string"
    ? apiHealth.runtimeVersion
    : null;
const webRuntimeVersion =
  typeof webVersion?.runtimeVersion === "string"
    ? webVersion.runtimeVersion
    : null;

if (!apiRuntimeVersion) {
  throw new Error(
    "API /healthz did not return runtimeVersion. Next step: deploy the current API build and retry.",
  );
}

if (!webRuntimeVersion) {
  throw new Error(
    "Web /api/version did not return runtimeVersion. Next step: deploy the current web build and retry.",
  );
}

let ok = true;

console.log(`[INFO] Expected runtime version: ${expectedRuntimeVersion}`);
ok =
  compareRuntimeVersion({
    label: "API",
    expected: expectedRuntimeVersion,
    actual: apiRuntimeVersion,
  }) && ok;
ok =
  compareRuntimeVersion({
    label: "Web",
    expected: expectedRuntimeVersion,
    actual: webRuntimeVersion,
  }) && ok;

if (apiRuntimeVersion === webRuntimeVersion) {
  console.log(`[OK] Web and API are aligned on runtime ${apiRuntimeVersion}`);
} else {
  console.error(
    `[FAIL] Web/API runtime mismatch: web=${webRuntimeVersion} api=${apiRuntimeVersion}. Next step: redeploy the stale service so both point at the same revision.`,
  );
  ok = false;
}

if (!ok) {
  process.exit(1);
}
