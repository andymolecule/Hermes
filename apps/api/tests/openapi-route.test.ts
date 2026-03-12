import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";

test("openapi document is served from well-known path", async () => {
  const app = createApp();
  const response = await app.request(
    new Request("http://localhost/.well-known/openapi.json"),
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    openapi: string;
    paths: Record<string, unknown>;
  };

  assert.equal(body.openapi, "3.1.0");
  assert.ok("/api/challenges" in body.paths);
  assert.ok("/api/submissions/{id}/status" in body.paths);
});
