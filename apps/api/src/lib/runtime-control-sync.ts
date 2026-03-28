const PUBLIC_API_RUNTIME_CHECK_TIMEOUT_MS = 5_000;

export interface PublicApiRuntimeSyncStatus {
  ok: boolean;
  reason:
    | "disabled"
    | "matched"
    | "mismatched"
    | "unhealthy"
    | "invalid_payload"
    | "request_failed";
  observedRuntimeVersion: string | null;
  status: number | null;
  detail: string | null;
}

interface PublicApiRuntimeSyncOptions {
  apiUrl?: string;
  runtimeVersion: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function resolvePublicApiHealthUrl(apiUrl: string) {
  return new URL("/api/health", apiUrl).toString();
}

function toPublicApiRuntimeSyncStatus(
  input: PublicApiRuntimeSyncStatus,
): PublicApiRuntimeSyncStatus {
  return input;
}

export async function readPublicApiRuntimeSyncStatus(
  input: PublicApiRuntimeSyncOptions,
): Promise<PublicApiRuntimeSyncStatus> {
  if (!input.apiUrl) {
    return toPublicApiRuntimeSyncStatus({
      ok: true,
      reason: "disabled",
      observedRuntimeVersion: null,
      status: null,
      detail: null,
    });
  }

  const timeoutMs = input.timeoutMs ?? PUBLIC_API_RUNTIME_CHECK_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();

  try {
    const response = await (input.fetchImpl ?? fetch)(
      resolvePublicApiHealthUrl(input.apiUrl),
      {
        headers: {
          accept: "application/json",
          "user-agent": "agora-runtime-control-sync/1.0",
        },
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      return toPublicApiRuntimeSyncStatus({
        ok: false,
        reason: "unhealthy",
        observedRuntimeVersion: null,
        status: response.status,
        detail: `Public API health returned ${response.status}.`,
      });
    }

    const payload = (await response.json().catch(() => null)) as {
      runtimeVersion?: unknown;
    } | null;
    const observedRuntimeVersion =
      typeof payload?.runtimeVersion === "string"
        ? payload.runtimeVersion
        : null;

    if (!observedRuntimeVersion) {
      return toPublicApiRuntimeSyncStatus({
        ok: false,
        reason: "invalid_payload",
        observedRuntimeVersion: null,
        status: response.status,
        detail: "Public API health payload is missing runtimeVersion.",
      });
    }

    if (observedRuntimeVersion !== input.runtimeVersion) {
      return toPublicApiRuntimeSyncStatus({
        ok: false,
        reason: "mismatched",
        observedRuntimeVersion,
        status: response.status,
        detail: `Public API runtime ${observedRuntimeVersion} is still active.`,
      });
    }

    return toPublicApiRuntimeSyncStatus({
      ok: true,
      reason: "matched",
      observedRuntimeVersion,
      status: response.status,
      detail: null,
    });
  } catch (error) {
    return toPublicApiRuntimeSyncStatus({
      ok: false,
      reason: "request_failed",
      observedRuntimeVersion: null,
      status: null,
      detail: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearTimeout(timer);
  }
}
