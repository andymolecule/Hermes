import fs from "node:fs/promises";
import path from "node:path";
import {
  getPublicClient,
  getWalletClient,
  parseSubmittedReceipt,
  submitChallengeResult,
} from "@agora/chain";
import {
  CHALLENGE_STATUS,
  SUBMISSION_RESULT_FORMAT,
  importSubmissionSealPublicKey,
  sealSubmission,
} from "@agora/common";
import { createSupabaseClient, getChallengeById } from "@agora/db";
import { pinJSON } from "@agora/ipfs";
import { Command } from "commander";
import {
  applyConfigToEnv,
  loadCliConfig,
  requireConfigValues,
} from "../lib/config-store";
import { printJson, printSuccess, printWarning } from "../lib/output";
import { createSpinner } from "../lib/spinner";
import { ensurePrivateKey } from "../lib/wallet";

const MAX_FILE_BYTES = 100 * 1024 * 1024;

type ChallengeRecord = {
  id: string;
  contract_address: string;
  deadline: string;
  status: string;
};

async function registerSubmissionWithApi(input: {
  apiUrl: string;
  challengeId: string;
  resultCid: string;
  txHash: `0x${string}`;
  resultFormat: "sealed_submission_v2";
}) {
  const response = await fetch(
    `${input.apiUrl.replace(/\/$/, "")}/api/submissions`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        challengeId: input.challengeId,
        resultCid: input.resultCid,
        txHash: input.txHash,
        resultFormat: input.resultFormat,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Failed to register submission with API (${response.status}): ${await response.text()}`,
    );
  }
  const body = (await response.json()) as {
    ok?: boolean;
    submission?: { id: string };
    warning?: string;
  };
  if (!body.ok || !body.submission) {
    throw new Error(
      "Submission registration response was missing submission details.",
    );
  }
  return body;
}

async function createSubmissionIntentWithApi(input: {
  apiUrl: string;
  challengeId: string;
  solverAddress: `0x${string}`;
  resultCid: string;
  resultFormat: "sealed_submission_v2";
}): Promise<{ resultHash: `0x${string}` }> {
  const response = await fetch(
    `${input.apiUrl.replace(/\/$/, "")}/api/submissions/intent`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        challengeId: input.challengeId,
        solverAddress: input.solverAddress,
        resultCid: input.resultCid,
        resultFormat: input.resultFormat,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Failed to create submission intent with API (${response.status}): ${await response.text()}`,
    );
  }
  const body = (await response.json()) as {
    data?: { resultHash?: `0x${string}` };
  };
  if (!body.data?.resultHash) {
    throw new Error(
      "Submission intent response was missing the result hash. Next step: retry the submission preparation request.",
    );
  }
  return { resultHash: body.data.resultHash };
}

export function buildSubmitCommand() {
  const cmd = new Command("submit")
    .description("Submit a result file to a challenge")
    .argument("<file>", "Result file path")
    .requiredOption("--challenge <id>", "Challenge id")
    .option("--dry-run", "Pin only, skip on-chain submission", false)
    .option("--key <ref>", "Private key reference, e.g. env:AGORA_PRIVATE_KEY")
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
          `${process.env.AGORA_API_URL?.replace(/\/$/, "")}/api/submissions/public-key`,
        );
        if (!publicKeyResponse.ok) {
          throw new Error(
            `Failed to fetch submission public key: ${await publicKeyResponse.text()}`,
          );
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

        if (challenge.status !== CHALLENGE_STATUS.open) {
          throw new Error("Challenge not open.");
        }

        const deadlineMs = new Date(challenge.deadline).getTime();
        if (!Number.isNaN(deadlineMs) && deadlineMs <= Date.now()) {
          throw new Error("Deadline passed.");
        }

        const submissionIntent = await createSubmissionIntentWithApi({
          apiUrl: process.env.AGORA_API_URL as string,
          challengeId: challenge.id,
          solverAddress: walletAddress as `0x${string}`,
          resultCid,
          resultFormat: SUBMISSION_RESULT_FORMAT.sealedSubmissionV2,
        });

        const submitSpinner =
          opts.format === "json"
            ? null
            : createSpinner("Submitting on-chain...");
        const txHash = await submitChallengeResult(
          challenge.contract_address as `0x${string}`,
          submissionIntent.resultHash,
        );
        submitSpinner?.succeed(`Submission tx sent: ${txHash}`);

        const publicClient = getPublicClient();
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: txHash,
        });
        const { submissionId } = parseSubmittedReceipt(
          receipt,
          challenge.contract_address as `0x${string}`,
        );
        let registrationWarning: string | null = null;
        try {
          const registration = await registerSubmissionWithApi({
            apiUrl: process.env.AGORA_API_URL as string,
            challengeId: challenge.id,
            resultCid,
            txHash,
            resultFormat: SUBMISSION_RESULT_FORMAT.sealedSubmissionV2,
          });
          registrationWarning = registration.warning ?? null;
        } catch (error) {
          registrationWarning =
            error instanceof Error
              ? error.message
              : "Submission metadata confirmation may take a minute.";
        }
        if (registrationWarning && opts.format !== "json") {
          printWarning(registrationWarning);
        }

        const output = {
          submissionId: Number(submissionId),
          resultCid,
          txHash,
          warning: registrationWarning,
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
