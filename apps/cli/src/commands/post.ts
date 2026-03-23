import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { registerChallengeWithApi } from "@agora/agent-runtime";
import {
  allowance,
  approve,
  balanceOf,
  createChallenge,
  getPublicClient,
  getWalletClient,
  parseChallengeCreatedReceipt,
} from "@agora/chain";
import {
  CHALLENGE_LIMITS,
  type ChallengeSpecOutput,
  DEFAULT_CHAIN_ID,
  SUBMISSION_LIMITS,
  canonicalizeChallengeSpec,
  defaultMinimumScoreForExecution,
  loadConfig,
  validateChallengeSpec,
} from "@agora/common";
import { pinFile } from "@agora/ipfs";
import { Command } from "commander";
import { formatUnits, parseUnits } from "viem";
import yaml from "yaml";
import type { z } from "zod";
import {
  applyConfigToEnv,
  loadCliConfig,
  requireConfigValues,
} from "../lib/config-store";
import { printJson, printSuccess, printWarning } from "../lib/output";
import { createSpinner } from "../lib/spinner";
import { ensurePrivateKey } from "../lib/wallet";

const distributionMap: Record<string, number> = {
  winner_take_all: 0,
  top_3: 1,
  proportional: 2,
};

function formatZodError(error: z.ZodError) {
  return error.issues
    .map((issue: z.ZodIssue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
}

function toPinnedFileName(value: string, baseDir: string) {
  if (value.startsWith("ipfs://")) {
    return null;
  }
  if (value.startsWith("https://")) {
    try {
      const parsed = new URL(value);
      const base = path.basename(parsed.pathname).trim();
      return base.length > 0 ? base : null;
    } catch {
      return null;
    }
  }
  const resolvedPath = path.isAbsolute(value)
    ? value
    : path.resolve(baseDir, value);
  return path.basename(resolvedPath);
}

async function maybePinLocalRef(
  value: string,
  label: string,
  baseDir: string,
  cache: Map<string, { source: string; fileName: string | null }>,
) {
  if (value.startsWith("ipfs://") || value.startsWith("https://")) {
    return {
      source: value,
      fileName: toPinnedFileName(value, baseDir),
    };
  }
  const resolvedPath = path.isAbsolute(value)
    ? value
    : path.resolve(baseDir, value);
  const cached = cache.get(resolvedPath);
  if (cached) {
    return cached;
  }
  const spinner = createSpinner(`Pinning ${label} to IPFS...`);
  try {
    const cid = await pinFile(resolvedPath, path.basename(resolvedPath));
    spinner.succeed(`Pinned ${label}: ${cid}`);
    const result = {
      source: cid,
      fileName: path.basename(resolvedPath),
    };
    cache.set(resolvedPath, result);
    return result;
  } catch (error) {
    spinner.fail(`Failed to pin ${label}`);
    throw error;
  }
}

async function pinSpecFile(spec: ChallengeSpecOutput) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agora-spec-"));
  const tempPath = path.join(tempDir, "challenge.yaml");
  try {
    const content = yaml.stringify(spec);
    await fs.writeFile(tempPath, content, "utf8");
    return await pinFile(tempPath, "challenge.yaml");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function parseDeadline(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid deadline value: ${value}`);
  }
  return Math.floor(date.getTime() / 1000);
}

function decimalToWad(value: number): bigint {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid minimum_score value: ${value}`);
  }
  const raw = value.toString();
  const normalized = /e/i.test(raw)
    ? value.toFixed(18).replace(/\.?0+$/, "")
    : raw;
  const decimal = normalized === "" ? "0" : normalized;
  return parseUnits(decimal, 18);
}

function defaultMinimumScoreForSpec(spec: ChallengeSpecOutput) {
  return defaultMinimumScoreForExecution(spec.execution);
}

export function buildPostCommand() {
  const cmd = new Command("post")
    .description("Post a new challenge on-chain")
    .argument("[file]", "Path to challenge.yaml", "challenge.yaml")
    .option("--deposit <amount>", "Override reward.total")
    .option(
      "--dry-run",
      "Validate and pin, but skip on-chain transactions",
      false,
    )
    .option("--key <ref>", "Private key reference, e.g. env:AGORA_PRIVATE_KEY")
    .option("--format <format>", "table or json", "table")
    .action(
      async (
        file: string,
        opts: {
          deposit?: string;
          dryRun: boolean;
          key?: string;
          format: string;
        },
      ) => {
        const config = loadCliConfig();
        applyConfigToEnv(config);
        requireConfigValues(
          config,
          opts.dryRun
            ? ["rpc_url", "factory_address", "usdc_address", "pinata_jwt"]
            : [
                "rpc_url",
                "factory_address",
                "usdc_address",
                "pinata_jwt",
                "api_url",
              ],
        );
        ensurePrivateKey(opts.key);

        const spinner = createSpinner("Reading challenge file...");
        const raw = await fs.readFile(
          path.resolve(process.cwd(), file),
          "utf8",
        );
        spinner.succeed("Loaded challenge file");

        const parsed = yaml.parse(raw) as Record<string, unknown>;
        if (parsed.deadline instanceof Date) {
          parsed.deadline = parsed.deadline.toISOString();
        }
        if (opts.deposit) {
          const deposit = Number(opts.deposit);
          if (Number.isNaN(deposit)) {
            throw new Error(`Invalid deposit amount: ${opts.deposit}`);
          }
          parsed.reward = {
            ...(parsed.reward as Record<string, unknown>),
            total: deposit,
          };
        }
        const specBaseDir = path.dirname(path.resolve(process.cwd(), file));
        const pinnedRefs = new Map<
          string,
          { source: string; fileName: string | null }
        >();

        if (Array.isArray(parsed.artifacts)) {
          for (const [index, artifact] of parsed.artifacts.entries()) {
            if (!artifact || typeof artifact !== "object") {
              continue;
            }
            const candidate = artifact as {
              role?: string;
              uri?: unknown;
              file_name?: string;
            };
            if (typeof candidate.uri !== "string") {
              continue;
            }
            const pinned = await maybePinLocalRef(
              candidate.uri,
              candidate.role?.trim() || `artifact ${index + 1}`,
              specBaseDir,
              pinnedRefs,
            );
            candidate.uri = pinned.source;
            candidate.file_name ??= pinned.fileName ?? undefined;
          }
        }

        if (parsed.execution && typeof parsed.execution === "object") {
          const execution = parsed.execution as {
            evaluation_artifact_uri?: unknown;
          };
          if (typeof execution.evaluation_artifact_uri === "string") {
            const pinnedBundle = await maybePinLocalRef(
              execution.evaluation_artifact_uri,
              "evaluation bundle",
              specBaseDir,
              pinnedRefs,
            );
            execution.evaluation_artifact_uri = pinnedBundle.source;
          }
        }

        const chainId = config.chain_id ?? DEFAULT_CHAIN_ID;
        const validation = validateChallengeSpec(parsed, chainId);
        if (!validation.success) {
          throw new Error(
            `Invalid challenge spec:\n${formatZodError(validation.error)}`,
          );
        }
        const runtimeConfig = loadConfig();
        const spec = await canonicalizeChallengeSpec(validation.data, {
          resolveOfficialPresetDigests:
            runtimeConfig.AGORA_REQUIRE_PINNED_PRESET_DIGESTS,
        });

        if (!(spec.reward.distribution in distributionMap)) {
          throw new Error(
            `Unsupported reward distribution: ${spec.reward.distribution}`,
          );
        }

        const specSpinner = createSpinner("Pinning challenge spec...");
        const specCid = await pinSpecFile(spec);
        specSpinner.succeed(`Pinned spec: ${specCid}`);

        if (opts.dryRun) {
          const output = {
            specCid,
            rewardAmount: spec.reward.total,
            deadline: spec.deadline,
            distribution: spec.reward.distribution,
            dryRun: true,
          };
          if (opts.format === "json") {
            printJson(output);
          } else {
            printSuccess(
              "Dry run complete. No on-chain transactions were sent.",
            );
          }
          return;
        }

        const walletClient = getWalletClient();
        const walletAddress = walletClient.account?.address;
        if (!walletAddress) {
          throw new Error("Wallet client is missing an account address.");
        }

        const rewardAmount = spec.reward.total;
        const rewardUnits = parseUnits(rewardAmount.toString(), 6);

        const balanceSpinner = createSpinner("Checking USDC balance...");
        const balance = await balanceOf(walletAddress);
        balanceSpinner.succeed(`Balance: ${formatUnits(balance, 6)} USDC`);
        if (balance < rewardUnits) {
          throw new Error("Insufficient USDC balance for reward deposit.");
        }

        const allowanceSpinner = createSpinner("Checking USDC allowance...");
        const allowanceAmount = await allowance(
          walletAddress,
          config.factory_address as `0x${string}`,
        );
        allowanceSpinner.succeed(
          `Allowance: ${formatUnits(allowanceAmount, 6)} USDC`,
        );

        if (allowanceAmount < rewardUnits) {
          const approveSpinner = createSpinner("Approving USDC...");
          const approveHash = await approve(
            config.factory_address as `0x${string}`,
            rewardAmount,
          );
          const publicClient = getPublicClient();
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
          approveSpinner.succeed(`Approval confirmed: ${approveHash}`);
        }

        const createSpinnerInstance = createSpinner("Creating challenge...");
        const minimumScoreWad = decimalToWad(
          spec.minimum_score ?? defaultMinimumScoreForSpec(spec),
        );
        const txHash = await createChallenge({
          specCid,
          rewardAmount,
          deadline: parseDeadline(spec.deadline),
          disputeWindowHours:
            spec.dispute_window_hours ??
            CHALLENGE_LIMITS.defaultDisputeWindowHours,
          minimumScore: minimumScoreWad,
          distributionType: distributionMap[spec.reward.distribution] ?? 0,
          labTba: (spec.lab_tba ??
            "0x0000000000000000000000000000000000000000") as `0x${string}`,
          maxSubmissions:
            spec.max_submissions_total ?? SUBMISSION_LIMITS.maxPerChallenge,
          maxSubmissionsPerSolver:
            spec.max_submissions_per_solver ??
            SUBMISSION_LIMITS.maxPerSolverPerChallenge,
        });
        createSpinnerInstance.succeed(`Challenge tx sent: ${txHash}`);

        const publicClient = getPublicClient();
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: txHash,
        });
        const { challengeId, challengeAddress } =
          parseChallengeCreatedReceipt(receipt);
        let registeredChallengeId: string | null = null;
        let registrationWarning: string | null = null;
        try {
          const registration = await registerChallengeWithApi(
            { txHash },
            config.api_url,
          );
          registeredChallengeId = registration.challengeId;
        } catch (error) {
          registrationWarning =
            error instanceof Error
              ? error.message
              : "Challenge API confirmation may take a minute.";
        }

        const output = {
          challengeId: registeredChallengeId,
          factoryChallengeId: Number(challengeId),
          challengeAddress,
          specCid,
          rewardAmount,
          deadline: spec.deadline,
          txHash,
          registrationStatus: registeredChallengeId
            ? "confirmed"
            : "confirmation_pending",
          warning: registrationWarning,
        };

        if (opts.format === "json") {
          printJson(output);
        } else {
          printSuccess("Challenge created successfully.");
          if (output.challengeId) {
            printWarning(`Challenge UUID: ${output.challengeId}`);
          }
          printWarning(`Factory challenge id: ${output.factoryChallengeId}`);
          printWarning(`Address: ${output.challengeAddress}`);
          printWarning(`Spec CID: ${output.specCid}`);
          if (output.warning) {
            printWarning(output.warning);
          }
        }
      },
    );

  return cmd;
}
