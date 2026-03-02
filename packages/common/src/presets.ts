/**
 * Shared challenge-type presets — single source of truth.
 * Consumed by: web PostClient, CLI init, API validation.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Schema-level challenge types (execution-agnostic). */
export type ChallengePresetType = "reproducibility" | "prediction" | "custom";

export interface ScorerPreset {
    /** Human-readable label shown in UI */
    label: string;
    /** Short description */
    description: string;
    /**
     * OCI container image reference.
     * `null` for "custom" — poster must supply their own.
     */
    container: string | null;
    /** Suggested metric — purely a UI hint, not enforced */
    metricHint: string;
    /** Default domain for this preset */
    defaultDomain: string;
}

// ---------------------------------------------------------------------------
// Official images — match containers/ directory names exactly
// ---------------------------------------------------------------------------

export const OFFICIAL_IMAGES = {
    repro: "ghcr.io/hermes-science/repro-scorer:latest",
    regression: "ghcr.io/hermes-science/regression-scorer:latest",
    docking: "ghcr.io/hermes-science/docking-scorer:latest",
} as const;

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export const SCORER_PRESETS: Record<ChallengePresetType, ScorerPreset> = {
    reproducibility: {
        label: "Deterministic",
        description: "Same input → same score, fully reproducible",
        container: OFFICIAL_IMAGES.repro,
        metricHint: "custom",
        defaultDomain: "other",
    },
    prediction: {
        label: "Metric-Based",
        description: "Submissions scored by a numerical metric (RMSE, R², etc.)",
        container: OFFICIAL_IMAGES.regression,
        metricHint: "r2",
        defaultDomain: "omics",
    },
    custom: {
        label: "Custom",
        description: "Bring your own scorer and rules",
        container: null,
        metricHint: "custom",
        defaultDomain: "other",
    },
};

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

    // Must look like a valid OCI reference: registry/path:tag or registry/path@sha256:...
    if (!trimmed.includes("/")) {
        return "Scoring container must be a fully qualified OCI image reference (e.g. ghcr.io/org/image:tag).";
    }

    // Warn about :latest on non-official containers
    if (trimmed.endsWith(":latest") && !isOfficialContainer(trimmed)) {
        return "Using :latest tag is not recommended for reproducibility. Pin a specific version or digest (@sha256:...).";
    }

    return null;
}
