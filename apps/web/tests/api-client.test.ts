import assert from "node:assert/strict";
import test from "node:test";
import { resolveApiRequestUrl } from "../src/lib/api";

test("browser requests keep /api routes same-origin", () => {
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    value: {} as Window,
    configurable: true,
  });

  try {
    assert.equal(
      resolveApiRequestUrl("/api/auth/session"),
      "/api/auth/session",
    );
  } finally {
    Object.defineProperty(globalThis, "window", {
      value: originalWindow,
      configurable: true,
    });
  }
});

test("browser requests still send non-api routes to the configured backend", () => {
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    value: {} as Window,
    configurable: true,
  });

  try {
    assert.match(resolveApiRequestUrl("/healthz"), /^https?:\/\/.+\/healthz$/);
  } finally {
    Object.defineProperty(globalThis, "window", {
      value: originalWindow,
      configurable: true,
    });
  }
});
