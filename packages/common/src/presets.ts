import type { SubmissionContractOutput } from "./schemas/submission-contract.js";
import {
  createCsvTableEvaluationContract,
  createRuntimePolicies,
  type CsvTableEvaluationContractOutput,
  type ScorerRuntimePoliciesOutput,
} from "./schemas/scorer-runtime.js";

// ---------------------------------------------------------------------------
// Official images — match containers/ directory names exactly.
// These are stable public release tags. Challenge publication resolves them
// to immutable @sha256 digests before persistence when strict pinning is on.
// ---------------------------------------------------------------------------

export const OFFICIAL_IMAGES = {
  repro: "ghcr.io/andymolecule/repro-scorer:v1",
  regression: "ghcr.io/andymolecule/regression-scorer:v1",
  docking: "ghcr.io/andymolecule/docking-scorer:v1",
} as const;

// ===========================================================================
// Preset Registry v2 — scoring runtime config
// ===========================================================================

export interface RunnerLimits {
  memory: string; // e.g. "512m", "8g"
  cpus: string; // e.g. "0.5", "1", "4" — Docker accepts floats
  pids: number; // e.g. 64
  timeoutMs: number; // e.g. 300_000
}

export interface ScoringMountConfig {
  evaluationBundleName?: string;
  submissionFileName: string;
}

export const DEFAULT_SCORER_MOUNT: ScoringMountConfig = {
  evaluationBundleName: "ground_truth.csv",
  submissionFileName: "submission.csv",
};

export interface ScorerPresetV2 {
  /** Versioned ID — NEVER mutate, add _v2 instead */
  id: string;
  /** Human-readable label */
  label: string;
  /** Short description */
  description: string;
  /**
   * Official presets use stable release tags in source. Challenge
   * publication should resolve those validated refs to immutable @sha256
   * digests before pinning or persistence.
   */
  container: string;
  /** Auto-generated scoring description (read-only for presets) */
  scoringDescription: string;
  /** Runner resource limits */
  runnerLimits: RunnerLimits;
  /** Recommended minimum score threshold */
  defaultMinimumScore: number;
  /** Optional format requirement enforced by shared spec validation. */
  expectedSubmissionKind?: SubmissionContractOutput["kind"];
  /** Optional scorer input layout override. Defaults to DEFAULT_SCORER_MOUNT. */
  mount?: ScoringMountConfig;
  /** Optional scorer-facing runtime defaults derived into agora-runtime.json. */
  runtimeDefaults?: {
    evaluationContract?: CsvTableEvaluationContractOutput;
    policies?: ScorerRuntimePoliciesOutput;
  };
}

// ---------------------------------------------------------------------------
// Registry — versioned, immutable entries
// ---------------------------------------------------------------------------

export const PRESET_REGISTRY: Record<string, ScorerPresetV2> = {
  csv_comparison_v1: {
    id: "csv_comparison_v1",
    label: "CSV Comparison",
    description: "Row-by-row CSV comparison against ground truth",
    container: OFFICIAL_IMAGES.repro,
    scoringDescription:
      "Evaluated deterministically by the Repro Scorer. Submissions are compared row-by-row against the reference CSV. Score = matched_rows / total_rows.",
    runnerLimits: { memory: "512m", cpus: "1", pids: 64, timeoutMs: 300_000 },
    defaultMinimumScore: 0,
    expectedSubmissionKind: "csv_table",
  },
  regression_v1: {
    id: "regression_v1",
    label: "Regression Metrics",
    description: "Scored by a numerical metric (RMSE, R², etc.)",
    container: OFFICIAL_IMAGES.regression,
    scoringDescription:
      "Evaluated by the Regression Scorer engine using the selected metric against the reference dataset.",
    runnerLimits: { memory: "2g", cpus: "2", pids: 64, timeoutMs: 600_000 },
    defaultMinimumScore: 0,
    expectedSubmissionKind: "csv_table",
    runtimeDefaults: {
      evaluationContract: createCsvTableEvaluationContract({
        requiredColumns: ["id", "label"],
        idColumn: "id",
        valueColumn: "label",
      }),
      policies: createRuntimePolicies({
        coveragePolicy: "reject",
        duplicateIdPolicy: "reject",
        invalidValuePolicy: "reject",
      }),
    },
  },
  docking_v1: {
    id: "docking_v1",
    label: "Molecular Docking",
    description: "Rank compounds by docking score against a protein target",
    container: OFFICIAL_IMAGES.docking,
    scoringDescription:
      "Evaluated by the Docking Scorer engine. Submissions are ranked by correlation to reference docking scores.",
    runnerLimits: { memory: "4g", cpus: "2", pids: 64, timeoutMs: 1_200_000 },
    defaultMinimumScore: 0,
    expectedSubmissionKind: "csv_table",
  },
};

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/** Look up a preset by ID. Returns undefined for unknown IDs. */
export function lookupPreset(id: string): ScorerPresetV2 | undefined {
  return PRESET_REGISTRY[id];
}

