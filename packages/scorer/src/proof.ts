import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export interface ProofBundleInput {
  challengeId: string;
  submissionId: string;
  score: number;
  scorerLog: string;
  containerImageDigest: string;
  inputPaths: string[];
  outputPath: string;
}

export interface ProofBundle {
  challengeId: string;
  submissionId: string;
  score: number;
  inputHash: string;
  outputHash: string;
  containerImageDigest: string;
  scorerLog: string;
  createdAt: string;
}

async function sha256OfFile(filePath: string) {
  const content = await fs.readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

function hashJoined(values: string[]) {
  return createHash("sha256").update(values.join("|")).digest("hex");
}

export async function buildProofBundle(
  input: ProofBundleInput,
): Promise<ProofBundle> {
  const inputHashes = await Promise.all(
    input.inputPaths.map(
      async (filePath) =>
        `${path.basename(filePath)}:${await sha256OfFile(filePath)}`,
    ),
  );
  const outputHash = await sha256OfFile(input.outputPath);

  return {
    challengeId: input.challengeId,
    submissionId: input.submissionId,
    score: input.score,
    inputHash: hashJoined(inputHashes.sort()),
    outputHash,
    containerImageDigest: input.containerImageDigest,
    scorerLog: input.scorerLog,
    createdAt: new Date().toISOString(),
  };
}
