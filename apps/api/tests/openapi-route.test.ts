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
  assert.ok(
    "post" in (body.paths["/api/challenges"] as Record<string, unknown>),
  );
  assert.ok("/api/agents/register" in body.paths);
  assert.ok("/api/agents/me" in body.paths);
  assert.ok("/api/agents/keys/{id}/revoke" in body.paths);
  assert.ok("/api/authoring/uploads" in body.paths);
  assert.ok("/api/authoring/sessions" in body.paths);
  assert.ok("/api/authoring/sessions/{id}" in body.paths);
  assert.ok("/api/verify" in body.paths);
  assert.ok(
    "patch" in
      (body.paths["/api/authoring/sessions/{id}"] as Record<string, unknown>),
  );
  assert.ok("/api/authoring/sessions/{id}/publish" in body.paths);
  assert.ok("/api/authoring/sessions/{id}/confirm-publish" in body.paths);
  assert.ok("/api/submissions/upload" in body.paths);
  assert.ok("/api/submissions/{id}/status" in body.paths);
  assert.ok("/api/submissions/by-intent/{intentId}/status" in body.paths);
  assert.ok("/api/submissions" in body.paths);
  assert.ok(!("/api/submissions/attach-metadata" in body.paths));

  const authoringListPath = body.paths["/api/authoring/sessions"] as {
    get?: {
      responses?: Record<string, unknown>;
    };
    post?: {
      responses?: Record<string, unknown>;
    };
  };
  const authoringListResponses = authoringListPath.get?.responses ?? {};
  const authoringCreateResponses = authoringListPath.post?.responses ?? {};
  assert.ok(
    "200" in authoringListResponses,
    "authoring list should advertise a success response",
  );
  assert.ok(
    "200" in authoringCreateResponses,
    "authoring create should advertise a success response",
  );

  const uploadPath = body.paths["/api/submissions/upload"] as {
    post?: {
      requestBody?: {
        content?: Record<string, unknown>;
      };
    };
  };
  const uploadContent = uploadPath.post?.requestBody?.content ?? {};
  assert.ok(
    "application/octet-stream" in uploadContent,
    "submission upload should advertise raw octet-stream bodies",
  );
  assert.ok(
    "multipart/form-data" in uploadContent,
    "submission upload should advertise multipart form uploads",
  );
  assert.equal(
    "application/json" in uploadContent,
    false,
    "submission upload should not advertise JSON bodies",
  );

  const registerPath = body.paths["/api/submissions"] as {
    post?: {
      responses?: Record<string, unknown>;
    };
  };
  const registerResponses = registerPath.post?.responses ?? {};
  assert.ok(
    "200" in registerResponses,
    "submission registration should advertise the normal success response",
  );
  assert.ok(
    "202" in registerResponses,
    "submission registration should advertise the warning success response",
  );

  const authoringUploadPath = body.paths["/api/authoring/uploads"] as {
    post?: {
      responses?: Record<string, unknown>;
    };
  };
  assert.ok(
    "200" in (authoringUploadPath.post?.responses ?? {}),
    "authoring upload should advertise a wrapped success response",
  );

  const healthzPath = body.paths["/healthz"] as {
    get?: {
      responses?: Record<string, unknown>;
    };
  };
  assert.ok(
    "503" in (healthzPath.get?.responses ?? {}),
    "healthz should advertise readiness failures",
  );

  const verifyPath = body.paths["/api/verify"] as {
    post?: {
      responses?: Record<string, unknown>;
    };
  };
  assert.ok(
    "200" in (verifyPath.post?.responses ?? {}),
    "verify should advertise the canonical success response",
  );
});
