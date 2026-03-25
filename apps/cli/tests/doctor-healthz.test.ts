import assert from "node:assert/strict";
import test from "node:test";
import {
  checkApiHealth,
  checkOfficialScorerRegistry,
  checkSubmissionPublicKey,
} from "../src/commands/doctor.js";

test("doctor falls back to /api/healthz when the web origin does not expose /healthz", async () => {
  const calls: string[] = [];

  const detail = await checkApiHealth(
    "https://agora-market.vercel.app",
    async (input) => {
      const url = String(input);
      calls.push(url);

      if (url.endsWith("/api/healthz")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      return new Response("not found", { status: 404 });
    },
  );

  assert.equal(detail, "api/healthz ok via web proxy");
  assert.deepEqual(calls, [
    "https://agora-market.vercel.app/healthz",
    "https://agora-market.vercel.app/api/healthz",
  ]);
});

test("doctor still accepts direct API origins that expose /healthz", async () => {
  const calls: string[] = [];

  const detail = await checkApiHealth("https://api.example", async (input) => {
    const url = String(input);
    calls.push(url);

    if (url.endsWith("/healthz")) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    return new Response("not found", { status: 404 });
  });

  assert.equal(detail, "healthz ok");
  assert.deepEqual(calls, ["https://api.example/healthz"]);
});

test("doctor validates the submission sealing public key endpoint", async () => {
  const detail = await checkSubmissionPublicKey(
    "https://api.example",
    async () =>
      new Response(
        JSON.stringify({
          data: {
            kid: "submission-seal",
            version: "sealed_submission_v2",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );

  assert.equal(detail, "kid=submission-seal, version=sealed_submission_v2");
});

test("doctor validates official scorer tags against pinned digests", async () => {
  const detail = await checkOfficialScorerRegistry(async (_input, init) => {
    const auth = init?.headers;
    assert.ok(auth);
    return new Response("", {
      status: 200,
      headers: {
        "docker-content-digest":
          String(_input).includes("gems-tabular-scorer")
            ? "sha256:b5f15b2d056c024c08f2f8a17e521e6ae8837ff49deda2572476b7a649bd17b5"
            : "sha256:315f4e058b8bcd86e16b77f49bb418bfa06392fe163000dd53841e9b516f9a64",
      },
    });
  });

  assert.match(
    detail,
    /gems-tabular-scorer:sha-d7f82f1065efa6e22db6a06c0621d59af738681f -> ghcr\.io\/andymolecule\/gems-tabular-scorer@sha256:b5f15b2d056c024c08f2f8a17e521e6ae8837ff49deda2572476b7a649bd17b5/,
  );
  assert.match(
    detail,
    /gems-match-scorer:sha-d7f82f1065efa6e22db6a06c0621d59af738681f -> ghcr\.io\/andymolecule\/gems-match-scorer@sha256:315f4e058b8bcd86e16b77f49bb418bfa06392fe163000dd53841e9b516f9a64/,
  );
});
