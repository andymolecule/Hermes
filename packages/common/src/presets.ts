/**
 * Shared challenge-type presets — single source of truth.
 * Consumed by: web PostClient, CLI init, API validation.
 */

import type { ChallengeType } from "./types/challenge.js";

// ---------------------------------------------------------------------------
// Official images — match containers/ directory names exactly
// ---------------------------------------------------------------------------

export const OFFICIAL_IMAGES = {
    repro: "ghcr.io/hermes-science/repro-scorer:latest",
    regression: "ghcr.io/hermes-science/regression-scorer:latest",
    docking: "ghcr.io/hermes-science/docking-scorer:latest",
} as const;

// ===========================================================================
// Preset Registry v2 — the formal preset-to-engine coupling layer
// ===========================================================================

export interface RunnerLimits {
    memory: string;     // e.g. "512m", "8g"
    cpus: string;       // e.g. "0.5", "1", "4" — Docker accepts floats
    pids: number;       // e.g. 64
    timeoutMs: number;  // e.g. 300_000
}

export interface ScorerPresetV2 {
    /** Versioned ID — NEVER mutate, add _v2 instead */
    id: string;
    /** Human-readable label */
    label: string;
    /** Short description */
    description: string;
    /**
     * Pinned container digest. Must contain @sha256: for non-custom.
     * Use OFFICIAL_IMAGES.:latest only during dev; pin before production.
     */
    container: string;
    /** Auto-generated scoring description (read-only for presets) */
    scoringDescription: string;
    /** Runner resource limits */
    runnerLimits: RunnerLimits;
    /** Recommended minimum score threshold */
    defaultMinimumScore: number;
}

// ---------------------------------------------------------------------------
// Registry — versioned, immutable entries
// ---------------------------------------------------------------------------

export const PRESET_REGISTRY: Record<string, ScorerPresetV2> = {
    csv_comparison_v1: {
        id: "csv_comparison_v1",
        label: "CSV Comparison",
        description: "Row-by-row CSV comparison against ground truth",
        container: OFFICIAL_IMAGES.repro,  // TODO: pin @sha256: before production
        scoringDescription: "Evaluated deterministically by the Repro Scorer. Submissions are compared row-by-row against the reference CSV. Score = matched_rows / total_rows.",
        runnerLimits: { memory: "512m", cpus: "1", pids: 64, timeoutMs: 300_000 },
        defaultMinimumScore: 0,
    },
    number_absdiff_v1: {
        id: "number_absdiff_v1",
        label: "Number (Absolute Difference)",
        description: "Score = 100 - abs(answer - target). Highest wins.",
        container: OFFICIAL_IMAGES.repro,  // TODO: replace with number-scorer@sha256: once containerized
        scoringDescription: "Score = 100 - abs(answer - target). The closest answer to the target wins. Evaluated by the Number Scorer engine.",
        runnerLimits: { memory: "128m", cpus: "0.5", pids: 32, timeoutMs: 60_000 },
        defaultMinimumScore: 1,
    },
    file_hash_v1: {
        id: "file_hash_v1",
        label: "File Hash Match",
        description: "Submit a string whose SHA-256 matches the target hash",
        container: OFFICIAL_IMAGES.repro,  // TODO: pin @sha256: before production
        scoringDescription: "Evaluated by SHA-256 hash comparison. Score = 100 if exact match, 0 otherwise. Fully deterministic and verifiable.",
        runnerLimits: { memory: "256m", cpus: "0.5", pids: 32, timeoutMs: 60_000 },
        defaultMinimumScore: 100,
    },
    regression_v1: {
        id: "regression_v1",
        label: "Regression Metrics",
        description: "Scored by a numerical metric (RMSE, R², etc.)",
        container: OFFICIAL_IMAGES.regression,  // TODO: pin @sha256: before production
        scoringDescription: "Evaluated by the Regression Scorer engine using the selected metric against the reference dataset.",
        runnerLimits: { memory: "2g", cpus: "2", pids: 64, timeoutMs: 600_000 },
        defaultMinimumScore: 0,
    },
    docking_v1: {
        id: "docking_v1",
        label: "Molecular Docking",
        description: "Rank compounds by docking score against a protein target",
        container: OFFICIAL_IMAGES.docking,  // TODO: pin @sha256: before production
        scoringDescription: "Evaluated by the Docking Scorer engine. Submissions are ranked by correlation to reference docking scores.",
        runnerLimits: { memory: "4g", cpus: "2", pids: 64, timeoutMs: 1_200_000 },
        defaultMinimumScore: 0,
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

/** Find all preset IDs that point to a given container image. */
export function findPresetIdsByContainer(container: string): string[] {
    return Object.values(PRESET_REGISTRY)
        .filter((preset) => preset.container === container)
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

const DEFAULT_PRESET_ID_BY_CHALLENGE_TYPE: Partial<
    Record<ChallengeType, string>
> = {
    reproducibility: "csv_comparison_v1",
    prediction: "regression_v1",
    docking: "docking_v1",
    optimization: "custom",
    red_team: "custom",
    custom: "custom",
};

export function defaultPresetIdForChallengeType(
    challengeType: ChallengeType,
): string | null {
    return DEFAULT_PRESET_ID_BY_CHALLENGE_TYPE[challengeType] ?? null;
}

export function defaultMinimumScoreForChallengeType(
    challengeType: ChallengeType,
): number {
    const presetId = defaultPresetIdForChallengeType(challengeType);
    if (!presetId || presetId === "custom") return 0;
    return lookupPreset(presetId)?.defaultMinimumScore ?? 0;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** Set of all official container references for quick lookup */
const officialContainerSet = new Set<string>(Object.values(OFFICIAL_IMAGES));

/** Check whether a container string is one of our official presets. */
export function isOfficialContainer(container: string): boolean {
    return officialContainerSet.has(container);
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

    // Warn about :latest on non-official containers
    if (trimmed.endsWith(":latest") && !isOfficialContainer(trimmed)) {
        return "Using :latest tag is not recommended for reproducibility. Pin a specific version or digest (@sha256:...).";
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

    if (preset.container !== container) {
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
