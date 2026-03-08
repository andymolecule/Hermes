"use client";

import { CHALLENGE_STATUS } from "@agora/common";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, FileText, FlaskConical, User } from "lucide-react";
import Link from "next/link";
import { useAccount, useSignMessage } from "wagmi";
import {
  getAuthNonce,
  getAuthSession,
  getMyPortfolio,
  logoutSiweSession,
  verifySiweSession,
} from "../../lib/api";
import { API_BASE_URL, CHAIN_ID } from "../../lib/config";
import { formatUsdc } from "../../lib/format";
import { getStatusStyle } from "../../lib/status-styles";
import type { SolverSubmission } from "../../lib/types";
import { getPortfolioAccessState } from "./portfolio-access";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatScore(score: string | null) {
  if (score === null || score === undefined) return "--";
  const num = Number(score);
  if (!Number.isFinite(num)) return score;
  return num.toFixed(4);
}

function buildSiweMessage(input: {
  address: `0x${string}`;
  chainId: number;
  nonce: string;
  domain: string;
  uri: string;
  statement?: string;
  version?: "1";
  issuedAt?: string;
}) {
  const statement = input.statement ?? "Sign in to Agora";
  const version = input.version ?? "1";
  const issuedAt = input.issuedAt ?? new Date().toISOString();

  return `${input.domain} wants you to sign in with your Ethereum account:
${input.address}

${statement}

URI: ${input.uri}
Version: ${version}
Chain ID: ${input.chainId}
Nonce: ${input.nonce}
Issued At: ${issuedAt}`;
}

function SubmissionRow({ submission }: { submission: SolverSubmission }) {
  const challenge = submission.challenges;
  const statusStyle = getStatusStyle(challenge.status);
  const claimableAmount = BigInt(submission.payout_claimable_amount ?? "0");
  const payoutAmount =
    submission.payout_amount === null ? 0 : Number(submission.payout_amount);
  const hasClaimable = claimableAmount > 0n;
  const hasEarned = Number.isFinite(payoutAmount) && payoutAmount > 0;

  return (
    <tr className="border-b last:border-b-0 border-black hover:bg-black/5 transition-colors">
      <td className="py-3 px-4 border-r border-black">
        <Link
          href={`/challenges/${challenge.id}`}
          className="font-semibold text-black text-sm hover:underline no-underline flex items-center gap-1.5"
        >
          {challenge.title}
          <ExternalLink className="w-3 h-3 opacity-40 flex-shrink-0" />
        </Link>
      </td>
      <td className="py-3 px-4 border-r border-black">
        <span className="px-2 py-1 text-[10px] font-mono font-bold uppercase tracking-wider bg-black text-white">
          {challenge.domain}
        </span>
      </td>
      <td className="py-3 px-4 border-r border-black text-right">
        <span className="font-mono text-xs font-bold tabular-nums">
          {challenge.status === CHALLENGE_STATUS.open
            ? "Hidden"
            : formatScore(submission.score)}
        </span>
      </td>
      <td className="py-3 px-4 border-r border-black">
        <span
          className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider rounded-[2px] border"
          style={{
            backgroundColor: statusStyle.bg,
            color: statusStyle.text,
            borderColor: statusStyle.borderColor,
          }}
        >
          {challenge.status}
        </span>
        {hasClaimable && (
          <span className="ml-2 px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider bg-green-100 text-green-700 border border-green-300 rounded-[2px]">
            Payout Available
          </span>
        )}
        {!hasClaimable && hasEarned && (
          <span className="ml-2 px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider bg-black/[0.06] text-black/70 border border-black/20 rounded-[2px]">
            Paid
          </span>
        )}
      </td>
      <td className="py-3 px-4 text-right border-r border-black">
        <span className="font-mono text-xs font-bold tabular-nums">
          {formatUsdc(challenge.reward_amount)} USDC
        </span>
      </td>
      <td className="py-3 px-4 text-right">
        <span className="font-mono text-xs text-black/60 tabular-nums">
          {formatDate(submission.submitted_at)}
        </span>
      </td>
    </tr>
  );
}

