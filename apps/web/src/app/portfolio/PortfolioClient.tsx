"use client";

import { CHALLENGE_STATUS, type ChallengeStatus } from "@agora/common";
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
import { getChallengeBadgeLabel } from "../../lib/challenge-status-copy";
import { CHAIN_ID } from "../../lib/config";
import { formatDate, formatUsdc, formatWadToScore } from "../../lib/format";
import { getStatusStyle } from "../../lib/status-styles";
import type { SolverSubmission } from "../../lib/types";
import { APP_CHAIN_NAME } from "../../lib/wallet/network";
import {
  AUTH_SESSION_QUERY_KEY,
  MY_PORTFOLIO_QUERY_KEY,
  resetWalletSessionQueries,
} from "../../lib/wallet/session-state";
import { getPortfolioAccessState } from "./portfolio-access";

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
    <tr className="hover:bg-[var(--surface-container-low)] transition-colors">
      <td className="py-3 px-4">
        <Link
          href={`/challenges/${challenge.id}`}
          className="font-semibold text-[var(--text-primary)] text-sm hover:underline no-underline flex items-center gap-1.5"
        >
          {challenge.title}
          <ExternalLink className="w-3 h-3 opacity-40 flex-shrink-0" />
        </Link>
      </td>
      <td className="py-3 px-4">
        <span className="px-2 py-1 text-[10px] font-mono font-bold uppercase tracking-wider bg-[var(--primary)] text-[var(--on-primary)] rounded-full">
          {challenge.domain}
        </span>
      </td>
      <td className="py-3 px-4 text-right">
        <span className="font-mono text-xs font-bold tabular-nums">
          {challenge.status === CHALLENGE_STATUS.open
            ? "Hidden"
            : formatWadToScore(submission.score)}
        </span>
      </td>
      <td className="py-3 px-4">
        <span
          className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider rounded-full"
          style={{
            backgroundColor: statusStyle.bg,
            color: statusStyle.text,
          }}
        >
          {getChallengeBadgeLabel(challenge.status as ChallengeStatus)}
        </span>
        {hasClaimable && (
          <span className="ml-2 px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider bg-[var(--color-success-bg)] text-[var(--color-success)] rounded-full">
            Payout Available
          </span>
        )}
        {!hasClaimable && hasEarned && (
          <span className="ml-2 px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider bg-[var(--surface-container-high)] text-[var(--text-muted)] rounded-full">
            Paid
          </span>
        )}
      </td>
      <td className="py-3 px-4 text-right">
        <span className="font-mono text-xs font-bold tabular-nums">
          {formatUsdc(challenge.reward_amount)} USDC
        </span>
      </td>
      <td className="py-3 px-4 text-right">
        <span className="font-mono text-xs text-[var(--text-muted)] tabular-nums">
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
    queryKey: AUTH_SESSION_QUERY_KEY,
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
    queryKey: MY_PORTFOLIO_QUERY_KEY,
    queryFn: getMyPortfolio,
    enabled: accessState === "ready",
  });

  async function handleSignIn() {
    if (!address) return;
    const nonce = await getAuthNonce();
    const message = buildSiweMessage({
      address: address as `0x${string}`,
      chainId: chainId ?? CHAIN_ID,
      nonce,
      domain: window.location.host,
      uri: window.location.origin,
    });
    const signature = await signMessageAsync({ message });
    await verifySiweSession({
      message,
      signature,
    });
    await queryClient.invalidateQueries({ queryKey: AUTH_SESSION_QUERY_KEY });
    await queryClient.invalidateQueries({ queryKey: MY_PORTFOLIO_QUERY_KEY });
  }

  async function handleLogout() {
    await logoutSiweSession();
    await resetWalletSessionQueries(queryClient);
  }

  if (accessState === "connect") {
    return (
      <div className="space-y-6">
        <section className="py-6 text-center">
          <h1 className="text-[2.5rem] sm:text-[3rem] leading-none font-display font-bold text-[var(--text-primary)] tracking-[-0.04em] flex items-center justify-center gap-3">
            <User className="w-8 h-8" strokeWidth={2} />
            Solver Portfolio
          </h1>
        </section>
        <div className="bg-[var(--surface-container-low)] rounded-xl p-12 text-center">
          <p className="font-mono font-bold text-sm uppercase tracking-wider text-[var(--text-muted)]">
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
          <h1 className="text-[2.5rem] sm:text-[3rem] leading-none font-display font-bold text-[var(--text-primary)] tracking-[-0.04em] flex items-center justify-center gap-3">
            <User className="w-8 h-8" strokeWidth={2} />
            Solver Portfolio
          </h1>
          <p className="text-[var(--text-muted)] font-medium mt-3 font-mono text-xs">
            {address}
          </p>
        </section>
        <div className="bg-[var(--surface-container-low)] rounded-xl p-12 text-center">
          <p className="font-mono font-bold text-sm uppercase tracking-wider text-[var(--text-muted)]">
            Switch to {APP_CHAIN_NAME} (chain {CHAIN_ID}) to sign in and view
            your portfolio.
          </p>
        </div>
      </div>
    );
  }

  if (accessState === "sign_in") {
    return (
      <div className="space-y-6">
        <section className="py-6 text-center">
          <h1 className="text-[2.5rem] sm:text-[3rem] leading-none font-display font-bold text-[var(--text-primary)] tracking-[-0.04em] flex items-center justify-center gap-3">
            <User className="w-8 h-8" strokeWidth={2} />
            Solver Portfolio
          </h1>
          <p className="text-[var(--text-muted)] font-medium mt-3 font-mono text-xs">
            {address}
          </p>
        </section>
        <div className="bg-[var(--surface-container-low)] rounded-xl p-12 text-center space-y-4">
          <p className="font-mono font-bold text-sm uppercase tracking-wider text-[var(--text-muted)]">
            Sign a SIWE message to load your private portfolio.
          </p>
          {sessionQuery.data?.authenticated && sessionQuery.data.address ? (
            <button
              type="button"
              onClick={handleLogout}
              className="btn-secondary inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-bold font-mono uppercase tracking-wider"
            >
              Clear Session
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleSignIn()}
              disabled={isSigning}
              className="btn-primary inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-bold font-mono uppercase tracking-wider disabled:opacity-50"
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
        <h1 className="text-[2.5rem] sm:text-[3rem] leading-none font-display font-bold text-[var(--text-primary)] tracking-[-0.04em] flex items-center justify-center gap-3">
          <User className="w-8 h-8" strokeWidth={2} />
          Solver Portfolio
        </h1>
        <p className="text-[var(--text-muted)] font-medium mt-3 font-mono text-xs">
          {address}
        </p>
      </section>

      {portfolioQuery.data && (
        <div className="grid grid-cols-2 gap-4 max-w-md mx-auto">
          <div className="bg-[var(--surface-container-low)] rounded-lg p-4 text-center">
            <div className="flex items-center justify-center gap-2 mb-1">
              <FileText className="w-4 h-4 opacity-60" />
              <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-[var(--text-muted)]">
                Submissions
              </span>
            </div>
            <span className="text-2xl font-mono font-bold tabular-nums">
              {portfolioQuery.data.totalSubmissions}
            </span>
          </div>
          <div className="bg-[var(--surface-container-low)] rounded-lg p-4 text-center">
            <div className="flex items-center justify-center gap-2 mb-1">
              <FlaskConical className="w-4 h-4 opacity-60" />
              <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-[var(--text-muted)]">
                Challenges
              </span>
            </div>
            <span className="text-2xl font-mono font-bold tabular-nums">
              {portfolioQuery.data.challengesParticipated}
            </span>
          </div>
        </div>
      )}

      {portfolioQuery.isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-14" />
          ))}
        </div>
      ) : portfolioQuery.error ? (
        <div className="bg-[var(--surface-container-low)] rounded-xl p-8 text-center">
          <div className="font-mono font-bold text-sm uppercase tracking-wider text-[var(--text-muted)]">
            Unable to load portfolio data.
          </div>
          <button
            type="button"
            onClick={() => portfolioQuery.refetch()}
            className="btn-secondary mt-4 px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider"
          >
            Retry
          </button>
        </div>
      ) : portfolioQuery.data &&
        portfolioQuery.data.submissions.length === 0 ? (
        <div className="bg-[var(--surface-container-low)] rounded-xl p-12 text-center">
          <p className="font-mono font-bold text-sm uppercase tracking-wider text-[var(--text-muted)]">
            No submissions yet. Browse challenges to get started.
          </p>
        </div>
      ) : portfolioQuery.data ? (
        <div className="bg-[var(--surface-container-low)] rounded-lg overflow-hidden">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-[var(--surface-container-high)]">
                <th className="text-left py-3 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-[var(--text-primary)]">
                  Challenge
                </th>
                <th className="text-left py-3 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-[var(--text-primary)]">
                  Domain
                </th>
                <th className="text-right py-3 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-[var(--text-primary)]">
                  Score
                </th>
                <th className="text-left py-3 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-[var(--text-primary)]">
                  Status
                </th>
                <th className="text-right py-3 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-[var(--text-primary)]">
                  Reward
                </th>
                <th className="text-right py-3 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-[var(--text-primary)]">
                  Submitted
                </th>
              </tr>
            </thead>
            <tbody className="bg-[var(--surface-container-lowest)]">
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
