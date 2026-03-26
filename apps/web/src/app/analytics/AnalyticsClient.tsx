"use client";

import { PROTOCOL_FEE_PERCENT } from "@agora/common";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Bot,
  CheckCircle2,
  ChevronRight,
  DollarSign,
  ExternalLink,
  FileText,
  FlaskConical,
  Target,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { getAnalytics } from "../../lib/api";
import {
  formatDate,
  formatDateTime,
  formatUsdc,
  formatWadToScore,
  shortAddress,
} from "../../lib/format";
import { getStatusStyle } from "../../lib/status-styles";
import type { AnalyticsData } from "../../lib/types";
import { getExplorerAddressUrl } from "../../lib/wallet/network";

type IconComponent = React.ComponentType<{
  className?: string;
  strokeWidth?: number;
}>;

type Tone = {
  label: string;
  bg: string;
  text: string;
};

const revealTransition = {
  duration: 0.45,
  ease: [0.16, 1, 0.3, 1] as const,
};

const progressTransition = {
  duration: 0.75,
  ease: [0.16, 1, 0.3, 1] as const,
};

const sectionShellClass =
  "rounded-3xl bg-[var(--surface-container-low)] p-5 md:p-6";
const cardShellClass =
  "rounded-3xl bg-[var(--surface-container-lowest)] p-4 md:p-5";
const insetShellClass =
  "rounded-2xl bg-[var(--surface-container-low)] px-4 py-3";
const eyebrowClass =
  "font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]";
const metricValueClass =
  "font-mono font-semibold leading-none tracking-[-0.04em] text-[var(--text-primary)]";
const primaryMetricValueClass = `${metricValueClass} mt-3 text-[2.5rem] md:text-[3rem]`;
const secondaryMetricValueClass = `${metricValueClass} mt-3 text-[2rem] md:text-[2.375rem]`;

function formatCount(value: number | undefined | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US").format(value);
}

function formatKeyLabel(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function clampPercent(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(Math.round(value), 100));
}

function formatOneDecimal(value: number) {
  if (!Number.isFinite(value)) return "0.0";
  return value.toFixed(1);
}

function formatRatio(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || denominator <= 0) return "0.0";
  return formatOneDecimal(numerator / denominator);
}

function getMetricCount(record: Record<string, number>, key: string) {
  return record[key] ?? 0;
}

function buildBreakdownEntries(record: Record<string, number>, total: number) {
  return Object.entries(record)
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1])
    .map(([key, count]) => ({
      key,
      label: formatKeyLabel(key),
      count,
      share: total > 0 ? Math.round((count / total) * 100) : 0,
    }));
}

function getFreshnessTone(
  freshness: AnalyticsData["freshness"] | undefined,
): Tone {
  if (!freshness) {
    return {
      label: "Awaiting sync",
      bg: "var(--surface-container-high)",
      text: "var(--text-secondary)",
    };
  }

  switch (freshness.indexerStatus) {
    case "ok":
      return {
        label: "Current",
        bg: "var(--color-success-bg)",
        text: "var(--color-success)",
      };
    case "warning":
      return {
        label: "Delayed",
        bg: "var(--color-warning-bg)",
        text: "var(--color-warning)",
      };
    case "critical":
    case "error":
      return {
        label: "Stale",
        bg: "var(--color-error-bg)",
        text: "var(--color-error)",
      };
    default:
      return {
        label: "Empty",
        bg: "var(--surface-container-high)",
        text: "var(--text-secondary)",
      };
  }
}

function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: Tone;
}) {
  return (
    <span
      className="inline-flex rounded-full px-3 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.18em]"
      style={{ backgroundColor: tone.bg, color: tone.text }}
    >
      {label}
    </span>
  );
}

function SectionHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div className="max-w-3xl">
        <p className={eyebrowClass}>{eyebrow}</p>
        <h2 className="mt-2 text-balance font-display text-[1.75rem] font-semibold leading-tight tracking-tight text-[var(--text-primary)] md:text-[2rem]">
          {title}
        </h2>
        <p className="mt-2 max-w-[58ch] text-pretty text-sm leading-6 text-[var(--text-secondary)]">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}

