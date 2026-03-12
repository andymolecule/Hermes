"use client";

import {
  CHALLENGE_STATUS,
  type ChallengeSpecOutput,
  DEFAULT_IPFS_GATEWAY,
  deriveExpectedColumns,
  describeSubmissionArtifact,
} from "@agora/common";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  Clock,
  Container,
  Database,
  DollarSign,
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
import { getChallengeBadgeLabel } from "../../../lib/challenge-status-copy";
import { formatUsdc } from "../../../lib/format";
import { getScorerPackageUrl } from "../../../lib/scorer-links";
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
        {Icon && (
          <Icon
            className="h-4 w-4 text-[var(--text-muted)]"
            strokeWidth={1.5}
          />
        )}
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
  id,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section
      id={id}
      className="rounded-lg border border-[var(--border-default)] bg-white p-6 sm:p-8"
    >
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

function getMetricPresentation(
  challengeType: string,
  evalMetric?: string | null,
  spec?: ChallengeSpecOutput | null,
) {
  if (challengeType === "reproducibility") {
    return {
      label: "Row match score",
      helper: spec?.evaluation?.tolerance
        ? "Score = matched rows / total rows after applying the configured drift tolerance."
        : "Score = matched rows / total rows from deterministic comparison against the posted reference output.",
    };
  }

  switch (evalMetric) {
    case "rmse":
      return {
        label: "RMSE",
        helper: "Lower is better. Computed against the hidden scoring labels.",
      };
    case "mae":
      return {
        label: "MAE",
        helper: "Lower is better. Computed against the hidden scoring labels.",
      };
    case "r2":
      return {
        label: "R²",
        helper: "Higher is better. Computed against the hidden scoring labels.",
      };
    case "pearson":
      return {
        label: "Pearson correlation",
        helper: "Higher is better. Computed against the hidden scoring labels.",
      };
    case "spearman":
      return {
        label: "Spearman correlation",
        helper: "Higher is better. Computed against the hidden scoring labels.",
      };
    case "custom":
      return {
        label: "Custom scoring metric",
        helper:
          "See the official scoring rule and scorer details below for the exact evaluation logic.",
      };
    default:
      return {
        label: "Scorer-defined metric",
        helper:
          "See the official scoring rule and scorer details below for the exact evaluation logic.",
      };
  }
}

