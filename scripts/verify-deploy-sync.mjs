const COMMIT_SHA_PATTERN = /^[a-fA-F0-9]{7,64}$/;
const FULL_GIT_SHA_PATTERN = /^[a-fA-F0-9]{40}$/;
const RELEASE_METADATA_SOURCES = new Set([
  "baked",
  "override",
  "provider_env",
  "repo_git",
  "legacy_file",
  "unknown",
]);
const HOSTED_RELEASE_METADATA_SOURCES = new Set([
  "baked",
  "override",
  "provider_env",
]);

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
    if (arg === "--worker-internal-url") {
      options.workerInternalUrl = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--worker-internal-token") {
      options.workerInternalToken = argv[index + 1];
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
    if (arg.startsWith("--worker-internal-url=")) {
      options.workerInternalUrl = arg.slice("--worker-internal-url=".length);
      continue;
    }
    if (arg.startsWith("--worker-internal-token=")) {
      options.workerInternalToken = arg.slice(
        "--worker-internal-token=".length,
      );
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
      `Unknown argument: ${arg}. Next step: use --api-url, optional --web-url, optional --expected/--expected-api/--expected-web, optional --expected-git-sha, optional --worker-internal-url/--worker-internal-token, and optional --skip-worker/--skip-web.`,
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

function normalizeIdentitySource(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  return RELEASE_METADATA_SOURCES.has(trimmed) ? trimmed : null;
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

async function fetchJsonWithHeaders(url, label, headers) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      ...headers,
    },
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
        : typeof payload?.error?.message === "string" &&
            payload.error.message.trim().length > 0
          ? payload.error.message
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

function compareIdentitySource(input) {
  if (input.actual && HOSTED_RELEASE_METADATA_SOURCES.has(input.actual)) {
    console.log(
      `[OK] ${input.label} release identity source is ${input.actual}`,
    );
    return true;
  }

  console.error(
    `[FAIL] ${input.label} release identity source is ${input.actual ?? "missing"}, expected one of ${Array.from(HOSTED_RELEASE_METADATA_SOURCES).join(", ")}. Next step: expose canonical hosted release metadata before retrying verification.`,
  );
  return false;
}

function readReportedReleaseValue(payload) {
  return normalizeRuntimeVersion(payload?.releaseId ?? payload?.runtimeVersion);
}

function readReportedGitSha(payload) {
  return normalizeGitSha(payload?.gitSha);
}

function readReportedIdentitySource(payload) {
  return normalizeIdentitySource(payload?.identitySource);
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
const workerInternalUrl = options.workerInternalUrl
  ? normalizeBaseUrl(options.workerInternalUrl, "Worker internal URL")
  : process.env.AGORA_WORKER_INTERNAL_URL
    ? normalizeBaseUrl(
        process.env.AGORA_WORKER_INTERNAL_URL,
        "Worker internal URL",
      )
    : null;
const workerInternalToken =
  options.workerInternalToken ??
  process.env.AGORA_WORKER_INTERNAL_TOKEN ??
  null;

const apiHealth = await fetchJson(`${apiUrl}/api/health`, "API /api/health");
const indexerHealth = await fetchJson(
  `${apiUrl}/api/indexer-health`,
  "API /api/indexer-health",
);
let submissionPublicKey = null;
try {
  submissionPublicKey = await fetchJson(
    `${apiUrl}/api/submissions/public-key`,
    "API /api/submissions/public-key",
  );
} catch (error) {
  console.log(
    `[INFO] Skipping submission sealing fingerprint verification: ${error instanceof Error ? error.message : String(error)}`,
  );
}
const webVersion = webUrl
  ? await fetchJson(`${webUrl}/api/version`, "Web /api/version")
  : null;
const workerHealth = options.skipWorker
  ? null
  : await fetchJson(`${apiUrl}/api/worker-health`, "API /api/worker-health");

const apiRuntimeVersion = readReportedReleaseValue(apiHealth);
const apiGitSha = readReportedGitSha(apiHealth);
const apiIdentitySource = readReportedIdentitySource(apiHealth);
const indexerRuntimeVersion = readReportedReleaseValue(indexerHealth);
const indexerGitSha = readReportedGitSha(indexerHealth);
const indexerIdentitySource = readReportedIdentitySource(indexerHealth);
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

if (indexerHealth?.service !== "indexer") {
  throw new Error(
    `API /api/indexer-health returned service=${String(indexerHealth?.service)}. Next step: deploy the current indexer health contract and retry.`,
  );
}

if (!indexerRuntimeVersion) {
  throw new Error(
    "API /api/indexer-health did not return releaseId or runtimeVersion. Next step: deploy the current indexer build and retry.",
  );
}

if (webUrl && !webRuntimeVersion) {
  throw new Error(
    "Web /api/version did not return releaseId or runtimeVersion. Next step: deploy the current web build and retry.",
  );
}

let ok = true;

console.log("[OK] API /api/health is healthy");
  console.log(`[INFO] Reported API runtime version: ${apiRuntimeVersion}`);
if (apiGitSha) {
  console.log(`[INFO] Reported API git SHA: ${apiGitSha}`);
} else {
  console.log(
    "[INFO] API /api/health did not report gitSha. Hosted git provenance is treated as best-effort in this verification mode.",
  );
}

if (expectedApiRuntimeVersion) {
  console.log(
    `[INFO] Expected API runtime version: ${expectedApiRuntimeVersion}`,
  );
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

ok =
  compareIdentitySource({
    label: "API",
    actual: apiIdentitySource,
  }) && ok;

console.log(
  `[INFO] Reported Indexer runtime version: ${indexerRuntimeVersion}`,
);
if (indexerGitSha) {
  console.log(`[INFO] Reported Indexer git SHA: ${indexerGitSha}`);
}

ok =
  compareIdentitySource({
    label: "Indexer",
    actual: indexerIdentitySource,
  }) && ok;
ok =
  compareRuntimeVersion({
    label: "Indexer",
    expected: apiRuntimeVersion,
    actual: indexerRuntimeVersion,
  }) && ok;

if (expectedApiGitSha) {
  if (!indexerGitSha) {
    console.error(
      "[FAIL] API /api/indexer-health did not report gitSha. Next step: redeploy the current indexer build with canonical hosted release metadata and retry.",
    );
    ok = false;
  } else {
    ok =
      compareGitSha({
        label: "Indexer",
        expected: expectedApiGitSha,
        actual: indexerGitSha,
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
  const workerApiRuntimeVersion = normalizeRuntimeVersion(
    typeof workerHealth?.runtime?.apiVersion === "string"
      ? workerHealth.runtime.apiVersion
      : null,
  );
  const workerApiIdentitySource = normalizeIdentitySource(
    workerHealth?.runtime?.identitySource,
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

  ok =
    compareIdentitySource({
      label: "Worker health API runtime",
      actual: workerApiIdentitySource,
    }) && ok;

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

if (submissionPublicKey?.data) {
  console.log(
    `[INFO] API submission seal key: kid=${submissionPublicKey.data.kid}, fingerprint=${submissionPublicKey.data.publicKeyFingerprint}`,
  );
  const apiSealFingerprint = submissionPublicKey.data.publicKeyFingerprint;
  const workerHealthSealFingerprint =
    workerHealth?.sealing?.publicKeyFingerprint ?? null;
  const workerHealthDerivedSealFingerprint =
    workerHealth?.sealing?.derivedPublicKeyFingerprint ?? null;
  const workerHealthSelfCheckOk = workerHealth?.sealing?.selfCheckOk ?? null;

  if (workerHealthSealFingerprint === apiSealFingerprint) {
    console.log("[OK] Worker-health public-key fingerprint matches API");
  } else if (workerHealthSealFingerprint) {
    console.error(
      `[FAIL] Worker-health public-key fingerprint mismatch: api=${apiSealFingerprint}, worker-health=${workerHealthSealFingerprint}. Next step: redeploy with the same submission sealing public key on both services, then retry.`,
    );
    ok = false;
  }

  if (workerHealthDerivedSealFingerprint === apiSealFingerprint) {
    console.log(
      "[OK] Worker-health derived private-key fingerprint matches API",
    );
  } else if (workerHealthDerivedSealFingerprint) {
    console.error(
      `[FAIL] Worker-health derived private-key fingerprint mismatch: api=${apiSealFingerprint}, worker-health-derived=${workerHealthDerivedSealFingerprint}. Next step: restore the worker private key that matches the API public key, then retry.`,
    );
    ok = false;
  }

  if (workerHealthSelfCheckOk === true) {
    console.log("[OK] Worker-health sealing self-check is healthy");
  } else if (workerHealthSelfCheckOk === false) {
    console.error(
      "[FAIL] Worker-health sealing self-check is unhealthy. Next step: restore the matching worker private key and retry.",
    );
    ok = false;
  }

  if (workerInternalUrl && workerInternalToken) {
    const workerSealHealth = await fetchJsonWithHeaders(
      `${workerInternalUrl}/internal/sealed-submissions/healthz`,
      "Worker internal /internal/sealed-submissions/healthz",
      {
        authorization: `Bearer ${workerInternalToken}`,
      },
    );

    const workerSealFingerprint =
      workerSealHealth?.sealing?.publicKeyFingerprint ?? null;
    const workerDerivedSealFingerprint =
      workerSealHealth?.sealing?.derivedPublicKeyFingerprint ?? null;
    const workerSealKeyId = workerSealHealth?.sealing?.keyId ?? null;

    if (workerSealHealth?.ok === true) {
      console.log("[OK] Worker internal sealing health is healthy");
    } else {
      console.error(
        "[FAIL] Worker internal sealing health is not healthy. Next step: restore the worker sealing keypair and retry.",
      );
      ok = false;
    }

    if (workerSealKeyId === submissionPublicKey.data.kid) {
      console.log(
        `[OK] Worker internal sealing key id matches API kid ${submissionPublicKey.data.kid}`,
      );
    } else {
      console.error(
        `[FAIL] Worker internal sealing key id mismatch: api=${submissionPublicKey.data.kid}, worker=${workerSealKeyId}. Next step: align the API public key and worker private key configuration, then retry.`,
      );
      ok = false;
    }

    if (workerSealFingerprint === apiSealFingerprint) {
      console.log("[OK] Worker internal public-key fingerprint matches API");
    } else {
      console.error(
        `[FAIL] Worker internal public-key fingerprint mismatch: api=${apiSealFingerprint}, worker=${workerSealFingerprint}. Next step: redeploy with the same submission sealing public key on both services, then retry.`,
      );
      ok = false;
    }

    if (workerDerivedSealFingerprint === apiSealFingerprint) {
      console.log("[OK] Worker derived private-key fingerprint matches API");
    } else {
      console.error(
        `[FAIL] Worker derived private-key fingerprint mismatch: api=${apiSealFingerprint}, worker-derived=${workerDerivedSealFingerprint}. Next step: restore the worker private key that matches the API public key, then retry.`,
      );
      ok = false;
    }
  } else {
    console.log(
      "[INFO] Skipping worker internal sealing fingerprint verification because --worker-internal-url/--worker-internal-token were not provided.",
    );
  }
}

if (!ok) {
  process.exit(1);
}
