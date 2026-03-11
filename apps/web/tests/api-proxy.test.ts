import assert from "node:assert/strict";
import test from "node:test";
import { resolveApiProxyBase } from "../src/lib/api-proxy";

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
