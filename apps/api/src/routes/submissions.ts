import { getOnChainSubmission, getPublicClient } from "@hermes/chain";
import HermesChallengeAbiJson from "@hermes/common/abi/HermesChallenge.json" with { type: "json" };
import {
  createSupabaseClient,
  getChallengeById,
  getProofBundleBySubmissionId,
  getSubmissionById,
  setSubmissionResultCid,
  upsertSubmission,
} from "@hermes/db";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { type Abi, parseEventLogs } from "viem";
import { z } from "zod";
import { requireWriteQuota } from "../middleware/rate-limit.js";
import { requireSiweSession } from "../middleware/siwe.js";
import type { ApiEnv } from "../types.js";

const HermesChallengeAbi = HermesChallengeAbiJson as unknown as Abi;

const createSubmissionBodySchema = z.object({
  challengeId: z.string().uuid(),
  resultCid: z.string().min(1),
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
});

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

const router = new Hono<ApiEnv>();

router.get("/:id", async (c) => {
  const submissionId = c.req.param("id");
  const db = createSupabaseClient(false);
  const submission = await getSubmissionById(db, submissionId);
  const proofBundle = await getProofBundleBySubmissionId(db, submissionId);

  return c.json({ data: { submission, proofBundle } });
});

router.post(
  "/",
  requireSiweSession,
  requireWriteQuota("/api/submissions"),
  zValidator("json", createSubmissionBodySchema),
  async (c) => {
    const { challengeId, resultCid, txHash } = c.req.valid("json");
    const sessionAddress = c.get("sessionAddress");

    const db = createSupabaseClient(true);
    const challenge = await getChallengeById(db, challengeId);

    const publicClient = getPublicClient();
    const receipt = await publicClient.getTransactionReceipt({
      hash: txHash as `0x${string}`,
    });
    if (receipt.status !== "success") {
      return c.json({ error: "Transaction failed." }, 400);
    }
    const challengeAddress = (
      challenge.contract_address as `0x${string}`
    ).toLowerCase();
    const challengeLogs = receipt.logs.filter(
      (log) => log.address.toLowerCase() === challengeAddress,
    );

    const logs = parseEventLogs({
      abi: HermesChallengeAbi,
      logs: challengeLogs,
      strict: false,
    });

    const event = logs.find(
      (log: { eventName?: string }) => log.eventName === "Submitted",
    );
    if (!event) {
      return c.json({ error: "Submitted event not found." }, 400);
    }

    const args = event.args as unknown as
      | readonly unknown[]
      | Record<string, unknown>;
    const subId = getLogArg(args, 0, "subId");
    if (subId === undefined || typeof subId !== "bigint") {
      return c.json({ error: "Invalid Submitted event payload." }, 400);
    }

    const onChain = await getOnChainSubmission(
      challenge.contract_address as `0x${string}`,
      subId,
    );
    if (onChain.solver.toLowerCase() !== sessionAddress.toLowerCase()) {
      return c.json(
        { error: "Authenticated wallet does not match submission solver." },
        403,
      );
    }

    const row = await upsertSubmission(db, {
      challenge_id: challengeId,
      on_chain_sub_id: Number(subId),
      solver_address: onChain.solver,
      result_hash: onChain.resultHash,
      result_cid: resultCid,
      proof_bundle_hash: onChain.proofBundleHash,
      score: onChain.score.toString(),
      scored: onChain.scored,
      submitted_at: new Date(Number(onChain.submittedAt) * 1000).toISOString(),
      tx_hash: txHash,
    });

    await setSubmissionResultCid(db, challengeId, Number(subId), resultCid);

    return c.json({ ok: true, submission: row });
  },
);

export default router;
