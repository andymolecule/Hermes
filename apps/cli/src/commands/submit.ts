import fs from "node:fs/promises";
import path from "node:path";
import {
  getPublicClient,
  getWalletClient,
  submitChallengeResult,
} from "@hermes/chain";
import {
  CHALLENGE_STATUS,
  SUBMISSION_RESULT_FORMAT,
  computeSubmissionResultHash,
  importSubmissionSealPublicKey,
  sealSubmission,
} from "@hermes/common";
import HermesChallengeAbiJson from "@hermes/common/abi/HermesChallenge.json";
import {
  createSupabaseClient,
  getChallengeById,
  setSubmissionResultCid,
} from "@hermes/db";
import { pinJSON } from "@hermes/ipfs";
import { Command } from "commander";
import { parseEventLogs } from "viem";
import {
  applyConfigToEnv,
  loadCliConfig,
  requireConfigValues,
} from "../lib/config-store";
import { printJson, printSuccess, printWarning } from "../lib/output";
import { createSpinner } from "../lib/spinner";
import { ensurePrivateKey } from "../lib/wallet";

const HermesChallengeAbi =
  HermesChallengeAbiJson as unknown as readonly unknown[];
const MAX_FILE_BYTES = 100 * 1024 * 1024;

type ChallengeRecord = {
  id: string;
  contract_address: string;
  deadline: string;
  status: string;
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

export function buildSubmitCommand() {
  const cmd = new Command("submit")
    .description("Submit a result file to a challenge")
    .argument("<file>", "Result file path")
    .requiredOption("--challenge <id>", "Challenge id")
    .option("--dry-run", "Pin only, skip on-chain submission", false)
    .option("--key <ref>", "Private key reference, e.g. env:HERMES_PRIVATE_KEY")
    .option("--format <format>", "table or json", "table")
    .action(
      async (
        file: string,
        opts: {
          challenge: string;
          dryRun: boolean;
          key?: string;
          format: string;
        },
      ) => {
        const config = loadCliConfig();
        applyConfigToEnv(config);
        requireConfigValues(config, [
          "rpc_url",
          "api_url",
          "factory_address",
          "usdc_address",
          "pinata_jwt",
          "supabase_url",
          "supabase_anon_key",
        ]);
        ensurePrivateKey(opts.key);

        const stat = await fs.stat(path.resolve(process.cwd(), file));
        if (stat.size > MAX_FILE_BYTES) {
          throw new Error("Result file exceeds 100MB limit.");
        }

        const pinSpinner = createSpinner("Pinning result file...");
        const sourcePath = path.resolve(process.cwd(), file);
        const sourceBytes = await fs.readFile(sourcePath);
        const publicKeyResponse = await fetch(
          `${process.env.HERMES_API_URL?.replace(/\/$/, "")}/api/submissions/public-key`,
        );
        if (!publicKeyResponse.ok) {
          throw new Error(`Failed to fetch submission public key: ${await publicKeyResponse.text()}`);
        }
        const submissionPublicKey = (await publicKeyResponse.json()) as {
          data?: { kid: string; publicKeyPem: string };
        };
        if (!submissionPublicKey.data) {
          throw new Error("Submission public key response missing data.");
        }

        const walletClient = getWalletClient();
        const walletAddress = walletClient.account?.address?.toLowerCase();
        if (!walletAddress) {
          throw new Error("Wallet client is missing an account address.");
        }

        const publicKey = await importSubmissionSealPublicKey(
          submissionPublicKey.data.publicKeyPem,
        );
        const sealedEnvelope = await sealSubmission({
          challengeId: opts.challenge,
          solverAddress: walletAddress,
          fileName: path.basename(sourcePath),
          mimeType: "application/octet-stream",
          bytes: new Uint8Array(sourceBytes),
          keyId: submissionPublicKey.data.kid,
          publicKey,
        });

        const resultCid = await pinJSON(
          `sealed-submission-${opts.challenge}`,
          sealedEnvelope,
        );
        pinSpinner.succeed(`Pinned result: ${resultCid}`);

        if (opts.dryRun) {
          const output = {
            challengeId: opts.challenge,
            resultCid,
            dryRun: true,
          };
          if (opts.format === "json") {
            printJson(output);
          } else {
            printSuccess("Dry run complete. No on-chain submission sent.");
          }
          return;
        }

        const db = createSupabaseClient();
        const challenge = (await getChallengeById(
          db,
          opts.challenge,
        )) as ChallengeRecord;

        if (challenge.status !== CHALLENGE_STATUS.active) {
          throw new Error("Challenge not active.");
        }

        const deadlineMs = new Date(challenge.deadline).getTime();
        if (!Number.isNaN(deadlineMs) && deadlineMs <= Date.now()) {
          throw new Error("Deadline passed.");
        }

        const resultHash = computeSubmissionResultHash(resultCid);

        const submitSpinner =
          opts.format === "json"
            ? null
            : createSpinner("Submitting on-chain...");
        const txHash = await submitChallengeResult(
          challenge.contract_address as `0x${string}`,
          resultHash,
        );
        submitSpinner?.succeed(`Submission tx sent: ${txHash}`);

        const publicClient = getPublicClient();
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: txHash,
        });
        const parsedLogs = parseEventLogs({
          abi: HermesChallengeAbi,
          logs: receipt.logs,
          strict: false,
        }) as Array<{ eventName?: string; args?: readonly unknown[] }>;
        const submitted = parsedLogs.find(
          (log: { eventName?: string }) => log.eventName === "Submitted",
        );
        const submissionId =
          getLogArg(submitted?.args, 0, "subId") ??
          getLogArg(submitted?.args, 0, "submissionId");
        let cidUpdateWarning: string | null = null;

        if (typeof submissionId === "bigint") {
          // Retry: the indexer may not have created the submission row yet
          let cidUpdated = false;
          for (let attempt = 0; attempt < 3 && !cidUpdated; attempt++) {
            try {
              if (attempt > 0) {
                await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
              }
              await setSubmissionResultCid(
                db,
                challenge.id,
                Number(submissionId),
                resultCid,
                SUBMISSION_RESULT_FORMAT.sealedV1,
              );
              cidUpdated = true;
            } catch {
              // submission row may not exist yet
            }
          }
          if (!cidUpdated) {
            cidUpdateWarning =
              "Failed to update result CID (indexer may not have processed the submission yet).";
            if (opts.format !== "json") {
              printWarning(
                `${cidUpdateWarning} Retry 'hm submit' in a few seconds if scoring cannot find the CID.`,
              );
            }
          }
        }

        const output = {
          submissionId:
            typeof submissionId === "bigint"
              ? Number(submissionId)
              : submissionId,
          resultCid,
          txHash,
          warning: cidUpdateWarning,
        };

        if (opts.format === "json") {
          printJson(output);
        } else {
          printSuccess("Submission recorded.");
        }
      },
    );

  return cmd;
}
