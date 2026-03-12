import { getOnChainSubmission } from "@agora/chain";
import { challengeSpecSchema, resolveEvalSpec } from "@agora/common";
import { getJSON } from "@agora/ipfs";
import {
  executeScoringPipeline,
  resolveScoringSpecRuntimeConfigFromSpecCid,
  wadToScore,
} from "@agora/scorer";
import { Command } from "commander";
import { keccak256, toBytes } from "viem";
import { fetchApiJson } from "../lib/api";
import {
  applyConfigToEnv,
  loadCliConfig,
  requireConfigValues,
} from "../lib/config-store";
import { printJson, printSuccess, printWarning } from "../lib/output";
import { createSpinner } from "../lib/spinner";

type PublicSubmissionVerification = {
  challengeId: string;
  challengeAddress: string;
  challengeSpecCid: string | null;
  submissionId: string;
  onChainSubId: number;
  solverAddress: string;
  score: string | null;
  scored: boolean;
  submittedAt: string;
  scoredAt?: string | null;
  proofBundleCid: string | null;
  proofBundleHash: string | null;
  evaluationBundleCid: string | null;
  replaySubmissionCid: string | null;
  containerImageDigest: string | null;
  inputHash: string | null;
  outputHash: string | null;
  reproducible: boolean;
};

type PublicProofBundle = {
  inputHash: string;
  outputHash: string;
  containerImageDigest: string;
  replaySubmissionCid?: string | null;
};

export function buildVerifyPublicCommand() {
  const cmd = new Command("verify-public")
    .description(
      "Re-run scorer using only public API, IPFS artifacts, and on-chain data",
    )
    .argument("<challengeId>", "Challenge id")
    .requiredOption("--sub <submissionId>", "Submission UUID")
    .option("--format <format>", "table or json", "table")
    .action(
      async (challengeId: string, opts: { sub: string; format: string }) => {
        const config = loadCliConfig();
        applyConfigToEnv(config);
        requireConfigValues(config, ["api_url", "rpc_url"]);

        const verification = await fetchApiJson<{
          data: PublicSubmissionVerification;
        }>(`/api/submissions/${opts.sub}/public`);
        const payload = verification.data;

        if (payload.challengeId !== challengeId) {
          throw new Error(
            "Submission does not belong to the provided challenge.",
          );
        }
        if (!payload.scored) {
          throw new Error("Submission has not been scored yet.");
        }
        if (!payload.proofBundleCid || !payload.proofBundleHash) {
          throw new Error("Submission has no public proof bundle yet.");
        }
        if (!payload.evaluationBundleCid) {
          throw new Error(
            "Submission is missing a public evaluation bundle CID.",
          );
        }
        if (!payload.replaySubmissionCid) {
          throw new Error(
            "Submission has no public replay artifact yet. This usually means it predates public verification publishing.",
          );
        }
        if (!payload.challengeSpecCid) {
          throw new Error(
            "Submission is missing a public challenge spec CID. This usually means it predates public verification publishing.",
          );
        }

        const expectedProofHash = keccak256(
          toBytes(payload.proofBundleCid.replace("ipfs://", "")),
        );
        if (
          expectedProofHash.toLowerCase() !==
          payload.proofBundleHash.toLowerCase()
        ) {
          throw new Error(
            "Proof bundle CID hash does not match recorded proof bundle hash.",
          );
        }

        const proofSpinner = createSpinner("Loading public proof bundle...");
        const proof = await getJSON<PublicProofBundle>(payload.proofBundleCid);
        if (
          payload.containerImageDigest &&
          proof.containerImageDigest !== payload.containerImageDigest
        ) {
          throw new Error("Proof bundle container digest mismatch.");
        }
        if (payload.inputHash && proof.inputHash !== payload.inputHash) {
          throw new Error("Proof bundle input hash mismatch.");
        }
        if (payload.outputHash && proof.outputHash !== payload.outputHash) {
          throw new Error("Proof bundle output hash mismatch.");
        }
        if (
          payload.replaySubmissionCid &&
          proof.replaySubmissionCid &&
          proof.replaySubmissionCid !== payload.replaySubmissionCid
        ) {
          throw new Error("Proof bundle replay submission CID mismatch.");
        }
        proofSpinner.succeed("Public proof bundle validated");

        const chainSpinner = createSpinner("Reading on-chain submission...");
        const onChainSub = await getOnChainSubmission(
          payload.challengeAddress as `0x${string}`,
          BigInt(payload.onChainSubId),
        );
        if (!onChainSub.scored) {
          throw new Error("On-chain submission has not been scored yet.");
        }
        if (
          onChainSub.proofBundleHash.toLowerCase() !==
          payload.proofBundleHash.toLowerCase()
        ) {
          throw new Error("On-chain proof bundle hash mismatch.");
        }
        const onChainScore = wadToScore(onChainSub.score.toString());
        chainSpinner.succeed(`On-chain score: ${onChainScore}`);

        const runSpinner = createSpinner(
          "Running scorer for public verification...",
        );
        const scoringSpecConfig =
          await resolveScoringSpecRuntimeConfigFromSpecCid(
            payload.challengeSpecCid,
          );
        const challengeSpec = challengeSpecSchema.parse(
          await getJSON(payload.challengeSpecCid),
        );
        const evalPlan = resolveEvalSpec(challengeSpec);
        const run = await executeScoringPipeline({
          image: proof.containerImageDigest,
          evaluationBundle: { cid: payload.evaluationBundleCid },
          mount: evalPlan.mount,
          submission: { cid: payload.replaySubmissionCid },
          submissionContract: scoringSpecConfig.submissionContract,
          env: scoringSpecConfig.env,
          strictPull: true,
        });
        if (!run.result.ok) {
          runSpinner.fail("Public verification scorer rejected submission");
          throw new Error(
            run.result.error ??
              "Public verification scorer rejected submission.",
          );
        }
        runSpinner.succeed("Public verification scoring finished");

        const delta = Math.abs(run.result.score - onChainScore);
        const matches = delta <= 0.001;
        const output = {
          challengeId: payload.challengeId,
          submissionId: payload.submissionId,
          localScore: run.result.score,
          onChainScore,
          delta,
          match: matches,
          proofBundleCid: payload.proofBundleCid,
          replaySubmissionCid: payload.replaySubmissionCid,
          evaluationBundleCid: payload.evaluationBundleCid,
          challengeSpecCid: payload.challengeSpecCid,
          containerImageDigest: proof.containerImageDigest,
        };

        if (opts.format === "json") {
          printJson(output);
          return;
        }

        if (matches) {
          printSuccess(
            "MATCH: public verification score is within tolerance (<= 0.001)",
          );
        } else {
          printWarning(
            "MISMATCH: public verification score differs by more than 0.001",
          );
        }
        printJson(output);
      },
    );

  return cmd;
}
