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
  CalendarClock,
  ChevronRight,
  Clock,
  Container,
  Database,
  Download,
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
import { getExplorerAddressUrl } from "../../../lib/wallet/network";
import { deadlineCountdown, formatUsdc, shortAddress } from "../../../lib/format";
import { getScorerPackageUrl } from "../../../lib/scorer-links";
import type {
  PublicChallengeArtifact,
  SubmissionVerification,
} from "../../../lib/types";
import {
  canShowChallengeResults,
  getChallengeLeaderboardEntries,
  getPublicVerificationTarget,
} from "./detail-visibility";

/* ─── Helpers (unchanged logic) ─── */

function formatLabel(value: string) {
  return value.replace(/_/g, " ");
}

function titleCase(value: string) {
  return formatLabel(value).replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatArtifactRole(value: string) {
  return titleCase(value);
}

function getMetricPresentation(
  challengeType: string,
  evalMetric?: string | null,
  spec?: ChallengeSpecOutput | null,
) {
  if (challengeType === "reproducibility") {
    return {
      label: "Row match score",
      helper:
        spec?.execution?.metric === "tolerant_match"
          ? "Score = matched rows / total rows after applying deterministic tolerant matching."
          : "Score = matched rows / total rows from deterministic comparison against the posted reference output.",
    };
  }

  switch (evalMetric) {
    case "rmse":
      return { label: "RMSE", helper: "Lower is better. Computed against the hidden scoring labels." };
    case "mae":
      return { label: "MAE", helper: "Lower is better. Computed against the hidden scoring labels." };
    case "r2":
      return { label: "R²", helper: "Higher is better. Computed against the hidden scoring labels." };
    case "pearson":
      return { label: "Pearson correlation", helper: "Higher is better. Computed against the hidden scoring labels." };
    case "spearman":
      return { label: "Spearman correlation", helper: "Higher is better. Computed against the hidden scoring labels." };
    case "custom":
      return { label: "Custom scoring metric", helper: "See the official scoring rule and scorer details below for the exact evaluation logic." };
    default:
      return { label: "Scorer-defined metric", helper: "See the official scoring rule and scorer details below for the exact evaluation logic." };
  }
}

function getEligibilityThresholdPresentation(minimumScore?: number | string | null) {
  const parsed = Number(minimumScore ?? 0);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { value: "No minimum threshold", helper: "Any valid scored submission can be ranked and considered for payout under the challenge's distribution rule." };
  }
  return { value: String(minimumScore), helper: "Scores below this threshold are excluded from ranking and payout." };
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

function getScorerTransparencyInfo(value: string | null | undefined): ScorerTransparencyInfo | null {
  if (!value) return null;
  const ref = value.toLowerCase();
  if (ref.includes("gems-match-scorer")) {
    return {
      label: "Gems Match Scorer",
      summary: "Compares the submitted CSV against the posted reference output row by row using deterministic rules.",
      details: [
        "Requires every reference-output column to be present in the submitted CSV.",
        "Reorders submission columns to match the reference output before comparison.",
        "Uses absolute numeric tolerance for numeric values.",
        "Uses exact equality for non-numeric values.",
        "Writes deterministic JSON score output for reproducible replay.",
      ],
      sourceLinks: [
        { label: "score.py", href: "https://github.com/andymolecule/Agora/blob/main/containers/gems-match-scorer/score.py" },
        { label: "Dockerfile", href: "https://github.com/andymolecule/Agora/blob/main/containers/gems-match-scorer/Dockerfile" },
      ],
    };
  }
  if (ref.includes("gems-tabular-scorer")) {
    return {
      label: "Gems Tabular Scorer",
      summary: "Matches submitted predictions to the posted ground-truth labels by row id and computes standard regression metrics.",
      details: [
        "Requires id and prediction columns in the submission and id and label columns in the ground truth.",
        "Matches rows by id rather than by file order.",
        "Computes R², RMSE, MAE, Pearson, and Spearman metrics.",
        "Uses clamped R² as the primary score for payout and ranking.",
        "Writes deterministic JSON score output for reproducible replay.",
      ],
      sourceLinks: [
        { label: "score.py", href: "https://github.com/andymolecule/Agora/blob/main/containers/gems-tabular-scorer/score.py" },
        { label: "Dockerfile", href: "https://github.com/andymolecule/Agora/blob/main/containers/gems-tabular-scorer/Dockerfile" },
      ],
    };
  }
  if (ref.includes("gems-ranking-scorer")) {
    return {
      label: "Gems Ranking Scorer",
      summary: "Official managed scorer for ranking-style and docking-style challenges.",
      details: ["The container reference is public and the scoring logic is available for solver-side inspection and dry-run previews."],
      sourceLinks: [
        { label: "score.py", href: "https://github.com/andymolecule/Agora/blob/main/containers/gems-ranking-scorer/score.py" },
        { label: "Dockerfile", href: "https://github.com/andymolecule/Agora/blob/main/containers/gems-ranking-scorer/Dockerfile" },
      ],
    };
  }
  if (ref.includes("gems-generated-scorer")) {
    return {
      label: "Gems Generated Scorer",
      summary: "Delegates scoring to an Agora-generated Python scorer entrypoint mounted at runtime.",
      details: [
        "The published image is a generic runner rather than a challenge-specific scorer.",
        "Agora stages the generated scorer program alongside the mounted runtime config and inputs.",
        "The container still writes the same deterministic score.json contract as other official scorers.",
      ],
      sourceLinks: [
        { label: "score.py", href: "https://github.com/andymolecule/Agora/blob/main/containers/gems-generated-scorer/score.py" },
        { label: "Dockerfile", href: "https://github.com/andymolecule/Agora/blob/main/containers/gems-generated-scorer/Dockerfile" },
      ],
    };
  }
  return null;
}

function getDistributionBreakdown(type: string | null | undefined, total: number) {
  const net = total * 0.9; // after 10% protocol fee
  switch (type) {
    case "top_3":
      return [
        { label: "First Place", amount: net * 0.6 },
        { label: "Second Place", amount: net * 0.25 },
        { label: "Third Place", amount: net * 0.15 },
      ];
    case "proportional":
      return [{ label: "Score-Weighted Pool", amount: net }];
    default:
      return [{ label: "Winner Takes All", amount: net }];
  }
}

/* ─── Sub-components ─── */

function WarningCallout({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-xl bg-[var(--color-warning-bg)] p-5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-primary)]" strokeWidth={2} />
        <div className="space-y-1">
          <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-[var(--text-primary)]/50">
            {title}
          </div>
          <p className="text-sm leading-relaxed text-[var(--text-primary)]/75">{message}</p>
        </div>
      </div>
    </div>
  );
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
    <div className="overflow-hidden rounded-lg border border-[var(--surface-container)]">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-[var(--surface-container-high)]">
          <tr>
            <th className="border-b border-[var(--surface-container)] px-4 py-2.5 text-left text-[10px] font-mono font-bold uppercase tracking-widest text-[var(--text-secondary)]">
              Column
            </th>
            <th className="border-b border-[var(--surface-container)] px-4 py-2.5 text-left text-[10px] font-mono font-bold uppercase tracking-widest text-[var(--text-secondary)]">
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
              <tr key={column} className="border-b last:border-b-0 border-[var(--surface-container)]">
                <td className="px-4 py-3 font-mono text-xs font-bold text-[var(--text-primary)]">{column}</td>
                <td className="px-4 py-3 text-sm font-medium text-[var(--text-secondary)]">{role}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LinkedValue({ href, value }: { href: string | null; value: string }) {
  if (!href) return <span>{value}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 underline decoration-[var(--text-primary)]/20 underline-offset-4 transition-colors hover:text-[var(--text-primary)]"
    >
      <span>{value}</span>
      <ExternalLink className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
    </a>
  );
}

