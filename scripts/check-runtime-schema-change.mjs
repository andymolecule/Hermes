import { execFileSync } from "node:child_process";
import fs from "node:fs";

const ACK_TOKEN = "[runtime-schema-change]";
const RUNTIME_SCHEMA_FILES = [
  "packages/db/src/schema-compatibility.ts",
  "packages/db/supabase/migrations/001_baseline.sql",
];

function runGit(args) {
  return execFileSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function tryRunGit(args) {
  try {
    return runGit(args);
  } catch {
    return null;
  }
}

function resolveDiffBase() {
  if (process.env.GITHUB_EVENT_NAME === "pull_request") {
    const baseRef = process.env.GITHUB_BASE_REF?.trim();
    if (!baseRef) {
      throw new Error(
        "GITHUB_BASE_REF is required for pull_request schema-change checks. Next step: rerun CI with the default GitHub pull_request metadata.",
      );
    }
    const remoteRef = `origin/${baseRef}`;
    const mergeBase = tryRunGit(["merge-base", "HEAD", remoteRef]);
    if (!mergeBase) {
      throw new Error(
        `Could not resolve merge-base against ${remoteRef}. Next step: ensure the CI checkout fetches the base branch history and retry.`,
      );
    }
    return mergeBase;
  }

  const payload = readEventPayload();
  const beforeSha = payload?.before;
  if (
    typeof beforeSha === "string" &&
    beforeSha.trim().length > 0 &&
    !/^0+$/.test(beforeSha.trim())
  ) {
    return beforeSha.trim();
  }

  const headParent = tryRunGit(["rev-parse", "HEAD^"]);
  return headParent;
}

function readChangedRuntimeSchemaFiles(diffBase) {
  if (!diffBase) {
    return [];
  }
  const changedFiles = runGit(["diff", "--name-only", `${diffBase}..HEAD`])
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);

  return changedFiles.filter((filePath) =>
    RUNTIME_SCHEMA_FILES.includes(filePath),
  );
}

function readEventPayload() {
  const eventPath = process.env.GITHUB_EVENT_PATH?.trim();
  if (!eventPath || !fs.existsSync(eventPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(eventPath, "utf8"));
}

function hasRuntimeSchemaAck(diffBase) {
  const commitRange = diffBase ? `${diffBase}..HEAD` : "HEAD";
  const commitMessages = runGit(["log", "--format=%B", commitRange]);
  if (commitMessages.includes(ACK_TOKEN)) {
    return true;
  }

  const payload = readEventPayload();
  const prTitle = payload?.pull_request?.title;
  return typeof prTitle === "string" && prTitle.includes(ACK_TOKEN);
}

const diffBase = resolveDiffBase();
const changedRuntimeSchemaFiles = readChangedRuntimeSchemaFiles(diffBase);

if (changedRuntimeSchemaFiles.length === 0) {
  console.log(
    "[runtime-schema-change] no runtime schema contract changes detected",
  );
  process.exit(0);
}

if (hasRuntimeSchemaAck(diffBase)) {
  console.log(
    `[runtime-schema-change] acknowledged for ${changedRuntimeSchemaFiles.join(", ")}`,
  );
  process.exit(0);
}

console.error(
  [
    "Runtime schema contract changed without an explicit acknowledgment.",
    `Changed files: ${changedRuntimeSchemaFiles.join(", ")}`,
    `Next step: add ${ACK_TOKEN} to the PR title or one of the commits in this branch, confirm the hosted reset plan (pnpm reset-bomb:testnet), and rerun CI.`,
  ].join("\n"),
);
process.exit(1);
