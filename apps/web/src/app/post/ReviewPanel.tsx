"use client";

import type { AuthoringSessionOutput } from "@agora/common";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Filter,
  Loader2,
  Shield,
  Wallet,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { formatUsdc } from "../../lib/format";
import type { PostingFundingState } from "./post-funding";

/* ── Types ─────────────────────────────────────────────── */

interface ReviewPanelProps {
  session: AuthoringSessionOutput | null;
  isOpen: boolean;
  onClose: () => void;
  onPublish: () => void;
  onApprove: () => void;
  onConnectWallet: () => void;
  onSwitchChain: () => void;
  isPublishing: boolean;
  isApproving: boolean;
  isConnected: boolean;
  isWrongChain: boolean;
  wrongChainMessage?: string;
  fundingState: PostingFundingState;
  allowanceReady: boolean;
  balanceReady: boolean;
  requiresApproval: boolean;
  rewardInput: string;
  feeUsdc: number;
  payoutUsdc: number;
  statusMessage: string | null;
  errorMessage: string | null;
}

function daysRemaining(deadline: string): string {
  const now = new Date();
  const end = new Date(deadline);
  const diffMs = end.getTime() - now.getTime();
  if (diffMs <= 0) return "Expired";
  const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  return `${days} day${days === 1 ? "" : "s"} remaining`;
}

/* ── Field components ──────────────────────────────────── */

const DISTRIBUTION_LABELS: Record<string, string> = {
  winner_take_all: "Winner take all",
  top_3: "Top 3",
  proportional: "Proportional",
};

function StaticField({
  value,
}: {
  value: string;
}) {
  return (
    <div className="rounded-md bg-warm-50 px-3 py-2 text-sm text-warm-700">
      <span className="text-warm-800">{value}</span>
    </div>
  );
}

/* ── Main component ────────────────────────────────────── */

