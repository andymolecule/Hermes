"use client";

import type { CompilationResultOutput } from "@agora/common";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Eye,
  EyeOff,
  Filter,
  Loader2,
  Shield,
  Wallet,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { formatUsdc } from "../../lib/format";
import {
  GUIDED_DISPUTE_WINDOW_OPTIONS,
  GUIDED_DISTRIBUTION_OPTIONS,
} from "./guided-prompts";
import type { PostingFundingState } from "./post-funding";

/* ── Types ─────────────────────────────────────────────── */

interface ReviewPanelProps {
  compilation: CompilationResultOutput;
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

/* ── Helpers ───────────────────────────────────────────── */

function formatRuntime(value: string) {
  return value
    .split("_")
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1))
    .join(" ");
}

function daysRemaining(deadline: string): string {
  const now = new Date();
  const end = new Date(deadline);
  const diffMs = end.getTime() - now.getTime();
  if (diffMs <= 0) return "Expired";
  const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  return `${days} day${days === 1 ? "" : "s"} remaining`;
}

function VisibilityBadge({ visibility }: { visibility: string }) {
  if (visibility === "private") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-amber-800">
        <EyeOff className="h-2.5 w-2.5" />
        Hidden
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-800">
      <Eye className="h-2.5 w-2.5" />
      Public
    </span>
  );
}

/* ── Field components ──────────────────────────────────── */

function SelectField({
  value,
  options,
  disabled,
}: {
  value: string;
  options: readonly { label: string; value: string }[];
  disabled?: boolean;
}) {
  const label = options.find((o) => o.value === value)?.label ?? value;
  return (
    <div className="rounded-md bg-warm-50 px-3 py-2 text-sm text-warm-700">
      {disabled ? label : <span className="text-warm-800">{label}</span>}
    </div>
  );
}

/* ── Main component ────────────────────────────────────── */

export function ReviewPanel({
  compilation,
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
  const spec = compilation.challenge_spec;

  /* Extract description for intent section */
  const description = spec?.description ?? "";
  const descriptionLines = description
    .split("\n")
    .map((l: string) => l.trim())
    .filter((l: string) => l.length > 0);
  const technicalObjective = descriptionLines[0] ?? "";
  const acceptanceCriteria = descriptionLines.slice(1, 4);

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
                Live Draft Preview
              </div>
              <span className="rounded-full bg-warm-900 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-white">
                Syncing
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
                {spec?.title ?? "Untitled challenge"}
              </h2>
            </div>

            {/* Scoring */}
            <div className="rounded-md bg-warm-50 p-4">
              <div className="mb-3 font-mono text-[10px] font-bold uppercase tracking-widest text-warm-400">
                Scoring Engine
              </div>
              <div className="space-y-2">
                {compilation.runtime_family ? (
                  <div className="flex justify-between text-sm">
                    <span className="text-warm-500">Runtime</span>
                    <span className="font-mono text-xs font-medium text-warm-800">
                      {formatRuntime(compilation.runtime_family)}
                    </span>
                  </div>
                ) : null}
                {compilation.metric ? (
                  <div className="flex justify-between text-sm">
                    <span className="text-warm-500">Metric</span>
                    <span className="font-mono text-xs font-medium text-warm-800">
                      {compilation.metric}
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
                  {spec?.deadline
                    ? new Date(spec.deadline).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })
                    : "Not set"}
                </div>
                {spec?.deadline ? (
                  <div className="mt-1 font-mono text-[11px] text-red-600">
                    {daysRemaining(spec.deadline)}
                  </div>
                ) : null}
              </div>
            </div>

            {/* Distribution + Dispute */}
            <div className="space-y-3">
              <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-warm-400">
                Distribution
              </div>
              <SelectField
                value={spec?.reward?.distribution ?? "winner_take_all"}
                options={GUIDED_DISTRIBUTION_OPTIONS}
                disabled
              />

              <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-warm-400">
                Dispute Window
              </div>
              <SelectField
                value={String(spec?.dispute_window_hours ?? "0")}
                options={GUIDED_DISPUTE_WINDOW_OPTIONS}
                disabled
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

                {technicalObjective ? (
                  <div>
                    <div className="mb-1 font-mono text-[10px] font-bold uppercase tracking-widest text-warm-400">
                      Technical Objective
                    </div>
                    <div className="border-l-2 border-warm-300 pl-4 text-sm leading-relaxed text-warm-700">
                      {technicalObjective}
                    </div>
                  </div>
                ) : null}

                {acceptanceCriteria.length > 0 ? (
                  <div>
                    <div className="mb-1 font-mono text-[10px] font-bold uppercase tracking-widest text-warm-400">
                      Acceptance Criteria
                    </div>
                    <div className="space-y-1">
                      {acceptanceCriteria.map(
                        (criterion: string, index: number) => (
                          <div
                            key={criterion}
                            className="flex items-start gap-2 text-sm text-warm-700"
                          >
                            <span className="font-mono text-[11px] font-bold text-warm-400">
                              {String(index + 1).padStart(2, "0")}.
                            </span>
                            <span className="leading-relaxed">{criterion}</span>
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Artifacts */}
            {spec?.artifacts && spec.artifacts.length > 0 ? (
              <div className="space-y-3">
                <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-warm-400">
                  Artifacts
                </div>
                <div className="space-y-2">
                  {spec.artifacts.map((artifact, index) => (
                    <div
                      key={artifact.uri ?? index}
                      className="flex items-center justify-between rounded-md bg-warm-50 px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-warm-700">
                          {artifact.file_name ?? artifact.role ?? "file"}
                        </span>
                        {artifact.role ? (
                          <span className="font-mono text-[10px] text-warm-400">
                            {artifact.role}
                          </span>
                        ) : null}
                      </div>
                      <VisibilityBadge
                        visibility={artifact.visibility ?? "public"}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Dry run */}
            {compilation.dry_run?.summary ? (
              <div className="rounded-md bg-emerald-50 p-4">
                <div className="mb-1 font-mono text-[10px] font-bold uppercase tracking-widest text-emerald-600">
                  Dry Run Passed
                </div>
                <div className="text-xs text-emerald-800">
                  {compilation.dry_run.summary}
                </div>
              </div>
            ) : null}

            {/* Warnings */}
            {compilation.warnings && compilation.warnings.length > 0 ? (
              <div className="rounded-md bg-amber-50 p-4">
                <div className="mb-2 font-mono text-[10px] font-bold uppercase tracking-widest text-amber-600">
                  Warnings
                </div>
                <ul className="space-y-1 text-xs text-amber-800">
                  {compilation.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
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
              {showSpec ? "Hide" : "Show"} raw spec
            </button>

            {showSpec ? (
              <pre className="max-h-64 overflow-auto rounded-md bg-warm-900 p-4 font-mono text-[11px] leading-relaxed text-warm-200">
                {JSON.stringify(spec, null, 2)}
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
