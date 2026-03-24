import { getChallengeClaimablesByAddress } from "@agora/chain";
import {
  createSupabaseClient,
  listChallengePayoutsBySolver,
  listSubmissionsBySolver,
} from "@agora/db";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { requireSiweSession } from "../middleware/siwe.js";
import type { ApiEnv } from "../types.js";
import { normalizeSubmissionScore } from "./challenges-shared.js";

type PortfolioRouteDeps = {
  createSupabaseClient: typeof createSupabaseClient;
  getChallengeClaimablesByAddress: typeof getChallengeClaimablesByAddress;
  listChallengePayoutsBySolver: typeof listChallengePayoutsBySolver;
  listSubmissionsBySolver: typeof listSubmissionsBySolver;
  requireSiweSession: MiddlewareHandler<ApiEnv>;
};

type PortfolioDbClient = ReturnType<typeof createSupabaseClient>;
type SolverSubmissionRow = Awaited<
  ReturnType<typeof listSubmissionsBySolver>
>[number];
type SolverPayoutRow = {
  challenge_id: string;
  amount: string | number;
  claimed_at?: string | null;
  claim_tx_hash?: string | null;
};

function challengeContractAddress(
  submission: SolverSubmissionRow,
): `0x${string}` | undefined {
  const challengeMeta = Array.isArray(submission.challenges)
    ? submission.challenges[0]
    : submission.challenges;
  return challengeMeta?.contract_address as `0x${string}` | undefined;
}

function aggregatePayoutRowsByChallenge(payoutRows: SolverPayoutRow[]) {
  const aggregated = new Map<
    string,
    {
      challenge_id: string;
      amount: string;
      claimed_at: string | null;
      claim_tx_hash: string | null;
    }
  >();

  for (const payout of payoutRows) {
    const key = payout.challenge_id;
    const current = aggregated.get(key) ?? {
      challenge_id: key,
      amount: "0",
      claimed_at: null,
      claim_tx_hash: null,
    };
    current.amount = (
      Number(current.amount) + Number(payout.amount ?? 0)
    ).toString();
    current.claimed_at = current.claimed_at ?? payout.claimed_at ?? null;
    current.claim_tx_hash =
      current.claim_tx_hash ?? payout.claim_tx_hash ?? null;
    aggregated.set(key, current);
  }

  return aggregated;
}

const defaultDeps: PortfolioRouteDeps = {
  createSupabaseClient,
  getChallengeClaimablesByAddress,
  listChallengePayoutsBySolver,
  listSubmissionsBySolver,
  requireSiweSession,
};

export function buildPortfolioResponse(
  address: string,
  submissions: SolverSubmissionRow[],
  payoutRows: SolverPayoutRow[],
  claimableAmounts: Record<string, string>,
) {
  const challengeIds = new Set(
    submissions.map((submission) => submission.challenge_id),
  );
  const payoutsByChallenge = aggregatePayoutRowsByChallenge(payoutRows);

  return {
    data: {
      address,
      totalSubmissions: submissions.length,
      challengesParticipated: challengeIds.size,
      submissions: submissions.map((submission) => {
        const payout = payoutsByChallenge.get(submission.challenge_id);
        return {
          challenge_id: submission.challenge_id,
          on_chain_sub_id: submission.on_chain_sub_id,
          solver_address: submission.solver_address,
          score: normalizeSubmissionScore(submission.score),
          scored: submission.scored,
          submitted_at: submission.submitted_at,
          scored_at: submission.scored_at,
          payout_amount: payout?.amount ?? null,
          payout_claimable_amount:
            claimableAmounts[submission.challenge_id] ?? "0",
          payout_claimed_at: payout?.claimed_at ?? null,
          payout_claim_tx_hash: payout?.claim_tx_hash ?? null,
          challenges: submission.challenges,
        };
      }),
    },
  };
}

export function createPortfolioRouter(deps: PortfolioRouteDeps = defaultDeps) {
  const router = new Hono<ApiEnv>();

  router.get("/", deps.requireSiweSession, async (c) => {
    const address = c.get("sessionAddress").toLowerCase();
    const db = deps.createSupabaseClient(true) as PortfolioDbClient;
    const [submissions, payoutRows] = await Promise.all([
      deps.listSubmissionsBySolver(db, address, 100),
      deps.listChallengePayoutsBySolver(db, address),
    ]);
    const claimableAmounts: Record<string, string> = {};

    const challengeContracts = new Map<string, `0x${string}`>();
    for (const submission of submissions) {
      const contractAddress = challengeContractAddress(submission);
      if (contractAddress) {
        challengeContracts.set(submission.challenge_id, contractAddress);
      }
    }

    const claimableByAddress = await deps.getChallengeClaimablesByAddress(
      Array.from(new Set(challengeContracts.values())),
      address as `0x${string}`,
    );

    for (const challengeId of new Set(submissions.map((s) => s.challenge_id))) {
      const contractAddress = challengeContracts.get(challengeId);
      claimableAmounts[challengeId] = contractAddress
        ? (claimableByAddress[contractAddress.toLowerCase()] ?? 0n).toString()
        : "0";
    }

    return c.json(
      buildPortfolioResponse(
        address,
        submissions,
        payoutRows,
        claimableAmounts,
      ),
    );
  });

  return router;
}

export default createPortfolioRouter();
