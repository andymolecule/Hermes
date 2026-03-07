"use client";

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
import { CHALLENGE_STATUS, DEFAULT_IPFS_GATEWAY } from "@agora/common";
import Link from "next/link";
import { LeaderboardTable } from "../../../components/LeaderboardTable";
import { SubmitSolution } from "../../../components/SubmitSolution";
import { TimelineStatus } from "../../../components/TimelineStatus";
import { ChallengeActions } from "../../../components/ChallengeActions";
import { getChallenge, getChallengeSpec, getPublicSubmissionVerification } from "../../../lib/api";
import { formatUsdc } from "../../../lib/format";
import type { ChallengeSpecOutput } from "@agora/common";
import type { SubmissionVerification } from "../../../lib/types";

function InfoRow({
  label,
  value,
  mono = false,
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  icon?: React.ComponentType<{ className?: string, strokeWidth?: number }>;
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-black/10 py-4 last:border-b-0 sm:flex-row sm:items-center">
      <div className="flex items-center gap-2 w-48 shrink-0">
        {Icon && <Icon className="h-4 w-4 text-black/60" strokeWidth={1.5} />}
        <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-black/60">{label}</div>
      </div>
      <div className={`flex-1 break-all text-sm text-black ${mono ? "font-mono text-xs font-bold" : "font-medium"}`}>
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
    <section className="rounded-[2px] border border-black bg-white p-6 sm:p-8">
      <h2 className="mb-4 flex items-center gap-2 text-xl font-display font-bold tracking-tight text-black">
        <Icon className="h-5 w-5" strokeWidth={2.25} />
        {title}
      </h2>
      {children}
    </section>
  );
}

