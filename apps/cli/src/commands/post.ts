import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  allowance,
  approve,
  balanceOf,
  createChallenge,
  getPublicClient,
  getWalletClient,
} from "@hermes/chain";
import { type ChallengeSpecOutput, challengeSpecSchema } from "@hermes/common";
import HermesFactoryAbiJson from "@hermes/common/abi/HermesFactory.json";
import { pinFile } from "@hermes/ipfs";
import { Command } from "commander";
import { formatUnits, parseEventLogs, parseUnits } from "viem";
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

const HermesFactoryAbi = HermesFactoryAbiJson as unknown as readonly unknown[];

const distributionMap: Record<string, number> = {
  winner_take_all: 0,
  top_3: 1,
  proportional: 2,
};

function getLogArg(
  args: readonly unknown[] | Record<string, unknown> | undefined,
  index: number,
  key: string,
) {
  if (!args) return undefined;
  if (Array.isArray(args)) return args[index];
  if (typeof args === "object" && args !== null && key in args) {
    return (args as Record<string, unknown>)[key];
  }
  return undefined;
}

function formatZodError(error: z.ZodError) {
  return error.issues
    .map((issue: z.ZodIssue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
}

async function maybePinDataset(value: string, label: string, baseDir: string) {
  if (value.startsWith("ipfs://") || value.startsWith("https://")) {
    return value;
  }
  const resolvedPath = path.isAbsolute(value)
    ? value
    : path.resolve(baseDir, value);
  const spinner = createSpinner(`Pinning ${label} to IPFS...`);
  try {
    const cid = await pinFile(resolvedPath, path.basename(resolvedPath));
    spinner.succeed(`Pinned ${label}: ${cid}`);
    return cid;
  } catch (error) {
    spinner.fail(`Failed to pin ${label}`);
    throw error;
  }
}

async function pinSpecFile(spec: ChallengeSpecOutput) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-spec-"));
  const tempPath = path.join(tempDir, "challenge.yaml");
  const content = yaml.stringify(spec);
  await fs.writeFile(tempPath, content, "utf8");
  return pinFile(tempPath, "challenge.yaml");
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
    .option("--key <ref>", "Private key reference, e.g. env:HERMES_PRIVATE_KEY")
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
        requireConfigValues(config, [
          "rpc_url",
          "factory_address",
          "usdc_address",
          "pinata_jwt",
        ]);
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

        if (parsed.dataset && typeof parsed.dataset === "object") {
          const dataset = parsed.dataset as { train?: string; test?: string };
          if (dataset.train) {
            dataset.train = await maybePinDataset(
              dataset.train,
              "train dataset",
              path.dirname(path.resolve(process.cwd(), file)),
            );
          }
          if (dataset.test) {
            dataset.test = await maybePinDataset(
              dataset.test,
              "test dataset",
              path.dirname(path.resolve(process.cwd(), file)),
            );
          }
        }

        const validation = challengeSpecSchema.safeParse(parsed);
        if (!validation.success) {
          throw new Error(
            `Invalid challenge spec:\n${formatZodError(validation.error)}`,
          );
        }
        const spec = validation.data;

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
        const minimumScoreWad =
          spec.minimum_score !== undefined
            ? decimalToWad(spec.minimum_score)
            : 0n;
        const txHash = await createChallenge({
          specCid,
          rewardAmount,
          deadline: parseDeadline(spec.deadline),
          disputeWindowHours: spec.dispute_window_hours ?? 48,
          maxSubmissionsPerWallet: spec.max_submissions_per_wallet ?? 3,
          minimumScore: minimumScoreWad,
          distributionType: distributionMap[spec.reward.distribution] ?? 0,
          labTba: (spec.lab_tba ??
            "0x0000000000000000000000000000000000000000") as `0x${string}`,
        });
        createSpinnerInstance.succeed(`Challenge tx sent: ${txHash}`);

        const publicClient = getPublicClient();
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: txHash,
        });
        const parsedLogs = parseEventLogs({
          abi: HermesFactoryAbi,
          logs: receipt.logs,
          strict: false,
        }) as Array<{ eventName?: string; args?: readonly unknown[] }>;

        const created = parsedLogs.find(
          (log: { eventName?: string }) => log.eventName === "ChallengeCreated",
        );
        const challengeId = getLogArg(created?.args, 0, "id");
        const challengeAddress = getLogArg(created?.args, 1, "challenge");

        const output = {
          id:
            typeof challengeId === "bigint" ? Number(challengeId) : challengeId,
          address: challengeAddress,
          specCid,
          rewardAmount,
          deadline: spec.deadline,
          txHash,
        };

        if (opts.format === "json") {
          printJson(output);
        } else {
          printSuccess("Challenge created successfully.");
          printWarning(`Challenge ID: ${output.id}`);
          printWarning(`Address: ${output.address}`);
          printWarning(`Spec CID: ${output.specCid}`);
        }
      },
    );

  return cmd;
}
