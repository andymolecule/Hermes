import type { ScoreResult } from "../types/scoring.js";
import type { ProofBundle } from "../types/submission.js";

const scoreResult: ScoreResult = {
  ok: true,
  score: 0.75,
  details: { matched_rows: 3, total_rows: 4 },
  containerImageDigest: "ghcr.io/andymolecule/repro-scorer@sha256:abc123",
};

const proofBundle: ProofBundle = {
  inputHash: "input-hash",
  outputHash: "output-hash",
  containerImageDigest: "ghcr.io/andymolecule/repro-scorer@sha256:def456",
  score: 0.75,
  scorerLog: "scorer completed",
};

if (!scoreResult.ok || typeof scoreResult.details !== "object") {
  console.error("shared ScoreResult should require ok + details");
  process.exit(1);
}

if (!proofBundle.containerImageDigest.includes("@sha256:")) {
  console.error("shared ProofBundle should use containerImageDigest");
  process.exit(1);
}

console.log("scoring type validation passed");
