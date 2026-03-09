"use client";

import { CHALLENGE_STATUS, DEFAULT_IPFS_GATEWAY } from "@agora/common";
import type { ChallengeSpecOutput } from "@agora/common";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  Clock,
  Container,
  Database,
  ExternalLink,
  FileText,
  ShieldCheck,
  Target,
  Trophy,
} from "lucide-react";
import Link from "next/link";
import { ChallengeActions } from "../../../components/ChallengeActions";
import { LeaderboardTable } from "../../../components/LeaderboardTable";
import { SubmitSolution } from "../../../components/SubmitSolution";
import { TimelineStatus } from "../../../components/TimelineStatus";
import {
  getChallenge,
  getChallengeSpec,
  getPublicSubmissionVerification,
} from "../../../lib/api";
import { formatUsdc } from "../../../lib/format";
import type { SubmissionVerification } from "../../../lib/types";
import {
  canShowChallengeResults,
  getChallengeLeaderboardEntries,
  getPublicVerificationTarget,
} from "./detail-visibility";

function InfoRow({
  label,
  value,
  mono = false,
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-[var(--border-subtle)] py-4 last:border-b-0 sm:flex-row sm:items-center">
      <div className="flex items-center gap-2 w-48 shrink-0">
        {Icon && <Icon className="h-4 w-4 text-[var(--text-muted)]" strokeWidth={1.5} />}
        <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--text-muted)]">
          {label}
        </div>
      </div>
      <div
        className={`flex-1 break-all text-sm text-[var(--color-warm-900)] ${mono ? "font-mono text-xs font-bold" : "font-medium"}`}
      >
        {value}
      </div>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[var(--border-default)] bg-white p-6 sm:p-8">
      <h2 className="mb-4 flex items-center gap-2 text-xl font-display font-bold tracking-tight text-[var(--color-warm-900)]">
        <Icon className="h-5 w-5" strokeWidth={2.25} />
        {title}
      </h2>
      {children}
    </section>
  );
}

function SpecSectionSkeleton({ title }: { title: string }) {
  return (
    <section className="rounded-lg border border-[var(--border-default)] bg-white p-6 sm:p-8">
      <div className="mb-4 flex items-center gap-2">
        <div className="skeleton h-5 w-5 rounded-full" />
        <div className="skeleton h-6 w-40" />
      </div>
      <div className="space-y-3">
        <div className="skeleton h-4 w-full" />
        <div className="skeleton h-4 w-5/6" />
        <div className="skeleton h-4 w-2/3" />
      </div>
      <span className="sr-only">{title}</span>
    </section>
  );
}

function WarningCallout({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[#fff3e8] p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle
          className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-warm-900)]"
          strokeWidth={2}
        />
        <div className="space-y-1">
          <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--text-muted)]">
            {title}
          </div>
          <p className="text-sm leading-relaxed text-black/75">{message}</p>
        </div>
      </div>
    </div>
  );
}

function formatLabel(value: string) {
  return value.replace(/_/g, " ");
}

function titleCase(value: string) {
  return formatLabel(value).replace(/\b\w/g, (char) => char.toUpperCase());
}

function inferSubmissionArtifact(spec?: ChallengeSpecOutput | null) {
  const submissionFormat = spec?.evaluation?.submission_format?.trim();
  if (submissionFormat) return submissionFormat;

  switch (spec?.type) {
    case "prediction":
      return "submission.csv";
    case "reproducibility":
      return "reproduced_output";
    case "optimization":
      return "parameter_set.json";
    case "docking":
      return "ranked_predictions.csv";
    case "red_team":
      return "adversarial_cases.json";
    default:
      return "solution file";
  }
}

