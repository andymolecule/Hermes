import {
  OFFICIAL_IMAGES,
  resolveOfficialImageToDigest,
} from "../packages/common/dist/index.js";

const images = Object.values(OFFICIAL_IMAGES);

if (images.length === 0) {
  throw new Error(
    "No official scorer images configured. Next step: define OFFICIAL_IMAGES before running release verification.",
  );
}

const failures = [];
const resolved = [];

for (const image of images) {
  try {
    const digest = await resolveOfficialImageToDigest(image);
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
  console.log(`[official-scorers] ${row.image} -> ${row.digest}`);
}
