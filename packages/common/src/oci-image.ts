type ParsedGhcrImageRef = {
  imagePath: string;
  owner: string;
  repository: string;
  tag?: string;
  digest?: string;
};

export interface ResolveOciImageToDigestOptions {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

const GHCR_RESOLUTION_TIMEOUT_MS = 5_000;
const GHCR_CACHE_TTL_MS = 5 * 60 * 1000;
const ghcrDigestCache = new Map<
  string,
  { digest: string; expiresAt: number }
>();

export function parseGhcrImageReference(
  image: string,
): ParsedGhcrImageRef | null {
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

export function sharesGhcrRepository(left: string, right: string): boolean {
  const leftRef = parseGhcrImageReference(left);
  const rightRef = parseGhcrImageReference(right);
  return (
    typeof leftRef?.imagePath === "string" &&
    typeof rightRef?.imagePath === "string" &&
    leftRef.imagePath === rightRef.imagePath
  );
}

export function hasPinnedDigest(image: string): boolean {
  return image.trim().includes("@sha256:");
}

export function validateScorerImage(image: string): string | null {
  const trimmed = image.trim();

  if (!trimmed) {
    return "Scorer image is required.";
  }

  if (!trimmed.includes("/")) {
    return "Scorer image must be a fully qualified OCI image reference (e.g. ghcr.io/org/image:tag).";
  }

  if (trimmed.endsWith(":latest")) {
    return "Using :latest is not allowed for scoring. Use a pinned digest or a stable Agora-managed image tag.";
  }

  return null;
}

export function validateExpertScorerImage(image: string): string | null {
  const base = validateScorerImage(image);
  if (base) return base;
  if (!hasPinnedDigest(image)) {
    return "Expert-mode scorer images must use a pinned digest (@sha256:...) for reproducibility.";
  }
  return null;
}

async function getGhcrHeaders(
  env: Record<string, string | undefined>,
  imagePath?: string,
  fetchImpl: typeof fetch = fetch,
) {
  const headers: Record<string, string> = {
    Accept:
      "application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.docker.distribution.manifest.list.v2+json",
  };
  const token = env.AGORA_GHCR_TOKEN ?? env.GHCR_TOKEN ?? env.GITHUB_TOKEN;
  if (typeof token === "string" && token.length > 0) {
    headers.Authorization = `Bearer ${token}`;
  } else if (imagePath) {
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
      // Anonymous fallback.
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

export async function resolveOciImageToDigest(
  image: string,
  options: ResolveOciImageToDigestOptions = {},
): Promise<string> {
  const parsed = parseGhcrImageReference(image);
  if (!parsed?.imagePath || !parsed.tag) {
    throw new GhcrResolutionError(
      "unsupported_image_reference",
      `Unable to resolve digest for image ${image}. Next step: use a tagged ghcr.io image reference.`,
    );
  }

  const env = options.env ?? {};
  const cacheKey = getGhcrDigestCacheKey(image, env);
  const now = Date.now();
  const cached = ghcrDigestCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return `ghcr.io/${parsed.imagePath}@${cached.digest}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GHCR_RESOLUTION_TIMEOUT_MS);
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;

  try {
    const headers = await getGhcrHeaders(
      env,
      parsed.imagePath,
      options.fetchImpl,
    );
    const response = await (options.fetchImpl ?? fetch)(
      `https://ghcr.io/v2/${parsed.imagePath}/manifests/${parsed.tag}`,
      {
        method: "GET",
        headers,
        signal,
      },
    );

    if (response.status === 401 || response.status === 403) {
      throw new GhcrResolutionError(
        "auth_failure",
        `GHCR authentication failed while resolving ${image}. Next step: set AGORA_GHCR_TOKEN or GHCR_TOKEN and retry.`,
      );
    }
    if (response.status === 429) {
      throw new GhcrResolutionError(
        "rate_limit",
        `GHCR rate limit hit while resolving ${image}. Next step: retry later or configure AGORA_GHCR_TOKEN.`,
      );
    }
    if (!response.ok) {
      throw new GhcrResolutionError(
        "http_error",
        `GHCR returned HTTP ${response.status} while resolving ${image}. Next step: confirm the image tag exists and is readable.`,
      );
    }

    const digest = response.headers.get("docker-content-digest");
    if (!digest) {
      throw new GhcrResolutionError(
        "missing_digest_header",
        `GHCR did not return a digest for ${image}. Next step: confirm the image reference points at a manifest.`,
      );
    }

    ghcrDigestCache.set(cacheKey, {
      digest,
      expiresAt: now + GHCR_CACHE_TTL_MS,
    });
    return `ghcr.io/${parsed.imagePath}@${digest}`;
  } catch (error) {
    if (error instanceof GhcrResolutionError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new GhcrResolutionError(
        "network_timeout",
        `Timed out resolving ${image} from GHCR. Next step: retry or verify outbound network access.`,
      );
    }
    throw new GhcrResolutionError(
      "network_error",
      `Network error while resolving ${image} from GHCR. Next step: retry or verify outbound network access.`,
    );
  } finally {
    clearTimeout(timeout);
  }
}
