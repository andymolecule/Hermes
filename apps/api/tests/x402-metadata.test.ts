import assert from "node:assert/strict";
import test from "node:test";
import { buildX402Metadata, matchPaidRoute } from "../src/middleware/x402.js";

test("x402 metadata reports canonical paid routes and supported alternates", () => {
  const metadata = buildX402Metadata() as {
    routes: Array<{
      id: string;
      method: string;
      path: string;
      canonicalPath: string;
      aliasPaths: string[];
    }>;
  };

  const listRoute = metadata.routes.find(
    (route) => route.id === "challenge-list",
  );
  assert.ok(listRoute);
  assert.equal(listRoute.method, "GET");
  assert.equal(listRoute.path, "/api/challenges");
  assert.equal(listRoute.canonicalPath, "/api/challenges");
  assert.deepEqual(listRoute.aliasPaths, []);

  const detailRoute = metadata.routes.find(
    (route) => route.id === "challenge-detail",
  );
  assert.ok(detailRoute);
  assert.equal(detailRoute.path, "/api/challenges/:id");
  assert.deepEqual(detailRoute.aliasPaths, [
    "/api/challenges/by-address/:address",
  ]);

  const verifyRoute = metadata.routes.find(
    (route) => route.id === "verify-write",
  );
  assert.ok(verifyRoute);
  assert.equal(verifyRoute.path, "/api/verify");
  assert.equal(verifyRoute.canonicalPath, "/api/verify");
  assert.deepEqual(verifyRoute.aliasPaths, []);
});

test("x402 matches canonical and by-address challenge routes", () => {
  assert.ok(matchPaidRoute("GET", "/api/challenges"));
  assert.ok(
    matchPaidRoute(
      "GET",
      "/api/challenges/by-address/0x0000000000000000000000000000000000000001",
    ),
  );
  assert.ok(
    matchPaidRoute(
      "GET",
      "/api/challenges/by-address/0x0000000000000000000000000000000000000001/leaderboard",
    ),
  );
});
