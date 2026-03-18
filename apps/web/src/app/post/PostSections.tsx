"use client";

import type {
  CompilationResultOutput,
  PostingReviewSummaryOutput,
} from "@agora/common";
import {
  Check,
  ChevronRight,
  Loader2,
  Pencil,
  Shield,
  Sparkles,
  TerminalSquare,
  Wallet,
} from "lucide-react";
import type { ReactNode } from "react";
import { formatUsdc } from "../../lib/format";
import type { PostingFundingState } from "./post-funding";
import { cx } from "./post-ui";

export type PostStep = 1 | 2 | 3;
type PostingMode = "managed" | "expert";

const STEP_LABELS: Record<PostStep, string> = {
  1: "Describe",
  2: "Review",
  3: "Publish",
};

function formatRuntimeLabel(value: string) {
  return value
    .split("_")
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

function DeadlineRefreshNotice({
  message,
  onRefresh,
}: {
  message: string;
  onRefresh: () => void;
}) {
  return (
    <PostNotice tone="warning">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="max-w-2xl">{message}</div>
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex items-center gap-2 rounded-[2px] border border-amber-400 bg-white px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-wider text-amber-900 transition hover:border-warm-900 hover:text-warm-900 motion-reduce:transition-none"
        >
          Refresh contract
        </button>
      </div>
    </PostNotice>
  );
}

export function PostNotice({
  tone,
  children,
}: {
  tone: "info" | "success" | "error" | "warning";
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        "rounded-[2px] border px-4 py-3 text-sm",
        tone === "info" && "border-accent-200 bg-accent-50 text-accent-700",
        tone === "success" &&
          "border-emerald-300 bg-emerald-50 text-emerald-800",
        tone === "error" && "border-red-300 bg-red-50 text-red-800",
        tone === "warning" && "border-amber-300 bg-amber-50 text-amber-900",
      )}
    >
      {children}
    </div>
  );
}

