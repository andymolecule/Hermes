import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoringSourcesRouter } from "../src/routes/authoring-sources.js";

function createRouter(
  dependencies?: Parameters<typeof createAuthoringSourcesRouter>[0],
) {
  return createAuthoringSourcesRouter({
    ...dependencies,
  });
}

test("authoring callback sweep requires the internal operator token", async () => {
  const router = createRouter({
    readAuthoringOperatorRuntimeConfig: () =>
      ({
        token: "operator-secret",
      }) as never,
  });

  const response = await router.request(
    new Request("http://localhost/callbacks/sweep", {
      method: "POST",
    }),
  );

  assert.equal(response.status, 401);
  assert.equal(
    ((await response.json()) as { code: string }).code,
    "AUTHORING_OPERATOR_UNAUTHORIZED",
  );
});

test("authoring callback sweep returns the durable delivery summary", async () => {
  const router = createRouter({
    readAuthoringOperatorRuntimeConfig: () =>
      ({
        token: "operator-secret",
      }) as never,
    sweepPendingAuthoringDraftLifecycleEvents: async (input) => {
      assert.equal(input.limit, 17);
      return {
        scanned: 17,
        delivered: 3,
        failed: 1,
        pending: 2,
      } as never;
    },
  });

  const response = await router.request(
    new Request("http://localhost/callbacks/sweep?limit=17", {
      method: "POST",
      headers: {
        "x-agora-operator-token": "operator-secret",
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    data: {
      scanned: 17,
      delivered: 3,
      failed: 1,
      pending: 2,
    },
  });
});