export function ReviewPanel({
  session,
  isOpen,
  onClose,
  onPublish,
  onApprove,
  onConnectWallet,
  onSwitchChain,
  isPublishing,
  isApproving,
  isConnected,
  isWrongChain,
  wrongChainMessage,
  fundingState,
  allowanceReady,
  balanceReady,
  requiresApproval,
  rewardInput,
  feeUsdc,
  payoutUsdc,
  statusMessage,
  errorMessage,
}: ReviewPanelProps) {
  const [showSpec, setShowSpec] = useState(false);
  const checklist = session?.checklist;
  const compilation = session?.compilation;
  const artifacts = session?.artifacts ?? [];
  const resolvedIntent = session?.resolved.intent;
  const sessionTitle =
    checklist?.title ?? resolvedIntent?.title ?? "Untitled challenge";

  /* Extract description for intent section */
  const description = resolvedIntent?.description ?? "";

  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          initial={{ x: "100%", opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: "100%", opacity: 0 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="flex h-full w-full flex-col bg-white/80 backdrop-blur-xl md:w-[420px] md:shadow-[0_20px_40px_rgba(28,28,24,0.06)]"
        >
          {/* Header */}
          <div className="flex items-center justify-between bg-warm-50/60 px-5 py-3">
            <div className="flex items-center gap-3">
              <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-warm-400">
                Session contract
              </div>
              <span className="rounded-full bg-warm-900 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-white">
                {session?.state ?? "draft"}
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-warm-400 transition hover:bg-warm-100 hover:text-warm-700 motion-reduce:transition-none"
              aria-label="Close review panel"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Scrollable fields */}
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
            {/* Bounty Title */}
            <div className="space-y-1.5">
              <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-warm-400">
                Bounty Title
              </div>
              <h2 className="font-display text-2xl font-bold text-warm-900">
                {sessionTitle}
              </h2>
            </div>

            {/* Scoring */}
            <div className="rounded-md bg-warm-50 p-4">
              <div className="mb-3 font-mono text-[10px] font-bold uppercase tracking-widest text-warm-400">
                Scoring Engine
              </div>
              <div className="space-y-2">
                {compilation?.metric ? (
                  <div className="flex justify-between text-sm">
                    <span className="text-warm-500">Metric</span>
                    <span className="font-mono text-xs font-medium text-warm-800">
                      {compilation.metric} {compilation.objective}
                    </span>
                  </div>
                ) : null}
              </div>
            </div>

            {/* Reward + Deadline side-by-side */}
            <div className="grid grid-cols-2 gap-3">
              {/* Reward Pool */}
              <div className="rounded-md bg-warm-50 p-4">
                <div className="mb-2 font-mono text-[10px] font-bold uppercase tracking-widest text-warm-400">
                  Reward Pool
                </div>
                <div className="font-mono text-2xl font-bold text-warm-900">
                  {rewardInput}
                  <span className="ml-1 text-sm font-medium text-warm-500">
                    USDC
                  </span>
                </div>
                <div className="mt-1 font-mono text-[11px] text-warm-500">
                  {formatUsdc(feeUsdc)} fee · {formatUsdc(payoutUsdc)} to
                  winners
                </div>
              </div>

              {/* Deadline */}
              <div className="rounded-md bg-warm-50 p-4">
                <div className="mb-2 font-mono text-[10px] font-bold uppercase tracking-widest text-warm-400">
                  Deadline
                </div>
                <div className="text-lg font-bold text-warm-900">
                  {compilation?.deadline
                    ? new Date(compilation.deadline).toLocaleDateString(
                        "en-US",
                        {
                          month: "short",
                          day: "numeric",
                        },
                      )
                    : "Not set"}
                </div>
                {compilation?.deadline ? (
                  <div className="mt-1 font-mono text-[11px] text-red-600">
                    {daysRemaining(compilation.deadline)}
                  </div>
                ) : null}
              </div>
            </div>

            {/* Distribution + Dispute */}
            <div className="space-y-3">
              <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-warm-400">
                Distribution
              </div>
              <StaticField
                value={
                  DISTRIBUTION_LABELS[
                    compilation?.reward?.distribution ?? "winner_take_all"
                  ] ??
                  compilation?.reward?.distribution ??
                  "winner_take_all"
                }
              />

              <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-warm-400">
                Dispute Window
              </div>
              <StaticField
                value={`${compilation?.dispute_window_hours ?? 0} hours`}
              />
            </div>

            {/* Extracted Intent */}
            {description ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Filter className="h-3.5 w-3.5 text-warm-400" />
                  <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-warm-400">
                    Extracted Intent
                  </div>
                </div>

                {description ? (
                  <div>
                    <div className="mb-1 font-mono text-[10px] font-bold uppercase tracking-widest text-warm-400">
                      Current Summary
                    </div>
                    <div className="border-l-2 border-warm-300 pl-4 text-sm leading-relaxed text-warm-700">
                      {description}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Artifacts */}
            {artifacts.length > 0 ? (
              <div className="space-y-3">
                <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-warm-400">
                  Artifacts
                </div>
                <div className="space-y-2">
                  {artifacts.map(
                    (
                      artifact: NonNullable<
                        typeof session
                      >["artifacts"][number],
                      index: number,
                    ) => (
                      <div
                        key={artifact.artifact_id ?? index}
                        className="flex items-center justify-between rounded-md bg-warm-50 px-3 py-2"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-warm-700">
                            {artifact.file_name}
                          </span>
                          {artifact.role ? (
                            <span className="font-mono text-[10px] text-warm-400">
                              {artifact.role}
                            </span>
                          ) : null}
                        </div>
                        <span className="font-mono text-[10px] text-warm-400">
                          Agora artifact
                        </span>
                      </div>
                    ),
                  )}
                </div>
              </div>
            ) : null}

            {/* Raw spec toggle */}
            <button
              type="button"
              onClick={() => setShowSpec(!showSpec)}
              className="flex items-center gap-1.5 font-mono text-[11px] text-warm-500 transition hover:text-warm-700 motion-reduce:transition-none"
            >
              <ChevronRight
                className={`h-3 w-3 transition motion-reduce:transition-none ${showSpec ? "rotate-90" : ""}`}
              />
              {showSpec ? "Hide" : "Show"} raw session contract
            </button>

            {showSpec ? (
              <pre className="max-h-64 overflow-auto rounded-md bg-warm-900 p-4 font-mono text-[11px] leading-relaxed text-warm-200">
                {JSON.stringify(
                  {
                    checklist,
                    compilation,
                    artifacts,
                  },
                  null,
                  2,
                )}
              </pre>
            ) : null}
          </div>

          {/* Footer: wallet + publish */}
          <div className="space-y-3 bg-warm-50/40 px-5 py-4">
            {/* Status / error messages */}
            {statusMessage ? (
              <div className="rounded-md bg-warm-50 px-3 py-2 text-xs text-warm-600">
                {statusMessage}
              </div>
            ) : null}
            {errorMessage ? (
              <div className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
                {errorMessage}
              </div>
            ) : null}

            {/* Wallet status */}
            {!isConnected ? (
              <button
                type="button"
                onClick={onConnectWallet}
                className="btn-secondary flex w-full items-center justify-center gap-2 rounded-md py-2.5 font-mono text-xs font-bold uppercase tracking-wider"
              >
                <Wallet className="h-4 w-4" />
                Connect Wallet
              </button>
            ) : isWrongChain ? (
              <button
                type="button"
                onClick={onSwitchChain}
                className="btn-secondary flex w-full items-center justify-center gap-2 rounded-md py-2.5 font-mono text-xs font-bold uppercase tracking-wider"
              >
                {wrongChainMessage ?? "Switch to Base Sepolia"}
              </button>
            ) : (
              <>
                {/* Funding info */}
                <div className="flex items-center gap-2 text-xs">
                  <Shield className="h-3.5 w-3.5 text-warm-400" />
                  <span className="text-warm-500">
                    {fundingState.method === "permit"
                      ? "Gasless permit supported"
                      : `Allowance: ${allowanceReady ? "ready" : "needed"}`}
                  </span>
                  {balanceReady ? (
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <span className="text-red-500">Insufficient balance</span>
                  )}
                </div>

                {/* Approve button (if needed) */}
                {requiresApproval ? (
                  <button
                    type="button"
                    onClick={onApprove}
                    disabled={isApproving || !balanceReady}
                    className="btn-secondary flex w-full items-center justify-center gap-2 rounded-md py-2.5 font-mono text-xs font-bold uppercase tracking-wider disabled:opacity-40"
                  >
                    {isApproving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    Approve USDC
                  </button>
                ) : null}

                {/* Publish button */}
                <button
                  type="button"
                  onClick={onPublish}
                  disabled={
                    isPublishing ||
                    isApproving ||
                    !balanceReady ||
                    requiresApproval
                  }
                  className="flex w-full items-center justify-center gap-2 rounded-md bg-warm-900 py-4 font-mono text-sm font-bold uppercase tracking-widest text-white transition hover:bg-warm-800 disabled:opacity-40 motion-reduce:transition-none"
                >
                  {isPublishing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  Finalize & Publish Bounty
                  {!isPublishing ? <ArrowRight className="h-4 w-4" /> : null}
                </button>

                {/* Gas estimate */}
                <div className="text-center font-mono text-[11px] text-warm-400">
                  Estimated gas cost: ~0.004 ETH
                </div>
              </>
            )}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