/** Get all registered preset IDs. */
export function getPresetIds(): string[] {
  return Object.keys(PRESET_REGISTRY);
}

export function resolvePresetMount(
  presetId?: string | null,
): ScoringMountConfig {
  const preset =
    typeof presetId === "string" && presetId.trim().length > 0
      ? PRESET_REGISTRY[presetId.trim()]
      : undefined;
  return preset?.mount ?? DEFAULT_SCORER_MOUNT;
}

export function getPresetExpectedSubmissionKind(
  presetId?: string | null,
): SubmissionContractOutput["kind"] | null {
  const preset =
    typeof presetId === "string" && presetId.trim().length > 0
      ? PRESET_REGISTRY[presetId.trim()]
      : undefined;
  return preset?.expectedSubmissionKind ?? null;
}

export function resolvePresetRuntimeDefaults(
  presetId?: string | null,
): ScorerPresetV2["runtimeDefaults"] | null {
  const preset =
    typeof presetId === "string" && presetId.trim().length > 0
      ? PRESET_REGISTRY[presetId.trim()]
      : undefined;
  return preset?.runtimeDefaults ?? null;
}

type ParsedGhcrImageRef = {
  imagePath: string;
  owner: string;
  repository: string;
  tag?: string;
  digest?: string;
};

function parseGhcrImageReference(image: string): ParsedGhcrImageRef | null {
  const match =
    /^ghcr\.io\/([^/]+\/[^:@]+)(?::([^@]+))?(?:@(sha256:[a-fA-F0-9]{64}))?$/.exec(
      image.trim(),
    );
  if (!match) return null;
  const imagePath = match[1];
  if (!imagePath) return null;
  const [owner = "", repository = ""] = imagePath.split("/", 2);
  return {
    imagePath,
    owner,
    repository,
    tag: match[2],
    digest: match[3],
  };
}

function findOfficialContainerByRepository(container: string): string | null {
  const parsed = parseGhcrImageReference(container);
  if (!parsed?.repository) return null;

  for (const officialImage of Object.values(OFFICIAL_IMAGES)) {
    const officialRef = parseGhcrImageReference(officialImage);
    if (officialRef?.repository === parsed.repository) {
      return officialImage;
    }
  }

  return null;
}

function sharesGhcrRepository(left: string, right: string): boolean {
  const leftRef = parseGhcrImageReference(left);
  const rightRef = parseGhcrImageReference(right);
  return (
    typeof leftRef?.imagePath === "string" &&
    typeof rightRef?.imagePath === "string" &&
    leftRef.imagePath === rightRef.imagePath
  );
}

function matchesPresetContainer(
  presetContainer: string,
  candidateContainer: string,
): boolean {
  const preset = presetContainer.trim();
  const candidate = candidateContainer.trim();
  if (preset === candidate) return true;
  return (
    candidate.includes("@sha256:") && sharesGhcrRepository(preset, candidate)
  );
}

/** Find all preset IDs that point to a given container image. */
export function findPresetIdsByContainer(container: string): string[] {
  return Object.values(PRESET_REGISTRY)
    .filter((preset) => matchesPresetContainer(preset.container, container))
    .map((preset) => preset.id);
}