/* ─── Main Component ─── */

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
  const resultsVisible = detailQuery.data
    ? canShowChallengeResults(detailQuery.data.challenge.status)
    : false;
  const leaderboardEntries = getChallengeLeaderboardEntries(detailQuery.data);
  const verificationSubmission = getPublicVerificationTarget(detailQuery.data);
  const verificationQuery = useQuery<SubmissionVerification>({
    queryKey: ["submission-verification", verificationSubmission?.id],
    queryFn: () => getPublicSubmissionVerification(verificationSubmission?.id as string),
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

  /* ─── Loading ─── */
  if (detailQuery.isLoading) {
    return (
      <div className="max-w-7xl mx-auto pt-32 pb-20 px-6">
        <div className="space-y-4">
          <div className="skeleton h-4 w-48" />
          <div className="skeleton h-12 w-3/4" />
          <div className="skeleton h-64 rounded-xl" />
        </div>
      </div>
    );
  }

  /* ─── Error ─── */
  if (detailQuery.error || !detailQuery.data) {
    return (
      <div className="max-w-7xl mx-auto pt-32 pb-20 px-6 text-center">
        <p className="text-sm font-medium text-[var(--text-muted)]">Challenge not found.</p>
      </div>
    );
  }

  const { challenge, submissions, artifacts } = detailQuery.data;
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
  const rewardDistribution = titleCase(challenge.distribution_type ?? "winner_take_all");
  const successDefinition =
    (spec?.type ?? challenge.challenge_type) === "reproducibility"
      ? "Submissions are compared against the reference output bundle using deterministic row matching."
      : "Submissions are ranked by score after the managed evaluation pipeline runs on the hidden evaluation bundle.";
  const evaluationCriteria =
    "Submit a valid solution in the expected format. Higher-ranked valid scores receive the reward distribution for this challenge.";
  const technicalSpecsLoading = Boolean(challenge.spec_cid) && specQuery.isLoading;
  const verification = verificationQuery.data;
  const hasPublicVerificationArtifacts = Boolean(verification?.proofBundleCid);
  const verifyCommand =
    hasPublicVerificationArtifacts && verification
      ? `agora verify-public ${challenge.id} --sub ${verification.submissionId}`
      : null;
  const scorerInfo = getScorerTransparencyInfo(challenge.execution?.scorer_image);
  const scorerPackageUrl = getScorerPackageUrl(challenge.execution?.scorer_image);
  const metricPresentation = getMetricPresentation(challenge.challenge_type, challenge.execution?.metric, spec);
  const eligibilityThreshold = getEligibilityThresholdPresentation(challenge.minimum_score);
  const distributionRows = getDistributionBreakdown(challenge.distribution_type, Number(challenge.reward_amount));
  const countdown = deadlineCountdown(challenge.deadline);

  return (
    <div className="max-w-7xl mx-auto">
      {/* ─── Breadcrumb ─── */}
      <div className="mb-10 flex items-center gap-2 font-mono text-xs text-[var(--text-muted)]">
        <Link href="/" className="hover:text-[var(--text-primary)] transition-colors">BOUNTIES</Link>
        <ChevronRight className="w-3.5 h-3.5" strokeWidth={1.5} />
        <span className="uppercase">{challenge.domain.replace(/_/g, " ")}</span>
        <ChevronRight className="w-3.5 h-3.5" strokeWidth={1.5} />
        <span className="text-[var(--text-primary)] font-bold uppercase">CASE_ID: {challenge.id.slice(0, 8).toUpperCase()}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
        {/* ═══════════════════════════════════════════
            LEFT COLUMN (8 cols)
            ═══════════════════════════════════════════ */}
        <div className="lg:col-span-8 space-y-12">

          {/* ─── Hero ─── */}
          <section>
            <h1 className="text-4xl sm:text-5xl font-bold font-display tracking-tight mb-6 leading-tight text-[var(--text-primary)]">
              {challenge.title}
            </h1>
            <div className="flex flex-wrap gap-4 items-center">
              <span className={`px-3 py-1 font-mono text-[10px] tracking-widest uppercase ${
                challenge.status === CHALLENGE_STATUS.open
                  ? "bg-[var(--text-primary)] text-white"
                  : "bg-[var(--surface-container-high)] text-[var(--text-primary)]"
              }`}>
                {getChallengeBadgeLabel(challenge.status)}
              </span>
              <span className="px-3 py-1 bg-[var(--surface-container-high)] text-[var(--text-primary)] font-mono text-[10px] tracking-widest uppercase">
                {challenge.domain.replace(/_/g, " ")}
              </span>
              <span className="px-3 py-1 bg-[var(--surface-container-high)] text-[var(--text-primary)] font-mono text-[10px] tracking-widest uppercase">
                {challengeTypeLabel}
              </span>
              <span className="flex items-center gap-1.5 font-mono text-xs text-[var(--text-secondary)]">
                <Clock className="w-3.5 h-3.5" strokeWidth={1.75} />
                {countdown === "Closed" ? "Deadline passed" : countdown}
              </span>
            </div>
          </section>

          {/* ─── Description Block ─── */}
          <section className="bg-[var(--surface-container-low)] p-8 sm:p-10 rounded-xl space-y-8">
            <div>
              <h3 className="font-display font-bold text-xl mb-4 flex items-center gap-2 text-[var(--text-primary)]">
                <FileText className="w-5 h-5" strokeWidth={2} />
                The Challenge
              </h3>
              <p className="text-[var(--text-secondary)] leading-relaxed">{challenge.description}</p>
            </div>

            {/* Technical Requirements / What To Submit */}
            {!technicalSpecsLoading && submissionContract && (
              <div>
                <h3 className="font-display font-bold text-xl mb-4 flex items-center gap-2 text-[var(--text-primary)]">
                  <Target className="w-5 h-5" strokeWidth={2} />
                  What To Submit
                </h3>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-4">
                  Submit <span className="font-semibold text-[var(--text-primary)]">{submissionArtifact}</span>.{" "}
                  {evaluationCriteria}
                </p>
                {expectedColumns.length > 0 && (
                  <div className="space-y-3">
                    <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-[var(--text-muted)]">
                      Expected Columns
                    </div>
                    <SubmissionColumnsTable
                      expectedColumns={expectedColumns}
                      idColumn={submissionContract?.kind === "csv_table" ? submissionContract.columns.id : undefined}
                      valueColumn={submissionContract?.kind === "csv_table" ? submissionContract.columns.value : undefined}
                    />
                  </div>
                )}
              </div>
            )}
            {technicalSpecsLoading && (
              <div className="space-y-3">
                <div className="skeleton h-6 w-40" />
                <div className="skeleton h-4 w-full" />
                <div className="skeleton h-4 w-5/6" />
              </div>
            )}
            {technicalSpecsErrorMessage && (
              <WarningCallout
                title="Challenge Spec Unavailable"
                message={`Detailed spec data could not be loaded. ${technicalSpecsErrorMessage}`}
              />
            )}
          </section>

          {/* ─── How You're Judged ─── */}
          {!technicalSpecsLoading && (
            <section className="bg-[var(--surface-container-low)] p-8 sm:p-10 rounded-xl space-y-6" id="how-you-are-judged">
              <h3 className="font-display font-bold text-xl flex items-center gap-2 text-[var(--text-primary)]">
                <ShieldCheck className="w-5 h-5" strokeWidth={2} />
                How You're Judged
              </h3>
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{successDefinition}</p>
              {spec?.execution?.metric === "tolerant_match" && (
                <p className="text-sm font-medium text-[var(--text-secondary)]">
                  Matching mode: <span className="font-mono font-bold text-[var(--text-primary)]">tolerant_match</span>
                </p>
              )}

              {/* Metric + Threshold cards */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="bg-white rounded-lg p-5">
                  <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-[var(--text-muted)]">Scoring metric</div>
                  <div className="mt-2 text-2xl font-display font-bold text-[var(--text-primary)]">{metricPresentation.label}</div>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">{metricPresentation.helper}</p>
                </div>
                <div className="bg-white rounded-lg p-5">
                  <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-[var(--text-muted)]">Eligibility threshold</div>
                  <div className="mt-2 text-2xl font-display font-bold text-[var(--text-primary)]">{eligibilityThreshold.value}</div>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">{eligibilityThreshold.helper}</p>
                </div>
              </div>

              {/* Scorer Engine */}
              {scorerInfo && (
                <div className="bg-white rounded-lg overflow-hidden">
                  <div className="px-5 py-3 bg-[var(--surface-container-high)]">
                    <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-[var(--text-muted)]">Scorer engine</div>
                  </div>
                  <div className="px-5 py-5 space-y-4">
                    <div>
                      <div className="text-base font-bold text-[var(--text-primary)]">{scorerInfo.label}</div>
                      <p className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">{scorerInfo.summary}</p>
                    </div>
                    <ul className="space-y-2 text-sm leading-relaxed text-[var(--text-secondary)]">
                      {scorerInfo.details.map((detail) => (
                        <li key={detail} className="flex items-start gap-2">
                          <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-primary)]" />
                          <span>{detail}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="flex flex-wrap items-center gap-3 pt-4 mt-4">
                      {scorerInfo.sourceLinks.map((link) => (
                        <a
                          key={link.href}
                          href={link.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 rounded-lg bg-[var(--surface-container-low)] px-3 py-2 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-container-high)]"
                        >
                          <span>{link.label}</span>
                          <ExternalLink className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                        </a>
                      ))}
                      {scorerPackageUrl && (
                        <a href={scorerPackageUrl} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 rounded-lg bg-[var(--surface-container-low)] px-3 py-2 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-container-high)]">
                          <span>GHCR package</span>
                          <ExternalLink className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* ─── Submit Solution ─── */}
          <div id="submit-solution" />
          <SubmitSolution
            challengeId={challenge.id}
            challengeAddress={challenge.contract_address}
            challengeStatus={challenge.status}
            deadline={challenge.deadline}
            submissionPrivacyMode={challenge.submission_privacy_mode}
            submissionContract={submissionContract}
            submissionUnavailableReason={submissionUnavailableReason}
          />

          {/* ─── Proposed Solutions / Leaderboard ─── */}
          <section>
            <div className="flex justify-between items-end mb-8">
              <h3 className="font-display font-bold text-2xl text-[var(--text-primary)]">
                Proposed Solutions ({submissions.length})
              </h3>
            </div>
            {resultsVisible ? (
              <LeaderboardTable rows={leaderboardEntries} />
            ) : (
              <div className="bg-[var(--surface-container-low)] rounded-xl p-10 text-center">
                <Trophy className="w-8 h-8 mx-auto mb-3 text-[var(--text-muted)]" strokeWidth={1.5} />
                <p className="text-sm text-[var(--text-muted)] font-mono uppercase tracking-widest">
                  Leaderboard unlocks when the challenge enters scoring.
                </p>
              </div>
            )}
          </section>

          {/* ─── Public Verification ─── */}
          {resultsVisible && verificationSubmission && (
            <section className="bg-[var(--surface-container-low)] p-8 sm:p-10 rounded-xl space-y-5" id="public-verification">
              <h3 className="font-display font-bold text-xl flex items-center gap-2 text-[var(--text-primary)]">
                <ShieldCheck className="w-5 h-5" strokeWidth={2} />
                Public Verification
              </h3>
              {verificationQuery.isLoading ? (
                <div className="space-y-3">
                  <div className="skeleton h-4 w-full" />
                  <div className="skeleton h-4 w-5/6" />
                  <div className="skeleton h-16 w-full" />
                </div>
              ) : verificationErrorMessage ? (
                <WarningCallout title="Verification Unavailable" message={`Verification artifacts could not be loaded. ${verificationErrorMessage}`} />
              ) : verification && hasPublicVerificationArtifacts ? (
                <div className="space-y-5">
                  <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                    Agora currently operates scoring, but this submission exposes the public artifacts needed to replay the scorer and check the published result independently.
                  </p>
                  <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-[var(--text-muted)]">
                    Showing artifacts for submission #{verificationSubmission.on_chain_sub_id}
                  </p>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="bg-white rounded-lg p-5">
                      <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-[var(--text-muted)]">Proof Bundle</div>
                      <div className="mt-2 break-all font-mono text-xs font-bold text-[var(--text-primary)]">
                        <LinkedValue href={cidHref(verification.proofBundleCid)} value={verification.proofBundleCid ?? "—"} />
                      </div>
                    </div>
                    <div className="bg-white rounded-lg p-5">
                      <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-[var(--text-muted)]">Replay Submission</div>
                      <div className="mt-2 break-all font-mono text-xs font-bold text-[var(--text-primary)]">
                        {verification.replaySubmissionCid ? (
                          <LinkedValue href={cidHref(verification.replaySubmissionCid)} value={verification.replaySubmissionCid} />
                        ) : (
                          "Not published for this older submission."
                        )}
                      </div>
                    </div>
                    <div className="bg-white rounded-lg p-5">
                      <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-[var(--text-muted)]">Evaluation Bundle</div>
                      <div className="mt-2 break-all font-mono text-xs font-bold text-[var(--text-primary)]">
                        <LinkedValue href={cidHref(verification.evaluationBundleCid)} value={verification.evaluationBundleCid ?? "—"} />
                      </div>
                    </div>
                    <div className="bg-white rounded-lg p-5">
                      <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-[var(--text-muted)]">Scorer Image</div>
                      <div className="mt-2 break-all font-mono text-xs font-bold text-[var(--text-primary)]">{verification.containerImageDigest ?? "—"}</div>
                      {getScorerPackageUrl(verification.containerImageDigest) && (
                        <div className="mt-3">
                          <a href={getScorerPackageUrl(verification.containerImageDigest) ?? undefined} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 rounded-lg bg-[var(--surface-container-low)] px-3 py-2 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-container-high)]">
                            <span>GHCR package</span>
                            <ExternalLink className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                          </a>
                        </div>
                      )}
                    </div>
                  </div>

                  {verifyCommand && (
                    <div className="rounded-xl bg-[var(--text-primary)] p-5 text-white">
                      <div className="text-[10px] font-mono font-bold uppercase tracking-widest opacity-60">One-command replay</div>
                      <pre className="mt-2 whitespace-pre-wrap break-all font-mono text-xs font-bold leading-relaxed text-white">{verifyCommand}</pre>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm leading-relaxed text-[var(--text-muted)]">
                  Public replay artifacts have not been published for any scored submission yet.
                </p>
              )}
            </section>
          )}

          {/* ─── Technical Details / Artifacts ─── */}
          <section className="bg-[var(--surface-container-low)] p-8 sm:p-10 rounded-xl">
            <h3 className="font-display font-bold text-xl mb-6 flex items-center gap-2 text-[var(--text-primary)]">
              <Container className="w-5 h-5" strokeWidth={2} />
              Public Challenge Artifacts
            </h3>
            <div className="space-y-4">
              {artifacts.spec_cid && (
                <div className="flex items-start gap-4 bg-white rounded-lg p-4">
                  <FileText className="w-4 h-4 mt-0.5 text-[var(--text-muted)] shrink-0" strokeWidth={1.75} />
                  <div className="min-w-0">
                    <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-[var(--text-muted)] mb-1">Challenge Spec</div>
                    <div className="font-mono text-xs font-bold text-[var(--text-primary)] break-all">
                      <LinkedValue href={artifacts.spec_url} value={artifacts.spec_cid} />
                    </div>
                  </div>
                </div>
              )}
              {artifacts.public.length > 0 ? (
                artifacts.public.map((artifact: PublicChallengeArtifact) => (
                  <div key={`${artifact.role}:${artifact.uri}`} className="flex items-start gap-4 bg-white rounded-lg p-4">
                    <Database className="w-4 h-4 mt-0.5 text-[var(--text-muted)] shrink-0" strokeWidth={1.75} />
                    <div className="min-w-0">
                      <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-[var(--text-muted)] mb-1">{formatArtifactRole(artifact.role)}</div>
                      <div className="font-mono text-xs font-bold text-[var(--text-primary)] break-all">
                        <LinkedValue href={artifact.url} value={artifact.uri} />
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex items-start gap-4 bg-white rounded-lg p-4">
                  <Database className="w-4 h-4 mt-0.5 text-[var(--text-muted)] shrink-0" strokeWidth={1.75} />
                  <div>
                    <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-[var(--text-muted)] mb-1">Public Artifacts</div>
                    <div className="text-sm text-[var(--text-secondary)]">—</div>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* ═══════════════════════════════════════════
            RIGHT COLUMN (4 cols — sticky)
            ═══════════════════════════════════════════ */}
        <div className="lg:col-span-4 space-y-6 lg:sticky lg:top-28 lg:self-start">

          {/* ─── Reward Card (dark) ─── */}
          <div className="bg-[var(--text-primary)] text-white p-8 rounded-xl shadow-[0_20px_40px_rgba(17,21,25,0.15)] relative overflow-hidden">
            <div className="relative z-10">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] opacity-60">Total Reward Pool</span>
              <div className="text-5xl font-display font-bold mt-2 mb-6">
                {formatUsdc(challenge.reward_amount)} <span className="text-2xl font-normal opacity-70">USDC</span>
              </div>
              <div className="space-y-4 mb-8">
                {distributionRows.map((row, i) => (
                  <div
                    key={row.label}
                    className={`flex justify-between items-center py-3 ${i < distributionRows.length - 1 ? "border-b border-white/10" : ""}`}
                  >
                    <span className="font-mono text-xs opacity-70 uppercase">{row.label}</span>
                    <span className="font-mono text-xs font-bold">{formatUsdc(row.amount.toFixed(2))} USDC</span>
                  </div>
                ))}
                <div className="flex justify-between items-center py-3 border-t border-white/10">
                  <span className="font-mono text-xs opacity-70 uppercase">Protocol Fee</span>
                  <span className="font-mono text-xs font-bold">{formatUsdc((Number(challenge.reward_amount) * 0.1).toFixed(2))} USDC</span>
                </div>
              </div>
              {/* Submit CTA */}
              <a
                href="#submit-solution"
                className="block w-full bg-white py-4 rounded-lg font-display font-bold text-lg text-center hover:scale-[0.98] transition-all duration-200"
                style={{ color: "var(--text-primary)" }}
              >
                Submit Solution
              </a>
            </div>
            {/* Abstract Decor */}
            <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-white/5 rounded-full blur-3xl" />
          </div>

          {/* ─── Bounty Specifications ─── */}
          <div className="bg-[var(--surface-container-low)] p-8 rounded-xl">
            <h4 className="font-display font-bold uppercase tracking-widest text-xs mb-6 text-[var(--text-muted)]">
              Bounty Specifications
            </h4>
            <div className="space-y-6">
              <div className="flex items-center gap-4">
                <CalendarClock className="w-5 h-5 text-[var(--primary-container)] shrink-0" strokeWidth={1.75} />
                <div>
                  <p className="text-[10px] font-mono uppercase text-[var(--text-muted)] leading-none mb-1">Deadline</p>
                  <p className="font-display font-bold text-[var(--text-primary)]">{formatDateTime(challenge.deadline)}</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <Trophy className="w-5 h-5 text-[var(--primary-container)] shrink-0" strokeWidth={1.75} />
                <div>
                  <p className="text-[10px] font-mono uppercase text-[var(--text-muted)] leading-none mb-1">Distribution</p>
                  <p className="font-display font-bold text-[var(--text-primary)]">{rewardDistribution}</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <Clock className="w-5 h-5 text-[var(--primary-container)] shrink-0" strokeWidth={1.75} />
                <div>
                  <p className="text-[10px] font-mono uppercase text-[var(--text-muted)] leading-none mb-1">Review Window</p>
                  <p className="font-display font-bold text-[var(--text-primary)]">
                    {challenge.dispute_window_hours != null ? `${challenge.dispute_window_hours} hours` : "—"}
                  </p>
                </div>
              </div>
              {challenge.contract_address && (
                <div className="flex items-center gap-4">
                  <FileText className="w-5 h-5 text-[var(--primary-container)] shrink-0" strokeWidth={1.75} />
                  <div>
                    <p className="text-[10px] font-mono uppercase text-[var(--text-muted)] leading-none mb-1">Challenge Contract</p>
                    <div className="flex items-center gap-2">
                      <p className="font-mono font-bold text-[var(--text-primary)]">{shortAddress(challenge.contract_address)}</p>
                      <a
                        href={getExplorerAddressUrl(challenge.contract_address) ?? undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors shrink-0"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Download artifacts link */}
            {artifacts.public.length > 0 && (
              <div className="mt-8 pt-8 border-t border-[var(--outline-variant)]/15">
                <button
                  type="button"
                  className="flex items-center justify-between w-full font-mono text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors uppercase tracking-widest"
                >
                  <span>View Challenge Artifacts</span>
                  <Download className="w-4 h-4" strokeWidth={1.75} />
                </button>
              </div>
            )}
          </div>

          {/* ─── Timeline ─── */}
          <TimelineStatus challenge={challenge} />

          {/* ─── Challenge Actions ─── */}
          <ChallengeActions
            challengeId={challenge.id}
            contractAddress={challenge.contract_address}
          />
        </div>
      </div>
    </div>
  );
}
