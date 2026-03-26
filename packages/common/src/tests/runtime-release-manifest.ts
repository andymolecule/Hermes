import assert from "node:assert/strict";
import {
  runtimeReleaseManifestSchema,
  runtimeSchemaPlanSchema,
} from "../index.js";

const digest = `ghcr.io/andymolecule/agora-api@sha256:${"a".repeat(64)}`;
const otherDigest = `ghcr.io/andymolecule/agora-indexer@sha256:${"b".repeat(64)}`;
const workerDigest = `ghcr.io/andymolecule/agora-worker@sha256:${"c".repeat(64)}`;

assert.deepEqual(
  runtimeSchemaPlanSchema.parse({
    type: "bootstrap",
    baselineId: "001_baseline.sql",
    baselineSha256: "d".repeat(64),
  }),
  {
    type: "bootstrap",
    baselineId: "001_baseline.sql",
    baselineSha256: "d".repeat(64),
  },
);

assert.throws(
  () =>
    runtimeSchemaPlanSchema.parse({
      type: "bootstrap",
    }),
  /baseline/i,
  "bootstrap schema plans should require baseline metadata",
);

assert.deepEqual(
  runtimeReleaseManifestSchema.parse({
    releaseId: "rt_2026_03_26_1234567890ab",
    gitSha: "1234567890abcdef1234567890abcdef12345678",
    createdAt: "2026-03-26T10:20:30.000Z",
    schemaPlan: {
      type: "noop",
    },
    services: {
      api: { image: digest },
      indexer: { image: otherDigest },
      worker: { image: workerDigest },
    },
    healthContractVersion: "runtime-health-v1",
  }).services.api.image,
  digest,
);

assert.throws(
  () =>
    runtimeReleaseManifestSchema.parse({
      releaseId: "rt_invalid",
      gitSha: "1234567890abcdef1234567890abcdef12345678",
      createdAt: "2026-03-26T10:20:30.000Z",
      schemaPlan: {
        type: "noop",
      },
      services: {
        api: { image: "ghcr.io/andymolecule/agora-api:latest" },
        indexer: { image: otherDigest },
        worker: { image: workerDigest },
      },
      healthContractVersion: "runtime-health-v1",
    }),
  /digest/i,
  "runtime release manifests should require digest-pinned service images",
);

console.log("runtime release manifest schema validation passed");