function SpecSectionSkeleton({ title }: { title: string }) {
  return (
    <section className="rounded-[2px] border border-black bg-white p-6 sm:p-8">
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
    <div className="rounded-[2px] border border-black bg-[#fff3e8] p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-black" strokeWidth={2} />
        <div className="space-y-1">
          <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-black/60">
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
            if (labelColumn && column === labelColumn) role = "Prediction target";

            return (
              <tr key={column} className="border-b last:border-b-0 border-black/10">
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
    const clean = value.replace(/^ghcr\.io\//, "").split("@")[0]?.split(":")[0];
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
    scoring_container?: string | null;
  };
}) {
  return (
    <section className="rounded-[2px] border border-black bg-[#f1f1ec] p-6">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-mono font-bold uppercase tracking-wider text-black">
        <Container className="w-4 h-4" strokeWidth={2} />
        Technical Specifications
      </h3>
      <div className="flex flex-col rounded-[2px] border border-black/10 bg-[#f7f7f3] px-5">
        <InfoRow
          label="Dataset (train)"
          value={
            challenge.dataset_train_cid
              ? <LinkedValue href={cidHref(challenge.dataset_train_cid)} value={challenge.dataset_train_cid} />
              : "—"
          }
          mono
          icon={Database}
        />
        <InfoRow
          label="Dataset (test)"
          value={
            challenge.dataset_test_cid
              ? <LinkedValue href={cidHref(challenge.dataset_test_cid)} value={challenge.dataset_test_cid} />
              : "—"
          }
          mono
          icon={Database}
        />
        <InfoRow
          label="Scoring container"
          value={
            challenge.scoring_container
              ? <LinkedValue href={containerHref(challenge.scoring_container)} value={challenge.scoring_container} />
              : "—"
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
    queryFn: () => getChallengeSpec(detailQuery.data?.challenge.spec_cid as string),
    enabled: Boolean(detailQuery.data?.challenge.spec_cid),
    staleTime: 5 * 60 * 1000,
  });
  const leaderboardEntries = detailQuery.data
    ? (detailQuery.data.leaderboard.length > 0
      ? detailQuery.data.leaderboard
      : detailQuery.data.submissions)
    : [];
  const firstScoredSubmission = leaderboardEntries.find(
    (entry) => entry.scored && entry.score !== null,
  );
  const verificationQuery = useQuery<SubmissionVerification>({
    queryKey: ["submission-verification", firstScoredSubmission?.id],
    queryFn: () => getPublicSubmissionVerification(firstScoredSubmission?.id as string),
    enabled: Boolean(firstScoredSubmission?.id),
    staleTime: 5 * 60 * 1000,
  });
  const technicalSpecsErrorMessage =
    detailQuery.data?.challenge.spec_cid && specQuery.isError
      ? (specQuery.error instanceof Error
        ? specQuery.error.message
        : "Failed to load the challenge specification.")
      : null;
  const verificationErrorMessage = verificationQuery.isError
    ? (verificationQuery.error instanceof Error
      ? verificationQuery.error.message
      : "Failed to load verification artifacts.")
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
    ...[
      spec?.evaluation?.id_column,
      spec?.evaluation?.label_column,
    ].filter((value): value is string => Boolean(value)),
  ].filter((value, index, array) => array.indexOf(value) === index);
  const challengeTypeLabel = formatChallengeType(challenge.challenge_type);
  const rewardDistribution = titleCase(challenge.distribution_type ?? "winner_take_all");
  const successDefinition =
    spec?.evaluation?.success_definition
    ?? "Submissions are ranked by score after the evaluation pipeline runs on the hidden test bundle.";
  const evaluationCriteria =
    spec?.evaluation?.criteria
    ?? "Submit a valid solution in the expected format. Higher-ranked valid scores receive the reward distribution for this challenge.";
  const technicalSpecsLoading = Boolean(challenge.spec_cid) && specQuery.isLoading;
  const verification = verificationQuery.data;
  const verifyCommand = verification
    ? `agora verify-public ${challenge.id} --sub ${verification.submissionId}`
    : null;

  return (
    <div className="max-w-6xl mx-auto">
      {/* Back link */}
      <div className="mb-6">
        <Link
          href="/"
          className="group inline-flex items-center gap-2 border border-black bg-white px-4 py-2 text-sm font-bold font-mono uppercase tracking-wider text-black transition-colors duration-200 hover:bg-black hover:text-white"
        >
          <ArrowLeft className="h-4 w-4 text-black transition-colors group-hover:text-white" strokeWidth={2} />
          <span className="text-black transition-colors group-hover:text-white">Back</span>
        </Link>
      </div>

      <div className="bg-plus-pattern border border-black p-4 sm:p-8 rounded-[2px]">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column: Challenge brief */}
          <div className="lg:col-span-2 space-y-6">
            <section className="rounded-[2px] border border-black bg-white p-6 sm:p-8">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-4">
                <h1 className="text-3xl sm:text-4xl font-display font-bold text-black tracking-tight leading-tight">
                  {challenge.title}
                </h1>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.5px] font-mono border border-black bg-white text-black shrink-0">
                  <span className={`w-1.5 h-1.5 rounded-full ${challenge.status === CHALLENGE_STATUS.active ? 'bg-green-500' : 'bg-black'}`} />
                  {challenge.status}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 mb-4">
                <span className="px-3 py-1.5 text-[10px] font-mono font-bold uppercase tracking-wider bg-black text-white">
                  {challenge.domain}
                </span>
                <span className="px-3 py-1.5 text-[10px] font-mono font-bold uppercase tracking-wider border border-black text-black">
                  {challengeTypeLabel}
                </span>
                <span className="px-3 py-1.5 text-[10px] font-mono font-bold uppercase tracking-wider border border-black bg-white text-black">
                  {formatUsdc(challenge.reward_amount)} USDC
                </span>
              </div>

              <div className="text-lg leading-relaxed text-black/80 font-medium">
                {challenge.description}
              </div>
            </section>

            {technicalSpecsLoading ? (
              <>
                <SpecSectionSkeleton title="What To Submit" />
                <SpecSectionSkeleton title="How You’re Judged" />
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
                        Submit <span className="font-semibold text-black">{submissionArtifact}</span>.
                        {spec?.evaluation?.submission_format && (
                          <> Expected format: <span className="font-semibold text-black">{spec.evaluation.submission_format}</span>.</>
                        )}
                      </p>
                      <p className="text-sm leading-relaxed text-black/75">
                        {evaluationCriteria}
                      </p>
                    </div>
                    <div className="rounded-[2px] border border-black/15 bg-[#f7f7f3] p-4">
                      <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-black/50">
                        Submission Artifact
                      </div>
                      <div className="mt-2 font-mono text-sm font-bold text-black">
                        {submissionArtifact}
                      </div>
                    </div>
                  </div>
                  {expectedColumns.length > 0 && (
                    <div className="mt-5 space-y-3">
                      <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-black/50">
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

                <Section title="How You’re Judged" icon={Target}>
                  <div className="space-y-5">
                    <p className="text-base leading-relaxed text-black/80">
                      {successDefinition}
                    </p>

                    <div className="space-y-4">
                      <div className="rounded-[2px] border border-black/15 bg-[#f7f7f3] px-5 py-4">
                        <div className="mb-2 text-[10px] font-mono font-bold uppercase tracking-wider text-black/50">
                          Evaluation Notes
                        </div>
                        <p className="text-sm leading-relaxed text-black/75">
                          {spec?.evaluation?.criteria ?? "Final scores are produced by the configured evaluation bundle and scorer container."}
                        </p>
                        {spec?.evaluation?.tolerance && (
                          <p className="mt-3 text-sm font-medium text-black/70">
                            Comparison tolerance: <span className="font-mono font-bold text-black">{spec.evaluation.tolerance}</span>
                          </p>
                        )}
                      </div>
                      <div className="grid gap-4 sm:grid-cols-[170px_minmax(0,1fr)] sm:items-stretch">
                        <div className="rounded-[2px] border border-black/15 bg-[#f7f7f3] px-5 py-4">
                          <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-black/50">
                            Metric
                          </div>
                          <div className="mt-2 text-2xl font-display font-bold text-black">
                            {challenge.scoring_metric ? titleCase(challenge.scoring_metric) : "Custom"}
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-4 rounded-[2px] border border-black/15 bg-[#f7f7f3] px-4 py-3">
                          <div>
                            <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-black/45">
                              Minimum passing score
                            </div>
                            <div className="mt-1 text-sm font-medium text-black/70">
                              Submissions below this threshold are not eligible.
                            </div>
                          </div>
                          <div className="shrink-0 rounded-[2px] border border-black bg-black px-3 py-2 font-mono text-lg font-bold text-white">
                            {String(challenge.minimum_score ?? 0)}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </Section>
              </>
            )}

            <TechnicalDetailsSection challenge={challenge} />

            {firstScoredSubmission && (
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
                ) : verification ? (
                  <div className="space-y-5">
                    <p className="text-sm leading-relaxed text-black/75">
                      Agora currently operates scoring, but this submission exposes the public artifacts needed to replay the scorer and check the published result independently.
                    </p>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="rounded-[2px] border border-black/15 bg-[#f7f7f3] px-5 py-4">
                        <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-black/50">
                          Proof Bundle
                        </div>
                        <div className="mt-2 break-all font-mono text-xs font-bold text-black">
                          <LinkedValue
                            href={cidHref(verification.proofBundleCid)}
                            value={verification.proofBundleCid ?? "—"}
                          />
                        </div>
                      </div>

                      <div className="rounded-[2px] border border-black/15 bg-[#f7f7f3] px-5 py-4">
                        <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-black/50">
                          Replay Submission
                        </div>
                        <div className="mt-2 break-all font-mono text-xs font-bold text-black">
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

                      <div className="rounded-[2px] border border-black/15 bg-[#f7f7f3] px-5 py-4">
                        <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-black/50">
                          Evaluation Bundle
                        </div>
                        <div className="mt-2 break-all font-mono text-xs font-bold text-black">
                          <LinkedValue
                            href={cidHref(verification.evaluationBundleCid)}
                            value={verification.evaluationBundleCid ?? "—"}
                          />
                        </div>
                      </div>

                      <div className="rounded-[2px] border border-black/15 bg-[#f7f7f3] px-5 py-4">
                        <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-black/50">
                          Scorer Image
                        </div>
                        <div className="mt-2 break-all font-mono text-xs font-bold text-black">
                          <LinkedValue
                            href={containerHref(verification.containerImageDigest)}
                            value={verification.containerImageDigest ?? "—"}
                          />
                        </div>
                      </div>
                    </div>

                    {verifyCommand && (
                      <div className="rounded-[2px] border border-black/15 bg-black p-4 text-white">
                        <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-white/60">
                          One-command replay
                        </div>
                        <pre className="mt-2 overflow-x-auto font-mono text-xs font-bold text-white">
                          {verifyCommand}
                        </pre>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm leading-relaxed text-black/60">
                    Verification artifacts are not available for this submission yet.
                  </p>
                )}
              </Section>
            )}
          </div>

          {/* Right column: incentives, submission, and timeline */}
          <div className="space-y-4 lg:self-start">
            <section className="rounded-[2px] border border-black bg-white p-6">
              <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-black/50">
                Incentives & Timing
              </div>
              <div className="mt-3 rounded-[2px] border border-black/15 bg-[#f7f7f3] px-5 py-4">
                <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-black/50">
                  Reward Pool
                </div>
                <div className="mt-2 text-4xl font-display font-bold tracking-tight text-black">
                  {formatUsdc(challenge.reward_amount)} USDC
                </div>
              </div>
              <div className="mt-5 space-y-4">
                <div>
                  <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-black/50">
                    Distribution
                  </div>
                  <div className="mt-1 text-sm font-medium text-black">
                    {rewardDistribution}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-black/50">
                    Deadline
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-sm font-medium text-black">
                    <CalendarClock className="h-4 w-4 text-black/50" strokeWidth={1.75} />
                    {formatDateTime(challenge.deadline)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-black/50">
                    Review Period
                  </div>
                  <div className="mt-1 text-sm font-medium text-black">
                    {challenge.dispute_window_hours != null ? `${challenge.dispute_window_hours} hours` : "—"}
                  </div>
                </div>
              </div>
            </section>

            <SubmitSolution
              challengeId={challenge.id}
              challengeAddress={challenge.contract_address}
              challengeStatus={challenge.status}
              deadline={challenge.deadline}
              expectedColumns={challenge.expected_columns}
            />

            <ChallengeActions
              challengeId={challenge.id}
              contractAddress={challenge.contract_address}
              challengeStatus={challenge.status}
              deadline={challenge.deadline}
              disputeWindowHours={challenge.dispute_window_hours ?? 168}
            />

            <TimelineStatus
              challenge={challenge}
              submissions={submissions}
            />
          </div>
        </div>

        {/* Leaderboard — FULL WIDTH below the grid */}
        <div className="mt-6 rounded-[2px] border border-black p-6 bg-white">
          <h3 className="text-xl font-display font-bold mb-4 flex items-center gap-2 text-black uppercase tracking-tight">
            <Trophy className="w-5 h-5" strokeWidth={2.5} />
            Leaderboard
          </h3>
          <LeaderboardTable rows={leaderboardEntries} />
        </div>
      </div>
    </div>
  );
}