function getEligibilityThresholdPresentation(
  minimumScore?: number | string | null,
) {
  const parsed = Number(minimumScore ?? 0);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return {
      value: "No minimum threshold",
      helper:
        "Any valid scored submission can be ranked and considered for payout under the challenge's distribution rule.",
    };
  }

  return {
    value: String(minimumScore),
    helper: "Scores below this threshold are excluded from ranking and payout.",
  };
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
  valueColumn,
}: {
  expectedColumns: string[];
  idColumn?: string;
  valueColumn?: string;
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
            if (valueColumn && column === valueColumn) role = "Scored value";

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

type ScorerTransparencyInfo = {
  label: string;
  summary: string;
  details: string[];
  sourceLinks: Array<{ label: string; href: string }>;
};

function getScorerTransparencyInfo(
  value: string | null | undefined,
): ScorerTransparencyInfo | null {
  if (!value) return null;

  const ref = value.toLowerCase();
  if (ref.includes("repro-scorer")) {
    return {
      label: "Agora Repro Scorer",
      summary:
        "Compares the submitted CSV against the posted reference output row by row using deterministic rules.",
      details: [
        "Requires every reference-output column to be present in the submitted CSV.",
        "Reorders submission columns to match the reference output before comparison.",
        "Uses absolute numeric tolerance for numeric values.",
        "Uses exact equality for non-numeric values.",
        "Writes deterministic JSON score output for reproducible replay.",
      ],
      sourceLinks: [
        {
          label: "score.py",
          href: "https://github.com/andymolecule/Agora/blob/main/containers/repro-scorer/score.py",
        },
        {
          label: "Dockerfile",
          href: "https://github.com/andymolecule/Agora/blob/main/containers/repro-scorer/Dockerfile",
        },
      ],
    };
  }

  if (ref.includes("regression-scorer")) {
    return {
      label: "Agora Regression Scorer",
      summary:
        "Matches submitted predictions to the posted ground-truth labels by row id and computes standard regression metrics.",
      details: [
        "Requires id and prediction columns in the submission and id and label columns in the ground truth.",
        "Matches rows by id rather than by file order.",
        "Computes R², RMSE, MAE, Pearson, and Spearman metrics.",
        "Uses clamped R² as the primary score for payout and ranking.",
        "Writes deterministic JSON score output for reproducible replay.",
      ],
      sourceLinks: [
        {
          label: "score.py",
          href: "https://github.com/andymolecule/Agora/blob/main/containers/regression-scorer/score.py",
        },
        {
          label: "Dockerfile",
          href: "https://github.com/andymolecule/Agora/blob/main/containers/regression-scorer/Dockerfile",
        },
      ],
    };
  }

  if (ref.includes("docking-scorer")) {
    return {
      label: "Agora Docking Scorer",
      summary:
        "Reserved for the official docking scorer image family, but the current implementation is still a placeholder.",
      details: [
        "The container reference is public, but the docking scoring logic in this repo is not yet a full solver-facing implementation.",
      ],
      sourceLinks: [
        {
          label: "score.py",
          href: "https://github.com/andymolecule/Agora/blob/main/containers/docking-scorer/score.py",
        },
        {
          label: "Dockerfile",
          href: "https://github.com/andymolecule/Agora/blob/main/containers/docking-scorer/Dockerfile",
        },
      ],
    };
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
    spec_cid?: string | null;
    dataset_train_cid?: string | null;
    dataset_test_cid?: string | null;
  };
}) {
  return (
    <section className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] p-6">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-mono font-bold uppercase tracking-wider text-[var(--color-warm-900)]">
        <Container className="w-4 h-4" strokeWidth={2} />
        Public Challenge Artifacts
      </h3>
      <div className="flex flex-col rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-default)] px-5">
        <InfoRow
          label="Challenge spec"
          value={
            challenge.spec_cid ? (
              <LinkedValue
                href={cidHref(challenge.spec_cid)}
                value={challenge.spec_cid}
              />
            ) : (
              "—"
            )
          }
          mono
          icon={FileText}
        />
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
  const submissionContract = spec?.submission_contract ?? null;
  const submissionArtifact = submissionContract
    ? describeSubmissionArtifact(submissionContract)
    : "submission contract unavailable";
  const expectedColumns = deriveExpectedColumns(submissionContract);
  const submissionUnavailableReason =
    challenge.spec_cid && !spec && technicalSpecsErrorMessage
      ? "Challenge submissions are disabled because the pinned challenge spec does not match the current Agora schema."
      : !submissionContract
        ? "Challenge submissions are disabled because no current-schema submission contract is available."
        : null;
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
  const verifyCommand =
    hasPublicVerificationArtifacts && verification
      ? `agora verify-public ${challenge.id} --sub ${verification.submissionId}`
      : null;
  const scorerInfo = getScorerTransparencyInfo(challenge.eval_image);
  const scorerPackageUrl = getScorerPackageUrl(challenge.eval_image);
  const metricPresentation = getMetricPresentation(
    challenge.challenge_type,
    challenge.eval_metric,
    spec,
  );
  const eligibilityThreshold = getEligibilityThresholdPresentation(
    challenge.minimum_score,
  );

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
                  {getChallengeBadgeLabel(challenge.status)}
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
                    message={`Detailed IPFS-backed spec data could not be loaded, so this page is showing challenge metadata only. ${technicalSpecsErrorMessage}`}
                  />
                )}
                <Section title="What To Submit" icon={FileText}>
                  <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_220px]">
                    <div className="space-y-4">
                      {submissionContract ? (
                        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                          Submit{" "}
                          <span className="font-semibold text-[var(--color-warm-900)]">
                            {submissionArtifact}
                          </span>
                          .
                        </p>
                      ) : (
                        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                          Submission format details are unavailable because the
                          pinned challenge spec could not be validated against
                          the current Agora schema.
                        </p>
                      )}
                      <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
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
                        idColumn={
                          submissionContract?.kind === "csv_table"
                            ? submissionContract.columns.id
                            : undefined
                        }
                        valueColumn={
                          submissionContract?.kind === "csv_table"
                            ? submissionContract.columns.value
                            : undefined
                        }
                      />
                    </div>
                  )}
                </Section>

                <Section
                  title="How You're Judged"
                  icon={Target}
                  id="how-you-are-judged"
                >
                  <div className="space-y-5">
                    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-5 py-4">
                      <div className="mb-2 text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--text-muted)]">
                        Official scoring rule
                      </div>
                      <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                        {successDefinition}
                      </p>
                    </div>

                    <div className="space-y-4">
                      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-5 py-4">
                        <div className="mb-2 text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--text-muted)]">
                          Evaluation notes
                        </div>
                        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                          {spec?.evaluation?.criteria ??
                            "Final scores are produced by the configured evaluation bundle and scorer container."}
                        </p>
                        {spec?.evaluation?.tolerance && (
                          <p className="mt-3 text-sm font-medium text-[var(--text-secondary)]">
                            Comparison tolerance:{" "}
                            <span className="font-mono font-bold text-[var(--color-warm-900)]">
                              {spec.evaluation.tolerance}
                            </span>
                          </p>
                        )}
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-5 py-4">
                          <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--text-muted)]">
                            Scoring metric
                          </div>
                          <div className="mt-2 text-2xl font-display font-bold text-[var(--color-warm-900)]">
                            {metricPresentation.label}
                          </div>
                          <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
                            {metricPresentation.helper}
                          </p>
                        </div>
                        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-5 py-4">
                          <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--text-muted)]">
                            Eligibility threshold
                          </div>
                          <div className="mt-2 text-2xl font-display font-bold text-[var(--color-warm-900)]">
                            {eligibilityThreshold.value}
                          </div>
                          <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
                            {eligibilityThreshold.helper}
                          </p>
                        </div>
                      </div>
                      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-5 py-4">
                        <div className="mb-2 text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--text-muted)]">
                          Official scorer
                        </div>
                        {scorerInfo ? (
                          <div className="space-y-4">
                            <div>
                              <div className="text-base font-bold text-[var(--color-warm-900)]">
                                {scorerInfo.label}
                              </div>
                              <p className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">
                                {scorerInfo.summary}
                              </p>
                            </div>
                            <div>
                              <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--text-muted)]">
                                What this scorer does
                              </div>
                              <ul className="mt-2 space-y-2 text-sm leading-relaxed text-[var(--text-secondary)]">
                                {scorerInfo.details.map((detail) => (
                                  <li
                                    key={detail}
                                    className="flex items-start gap-2"
                                  >
                                    <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-warm-900)]" />
                                    <span>{detail}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                            <div>
                              <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--text-muted)]">
                                Source code
                              </div>
                              <div className="mt-2 flex flex-wrap gap-3">
                                {scorerInfo.sourceLinks.map((link) => (
                                  <a
                                    key={link.href}
                                    href={link.href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-2 rounded-md border border-[var(--border-default)] bg-white px-3 py-2 text-sm font-medium text-[var(--color-warm-900)] transition-colors hover:border-[var(--color-warm-900)]"
                                  >
                                    <span>{link.label}</span>
                                    <ExternalLink
                                      className="h-3.5 w-3.5 shrink-0"
                                      strokeWidth={1.75}
                                    />
                                  </a>
                                ))}
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--text-muted)]">
                                Scorer image ref
                              </div>
                              <p className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">
                                Exact OCI container image reference used by the
                                worker for official scoring.
                              </p>
                              <div className="mt-3 break-all font-mono text-xs font-bold text-[var(--color-warm-900)]">
                                {challenge.eval_image ?? "—"}
                              </div>
                              {scorerPackageUrl && (
                                <div className="mt-3">
                                  <a
                                    href={scorerPackageUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-2 rounded-md border border-[var(--border-default)] bg-white px-3 py-2 text-sm font-medium text-[var(--color-warm-900)] transition-colors hover:border-[var(--color-warm-900)]"
                                  >
                                    <span>GHCR package</span>
                                    <ExternalLink
                                      className="h-3.5 w-3.5 shrink-0"
                                      strokeWidth={1.75}
                                    />
                                  </a>
                                </div>
                              )}
                              {resultsVisible && (
                                <p className="mt-3 text-sm leading-relaxed text-[var(--text-secondary)]">
                                  After scoring begins, the{" "}
                                  <a
                                    href="#public-verification"
                                    className="font-medium text-[var(--color-warm-900)] underline decoration-[var(--border-default)] underline-offset-4 transition-colors hover:text-[var(--accent-500)] hover:decoration-[var(--accent-500)]"
                                  >
                                    Public Verification
                                  </a>{" "}
                                  section exposes the replay-grade scorer image
                                  digest used for a scored submission.
                                </p>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                              Exact OCI container image reference used by the
                              worker for official scoring.
                            </p>
                            <div className="break-all font-mono text-xs font-bold text-[var(--color-warm-900)]">
                              {challenge.eval_image ?? "—"}
                            </div>
                            {scorerPackageUrl && (
                              <div>
                                <a
                                  href={scorerPackageUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-2 rounded-md border border-[var(--border-default)] bg-white px-3 py-2 text-sm font-medium text-[var(--color-warm-900)] transition-colors hover:border-[var(--color-warm-900)]"
                                >
                                  <span>GHCR package</span>
                                  <ExternalLink
                                    className="h-3.5 w-3.5 shrink-0"
                                    strokeWidth={1.75}
                                  />
                                </a>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Read further — always at the bottom */}
                    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-5 py-4">
                      <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--text-muted)]">
                        Read further
                      </div>
                      <div className="mt-2 flex flex-wrap gap-3">
                        {challenge.spec_cid && (
                          <a
                            href={cidHref(challenge.spec_cid) ?? undefined}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 rounded-md border border-[var(--border-default)] bg-white px-3 py-2 text-sm font-medium text-[var(--color-warm-900)] transition-colors hover:border-[var(--color-warm-900)]"
                          >
                            <span>Challenge spec</span>
                            <ExternalLink
                              className="h-3.5 w-3.5 shrink-0"
                              strokeWidth={1.75}
                            />
                          </a>
                        )}
                        {resultsVisible && (
                          <a
                            href="#public-verification"
                            className="inline-flex items-center gap-2 rounded-md border border-[var(--border-default)] bg-white px-3 py-2 text-sm font-medium text-[var(--color-warm-900)] transition-colors hover:border-[var(--color-warm-900)]"
                          >
                            <span>Public verification</span>
                          </a>
                        )}
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
              submissionContract={submissionContract}
              submissionUnavailableReason={submissionUnavailableReason}
            />

            <TechnicalDetailsSection challenge={challenge} />

            {resultsVisible && verificationSubmission && (
              <Section
                title="Public Verification"
                icon={ShieldCheck}
                id="public-verification"
              >
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
                          {verification.containerImageDigest ?? "—"}
                        </div>
                        {getScorerPackageUrl(
                          verification.containerImageDigest,
                        ) && (
                          <div className="mt-3">
                            <a
                              href={
                                getScorerPackageUrl(
                                  verification.containerImageDigest,
                                ) ?? undefined
                              }
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-2 rounded-md border border-[var(--border-default)] bg-white px-3 py-2 text-sm font-medium text-[var(--color-warm-900)] transition-colors hover:border-[var(--color-warm-900)]"
                            >
                              <span>GHCR package</span>
                              <ExternalLink
                                className="h-3.5 w-3.5 shrink-0"
                                strokeWidth={1.75}
                              />
                            </a>
                          </div>
                        )}
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
              <h3 className="text-xl font-display font-bold text-[var(--color-warm-900)] flex items-center gap-2 uppercase tracking-tight">
                <DollarSign className="w-5 h-5" strokeWidth={2.5} />
                Rewards
              </h3>
              <div className="mt-4 rounded-lg border border-[#5B7F5E]/15 bg-[#F4F7F2] px-5 py-4">
                <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#5B7F5E]">
                  Reward Pool
                </div>
                <div className="mt-2 text-4xl font-display font-bold tracking-tight text-[#4A6B4D]">
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
                    Submission Deadline
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
                    Review Window
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