export function PostStepIndicator({ step }: { step: PostStep }) {
  return (
    <nav aria-label="Posting progress" className="flex items-center gap-1">
      {([1, 2, 3] as PostStep[]).map((currentStep, index) => (
        <div key={currentStep} className="flex items-center gap-1">
          {index > 0 ? (
            <ChevronRight className="h-3 w-3 text-warm-400" />
          ) : null}
          <div
            aria-current={currentStep === step ? "step" : undefined}
            className={cx(
              "flex items-center gap-1.5 rounded-[2px] px-3 py-1.5 font-mono text-xs font-bold uppercase tracking-wider",
              currentStep === step
                ? "border-2 border-warm-900 bg-warm-900 text-white shadow-[2px_2px_0px_var(--color-warm-900)]"
                : currentStep < step
                  ? "border border-warm-300 bg-white text-warm-900"
                  : "border border-warm-200 bg-warm-50 text-warm-400",
            )}
          >
            {currentStep < step ? <Check className="h-3 w-3" /> : null}
            {STEP_LABELS[currentStep]}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function PostingModeSection({
  expertMode,
  onSetPostingMode,
}: {
  expertMode: boolean;
  onSetPostingMode: (nextMode: PostingMode) => void;
}) {
  return (
    <section className="rounded-[2px] border border-warm-300 bg-white px-4 py-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-warm-500">
            Posting mode
          </div>
          <p className="mt-1 max-w-xl text-sm leading-6 text-warm-600">
            Managed mode covers supported runtimes. Expert Mode keeps the
            CLI-first path visible for poster-authored specs, custom scorer
            images, and advanced runtime setups.
          </p>
        </div>
        <div className="inline-flex rounded-[2px] border border-warm-300 bg-warm-50 p-1">
          <button
            type="button"
            onClick={() => onSetPostingMode("managed")}
            className={cx(
              "rounded-[2px] px-4 py-2 font-mono text-xs font-semibold uppercase tracking-wider transition motion-reduce:transition-none",
              !expertMode
                ? "bg-warm-900 text-white shadow-[2px_2px_0px_var(--color-warm-900)]"
                : "text-warm-700 hover:text-warm-900",
            )}
          >
            Managed
          </button>
          <button
            type="button"
            onClick={() => onSetPostingMode("expert")}
            className={cx(
              "rounded-[2px] px-4 py-2 font-mono text-xs font-semibold uppercase tracking-wider transition motion-reduce:transition-none",
              expertMode
                ? "bg-warm-900 text-white shadow-[2px_2px_0px_var(--color-warm-900)]"
                : "text-warm-700 hover:text-warm-900",
            )}
          >
            Expert Mode
          </button>
        </div>
      </div>
    </section>
  );
}

export function ExpertModePanel() {
  return (
    <section className="space-y-4">
      <div className="rounded-[2px] border-2 border-warm-900 bg-white p-5 shadow-[4px_4px_0px_var(--color-warm-900)]">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[2px] bg-warm-900 text-white">
            <TerminalSquare className="h-5 w-5" />
          </div>
          <div className="space-y-3">
            <div>
              <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-warm-500">
                Expert Mode
              </div>
              <h2 className="mt-1 font-display text-2xl font-bold tracking-tight text-warm-900">
                Custom scorer paths stay CLI-first
              </h2>
            </div>
            <p className="max-w-2xl text-sm leading-6 text-warm-700">
              Use Expert Mode when the managed compiler cannot safely map your
              files, when you need a custom scorer image, or when the bounty
              depends on a runtime outside Agora&apos;s managed families.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-[2px] border border-warm-300 bg-white p-5">
          <div className="flex items-center gap-3">
            <Shield className="h-4 w-4 text-warm-700" />
            <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-warm-500">
              When to switch
            </div>
          </div>
          <div className="mt-3 space-y-3 text-sm leading-6 text-warm-700">
            <p>Custom scorer image or runtime settings.</p>
            <p>
              Managed authoring asks for operator review or cannot compile
              safely.
            </p>
            <p>
              Poster-authored specs, artifacts, or thresholds need full control.
            </p>
          </div>
        </div>

        <div className="rounded-[2px] border border-warm-300 bg-warm-50 p-5">
          <div className="flex items-center gap-3">
            <Sparkles className="h-4 w-4 text-warm-700" />
            <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-warm-500">
              CLI Path
            </div>
          </div>
          <div className="mt-3 rounded-[2px] border border-warm-300 bg-white px-4 py-3 font-mono text-[12px] text-warm-800">
            agora post ./challenge.yaml --format json
          </div>
          <p className="mt-3 text-sm leading-6 text-warm-700">
            Managed mode still covers the fastest path for supported
            reproducibility, tabular prediction, docking, and ranking
            challenges.
          </p>
        </div>
      </div>
    </section>
  );
}

export function ReviewStep({
  compilation,
  managedTitle,
  editingTitle,
  titleDraft,
  onTitleDraftChange,
  onSaveTitle,
  onBeginTitleEdit,
  isReviewQueued,
  reviewSummary,
  shouldSuggestExpertMode,
  onOpenExpertMode,
  deadlineWindowMessage,
  onRefreshCompiledDeadline,
  publicArtifacts,
  privateArtifacts,
}: {
  compilation: CompilationResultOutput;
  managedTitle: string;
  editingTitle: boolean;
  titleDraft: string;
  onTitleDraftChange: (value: string) => void;
  onSaveTitle: () => void;
  onBeginTitleEdit: () => void;
  isReviewQueued: boolean;
  reviewSummary: PostingReviewSummaryOutput | null;
  shouldSuggestExpertMode: boolean;
  onOpenExpertMode: () => void;
  deadlineWindowMessage: string | null;
  onRefreshCompiledDeadline: () => void;
  publicArtifacts: CompilationResultOutput["resolved_artifacts"];
  privateArtifacts: CompilationResultOutput["resolved_artifacts"];
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-[2px] border-2 border-warm-900 bg-white p-5 shadow-[4px_4px_0px_var(--color-warm-900)]">
        <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-warm-500">
          Challenge title
        </div>
        {editingTitle ? (
          <div className="mt-2 space-y-2">
            <div className="flex gap-2">
              <input
                value={titleDraft}
                onChange={(event) => onTitleDraftChange(event.target.value)}
                aria-label="Challenge title"
                className="min-w-0 flex-1 rounded-[2px] border border-warm-300 bg-white px-3 py-2 text-sm text-warm-900 outline-none transition focus:border-warm-900 focus:shadow-[2px_2px_0px_var(--color-warm-900)] motion-reduce:transition-none"
              />
              <button
                type="button"
                onClick={onSaveTitle}
                className="btn-primary rounded-[2px] px-4 py-2 font-mono text-xs font-semibold uppercase tracking-wider"
              >
                Save
              </button>
            </div>
            {titleDraft.trim().length === 0 ? (
              <div className="text-xs text-warm-500">
                Saving an empty value restores the suggested title from your
                problem statement.
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mt-2 flex items-center justify-between gap-3">
            <h2 className="font-display text-xl font-bold tracking-tight text-warm-900">
              {managedTitle || "Untitled"}
            </h2>
            <button
              type="button"
              onClick={onBeginTitleEdit}
              className="inline-flex shrink-0 items-center gap-1 rounded-[2px] border border-warm-300 bg-white px-2.5 py-1 text-xs font-medium text-warm-700 transition hover:border-warm-900 hover:text-warm-900 motion-reduce:transition-none"
            >
              <Pencil className="h-3 w-3" />
              Edit
            </button>
          </div>
        )}
      </div>

      {isReviewQueued && reviewSummary ? (
        <PostNotice tone="warning">
          <div className="space-y-3">
            <div className="font-semibold">
              Operator review required before publish
            </div>
            <div>{reviewSummary.summary}</div>
            {shouldSuggestExpertMode ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onOpenExpertMode}
                  className="inline-flex items-center gap-2 rounded-[2px] border border-amber-400 bg-white px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-wider text-amber-900 transition hover:border-warm-900 hover:text-warm-900 motion-reduce:transition-none"
                >
                  Open expert mode
                </button>
                <span className="text-xs text-amber-900/80">
                  This draft may need a poster-authored spec instead of the
                  managed pipeline.
                </span>
              </div>
            ) : null}
          </div>
        </PostNotice>
      ) : null}

      {deadlineWindowMessage ? (
        <DeadlineRefreshNotice
          message={deadlineWindowMessage}
          onRefresh={onRefreshCompiledDeadline}
        />
      ) : null}

      <div className="space-y-4 rounded-[2px] border border-warm-300 bg-white p-5">
        <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-warm-500">
          Contract summary
        </div>

        <div className="space-y-3 text-sm leading-6 text-warm-700">
          <p>{compilation.confirmation_contract.scoring_summary}</p>
          <p>{compilation.confirmation_contract.solver_submission}</p>
          <p>{compilation.confirmation_contract.reward_summary}</p>
          <p>{compilation.confirmation_contract.deadline_summary}</p>
          <p>{compilation.confirmation_contract.dry_run_summary}</p>
        </div>

        <div className="flex rounded-[2px] border-[2.5px] border-warm-900 bg-white shadow-[5px_5px_0px_var(--color-warm-900)]">
          <div className="flex-1 border-r-[2.5px] border-warm-900 p-4">
            <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-warm-500">
              Runtime
            </div>
            <div className="mt-1 font-display text-lg font-bold tracking-tight text-warm-900">
              {formatRuntimeLabel(compilation.runtime_family)}
            </div>
          </div>
          <div
            className={cx(
              "flex-1 p-4",
              compilation.dry_run.sample_score != null &&
                "border-r-[2.5px] border-warm-900",
            )}
          >
            <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-warm-500">
              Metric
            </div>
            <div className="mt-1 font-display text-lg font-bold tracking-tight text-warm-900">
              {compilation.metric}
            </div>
          </div>
          {compilation.dry_run.sample_score != null ? (
            <div className="flex-1 p-4">
              <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-warm-500">
                Sample
              </div>
              <div className="mt-1 font-display text-lg font-bold tracking-tight text-emerald-700">
                {compilation.dry_run.sample_score}
              </div>
            </div>
          ) : null}
        </div>

        <div className="grid gap-4 border-t border-warm-200 pt-4 sm:grid-cols-2">
          <div>
            <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-warm-500">
              Visible to solvers
            </div>
            {publicArtifacts.length === 0 ? (
              <div className="mt-1 text-sm text-warm-400">None</div>
            ) : (
              publicArtifacts.map((artifact) => (
                <div
                  key={`${artifact.role}:${artifact.uri}`}
                  className="mt-1 text-sm text-warm-700"
                >
                  {artifact.file_name ?? artifact.role}
                  <span className="ml-1 font-mono text-[10px] uppercase text-warm-400">
                    {artifact.role}
                  </span>
                </div>
              ))
            )}
          </div>
          <div>
            <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-warm-500">
              Hidden for evaluation
            </div>
            {privateArtifacts.length === 0 ? (
              <div className="mt-1 text-sm text-warm-400">None</div>
            ) : (
              privateArtifacts.map((artifact) => (
                <div
                  key={`${artifact.role}:${artifact.uri}`}
                  className="mt-1 text-sm text-warm-700"
                >
                  {artifact.file_name ?? artifact.role}
                  <span className="ml-1 font-mono text-[10px] uppercase text-warm-400">
                    {artifact.role}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {compilation.confirmation_contract.public_private_summary.length > 0 ? (
          <ul className="list-inside list-disc border-t border-warm-200 pt-4 text-sm text-warm-600">
            {compilation.confirmation_contract.public_private_summary.map(
              (line) => (
                <li key={line}>{line}</li>
              ),
            )}
          </ul>
        ) : null}

        {compilation.warnings.length > 0 ? (
          <PostNotice tone="warning">
            {compilation.warnings.join(" ")}
          </PostNotice>
        ) : null}
      </div>

      {isReviewQueued && reviewSummary?.reason_codes.length ? (
        <div className="flex flex-wrap gap-2">
          {reviewSummary.reason_codes.map((code) => (
            <span
              key={code}
              className="rounded-[2px] border border-warm-300 bg-warm-50 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-warm-600"
            >
              {code}
            </span>
          ))}
        </div>
      ) : null}

      <details className="rounded-[2px] border border-warm-300">
        <summary className="cursor-pointer px-4 py-3 font-mono text-xs font-bold uppercase tracking-wider text-warm-500">
          Raw spec preview
        </summary>
        <pre className="overflow-x-auto border-t border-warm-300 bg-warm-50 px-4 py-4 font-mono text-[11px] leading-5 text-warm-700">
          {JSON.stringify(compilation.challenge_spec, null, 2)}
        </pre>
      </details>
    </div>
  );
}

export function PublishStep({
  compilation,
  rewardInput,
  feeUsdc,
  payoutUsdc,
  isConnected,
  isWrongChain,
  wrongChainMessage,
  fundingState,
  allowanceReady,
  balanceReady,
  fundingSummary,
  deadlineWindowMessage,
  onRefreshCompiledDeadline,
}: {
  compilation: CompilationResultOutput;
  rewardInput: string;
  feeUsdc: number;
  payoutUsdc: number;
  isConnected: boolean;
  isWrongChain: boolean;
  wrongChainMessage: string;
  fundingState: PostingFundingState;
  allowanceReady: boolean;
  balanceReady: boolean;
  fundingSummary: string;
  deadlineWindowMessage: string | null;
  onRefreshCompiledDeadline: () => void;
}) {
  return (
    <div className="space-y-4">
      {deadlineWindowMessage ? (
        <DeadlineRefreshNotice
          message={deadlineWindowMessage}
          onRefresh={onRefreshCompiledDeadline}
        />
      ) : null}

      <div className="rounded-[2px] border-2 border-warm-900 bg-white p-5 shadow-[4px_4px_0px_var(--color-warm-900)]">
        <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-warm-500">
          Reward
        </div>
        <div className="mt-3 flex items-baseline gap-3">
          <span className="font-display text-[2.75rem] font-bold leading-none tracking-[-0.03em] text-warm-900">
            {formatUsdc(Number(rewardInput || 0))}
          </span>
          <span className="font-mono text-lg font-bold uppercase tracking-wider text-warm-500">
            USDC
          </span>
        </div>
        <div className="mt-3 flex gap-4 text-sm text-warm-600">
          <span>
            Protocol fee:{" "}
            <span className="font-mono text-warm-900">
              {formatUsdc(feeUsdc)}
            </span>
          </span>
          <span>
            Net payout:{" "}
            <span className="font-mono text-warm-900">
              {formatUsdc(payoutUsdc)}
            </span>
          </span>
        </div>
      </div>

      <div className="rounded-[2px] border border-warm-300 bg-white p-5">
        <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-warm-500">
          Wallet
        </div>
        {!isConnected ? (
          <p className="mt-2 text-sm text-warm-600">
            Connect your wallet to fund and publish the bounty.
          </p>
        ) : isWrongChain ? (
          <p className="mt-2 text-sm text-warm-600">{wrongChainMessage}</p>
        ) : (
          <div className="mt-2 space-y-2">
            <div className="flex items-center justify-between border-b border-warm-200 py-2 text-sm">
              <span className="text-warm-500">Method</span>
              <span className="font-mono text-warm-900">
                {fundingState.method}
              </span>
            </div>
            <div className="flex items-center justify-between border-b border-warm-200 py-2 text-sm">
              <span className="text-warm-500">Allowance</span>
              <span className="font-mono text-warm-900">
                {allowanceReady ? "Ready" : "Needed"}
              </span>
            </div>
            <div className="flex items-center justify-between py-2 text-sm">
              <span className="text-warm-500">Balance</span>
              <span className="font-mono text-warm-900">
                {balanceReady ? "Ready" : "Insufficient"}
              </span>
            </div>
            <div className="rounded-[2px] border border-warm-200 bg-warm-50 px-3 py-2 text-sm text-warm-600">
              {fundingSummary}
            </div>
          </div>
        )}
      </div>

      <div className="rounded-[2px] border border-warm-300 bg-warm-50 p-5">
        <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-warm-500">
          What goes live
        </div>
        <div className="mt-2 space-y-1 text-sm text-warm-700">
          <div>{compilation.confirmation_contract.solver_submission}</div>
          <div>{compilation.confirmation_contract.scoring_summary}</div>
        </div>
      </div>
    </div>
  );
}

export function PostingActionBar({
  step,
  isCompiling,
  compileReady,
  isReviewQueued,
  needsDeadlineRefresh,
  isConnected,
  isWrongChain,
  requiresApproval,
  isApproving,
  isPublishing,
  chainName,
  onBack,
  onCompile,
  onContinueToPublish,
  onOpenConnect,
  onOpenChain,
  onRefreshContract,
  onApprove,
  onPublish,
}: {
  step: PostStep;
  isCompiling: boolean;
  compileReady: boolean;
  isReviewQueued: boolean;
  needsDeadlineRefresh: boolean;
  isConnected: boolean;
  isWrongChain: boolean;
  requiresApproval: boolean;
  isApproving: boolean;
  isPublishing: boolean;
  chainName: string;
  onBack: () => void;
  onCompile: () => void;
  onContinueToPublish: () => void;
  onOpenConnect: () => void;
  onOpenChain: () => void;
  onRefreshContract: () => void;
  onApprove: () => void;
  onPublish: () => void;
}) {
  return (
    <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-[2px] border-2 border-warm-900 bg-white px-5 py-4 shadow-[4px_4px_0px_var(--color-warm-900)]">
      <div className="text-sm text-warm-600">
        {step === 1
          ? "Lock answers, then compile."
          : step === 2
            ? isReviewQueued
              ? "Waiting for operator review."
              : needsDeadlineRefresh
                ? "Refresh the contract before you continue."
                : "Review the contract, then continue."
            : needsDeadlineRefresh
              ? "Refresh the contract before you publish."
              : "Fund and publish your challenge."}
      </div>

      <div className="flex gap-3">
        {step > 1 ? (
          <button
            type="button"
            onClick={onBack}
            className="btn-secondary rounded-[2px] px-5 py-2.5 font-mono text-sm font-semibold uppercase tracking-wider"
          >
            Back
          </button>
        ) : null}

        {step === 1 ? (
          <button
            type="button"
            onClick={onCompile}
            disabled={isCompiling || !compileReady}
            className="btn-primary inline-flex items-center gap-2 rounded-[2px] px-5 py-2.5 font-mono text-sm font-semibold uppercase tracking-wider disabled:pointer-events-none disabled:opacity-40"
          >
            {isCompiling ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Generate contract
          </button>
        ) : null}

        {step === 2 && !isReviewQueued ? (
          needsDeadlineRefresh ? (
            <button
              type="button"
              onClick={onRefreshContract}
              className="btn-primary rounded-[2px] px-5 py-2.5 font-mono text-sm font-semibold uppercase tracking-wider"
            >
              Refresh contract
            </button>
          ) : (
            <button
              type="button"
              onClick={onContinueToPublish}
              className="btn-primary rounded-[2px] px-5 py-2.5 font-mono text-sm font-semibold uppercase tracking-wider"
            >
              Continue to publish
            </button>
          )
        ) : null}

        {step === 2 && isReviewQueued ? (
          <div className="rounded-[2px] border border-amber-300 bg-amber-50 px-4 py-2.5 font-mono text-xs font-bold uppercase tracking-wider text-amber-900">
            Awaiting review
          </div>
        ) : null}

        {step === 3 ? (
          <>
            {!isConnected ? (
              <button
                type="button"
                onClick={onOpenConnect}
                className="btn-primary inline-flex items-center gap-2 rounded-[2px] px-5 py-2.5 font-mono text-sm font-semibold uppercase tracking-wider"
              >
                <Wallet className="h-4 w-4" />
                Connect wallet
              </button>
            ) : isWrongChain ? (
              <button
                type="button"
                onClick={onOpenChain}
                className="btn-primary rounded-[2px] px-5 py-2.5 font-mono text-sm font-semibold uppercase tracking-wider"
              >
                Switch to {chainName}
              </button>
            ) : (
              <>
                {needsDeadlineRefresh ? (
                  <button
                    type="button"
                    onClick={onRefreshContract}
                    className="btn-primary inline-flex items-center gap-2 rounded-[2px] px-5 py-2.5 font-mono text-sm font-semibold uppercase tracking-wider"
                  >
                    Refresh contract
                  </button>
                ) : null}
                {requiresApproval ? (
                  <button
                    type="button"
                    onClick={onApprove}
                    disabled={isApproving}
                    className="btn-secondary inline-flex items-center gap-2 rounded-[2px] px-5 py-2.5 font-mono text-sm font-semibold uppercase tracking-wider disabled:pointer-events-none disabled:opacity-40"
                  >
                    {isApproving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    Approve USDC
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={onPublish}
                  disabled={
                    needsDeadlineRefresh || isPublishing || requiresApproval
                  }
                  className="btn-primary inline-flex items-center gap-2 rounded-[2px] px-5 py-2.5 font-mono text-sm font-semibold uppercase tracking-wider disabled:pointer-events-none disabled:opacity-40"
                >
                  {isPublishing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  Publish challenge
                </button>
              </>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