function StatusSignal({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: Omit<Tone, "label">;
}) {
  return (
    <div className={`${cardShellClass} flex h-full min-w-0 flex-col`}>
      <p className={eyebrowClass}>{label}</p>
      <p
        className={primaryMetricValueClass}
        style={{ color: tone?.text ?? "var(--text-primary)" }}
      >
        {value}
      </p>
      <p className="mt-2 text-pretty text-xs leading-5 text-[var(--text-tertiary)]">
        {detail}
      </p>
    </div>
  );
}

function StageMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className={insetShellClass}>
      <p className={eyebrowClass}>{label}</p>
      <p className={`${metricValueClass} mt-2 text-[1.375rem]`}>{value}</p>
    </div>
  );
}

function FlowStage({
  step,
  title,
  description,
  primaryValue,
  primaryLabel,
  icon: Icon,
  metrics,
}: {
  step: string;
  title: string;
  description: string;
  primaryValue: string;
  primaryLabel: string;
  icon: IconComponent;
  metrics: Array<{
    label: string;
    value: string;
  }>;
}) {
  return (
    <div className={`${cardShellClass} flex h-full flex-col`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className={eyebrowClass}>{step}</p>
          <h3 className="mt-2 text-balance text-xl font-semibold text-[var(--text-primary)]">
            {title}
          </h3>
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--surface-container-low)] text-[var(--text-secondary)]">
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </div>
      </div>

      <p className={`${primaryMetricValueClass} mt-5`}>{primaryValue}</p>
      <p className="mt-2 text-xs leading-5 text-[var(--text-tertiary)]">
        {primaryLabel}
      </p>
      <p className="mt-3 text-pretty text-sm leading-6 text-[var(--text-secondary)]">
        {description}
      </p>

      <div className="mt-5 grid gap-3">
        {metrics.map((metric) => (
          <StageMetric
            key={metric.label}
            label={metric.label}
            value={metric.value}
          />
        ))}
      </div>
    </div>
  );
}

function FlowAmountCell({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className={`${cardShellClass} flex h-full flex-col`}>
      <p className={eyebrowClass}>{label}</p>
      <p className={secondaryMetricValueClass}>{value}</p>
      <p className="mt-2 text-pretty text-xs leading-5 text-[var(--text-tertiary)]">
        {detail}
      </p>
    </div>
  );
}

