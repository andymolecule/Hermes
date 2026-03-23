import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  listOfficialScorerImages,
  resolveOciImageToDigest,
} from "../packages/common/dist/index.js";

const images = Array.from(new Set(listOfficialScorerImages()));

if (images.length === 0) {
  throw new Error(
    "No official scorer images configured. Next step: define an official scorer catalog entry before running release verification.",
  );
}

function assertDockerAvailable() {
  const docker = spawnSync("docker", ["info"], {
    encoding: "utf8",
  });
  if (docker.status !== 0) {
    throw new Error(
      `Docker is required for official scorer verification. Next step: install/start Docker and retry. ${docker.stderr || docker.stdout || "docker info failed"}`,
    );
  }
}

function pullOfficialImageAnonymously(image) {
  const tempDockerConfig = mkdtempSync(
    path.join(os.tmpdir(), "agora-scorer-verify-"),
  );
  try {
    const pull = spawnSync("docker", ["pull", image], {
      encoding: "utf8",
      env: {
        ...process.env,
        DOCKER_CONFIG: tempDockerConfig,
      },
    });
    if (pull.status !== 0) {
      throw new Error(pull.stderr || pull.stdout || "docker pull failed");
    }
  } finally {
    rmSync(tempDockerConfig, {
      recursive: true,
      force: true,
    });
  }
}

assertDockerAvailable();

const failures = [];
const resolved = [];

for (const image of images) {
  try {
    const digest = await resolveOciImageToDigest(image, { env: {} });
    pullOfficialImageAnonymously(image);
    resolved.push({ image, digest });
  } catch (error) {
    failures.push({
      image,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

if (failures.length > 0) {
  console.error("[official-scorers] verification failed:");
  for (const failure of failures) {
    console.error(`- ${failure.image}: ${failure.error}`);
  }
  process.exit(1);
}

for (const row of resolved) {
  console.log(
    `[official-scorers] ${row.image} -> ${row.digest} (anonymous docker pull ok)`,
  );
}