/**
 * Infer a preset ID by container only when there is exactly one match.
 * Returns null for zero matches or ambiguous matches.
 */
export function inferPresetIdByContainer(container: string): string | null {
  const ids = findPresetIdsByContainer(container);
  const only = ids[0];
  return ids.length === 1 && typeof only === "string" ? only : null;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** Set of all official container references for quick lookup */
const officialContainerSet = new Set<string>(Object.values(OFFICIAL_IMAGES));

/** Check whether a container string is one of our official presets. */
export function isOfficialContainer(container: string): boolean {
  const trimmed = container.trim();
  return (
    officialContainerSet.has(trimmed) ||
    Object.values(OFFICIAL_IMAGES).some(
      (officialImage) =>
        trimmed.includes("@sha256:") &&
        sharesGhcrRepository(officialImage, trimmed),
    )
  );
}

/**
 * Validate a scoring container reference.
 * Returns null if valid, or an error message string.
 */
export function validateScoringContainer(container: string): string | null {
  const trimmed = container.trim();

  if (!trimmed) {
    return "Scoring container is required.";
  }

  if (!trimmed.includes("/")) {
    return "Scoring container must be a fully qualified OCI image reference (e.g. ghcr.io/org/image:tag).";
  }

  const officialContainer = findOfficialContainerByRepository(trimmed);
  if (officialContainer && !sharesGhcrRepository(officialContainer, trimmed)) {
    return `Official scorer images must use the canonical Agora image reference. Use ${officialContainer}.`;
  }

  if (trimmed.endsWith(":latest")) {
    return "Using :latest is not allowed for scoring. Use an official version tag (for Agora-managed scorers) or a pinned digest (@sha256:...).";
  }

  return null;
}

/**
 * Validate that a custom container uses a pinned digest.
 * Returns null if valid, or an error message string.
 */
export function validateCustomContainer(container: string): string | null {
  const base = validateScoringContainer(container);
  if (base) return base;

  const trimmed = container.trim();
  if (!trimmed.includes("@sha256:")) {
    return "Custom containers must use a pinned digest (@sha256:...) for reproducibility. Tags like :latest are not allowed.";
  }
  return null;
}

/**
 * Validate preset integrity: ensure a preset_id + container pair is consistent.
 * Returns null if valid, or an error message string.
 */
export function validatePresetIntegrity(
  presetId: string,
  container: string,
  options: { requirePinnedPresetDigest?: boolean } = {},
): string | null {
  if (presetId === "custom") {
    return validateCustomContainer(container);
  }

  const preset = lookupPreset(presetId);
  if (!preset) {
    return `Unknown preset ID: ${presetId}`;
  }

  if (!matchesPresetContainer(preset.container, container)) {
    return `Container mismatch for preset ${presetId}: expected ${preset.container}, got ${container}`;
  }

  if (options.requirePinnedPresetDigest && !container.includes("@sha256:")) {
    return `Preset ${presetId} must use a pinned digest (@sha256:...)`;
  }

  return null;
}

/**
 * Check whether all official images use pinned digests.
 * Returns an array of image references that still use mutable tags.
 * Empty array means all images are properly pinned.
 */
export function getUnpinnedOfficialImages(): string[] {
  return Object.values(OFFICIAL_IMAGES).filter(
    (image) => !image.includes("@sha256:"),
  );
}

const GHCR_RESOLUTION_TIMEOUT_MS = 5_000;
const GHCR_CACHE_TTL_MS = 5 * 60 * 1000;
const ghcrDigestCache = new Map<
  string,
  { digest: string; expiresAt: number }
>();

async function getGhcrHeaders(
  env: Record<string, string | undefined>,
  imagePath?: string,
  fetchImpl: typeof fetch = fetch,
) {
  const headers: Record<string, string> = {
    Accept:
      "application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json",
  };
  const token = env.AGORA_GHCR_TOKEN ?? env.GHCR_TOKEN ?? env.GITHUB_TOKEN;
  if (typeof token === "string" && token.length > 0) {
    headers.Authorization = `Bearer ${token}`;
  } else if (imagePath) {
    // Anonymous token exchange — GHCR requires a bearer token even for public images
    try {
      const tokenRes = await fetchImpl(
        `https://ghcr.io/token?scope=repository:${imagePath}:pull`,
      );
      if (tokenRes.ok) {
        const body = (await tokenRes.json()) as { token?: string };
        if (typeof body.token === "string" && body.token.length > 0) {
          headers.Authorization = `Bearer ${body.token}`;
        }
      }
    } catch {
      // Proceed without token — request will likely 401 and be caught downstream
    }
  }
  return headers;
}

function getGhcrDigestCacheKey(
  image: string,
  env: Record<string, string | undefined>,
) {
  const token = env.AGORA_GHCR_TOKEN ?? env.GHCR_TOKEN ?? env.GITHUB_TOKEN;
  return `${image}|${token ? "auth" : "anon"}`;
}

export class GhcrResolutionError extends Error {
  constructor(
    readonly code:
      | "auth_failure"
      | "rate_limit"
      | "missing_digest_header"
      | "network_timeout"
      | "network_error"
      | "http_error"
      | "unsupported_image_reference",
    message: string,
  ) {
    super(message);
    this.name = "GhcrResolutionError";
  }
}

export async function resolveOfficialImageToDigest(
  image: string,
  options: {
    env?: Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<string> {
  const trimmed = image.trim();
  if (trimmed.includes("@sha256:")) {
    return trimmed;
  }
  if (!officialContainerSet.has(trimmed)) {
    return trimmed;
  }

  const env = options.env ?? process.env;
  const cacheKey = getGhcrDigestCacheKey(trimmed, env);
  const cached = ghcrDigestCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.digest;
  }

  const parsed = parseGhcrImageReference(trimmed);
  if (!parsed?.imagePath) {
    throw new GhcrResolutionError(
      "unsupported_image_reference",
      `Failed to resolve digest for official preset image ${trimmed}: unsupported image reference format.`,
    );
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    GHCR_RESOLUTION_TIMEOUT_MS,
  );

  try {
    const response = await fetchImpl(
      `https://ghcr.io/v2/${parsed.imagePath}/manifests/${parsed.tag ?? "latest"}`,
      {
        method: "GET",
        headers: await getGhcrHeaders(env, parsed.imagePath, fetchImpl),
        signal: controller.signal,
      },
    );

    if (response.status === 401 || response.status === 403) {
      throw new GhcrResolutionError(
        "auth_failure",
        `GHCR auth failure while resolving official preset image ${trimmed}. Configure AGORA_GHCR_TOKEN, GHCR_TOKEN, or GITHUB_TOKEN with pull access.`,
      );
    }

    if (response.status === 429) {
      throw new GhcrResolutionError(
        "rate_limit",
        `GHCR rate limit while resolving official preset image ${trimmed}. Please retry shortly.`,
      );
    }

    if (!response.ok) {
      throw new GhcrResolutionError(
        "http_error",
        `Failed to resolve digest for official preset image ${trimmed}: GHCR responded ${response.status}.`,
      );
    }

    const digest = response.headers.get("docker-content-digest");
    if (!digest || !digest.startsWith("sha256:")) {
      throw new GhcrResolutionError(
        "missing_digest_header",
        `Failed to resolve digest for official preset image ${trimmed}: missing docker-content-digest header.`,
      );
    }

    const resolvedDigest = `ghcr.io/${parsed.imagePath}@${digest}`;
    ghcrDigestCache.set(cacheKey, {
      digest: resolvedDigest,
      expiresAt: Date.now() + GHCR_CACHE_TTL_MS,
    });
    return resolvedDigest;
  } catch (error) {
    if (error instanceof GhcrResolutionError) {
      throw error;
    }
    if (
      error instanceof Error &&
      (error.name === "AbortError" || controller.signal.aborted)
    ) {
      throw new GhcrResolutionError(
        "network_timeout",
        `Timed out resolving official preset image ${trimmed} from GHCR.`,
      );
    }
    throw new GhcrResolutionError(
      "network_error",
      `Network error resolving official preset image ${trimmed} from GHCR: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  } finally {
    clearTimeout(timeout);
  }
}
