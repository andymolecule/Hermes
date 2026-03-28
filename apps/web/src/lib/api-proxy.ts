function normalizeBaseUrl(value: string) {
  return value.replace(/\/$/, "");
}

const RESPONSE_HEADERS_TO_STRIP = [
  "connection",
  "content-encoding",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
] as const;

export function resolveApiProxyBase(input: {
  requestUrl: string;
  serverApiUrl?: string;
  publicApiUrl?: string;
}) {
  const requestOrigin = new URL(input.requestUrl).origin;
  const candidates = [input.serverApiUrl, input.publicApiUrl].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );

  for (const candidate of candidates) {
    try {
      const parsed = new URL(candidate);
      const normalizedPath = parsed.pathname.replace(/\/$/, "");

      if (
        parsed.origin === requestOrigin &&
        (normalizedPath === "" || normalizedPath === "/")
      ) {
        continue;
      }

      return {
        ok: true as const,
        baseUrl: normalizeBaseUrl(parsed.toString()),
      };
    } catch {}
  }

  return {
    ok: false as const,
    message:
      "Agora web API proxy is misconfigured. Set AGORA_API_URL to the backend API origin, not the web origin, then redeploy.",
  };
}

export function sanitizeUpstreamResponseHeaders(
  upstreamHeaders: Headers,
): Headers {
  const headers = new Headers(upstreamHeaders);
  for (const header of RESPONSE_HEADERS_TO_STRIP) {
    headers.delete(header);
  }
  return headers;
}