function formatChallengeType(value: string) {
  return titleCase(value);
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function SubmissionColumnsTable({
  expectedColumns,
  idColumn,
  labelColumn,
}: {
  expectedColumns: string[];
  idColumn?: string;
  labelColumn?: string;
}) {
  if (expectedColumns.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-[2px] border border-black/15">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-[#f4f4f0]">
          <tr>
            <th className="border-b border-black/10 px-4 py-2 text-left text-[10px] font-mono font-bold uppercase tracking-wider text-black/50">
              Column
            </th>
            <th className="border-b border-black/10 px-4 py-2 text-left text-[10px] font-mono font-bold uppercase tracking-wider text-black/50">
              Role
            </th>
          </tr>
        </thead>
        <tbody className="bg-white">
          {expectedColumns.map((column) => {
            let role = "Required";
            if (idColumn && column === idColumn) role = "Identifier";
            if (labelColumn && column === labelColumn)
              role = "Prediction target";

            return (
              <tr
                key={column}
                className="border-b last:border-b-0 border-black/10"
              >
                <td className="px-4 py-3 font-mono text-xs font-bold text-black">
                  {column}
                </td>
                <td className="px-4 py-3 text-sm font-medium text-black/70">
                  {role}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function cidHref(value: string | null | undefined) {
  if (!value) return null;
  return `${DEFAULT_IPFS_GATEWAY}${value.replace("ipfs://", "")}`;
}

function containerHref(value: string | null | undefined) {
  if (!value) return null;
  if (value.startsWith("ghcr.io/")) {
    const clean = value
      .replace(/^ghcr\.io\//, "")
      .split("@")[0]
      ?.split(":")[0];
    return clean ? `https://github.com/${clean}` : null;
  }
  return null;
}

function LinkedValue({
  href,
  value,
}: {
  href: string | null;
  value: string;
}) {
  if (!href) return <span>{value}</span>;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 underline decoration-black/20 underline-offset-4 transition-colors hover:text-[#ff2e63] hover:decoration-[#ff2e63]"
    >
      <span>{value}</span>
      <ExternalLink className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
    </a>
  );
}

function TechnicalDetailsSection({
  challenge,
}: {
  challenge: {
    dataset_train_cid?: string | null;
    dataset_test_cid?: string | null;
    eval_image?: string | null;
  };
}) {
  return (
    <section className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] p-6">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-mono font-bold uppercase tracking-wider text-[var(--color-warm-900)]">
        <Container className="w-4 h-4" strokeWidth={2} />
        Technical Specifications
      </h3>
      <div className="flex flex-col rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-default)] px-5">
        <InfoRow
          label="Dataset (train)"
          value={
            challenge.dataset_train_cid ? (
              <LinkedValue
                href={cidHref(challenge.dataset_train_cid)}
                value={challenge.dataset_train_cid}
              />
            ) : (
              "—"
            )
          }
          mono
          icon={Database}
        />
        <InfoRow
          label="Dataset (test)"
          value={
            challenge.dataset_test_cid ? (
              <LinkedValue
                href={cidHref(challenge.dataset_test_cid)}
                value={challenge.dataset_test_cid}
              />
            ) : (
              "—"
            )
          }
          mono
          icon={Database}
        />
        <InfoRow
          label="Evaluation image"
          value={
            challenge.eval_image ? (
              <LinkedValue
                href={containerHref(challenge.eval_image)}
                value={challenge.eval_image}
              />
            ) : (
              "—"
            )
          }
          mono
          icon={Container}
        />
      </div>
    </section>
  );
}

export function DetailClient({ id }: { id: string }) {
  const detailQuery = useQuery({
    queryKey: ["challenge", id],
    queryFn: () => getChallenge(id),
  });
  const specQuery = useQuery({
    queryKey: ["challenge-spec", detailQuery.data?.challenge.spec_cid],
    queryFn: () =>
      getChallengeSpec(detailQuery.data?.challenge.spec_cid as string),
    enabled: Boolean(detailQuery.data?.challenge.spec_cid),
    staleTime: 5 * 60 * 1000,
  });
  const resultsVisible = detailQuery.data
    ? canShowChallengeResults(detailQuery.data.challenge.status)
    : false;
  const leaderboardEntries = getChallengeLeaderboardEntries(detailQuery.data);
  const verificationSubmission = getPublicVerificationTarget(detailQuery.data);
  const verificationQuery = useQuery<SubmissionVerification>({
    queryKey: ["submission-verification", verificationSubmission?.id],
    queryFn: () =>
      getPublicSubmissionVerification(verificationSubmission?.id as string),
    enabled: detailQuery.data
      ? canShowChallengeResults(detailQuery.data.challenge.status) &&
      Boolean(verificationSubmission?.id) &&
      verificationSubmission?.has_public_verification === true
      : false,
    staleTime: 5 * 60 * 1000,
  });
  const technicalSpecsErrorMessage =
    detailQuery.data?.challenge.spec_cid && specQuery.isError
      ? specQuery.error instanceof Error
        ? specQuery.error.message
        : "Failed to load the challenge specification."
      : null;
  const verificationErrorMessage = verificationQuery.isError
    ? verificationQuery.error instanceof Error
      ? verificationQuery.error.message
      : "Failed to load verification artifacts."
    : null;

  if (detailQuery.isLoading) {
    return (
      <div className="space-y-4 max-w-5xl mx-auto">
        <div className="skeleton h-8 w-48" />
        <div className="skeleton h-64 border border-black" />
        <div className="skeleton h-48 border border-black" />
      </div>
    );
  }

  if (detailQuery.error || !detailQuery.data) {
    return (
      <div className="border border-black p-12 text-center max-w-5xl mx-auto font-mono text-black/60">
        <p className="font-medium text-secondary">Challenge not found.</p>
      </div>
    );
  }

  const { challenge, submissions } = detailQuery.data;
  const spec = specQuery.data;
  const submissionArtifact = inferSubmissionArtifact(spec);
  const expectedColumns = [
    ...(challenge.expected_columns ?? []),
    ...[spec?.evaluation?.id_column, spec?.evaluation?.label_column].filter(
      (value): value is string => Boolean(value),
    ),
  ].filter((value, index, array) => array.indexOf(value) === index);
  const challengeTypeLabel = formatChallengeType(challenge.challenge_type);
  const rewardDistribution = titleCase(
    challenge.distribution_type ?? "winner_take_all",
  );
  const successDefinition =
    spec?.evaluation?.success_definition ??
    "Submissions are ranked by score after the evaluation pipeline runs on the hidden test bundle.";
  const evaluationCriteria =
    spec?.evaluation?.criteria ??
    "Submit a valid solution in the expected format. Higher-ranked valid scores receive the reward distribution for this challenge.";
  const technicalSpecsLoading =
    Boolean(challenge.spec_cid) && specQuery.isLoading;
  const verification = verificationQuery.data;
  const hasPublicVerificationArtifacts = Boolean(verification?.proofBundleCid);
  const verifyCommand = hasPublicVerificationArtifacts && verification
    ? `agora verify-public ${challenge.id} --sub ${verification.submissionId}`
    : null;

  return (
    <div className="max-w-6xl mx-auto">
      {/* Back link */}
      <div className="mb-6">
        <Link
          href="/"
          className="group inline-flex items-center gap-2 rounded-lg border border-[var(--border-default)] bg-white px-4 py-2 text-sm font-bold font-mono uppercase tracking-wider text-[var(--color-warm-900)] transition-colors duration-200 hover:bg-[var(--color-warm-900)] hover:text-white hover:border-[var(--color-warm-900)]"
        >
          <ArrowLeft
            className="h-4 w-4 text-[var(--color-warm-900)] transition-colors group-hover:text-white"
            strokeWidth={2}
          />
          <span className="text-[var(--color-warm-900)] transition-colors group-hover:text-white">
            Back
          </span>
        </Link>
      </div>

      <div className="bg-plus-pattern border border-[var(--border-default)] p-4 sm:p-8 rounded-lg">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Left column: Challenge brief + Submit Solution */}
          <div className="lg:col-span-2 space-y-5">
            <section className="rounded-lg border border-[var(--border-default)] bg-white p-6 sm:p-8">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-4">
                <h1 className="text-3xl sm:text-4xl font-display font-bold text-[var(--color-warm-900)] tracking-tight leading-tight">
                  {challenge.title}
                </h1>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.5px] font-mono border border-[var(--border-default)] bg-white text-[var(--color-warm-900)] shrink-0 rounded-md">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${challenge.status === CHALLENGE_STATUS.open ? "bg-green-500" : "bg-[var(--color-warm-900)]"}`}
                  />
                  {challenge.status}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 mb-4">
                <span className="px-3 py-1.5 text-[10px] font-mono font-bold uppercase tracking-wider bg-[var(--color-warm-900)] text-white rounded-sm">
                  {challenge.domain}
                </span>
                <span className="px-3 py-1.5 text-[10px] font-mono font-bold uppercase tracking-wider border border-[var(--border-default)] text-[var(--color-warm-900)] rounded-sm">
                  {challengeTypeLabel}
                </span>
                <span className="px-3 py-1.5 text-[10px] font-mono font-bold uppercase tracking-wider border border-[var(--border-default)] bg-white text-[var(--color-warm-900)] rounded-sm">
                  {formatUsdc(challenge.reward_amount)} USDC
                </span>
              </div>

              <div className="text-lg leading-relaxed text-[var(--text-secondary)] font-medium">
                {challenge.description}
              </div>
            </section>

            {technicalSpecsLoading ? (
              <>
                <SpecSectionSkeleton title="What To Submit" />
                <SpecSectionSkeleton title="How You're Judged" />
              </>
            ) : (
              <>
                {technicalSpecsErrorMessage && (
                  <WarningCallout
                    title="Challenge Spec Unavailable"
                    message={`Detailed IPFS-backed spec data could not be loaded, so this page is showing fallback contract and database metadata. ${technicalSpecsErrorMessage}`}
                  />
                )}
                <Section title="What To Submit" icon={FileText}>
                  <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_220px]">
                    <div className="space-y-4">
                      <p className="text-sm leading-relaxed text-black/75">
                        Submit{" "}
                        <span className="font-semibold text-[var(--color-warm-900)]">
                          {submissionArtifact}
                        </span>
                        .
                        {spec?.evaluation?.submission_format && (
                          <>
                            {" "}
                            Expected format:{" "}
                            <span className="font-semibold text-[var(--color-warm-900)]">
                              {spec.evaluation.submission_format}
                            </span>
                            .
                          </>
                        )}
                      </p>
                      <p className="text-sm leading-relaxed text-black/75">
                        {evaluationCriteria}
                      </p>
                    </div>
                    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-4">
                      <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--text-muted)]">
                        Submission Artifact
                      </div>
                      <div className="mt-2 font-mono text-sm font-bold text-[var(--color-warm-900)]">
                        {submissionArtifact}
                      </div>
                    </div>
                  </div>
                  {expectedColumns.length > 0 && (
                    <div className="mt-5 space-y-3">
                      <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--text-muted)]">
                        Expected Columns
                      </div>
                      <SubmissionColumnsTable
                        expectedColumns={expectedColumns}
                        idColumn={spec?.evaluation?.id_column}
                        labelColumn={spec?.evaluation?.label_column}
                      />
                    </div>
                  )}
                </Section>

                <Section title="How You're Judged" icon={Target}>
                  <div className="space-y-5">
                    <p className="text-base leading-relaxed text-black/80">
                      {successDefinition}
                    </p>

                    <div className="space-y-4">
                      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-5 py-4">
                        <div className="mb-2 text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--text-muted)]">
                          Evaluation Notes
                        </div>
                        <p className="text-sm leading-relaxed text-black/75">
                          {spec?.evaluation?.criteria ??
                            "Final scores are produced by the configured evaluation bundle and scorer container."}
                        </p>
                        {spec?.evaluation?.tolerance && (
                          <p className="mt-3 text-sm font-medium text-black/70">
                            Comparison tolerance:{" "}
                            <span className="font-mono font-bold text-[var(--color-warm-900)]">
                              {spec.evaluation.tolerance}
                            </span>
                          </p>
                        )}
                      </div>
                      <div className="grid gap-4 sm:grid-cols-[170px_minmax(0,1fr)] sm:items-stretch">
                        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-5 py-4">
                          <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--text-muted)]">
                            Metric
                          </div>
                          <div className="mt-2 text-2xl font-display font-bold text-[var(--color-warm-900)]">
                            {challenge.eval_metric
                              ? titleCase(challenge.eval_metric)
                              : "Custom"}
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-4 py-3">
                          <div>
                            <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--text-muted)]">
                              Minimum passing score
                            </div>
                            <div className="mt-1 text-sm font-medium text-black/70">
                              Submissions below this threshold are not eligible.
                            </div>
                          </div>
                          <div className="shrink-0 rounded-md border border-[var(--color-warm-900)] bg-[var(--color-warm-900)] px-3 py-2 font-mono text-lg font-bold text-white">
                            {String(challenge.minimum_score ?? 0)}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </Section>
              </>
            )}

            {/* Submit Solution — main column, full width */}
            <SubmitSolution
              challengeId={challenge.id}
              challengeAddress={challenge.contract_address}
              challengeStatus={challenge.status}
              deadline={challenge.deadline}
              expectedColumns={challenge.expected_columns}
            />

            <TechnicalDetailsSection challenge={challenge} />

            {resultsVisible && verificationSubmission && (
              <Section title="Public Verification" icon={ShieldCheck}>
                {verificationQuery.isLoading ? (
                  <div className="space-y-3">
                    <div className="skeleton h-4 w-full" />
                    <div className="skeleton h-4 w-5/6" />
                    <div className="skeleton h-16 w-full" />
                  </div>
                ) : verificationErrorMessage ? (
                  <WarningCallout
                    title="Verification Unavailable"
                    message={`Verification artifacts could not be loaded right now. ${verificationErrorMessage}`}
                  />
                ) : verification && hasPublicVerificationArtifacts ? (
                  <div className="space-y-5">
                    <p className="text-sm leading-relaxed text-black/75">
                      Agora currently operates scoring, but this submission
                      exposes the public artifacts needed to replay the scorer
                      and check the published result independently.
                    </p>
                    <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--text-muted)]">
                      Showing artifacts for submission #
                      {verificationSubmission.on_chain_sub_id}
                    </p>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-5 py-4">
                        <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--text-muted)]">
                          Proof Bundle
                        </div>
                        <div className="mt-2 break-all font-mono text-xs font-bold text-[var(--color-warm-900)]">
                          <LinkedValue
                            href={cidHref(verification.proofBundleCid)}
                            value={verification.proofBundleCid ?? "—"}
                          />
                        </div>
                      </div>

                      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-5 py-4">
                        <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--text-muted)]">
                          Replay Submission
                        </div>
                        <div className="mt-2 break-all font-mono text-xs font-bold text-[var(--color-warm-900)]">
                          {verification.replaySubmissionCid ? (
                            <LinkedValue
                              href={cidHref(verification.replaySubmissionCid)}
                              value={verification.replaySubmissionCid}
                            />
                          ) : (
                            "Not published for this older submission."
                          )}
                        </div>
                      </div>

                      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-5 py-4">
                        <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--text-muted)]">
                          Evaluation Bundle
                        </div>
                        <div className="mt-2 break-all font-mono text-xs font-bold text-[var(--color-warm-900)]">
                          <LinkedValue
                            href={cidHref(verification.evaluationBundleCid)}
                            value={verification.evaluationBundleCid ?? "—"}
                          />
                        </div>
                      </div>

                      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-5 py-4">
                        <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--text-muted)]">
                          Scorer Image
                        </div>
                        <div className="mt-2 break-all font-mono text-xs font-bold text-[var(--color-warm-900)]">
                          <LinkedValue
                            href={containerHref(verification.containerImageDigest)}
                            value={verification.containerImageDigest ?? "—"}
                          />
                        </div>
                      </div>
                    </div>

                    {verifyCommand && (
                      <div className="rounded-lg border border-[var(--color-warm-900)] bg-[var(--color-warm-900)] p-4 text-white">
                        <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-white/60">
                          One-command replay
                        </div>
                        <pre className="mt-2 whitespace-pre-wrap break-all font-mono text-xs font-bold leading-relaxed text-white">
                          {verifyCommand}
                        </pre>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm leading-relaxed text-black/60">
                    Public replay artifacts have not been published for any
                    scored submission yet.
                  </p>
                )}
              </Section>
            )}
          </div>

          {/* Right column: incentives, timeline, actions (sticky) */}
          <div className="space-y-5 lg:sticky lg:top-6 lg:self-start">
            <section className="rounded-lg border border-[var(--border-default)] bg-white p-6">
              <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--text-muted)]">
                Incentives & Timing
              </div>
              <div className="mt-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-5 py-4">
                <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  Reward Pool
                </div>
                <div className="mt-2 text-4xl font-display font-bold tracking-tight text-[var(--color-warm-900)]">
                  {formatUsdc(challenge.reward_amount)} USDC
                </div>
              </div>
              <div className="mt-5 space-y-4">
                <div>
                  <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    Distribution
                  </div>
                  <div className="mt-1 text-sm font-medium text-[var(--color-warm-900)]">
                    {rewardDistribution}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    Deadline
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-sm font-medium text-[var(--color-warm-900)]">
                    <CalendarClock
                      className="h-4 w-4 text-[var(--text-muted)]"
                      strokeWidth={1.75}
                    />
                    {formatDateTime(challenge.deadline)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    Review Period
                  </div>
                  <div className="mt-1 text-sm font-medium text-[var(--color-warm-900)]">
                    {challenge.dispute_window_hours != null
                      ? `${challenge.dispute_window_hours} hours`
                      : "—"}
                  </div>
                </div>
              </div>
            </section>

            <TimelineStatus challenge={challenge} submissions={submissions} />

            <ChallengeActions
              challengeId={challenge.id}
              contractAddress={challenge.contract_address}
            />
          </div>
        </div>

        {/* Leaderboard — FULL WIDTH below the grid */}
        <div className="mt-6 rounded-lg border border-[var(--border-default)] p-6 bg-white">
          <h3 className="text-xl font-display font-bold mb-4 flex items-center gap-2 text-[var(--color-warm-900)] uppercase tracking-tight">
            <Trophy className="w-5 h-5" strokeWidth={2.5} />
            Leaderboard
          </h3>
          {resultsVisible ? (
            <LeaderboardTable rows={leaderboardEntries} />
          ) : (
            <p className="text-sm leading-relaxed text-[var(--text-muted)] font-medium">
              Leaderboard and verification artifacts unlock when the challenge
              enters scoring.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
