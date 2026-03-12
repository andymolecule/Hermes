import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../src/app/api/version/route";

test("api/version reports web runtime version", async () => {
  const response = await GET();
  assert.equal(response.status, 200);

  const payload = (await response.json()) as {
    ok: boolean;
    service: string;
    runtimeVersion: string;
    checkedAt: string;
  };

  assert.equal(payload.ok, true);
  assert.equal(payload.service, "web");
  assert.equal(typeof payload.runtimeVersion, "string");
  assert.ok(payload.runtimeVersion.length > 0);
  assert.equal(typeof payload.checkedAt, "string");
  assert.equal(response.headers.get("cache-control"), "no-store");
});
