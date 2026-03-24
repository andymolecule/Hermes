import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  listOfficialScorerImages,
  resolveOciImageToDigest,
} from "../packages/common/dist/index.js";

const images = Array.from(new Set(listOfficialScorerImages()));
const REQUIRED_PLATFORMS = ["linux/amd64", "linux/arm64"];

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
  for (const platform of REQUIRED_PLATFORMS) {
    const tempDockerConfig = mkdtempSync(
      path.join(os.tmpdir(), "agora-scorer-verify-"),
    );
    try {
      const pull = spawnSync(
        "docker",
        ["pull", "--platform", platform, image],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            DOCKER_CONFIG: tempDockerConfig,
          },
        },
      );
      if (pull.status !== 0) {
        throw new Error(
          `${platform}: ${pull.stderr || pull.stdout || "docker pull failed"}`,
        );
      }
    } finally {
      rmSync(tempDockerConfig, {
        recursive: true,
        force: true,
      });
    }
  }
}

function assertMultiArchManifest(image) {
  const inspect = spawnSync(
    "docker",
    ["buildx", "imagetools", "inspect", "--raw", image],
    {
      encoding: "utf8",
    },
  );
  if (inspect.status !== 0) {
    throw new Error(
      inspect.stderr ||
        inspect.stdout ||
        "docker buildx imagetools inspect failed",
    );
  }

  let manifest;
  try {
    manifest = JSON.parse(inspect.stdout);
  } catch {
    throw new Error("image manifest output was not valid JSON");
  }

  const manifests = Array.isArray(manifest?.manifests)
    ? manifest.manifests
    : [];
  if (manifests.length === 0) {
    throw new Error("image is not published as a multi-arch manifest list");
  }

  const availablePlatforms = new Set(
    manifests
      .map((entry) => {
        const osName = entry?.platform?.os;
        const architecture = entry?.platform?.architecture;
        return typeof osName === "string" && typeof architecture === "string"
          ? `${osName}/${architecture}`
          : null;
      })
      .filter(Boolean),
  );

  for (const platform of REQUIRED_PLATFORMS) {
    if (!availablePlatforms.has(platform)) {
      throw new Error(
        `image manifest is missing required platform ${platform}`,
      );
    }
  }
}

assertDockerAvailable();

const failures = [];
const resolved = [];

for (const image of images) {
  try {
    const digest = await resolveOciImageToDigest(image, { env: {} });
    assertMultiArchManifest(image);
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
    `[official-scorers] ${row.image} -> ${row.digest} (multi-arch manifest ok; anonymous docker pull ok for linux/amd64 and linux/arm64)`,
  );
}
