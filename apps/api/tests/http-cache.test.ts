import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { jsonWithEtag } from "../src/lib/http-cache.js";

test("jsonWithEtag returns 304 when If-None-Match matches", async () => {
  const app = new Hono();
  app.get("/cached", (c) => jsonWithEtag(c, { ok: true }));

  const first = await app.request(new Request("http://localhost/cached"));
  assert.equal(first.status, 200);
  const etag = first.headers.get("etag");
  assert.equal(typeof etag, "string");

  const second = await app.request(
    new Request("http://localhost/cached", {
      headers: { "If-None-Match": etag ?? "" },
    }),
  );
  assert.equal(second.status, 304);
});
