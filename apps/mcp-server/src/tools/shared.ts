import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  getOnChainSubmission,
  getPublicClient,
  submitChallengeResult,
  submitChallengeResultWithPrivateKey,
} from "@hermes/chain";
import HermesChallengeAbiJson from "@hermes/common/abi/HermesChallenge.json" with { type: "json" };
import {
  createSupabaseClient,
  getChallengeById,
  getProofBundleBySubmissionId,
  getSubmissionById,
  listSubmissionsForChallenge,
  setSubmissionResultCid,
  upsertSubmission,
} from "@hermes/db";
import { downloadToPath, pinFile } from "@hermes/ipfs";
import { runScorer } from "@hermes/scorer";
import { keccak256, parseEventLogs, toBytes } from "viem";
import type { Abi } from "viem";

const HermesChallengeAbi = HermesChallengeAbiJson as unknown as Abi;
const WAD_SCALE = 1_000_000_000_000_000_000n;

function wadToScore(wad: bigint): number {
  const whole = wad / WAD_SCALE;
  const fractional = wad % WAD_SCALE;
  return Number(`${whole}.${fractional.toString().padStart(18, "0")}`);
}

export async function listChallenges(input: {
  status?: string;
  domain?: string;
  minReward?: number;
  limit?: number;
}) {
  const db = createSupabaseClient(false);
  let query = db.from("challenges").select("*");
  if (input.status) query = query.eq("status", input.status);
  if (input.domain) query = query.eq("domain", input.domain);
  if (input.limit) query = query.limit(input.limit);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to list challenges: ${error.message}`);
  const rows = data ?? [];
  const minReward = input.minReward;
  if (minReward === undefined) {
    return rows;
  }
  return rows.filter(
    (row: { reward_amount: unknown }) => Number(row.reward_amount) >= minReward,
  );
}

export async function getChallenge(challengeId: string) {
  const db = createSupabaseClient(false);
  const challenge = await getChallengeById(db, challengeId);
  const submissions = await listSubmissionsForChallenge(db, challengeId);
  const leaderboard = submissions
    .filter((row: { score: unknown }) => row.score !== null)
    .sort((a: { score: unknown }, b: { score: unknown }) => {
      const aScore = BigInt(String(a.score ?? "0"));
      const bScore = BigInt(String(b.score ?? "0"));
      return bScore > aScore ? 1 : bScore < aScore ? -1 : 0;
    });
  return { challenge, submissions, leaderboard };
}

export async function getSubmissionStatus(submissionId: string) {
  const db = createSupabaseClient(false);
  const submission = await getSubmissionById(db, submissionId);
  const proofBundle = await getProofBundleBySubmissionId(db, submissionId);
  return { submission, proofBundle };
}

export async function submitSolution(input: {
  challengeId: string;
  filePath: string;
  privateKey?: string;
  allowRemotePrivateKey?: boolean;
}) {
  const db = createSupabaseClient(true);
  const challenge = await getChallengeById(db, input.challengeId);
  const challengeAddress = challenge.contract_address as `0x${string}`;

  const resultCid = await pinFile(input.filePath);
  const resultHash = keccak256(toBytes(resultCid.replace("ipfs://", "")));
  const normalizedPrivateKey = input.privateKey?.trim();
  if (normalizedPrivateKey && !/^0x[a-fA-F0-9]{64}$/.test(normalizedPrivateKey)) {
    throw new Error("Invalid privateKey: expected 0x-prefixed 32-byte hex.");
  }

  if (normalizedPrivateKey && !input.allowRemotePrivateKey) {
    throw new Error(
      "privateKey over MCP HTTP is disabled. Use MCP stdio mode or set HERMES_MCP_ALLOW_REMOTE_PRIVATE_KEYS=true.",
    );
  }

  const txHash = normalizedPrivateKey
    ? await submitChallengeResultWithPrivateKey(
      challengeAddress,
      resultHash,
      normalizedPrivateKey as `0x${string}`,
    )
    : await submitChallengeResult(challengeAddress, resultHash);

  const publicClient = getPublicClient();
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });
  const parsed = parseEventLogs({
    abi: HermesChallengeAbi,
    logs: receipt.logs,
    strict: false,
  });
  const submitted = parsed.find(
    (log: { eventName?: string }) => log.eventName === "Submitted",
  );
  if (!submitted) throw new Error("Submitted event not found.");
  const args = submitted.args as unknown as { subId?: bigint };
  if (args.subId === undefined)
    throw new Error("Invalid Submitted event payload.");

  const onChain = await getOnChainSubmission(challengeAddress, args.subId);
  const row = await upsertSubmission(db, {
    challenge_id: input.challengeId,
    on_chain_sub_id: Number(args.subId),
    solver_address: onChain.solver,
    result_hash: onChain.resultHash,
    result_cid: resultCid,
    proof_bundle_hash: onChain.proofBundleHash,
    score: onChain.scored ? onChain.score.toString() : null,
    scored: onChain.scored,
    submitted_at: new Date(Number(onChain.submittedAt) * 1000).toISOString(),
    tx_hash: txHash,
  });
  await setSubmissionResultCid(
    db,
    input.challengeId,
    Number(args.subId),
    resultCid,
  );

  return { txHash, resultCid, submission: row };
}

export async function verifySubmission(input: {
  challengeId: string;
  submissionId: string;
  tolerance?: number;
}) {
  const db = createSupabaseClient(true);
  const challenge = await getChallengeById(db, input.challengeId);
  const submission = await getSubmissionById(db, input.submissionId);
  const proof = await getProofBundleBySubmissionId(db, input.submissionId);
  if (!proof) throw new Error("No proof bundle found.");
  if (!challenge.dataset_test_cid)
    throw new Error("Challenge missing dataset_test_cid.");
  if (!submission.result_cid) throw new Error("Submission missing result_cid.");
  if (submission.on_chain_sub_id == null)
    throw new Error("Submission missing on_chain_sub_id.");

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-mcp-verify-"));
  try {
    const inputDir = path.join(root, "input");
    await fs.mkdir(inputDir, { recursive: true });
    await downloadToPath(
      challenge.dataset_test_cid,
      path.join(inputDir, "ground_truth.csv"),
    );
    await downloadToPath(
      submission.result_cid,
      path.join(inputDir, "submission.csv"),
    );

    const run = await runScorer({
      image: proof.container_image_hash,
      inputDir,
    });
    const onChain = await getOnChainSubmission(
      challenge.contract_address as `0x${string}`,
      BigInt(submission.on_chain_sub_id),
    );
    const onChainScore = wadToScore(onChain.score);
    const tolerance = input.tolerance ?? 0.001;
    const delta = Math.abs(run.score - onChainScore);

    return {
      match: delta <= tolerance,
      localScore: run.score,
      onChainScore,
      delta,
      tolerance,
    };
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
