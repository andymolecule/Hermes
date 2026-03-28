import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveApiProxyBase,
  sanitizeUpstreamResponseHeaders,
} from "../src/lib/api-proxy";

test("api proxy prefers the configured backend origin over same-origin public urls", () => {
  const resolved = resolveApiProxyBase({
    requestUrl: "https://agora-market.vercel.app/api/challenges/test",
    serverApiUrl: "https://agora-api.onrender.com",
    publicApiUrl: "https://agora-market.vercel.app",
  });

  assert.equal(resolved.ok, true);
  if (!resolved.ok) {
    return;
  }

  assert.equal(resolved.baseUrl, "https://agora-api.onrender.com");
});

test("api proxy rejects same-origin root urls to avoid recursive proxy loops", () => {
  const resolved = resolveApiProxyBase({
    requestUrl: "https://agora-market.vercel.app/api/challenges/test",
    publicApiUrl: "https://agora-market.vercel.app",
  });

  assert.equal(resolved.ok, false);
  if (resolved.ok) {
    return;
  }

  assert.match(resolved.message, /AGORA_API_URL/);
});

test("api proxy strips upstream transport headers before returning a response", () => {
  const upstreamHeaders = new Headers({
    "content-encoding": "br",
    "content-length": "123",
    "content-type": "application/json",
    "transfer-encoding": "chunked",
    "x-agora-trace-id": "trace-1",
  });

  const sanitized = sanitizeUpstreamResponseHeaders(upstreamHeaders);

  assert.equal(sanitized.get("content-encoding"), null);
  assert.equal(sanitized.get("content-length"), null);
  assert.equal(sanitized.get("transfer-encoding"), null);
  assert.equal(sanitized.get("content-type"), "application/json");
  assert.equal(sanitized.get("x-agora-trace-id"), "trace-1");
});