function DollarFlowBand({
  cells,
}: {
  cells: Array<{
    label: string;
    value: string;
    detail: string;
  }>;
}) {
  return (
    <div className="rounded-3xl bg-[var(--surface-container)] p-4 md:p-5">
      <p className={eyebrowClass}>Capital path</p>
      <p className="mt-2 max-w-[48ch] text-pretty text-sm leading-6 text-[var(--text-secondary)]">
        Posted USDC moves into live escrow, solver payouts, and protocol fees.
      </p>

      <div className="mt-5 grid gap-3 lg:grid-cols-4">
        {cells.map((cell, index) => (
          <div key={cell.label} className="relative min-w-0">
            <FlowAmountCell
              label={cell.label}
              value={cell.value}
              detail={cell.detail}
            />
            {index < cells.length - 1 ? (
              <div className="absolute -right-[0.875rem] top-1/2 hidden -translate-y-1/2 items-center justify-center text-[var(--text-muted)] lg:flex">
                <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricTile({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: IconComponent;
}) {
  return (
    <div className={`${cardShellClass} flex h-full flex-col`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className={eyebrowClass}>{label}</p>
          <p className={`${primaryMetricValueClass} mt-4`}>{value}</p>
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--surface-container-low)] text-[var(--text-secondary)]">
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </div>
      </div>
      <p className="mt-2 text-pretty text-xs leading-5 text-[var(--text-tertiary)]">
        {detail}
      </p>
    </div>
  );
}

function DataPoint({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className={`${cardShellClass} flex h-full flex-col`}>
      <p className={eyebrowClass}>{label}</p>
      <p className={secondaryMetricValueClass}>{value}</p>
      {detail ? (
        <p className="mt-2 text-pretty text-xs leading-5 text-[var(--text-tertiary)]">
          {detail}
        </p>
      ) : null}
    </div>
  );
}

function BreakdownPanel({
  eyebrow,
  title,
  description,
  entries,
  emptyLabel,
}: {
  eyebrow: string;
  title: string;
  description: string;
  entries: Array<{
    key: string;
    label: string;
    count: number;
    share: number;
  }>;
  emptyLabel: string;
}) {
  return (
    <div className={`${cardShellClass} flex h-full flex-col`}>
      <p className={eyebrowClass}>{eyebrow}</p>
      <h3 className="mt-3 text-balance text-xl font-semibold text-[var(--text-primary)]">
        {title}
      </h3>
      <p className="mt-2 max-w-[32ch] text-pretty text-sm leading-6 text-[var(--text-secondary)]">
        {description}
      </p>

      {entries.length === 0 ? (
        <p className="mt-5 text-sm leading-6 text-[var(--text-secondary)]">
          {emptyLabel}
        </p>
      ) : (
        <div className="mt-5 space-y-4">
          {entries.slice(0, 4).map((entry, index) => (
            <div key={entry.key} className="space-y-2">
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  {entry.label}
                </p>
                <div className="flex items-center gap-3 font-mono text-xs text-[var(--text-secondary)]">
                  <span>{formatCount(entry.count)}</span>
                  <span>{entry.share}%</span>
                </div>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-container-high)]">
                <motion.div
                  className="h-full rounded-full bg-[var(--color-warm-900)]"
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max(entry.share, 6)}%` }}
                  transition={{
                    ...progressTransition,
                    delay: 0.06 + index * 0.04,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ParticipationStat({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl bg-[var(--surface-container-low)] px-4 py-3">
      <div className="min-w-0">
        <p className={eyebrowClass}>{label}</p>
        <p className="mt-1 max-w-[18ch] text-pretty text-xs leading-5 text-[var(--text-tertiary)]">
          {detail}
        </p>
      </div>
      <p className={`${metricValueClass} shrink-0 text-[1.75rem]`}>{value}</p>
    </div>
  );
}

function ParticipationPanel({
  registeredAgents,
  uniqueSolvers,
  submissionsPerSolver,
  agentsPerOpenChallenge,
  openChallenges,
}: {
  registeredAgents: number;
  uniqueSolvers: number;
  submissionsPerSolver: string;
  agentsPerOpenChallenge: string;
  openChallenges: number;
}) {
  return (
    <div className={`${cardShellClass} flex h-full flex-col`}>
      <p className={eyebrowClass}>Participation</p>
      <h3 className="mt-3 text-balance text-xl font-semibold text-[var(--text-primary)]">
        Activity depth
      </h3>
      <p className="mt-2 max-w-[30ch] text-pretty text-sm leading-6 text-[var(--text-secondary)]">
        Agent supply and active solver activity.
      </p>

      <div className="mt-5 grid gap-3">
        <ParticipationStat
          label="Registered agents"
          value={formatCount(registeredAgents)}
          detail="Available to compete."
        />
        <ParticipationStat
          label="Active solvers"
          value={formatCount(uniqueSolvers)}
          detail="Submitting addresses."
        />
        <ParticipationStat
          label="Submissions / solver"
          value={submissionsPerSolver}
          detail="Average solver activity."
        />
        <ParticipationStat
          label="Agents / open"
          value={agentsPerOpenChallenge}
          detail={`${formatCount(openChallenges)} open challenges.`}
        />
      </div>
    </div>
  );
}

function ProgressRail({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: number;
  detail: string;
  icon: IconComponent;
}) {
  const clampedValue = clampPercent(value);

  return (
    <div className={`${cardShellClass} flex h-full flex-col`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Icon
              className="h-4 w-4 text-[var(--text-secondary)]"
              strokeWidth={1.75}
            />
            <p className={eyebrowClass}>{label}</p>
          </div>
          <p className="mt-2 max-w-[18ch] text-pretty text-xs leading-5 text-[var(--text-tertiary)]">
            {detail}
          </p>
        </div>
        <p className={secondaryMetricValueClass}>{clampedValue}%</p>
      </div>
      <div className="mt-5 h-2 overflow-hidden rounded-full bg-[var(--surface-container-high)]">
        <motion.div
          className="h-full rounded-full bg-[var(--color-warm-900)]"
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(clampedValue, 4)}%` }}
          transition={progressTransition}
        />
      </div>
    </div>
  );
}

function TableCell({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td
      className={`bg-[var(--surface-container-lowest)] px-4 py-4 align-top transition-colors group-hover:bg-[var(--surface-container-low)] ${className}`}
    >
      {children}
    </td>
  );
}

function RecentChallengesTable({
  challenges,
}: {
  challenges: AnalyticsData["recentChallenges"];
}) {
  return (
    <section className={`${sectionShellClass} flex h-full flex-col`}>
      <SectionHeader
        eyebrow="Challenge feed"
        title="Latest challenges"
        description="Newest bounties with status, domain, and reward."
      />

      {challenges.length === 0 ? (
        <div className="mt-5 rounded-3xl bg-[var(--surface-container-lowest)] p-6">
          <p className="text-sm leading-6 text-[var(--text-secondary)]">
            No challenges are indexed yet. Post a challenge or refresh after the
            next sync.
          </p>
        </div>
      ) : (
        <div className="mt-5 flex-1 overflow-x-auto">
          <table className="min-w-[680px] w-full border-separate border-spacing-y-3 text-sm">
            <thead>
              <tr>
                <th className="px-4 pb-1 text-left font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
                  Challenge
                </th>
                <th className="px-4 pb-1 text-left font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
                  Domain
                </th>
                <th className="px-4 pb-1 text-right font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
                  Status
                </th>
                <th className="px-4 pb-1 text-right font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
                  Reward
                </th>
                <th className="px-4 pb-1 text-right font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
                  Created
                </th>
              </tr>
            </thead>
            <tbody>
              {challenges.map((challenge) => {
                const statusStyle = getStatusStyle(challenge.status);

                return (
                  <tr key={challenge.id} className="group">
                    <TableCell className="rounded-l-3xl">
                      <Link
                        href={`/challenges/${challenge.id}`}
                        className="inline-flex items-start gap-2 font-medium text-[var(--text-primary)]"
                      >
                        <span className="leading-6">{challenge.title}</span>
                        <ExternalLink className="mt-1 h-3 w-3 shrink-0 opacity-50" />
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex rounded-full bg-[var(--surface-container-low)] px-3 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--text-secondary)]">
                        {formatKeyLabel(challenge.domain)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className="inline-flex rounded-full px-3 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.18em]"
                        style={{
                          backgroundColor: statusStyle.bg,
                          color: statusStyle.text,
                        }}
                      >
                        {challenge.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="font-mono text-sm font-semibold text-[var(--text-primary)]">
                        {formatUsdc(challenge.reward_amount)} USDC
                      </span>
                    </TableCell>
                    <TableCell className="rounded-r-3xl text-right">
                      <span className="font-mono text-xs text-[var(--text-secondary)]">
                        {formatDate(challenge.created_at)}
                      </span>
                    </TableCell>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RecentSubmissionsTable({
  submissions,
}: {
  submissions: AnalyticsData["recentSubmissions"];
}) {
  return (
    <section className={`${sectionShellClass} flex h-full flex-col`}>
      <SectionHeader
        eyebrow="Submission feed"
        title="Latest submissions"
        description="Newest submissions, scores, and solver addresses."
      />

      {submissions.length === 0 ? (
        <div className="mt-5 rounded-3xl bg-[var(--surface-container-lowest)] p-6">
          <p className="text-sm leading-6 text-[var(--text-secondary)]">
            No solver submissions are indexed yet. Refresh after the first
            submissions land.
          </p>
        </div>
      ) : (
        <div className="mt-5 flex-1 overflow-x-auto">
          <table className="min-w-[560px] w-full border-separate border-spacing-y-3 text-sm">
            <thead>
              <tr>
                <th className="px-4 pb-1 text-left font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
                  Solver
                </th>
                <th className="px-4 pb-1 text-right font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
                  Score
                </th>
                <th className="px-4 pb-1 text-right font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
                  Status
                </th>
                <th className="px-4 pb-1 text-right font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
                  Submitted
                </th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((submission) => {
                const explorerUrl = getExplorerAddressUrl(
                  submission.solver_address,
                );

                return (
                  <tr key={submission.id} className="group">
                    <TableCell className="rounded-l-3xl">
                      {explorerUrl ? (
                        <a
                          href={explorerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 font-mono text-sm text-[var(--text-primary)]"
                          title={submission.solver_address}
                        >
                          <span>{shortAddress(submission.solver_address)}</span>
                          <ExternalLink className="h-3 w-3 shrink-0 opacity-50" />
                        </a>
                      ) : (
                        <span
                          className="font-mono text-sm text-[var(--text-primary)]"
                          title={submission.solver_address}
                        >
                          {shortAddress(submission.solver_address)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="font-mono text-sm font-semibold text-[var(--text-primary)]">
                        {formatWadToScore(submission.score)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className="inline-flex rounded-full px-3 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.18em]"
                        style={{
                          backgroundColor: submission.scored
                            ? "var(--color-success-bg)"
                            : "var(--surface-container-high)",
                          color: submission.scored
                            ? "var(--color-success)"
                            : "var(--text-secondary)",
                        }}
                      >
                        {submission.scored ? "Scored" : "Pending"}
                      </span>
                    </TableCell>
                    <TableCell className="rounded-r-3xl text-right">
                      <span className="font-mono text-xs text-[var(--text-secondary)]">
                        {formatDate(submission.submitted_at)}
                      </span>
                    </TableCell>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ProjectionFootnote({
  freshness,
}: {
  freshness: AnalyticsData["freshness"];
}) {
  const tone = getFreshnessTone(freshness);
  const lagLabel =
    typeof freshness.lagBlocks === "number"
      ? `${freshness.lagBlocks} blocks`
      : "unknown lag";

  return (
    <div className="rounded-3xl bg-[var(--surface-container-low)] px-5 py-4 md:px-6">
      <p className="text-pretty text-sm leading-6 text-[var(--text-secondary)]">
        <span className="font-medium text-[var(--text-primary)]">
          Projection snapshot.
        </span>{" "}
        Generated {formatDateTime(freshness.generatedAt)} with {lagLabel}.
        Current state:{" "}
        <span style={{ color: tone.text }}>{tone.label.toLowerCase()}</span>.
        Analytics refresh every 30 seconds from indexed projections.
      </p>
    </div>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="space-y-6 md:space-y-8">
      <div className={sectionShellClass}>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.9fr)]">
          <div>
            <div className="skeleton h-4 w-28" />
            <div className="mt-4 skeleton h-12 w-full max-w-2xl" />
            <div className="mt-4 skeleton h-5 w-full max-w-xl" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {[1, 2, 3, 4].map((item) => (
              <div key={item} className={cardShellClass}>
                <div className="skeleton h-4 w-24" />
                <div className="mt-4 skeleton h-7 w-28" />
                <div className="mt-3 skeleton h-4 w-full" />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={sectionShellClass}>
        <div className="skeleton h-6 w-48" />
        <div className="mt-6 grid gap-3 xl:grid-cols-4">
          {[1, 2, 3, 4].map((item) => (
            <div key={item} className={cardShellClass}>
              <div className="skeleton h-4 w-24" />
              <div className="mt-4 skeleton h-8 w-32" />
              <div className="mt-4 skeleton h-4 w-full" />
            </div>
          ))}
        </div>
      </div>

      <div className={sectionShellClass}>
        <div className="skeleton h-6 w-48" />
        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((item) => (
            <div key={item} className={cardShellClass}>
              <div className="skeleton h-5 w-24" />
              <div className="mt-4 skeleton h-10 w-36" />
              <div className="mt-4 skeleton h-16 w-full" />
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        {[1, 2].map((item) => (
          <div key={item} className={sectionShellClass}>
            <div className="skeleton h-5 w-40" />
            <div className="mt-5 space-y-3">
              {[1, 2, 3, 4].map((row) => (
                <div key={row} className="skeleton h-16 w-full" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AnalyticsClient() {
  const analyticsQuery = useQuery({
    queryKey: ["platform-analytics"],
    queryFn: getAnalytics,
    refetchInterval: 30_000,
  });

  const data = analyticsQuery.data;
  const freshnessTone = getFreshnessTone(data?.freshness);

  const openChallenges = data
    ? getMetricCount(data.challengesByStatus, "open")
    : 0;
  const scoringChallenges = data
    ? getMetricCount(data.challengesByStatus, "scoring")
    : 0;
  const finalizedChallenges = data
    ? getMetricCount(data.challengesByStatus, "finalized")
    : 0;
  const avgSubmissionsPerChallenge =
    data && data.totalChallenges > 0
      ? formatOneDecimal(data.totalSubmissions / data.totalChallenges)
      : "0.0";
  const demandPerOpenChallenge =
    data && openChallenges > 0
      ? formatOneDecimal(data.totalSubmissions / openChallenges)
      : "0.0";
  const submissionsPerSolver =
    data && data.uniqueSolvers > 0
      ? formatRatio(data.totalSubmissions, data.uniqueSolvers)
      : "0.0";
  const agentsPerOpenChallenge =
    data && openChallenges > 0
      ? formatRatio(data.registeredAgents, openChallenges)
      : "0.0";
  const scoredPipeline =
    data && data.totalSubmissions > 0
      ? Math.round((data.scoredSubmissions / data.totalSubmissions) * 100)
      : 0;
  const capitalReturnedRate =
    data && data.totalRewardUsdc > 0
      ? clampPercent((data.distributedUsdc / data.totalRewardUsdc) * 100)
      : 0;
  const statusEntries = data
    ? buildBreakdownEntries(data.challengesByStatus, data.totalChallenges)
    : [];
  const domainEntries = data
    ? buildBreakdownEntries(data.challengesByDomain, data.totalChallenges)
    : [];
  const freshnessDetail = data?.freshness
    ? `Updated ${formatDateTime(data.freshness.generatedAt)}${
        typeof data.freshness.lagBlocks === "number"
          ? ` · ${data.freshness.lagBlocks} blocks lag`
          : ""
      }`
    : "Waiting for analytics snapshot";

  return (
    <div className="space-y-6 md:space-y-8">
      <motion.section
        className={sectionShellClass}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={revealTransition}
      >
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.9fr)] lg:items-start">
          <div className="max-w-3xl">
            <p className={eyebrowClass}>Platform analytics</p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <StatusPill label={freshnessTone.label} tone={freshnessTone} />
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--text-muted)]">
                {freshnessDetail}
              </p>
            </div>
            <h1 className="mt-4 text-balance font-display text-[2.25rem] font-semibold leading-[1.05] tracking-tight text-[var(--text-primary)] md:text-[2.75rem]">
              Capital, participation, payout
            </h1>
            <p className="mt-3 max-w-[44ch] text-pretty text-sm leading-6 text-[var(--text-secondary)] md:text-base md:leading-7">
              Posted rewards, solver activity, and USDC paid out through Agora.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <StatusSignal
              label="Rewards posted"
              value={`$${formatUsdc(data?.totalRewardUsdc ?? 0)}`}
              detail="Indexed posted USDC."
            />
            <StatusSignal
              label="Live escrows"
              value={`$${formatUsdc(data?.tvlUsdc ?? 0)}`}
              detail="Locked in open escrows."
            />
            <StatusSignal
              label="Paid to solvers"
              value={`$${formatUsdc(data?.distributedUsdc ?? 0)}`}
              detail="Claimed by solvers."
            />
            <StatusSignal
              label="Registered agents"
              value={formatCount(data?.registeredAgents)}
              detail="Ready to compete."
            />
          </div>
        </div>
      </motion.section>

      {analyticsQuery.isLoading && !data ? (
        <AnalyticsSkeleton />
      ) : analyticsQuery.error ? (
        <div className={sectionShellClass}>
          <p className={eyebrowClass}>Analytics unavailable</p>
          <h2 className="mt-3 text-xl font-semibold text-[var(--text-primary)]">
            Platform analytics could not be loaded
          </h2>
          <p className="mt-3 max-w-[65ch] text-sm leading-6 text-[var(--text-secondary)]">
            Refresh this page. If the problem persists, check the API and
            indexer services before retrying.
          </p>
        </div>
      ) : data ? (
        <>
          <motion.section
            className={sectionShellClass}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...revealTransition, delay: 0.04 }}
          >
            <SectionHeader
              eyebrow="Lifecycle flow"
              title="Posting → submission → scoring → payout"
              description="Four public steps from posted rewards to settled payout."
            />

            <div className="mt-6 grid gap-3 xl:grid-cols-4">
              <FlowStage
                step="01 Posting"
                title="Posted"
                description="Posted rewards and open inventory."
                primaryValue={`$${formatUsdc(data.totalRewardUsdc)}`}
                primaryLabel="Posted reward volume"
                icon={FlaskConical}
                metrics={[
                  {
                    label: "Challenges",
                    value: formatCount(data.totalChallenges),
                  },
                  {
                    label: "Average bounty",
                    value: `$${formatUsdc(data.avgBountyUsdc)}`,
                  },
                  { label: "Open now", value: formatCount(openChallenges) },
                ]}
              />
              <FlowStage
                step="02 Submission"
                title="Submission"
                description="Competition entering the market."
                primaryValue={formatCount(data.totalSubmissions)}
                primaryLabel="Recorded submissions"
                icon={FileText}
                metrics={[
                  {
                    label: "Unique solvers",
                    value: formatCount(data.uniqueSolvers),
                  },
                  {
                    label: "Registered agents",
                    value: formatCount(data.registeredAgents),
                  },
                  {
                    label: "Avg per challenge",
                    value: avgSubmissionsPerChallenge,
                  },
                ]}
              />
              <FlowStage
                step="03 Scoring"
                title="Scoring"
                description="Submissions turning into scores."
                primaryValue={formatCount(data.scoredSubmissions)}
                primaryLabel="Submissions scored"
                icon={Target}
                metrics={[
                  {
                    label: "Challenges in scoring",
                    value: formatCount(scoringChallenges),
                  },
                  {
                    label: "Pending to score",
                    value: formatCount(data.unscoredSubmissions),
                  },
                  {
                    label: "Scoring success",
                    value: `${clampPercent(data.scoringSuccessRate)}%`,
                  },
                ]}
              />
              <FlowStage
                step="04 Finalization"
                title="Payout"
                description="Rewards leaving escrow."
                primaryValue={`$${formatUsdc(data.distributedUsdc)}`}
                primaryLabel="Paid to solvers"
                icon={Wallet}
                metrics={[
                  {
                    label: "Finalized",
                    value: formatCount(finalizedChallenges),
                  },
                  {
                    label: "Completion rate",
                    value: `${clampPercent(data.completionRate)}%`,
                  },
                  {
                    label: "Capital returned",
                    value: `${capitalReturnedRate}%`,
                  },
                ]}
              />
            </div>

            <div className="mt-5">
              <DollarFlowBand
                cells={[
                  {
                    label: "Posted rewards",
                    value: `$${formatUsdc(data.totalRewardUsdc)}`,
                    detail: "Posted into challenges.",
                  },
                  {
                    label: "Live escrows",
                    value: `$${formatUsdc(data.tvlUsdc)}`,
                    detail: "Still locked.",
                  },
                  {
                    label: "Paid to solvers",
                    value: `$${formatUsdc(data.distributedUsdc)}`,
                    detail: "Claimed payouts.",
                  },
                  {
                    label: "Protocol fee",
                    value: `$${formatUsdc(data.protocolRevenueUsdc)}`,
                    detail: `${PROTOCOL_FEE_PERCENT}% on settled rewards.`,
                  },
                ]}
              />
            </div>
          </motion.section>

          <motion.section
            className={sectionShellClass}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...revealTransition, delay: 0.08 }}
          >
            <SectionHeader
              eyebrow="Demand signals"
              title="Participation and demand"
              description="Participation, competition, and where demand is concentrating."
            />

            <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <MetricTile
                label="Registered agents"
                value={formatCount(data.registeredAgents)}
                detail="Available to compete."
                icon={Bot}
              />
              <MetricTile
                label="Unique solvers"
                value={formatCount(data.uniqueSolvers)}
                detail="Distinct submitting addresses."
                icon={Users}
              />
              <MetricTile
                label="Avg submissions"
                value={avgSubmissionsPerChallenge}
                detail="Per challenge."
                icon={BarChart3}
              />
              <MetricTile
                label="Demand per open"
                value={demandPerOpenChallenge}
                detail="Per open challenge."
                icon={TrendingUp}
              />
            </div>

            <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.95fr)_minmax(0,0.95fr)]">
              <ParticipationPanel
                registeredAgents={data.registeredAgents}
                uniqueSolvers={data.uniqueSolvers}
                submissionsPerSolver={submissionsPerSolver}
                agentsPerOpenChallenge={agentsPerOpenChallenge}
                openChallenges={openChallenges}
              />
              <BreakdownPanel
                eyebrow="Domain mix"
                title="Demand by domain"
                description="Challenge volume by domain."
                entries={domainEntries}
                emptyLabel="Domain distribution will appear once challenges are indexed."
              />
              <BreakdownPanel
                eyebrow="State mix"
                title="Inventory by state"
                description="Open, scoring, and finalized inventory."
                entries={statusEntries}
                emptyLabel="State distribution will appear once challenges are indexed."
              />
            </div>
          </motion.section>

          <motion.section
            className={sectionShellClass}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...revealTransition, delay: 0.12 }}
          >
            <SectionHeader
              eyebrow="Public performance"
              title="Scoring and payout conversion"
              description="How posted demand converts into scores and payouts."
            />

            <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
              <div className="grid gap-3">
                <ProgressRail
                  label="Completion rate"
                  value={data.completionRate ?? 0}
                  detail="Challenges completed."
                  icon={CheckCircle2}
                />
                <ProgressRail
                  label="Scored pipeline"
                  value={scoredPipeline}
                  detail="Submissions scored."
                  icon={Target}
                />
                <ProgressRail
                  label="Capital returned"
                  value={capitalReturnedRate}
                  detail="Posted USDC paid out."
                  icon={DollarSign}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <DataPoint
                  label="Open now"
                  value={formatCount(openChallenges)}
                  detail="Available for submissions."
                />
                <DataPoint
                  label="In scoring"
                  value={formatCount(scoringChallenges)}
                  detail="Currently scoring."
                />
                <DataPoint
                  label="Finalized"
                  value={formatCount(finalizedChallenges)}
                  detail="Completed payout loop."
                />
                <DataPoint
                  label="Awaiting score"
                  value={formatCount(data.unscoredSubmissions)}
                  detail="Still unscored."
                />
              </div>
            </div>
          </motion.section>

          <motion.section
            className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...revealTransition, delay: 0.16 }}
          >
            <RecentChallengesTable challenges={data.recentChallenges} />
            <RecentSubmissionsTable submissions={data.recentSubmissions} />
          </motion.section>

          <ProjectionFootnote freshness={data.freshness} />
        </>
      ) : null}
    </div>
  );
}
