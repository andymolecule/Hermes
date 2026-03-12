import { createHash } from "node:crypto";
import type { Context } from "hono";

function stableJson(value: unknown) {
  return JSON.stringify(value);
}

export function createJsonEtag(payload: unknown) {
  const digest = createHash("sha1").update(stableJson(payload)).digest("hex");
  return `"${digest}"`;
}

export function jsonWithEtag(
  c: Context,
  payload: unknown,
  status = 200,
  extraHeaders?: Record<string, string>,
) {
  const etag = createJsonEtag(payload);
  if (c.req.header("if-none-match") === etag) {
    return c.newResponse(null, 304, {
      ETag: etag,
      "Cache-Control": "public, max-age=0, must-revalidate",
      ...(extraHeaders ?? {}),
    });
  }

  return c.newResponse(JSON.stringify(payload), status as never, {
    "Content-Type": "application/json; charset=utf-8",
    ETag: etag,
    "Cache-Control": "public, max-age=0, must-revalidate",
    ...(extraHeaders ?? {}),
  });
}