export function PortfolioClient() {
  const queryClient = useQueryClient();
  const { address, chainId, isConnected } = useAccount();
  const { signMessageAsync, isPending: isSigning } = useSignMessage();

  const sessionQuery = useQuery({
    queryKey: ["auth-session"],
    queryFn: getAuthSession,
  });
  const accessState = getPortfolioAccessState({
    isConnected,
    address,
    chainId,
    requiredChainId: CHAIN_ID,
    session: sessionQuery.data,
  });

  const portfolioQuery = useQuery({
    queryKey: ["my-portfolio"],
    queryFn: getMyPortfolio,
    enabled: accessState === "ready",
  });

  async function handleSignIn() {
    if (!address) return;
    const apiOrigin = new URL(API_BASE_URL, window.location.origin).origin;
    const nonce = await getAuthNonce();
    const message = buildSiweMessage({
      address: address as `0x${string}`,
      chainId: chainId ?? CHAIN_ID,
      nonce,
      domain: new URL(apiOrigin).host,
      uri: apiOrigin,
    });
    const signature = await signMessageAsync({ message });
    await verifySiweSession({
      message,
      signature,
    });
    await queryClient.invalidateQueries({ queryKey: ["auth-session"] });
    await queryClient.invalidateQueries({ queryKey: ["my-portfolio"] });
  }

  async function handleLogout() {
    await logoutSiweSession();
    await queryClient.invalidateQueries({ queryKey: ["auth-session"] });
    await queryClient.removeQueries({ queryKey: ["my-portfolio"] });
  }

  if (accessState === "connect") {
    return (
      <div className="space-y-6">
        <section className="py-6 text-center">
          <h1 className="text-[2.5rem] sm:text-[3rem] leading-none font-display font-bold text-black tracking-[-0.04em] flex items-center justify-center gap-3">
            <User className="w-8 h-8" strokeWidth={2} />
            Solver Portfolio
          </h1>
        </section>
        <div className="border border-black p-12 text-center">
          <p className="font-mono font-bold text-sm uppercase tracking-wider text-black/60">
            Connect your wallet to view your portfolio.
          </p>
        </div>
      </div>
    );
  }

  if (accessState === "switch_chain") {
    return (
      <div className="space-y-6">
        <section className="py-6 text-center">
          <h1 className="text-[2.5rem] sm:text-[3rem] leading-none font-display font-bold text-black tracking-[-0.04em] flex items-center justify-center gap-3">
            <User className="w-8 h-8" strokeWidth={2} />
            Solver Portfolio
          </h1>
          <p className="text-base text-black/60 font-medium mt-3 font-mono text-xs">
            {address}
          </p>
        </section>
        <div className="border border-black p-12 text-center">
          <p className="font-mono font-bold text-sm uppercase tracking-wider text-black/60">
            Switch to chain {CHAIN_ID} to sign in and view your portfolio.
          </p>
        </div>
      </div>
    );
  }

  if (accessState === "sign_in") {
    return (
      <div className="space-y-6">
        <section className="py-6 text-center">
          <h1 className="text-[2.5rem] sm:text-[3rem] leading-none font-display font-bold text-black tracking-[-0.04em] flex items-center justify-center gap-3">
            <User className="w-8 h-8" strokeWidth={2} />
            Solver Portfolio
          </h1>
          <p className="text-base text-black/60 font-medium mt-3 font-mono text-xs">
            {address}
          </p>
        </section>
        <div className="border border-black p-12 text-center space-y-4">
          <p className="font-mono font-bold text-sm uppercase tracking-wider text-black/60">
            Sign a SIWE message to load your private portfolio.
          </p>
          {sessionQuery.data?.authenticated && sessionQuery.data.address ? (
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 border border-black bg-white text-sm font-bold font-mono uppercase tracking-wider hover:bg-black hover:text-white transition-colors"
            >
              Clear Session
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleSignIn()}
              disabled={isSigning}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 border border-black bg-white text-sm font-bold font-mono uppercase tracking-wider hover:bg-black hover:text-white transition-colors disabled:opacity-50"
            >
              {isSigning ? "Signing..." : "Sign In"}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="py-6 text-center">
        <h1 className="text-[2.5rem] sm:text-[3rem] leading-none font-display font-bold text-black tracking-[-0.04em] flex items-center justify-center gap-3">
          <User className="w-8 h-8" strokeWidth={2} />
          Solver Portfolio
        </h1>
        <p className="text-base text-black/60 font-medium mt-3 font-mono text-xs">
          {address}
        </p>
      </section>

      {portfolioQuery.data && (
        <div className="grid grid-cols-2 gap-4 max-w-md mx-auto">
          <div className="border border-black p-4 text-center">
            <div className="flex items-center justify-center gap-2 mb-1">
              <FileText className="w-4 h-4 opacity-60" />
              <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-black/60">
                Submissions
              </span>
            </div>
            <span className="text-2xl font-display font-bold tabular-nums">
              {portfolioQuery.data.totalSubmissions}
            </span>
          </div>
          <div className="border border-black p-4 text-center">
            <div className="flex items-center justify-center gap-2 mb-1">
              <FlaskConical className="w-4 h-4 opacity-60" />
              <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-black/60">
                Challenges
              </span>
            </div>
            <span className="text-2xl font-display font-bold tabular-nums">
              {portfolioQuery.data.challengesParticipated}
            </span>
          </div>
        </div>
      )}

      {portfolioQuery.isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-14 border border-black" />
          ))}
        </div>
      ) : portfolioQuery.error ? (
        <div className="border border-black p-8 text-center font-mono font-bold text-sm uppercase tracking-wider text-black/60">
          Unable to load portfolio data.
        </div>
      ) : portfolioQuery.data &&
        portfolioQuery.data.submissions.length === 0 ? (
        <div className="border border-black p-12 text-center">
          <p className="font-mono font-bold text-sm uppercase tracking-wider text-black/60">
            No submissions yet. Browse challenges to get started.
          </p>
        </div>
      ) : portfolioQuery.data ? (
        <div className="border border-black rounded-[2px] overflow-hidden">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-[#f4f4f0]">
                <th className="text-left py-3 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-black border-r border-b border-black">
                  Challenge
                </th>
                <th className="text-left py-3 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-black border-r border-b border-black">
                  Domain
                </th>
                <th className="text-right py-3 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-black border-r border-b border-black">
                  Score
                </th>
                <th className="text-left py-3 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-black border-r border-b border-black">
                  Status
                </th>
                <th className="text-right py-3 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-black border-r border-b border-black">
                  Reward
                </th>
                <th className="text-right py-3 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-black border-b border-black">
                  Submitted
                </th>
              </tr>
            </thead>
            <tbody className="bg-white">
              {portfolioQuery.data.submissions.map((submission) => (
                <SubmissionRow
                  key={`${submission.challenge_id}-${submission.on_chain_sub_id}-${submission.solver_address}`}
                  submission={submission}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
