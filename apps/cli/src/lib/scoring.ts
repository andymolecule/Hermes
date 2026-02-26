import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { downloadToPath } from "@hermes/ipfs";

const WAD_SCALE = 1_000_000_000_000_000_000n;

export async function createScoringWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-score-"));
  const inputDir = path.join(root, "input");
  await fs.mkdir(inputDir, { recursive: true });
  return { root, inputDir };
}

export async function stageGroundTruth(inputDir: string, datasetCid: string) {
  const destination = path.join(inputDir, "ground_truth.csv");
  await downloadToPath(datasetCid, destination);
  return destination;
}

export async function stageSubmissionFile(
  inputDir: string,
  submissionPath: string,
) {
  const destination = path.join(inputDir, "submission.csv");
  const content = await fs.readFile(submissionPath);
  await fs.writeFile(destination, content);
  return destination;
}

export async function stageSubmissionFromCid(
  inputDir: string,
  resultCid: string,
) {
  const destination = path.join(inputDir, "submission.csv");
  await downloadToPath(resultCid, destination);
  return destination;
}

export function scoreToWad(score: number): bigint {
  if (!Number.isFinite(score) || score < 0) {
    throw new Error(`Invalid score value: ${score}`);
  }
  const normalized = score.toFixed(18);
  const [whole, fractional = ""] = normalized.split(".");
  const wholePart = BigInt(whole);
  const fractionalPart = BigInt(fractional.padEnd(18, "0").slice(0, 18));
  return wholePart * WAD_SCALE + fractionalPart;
}

export function wadToScore(wad: string | number | bigint): number {
  if (typeof wad === "string" && wad.includes(".")) {
    return Number(wad);
  }
  const value = typeof wad === "bigint" ? wad : BigInt(wad);
  const whole = value / WAD_SCALE;
  const fractional = value % WAD_SCALE;
  const asString = `${whole}.${fractional.toString().padStart(18, "0")}`;
  return Number(asString);
}
