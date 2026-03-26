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
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { motion } from "motion/react";
import { getAnalytics } from "../../lib/api";
import {
  formatDate,
  formatDateTime,
  formatUsdc,
  formatWadToScore,
  shortAddress,
} from "../../lib/format";
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

const pageStackClass = "space-y-4 overflow-x-hidden md:space-y-5";
const sectionShellClass =
  "rounded-[1.75rem] bg-[var(--surface-container-low)] p-4 md:p-5";
const cardShellClass =
  "rounded-[1.5rem] bg-[var(--surface-container-lowest)] p-4";
const insetShellClass =
  "rounded-[1.125rem] bg-[var(--surface-container-low)] px-3.5 py-3";
const eyebrowClass =
  "font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]";
const pillClass =
  "inline-flex rounded-full px-2.5 py-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.18em]";
const feedItemShellClass =
  "rounded-[1.375rem] bg-[var(--surface-container-lowest)] px-4 py-3.5";
const metricValueClass =
  "font-mono font-semibold leading-none tracking-[-0.04em] text-[var(--text-primary)]";
const primaryMetricValueClass = `${metricValueClass} text-[clamp(2rem,5vw,2.625rem)]`;
const secondaryMetricValueClass = `${metricValueClass} text-[clamp(1.5rem,3vw,2rem)]`;
const domainChartColors = [
  "var(--color-accent-600)",
  "var(--color-accent-500)",
  "var(--color-accent-400)",
  "var(--color-warm-700)",
  "var(--color-warm-600)",
  "var(--color-warm-400)",
];

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
      className={pillClass}
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
    <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
      <div className="max-w-3xl">
        <p className={eyebrowClass}>{eyebrow}</p>
        <h2 className="mt-1.5 text-balance font-display text-[1.625rem] font-semibold leading-tight tracking-tight text-[var(--text-primary)] md:text-[1.875rem] xl:whitespace-nowrap">
          {title}
        </h2>
        <p className="mt-1.5 max-w-[56ch] text-pretty text-sm leading-6 text-[var(--text-secondary)]">
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
    <div
      className={`${cardShellClass} flex h-full min-w-0 flex-col justify-between`}
    >
      <p className={eyebrowClass}>{label}</p>
      <p
        className={`${primaryMetricValueClass} mt-2.5`}
        style={{ color: tone?.text ?? "var(--text-primary)" }}
      >
        {value}
      </p>
      <p className="mt-1.5 text-pretty text-xs leading-5 text-[var(--text-tertiary)]">
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
      <p
        className={`${metricValueClass} mt-1.5 text-[1.25rem] md:text-[1.3125rem]`}
      >
        {value}
      </p>
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
    <div className={`${cardShellClass} flex h-full min-w-0 flex-col`}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={eyebrowClass}>{step}</p>
          <h3 className="mt-1.5 text-balance text-[1.125rem] font-semibold text-[var(--text-primary)] md:text-[1.1875rem] lg:whitespace-nowrap">
            {title}
          </h3>
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-container-low)] text-[var(--text-secondary)]">
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </div>
      </div>

      <p className={`${primaryMetricValueClass} mt-4`}>{primaryValue}</p>
      <p className="mt-1.5 text-xs leading-5 text-[var(--text-tertiary)]">
        {primaryLabel}
      </p>
      <p className="mt-2.5 text-pretty text-sm leading-6 text-[var(--text-secondary)]">
        {description}
      </p>

      <div className="mt-4 grid gap-2.5">
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
      <p className={`${secondaryMetricValueClass} mt-2.5`}>{value}</p>
      <p className="mt-1.5 text-pretty text-xs leading-5 text-[var(--text-tertiary)]">
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
    <div className="overflow-hidden rounded-[1.625rem] bg-[var(--surface-container)] p-4">
      <p className={eyebrowClass}>Capital path</p>
      <p className="mt-1.5 max-w-[46ch] text-pretty text-sm leading-6 text-[var(--text-secondary)]">
        Posted USDC moves into live escrow, solver payouts, and protocol fees.
      </p>

      <div className="mt-4 grid gap-2.5 lg:grid-cols-4">
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
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={eyebrowClass}>{label}</p>
          <p className={`${primaryMetricValueClass} mt-3`}>{value}</p>
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-container-low)] text-[var(--text-secondary)]">
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </div>
      </div>
      <p className="mt-1.5 text-pretty text-xs leading-5 text-[var(--text-tertiary)]">
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
      <p className={`${secondaryMetricValueClass} mt-2.5`}>{value}</p>
      {detail ? (
        <p className="mt-1.5 text-pretty text-xs leading-5 text-[var(--text-tertiary)]">
          {detail}
        </p>
      ) : null}
    </div>
  );
}

function DomainDonutPanel({
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
  const chartEntries = entries.slice(0, 6).map((entry, index) => ({
    ...entry,
    color: domainChartColors[index % domainChartColors.length],
  }));
  const totalCount = chartEntries.reduce((sum, entry) => sum + entry.count, 0);
  const donutRadius = 48;
  const donutCircumference = 2 * Math.PI * donutRadius;
  let cumulativeFraction = 0;

  return (
    <div className={`${cardShellClass} flex h-full flex-col`}>
      <p className={eyebrowClass}>{eyebrow}</p>
      <h3 className="mt-2.5 text-balance text-[1.125rem] font-semibold text-[var(--text-primary)] md:text-[1.1875rem] lg:whitespace-nowrap">
        {title}
      </h3>
      <p className="mt-1.5 max-w-[30ch] text-pretty text-sm leading-6 text-[var(--text-secondary)]">
        {description}
      </p>

      {entries.length === 0 ? (
        <p className="mt-4 text-sm leading-6 text-[var(--text-secondary)]">
          {emptyLabel}
        </p>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-start">
          <div className="mx-auto flex w-full max-w-[220px] flex-col items-center">
            <div className="relative h-[200px] w-[200px]">
              <svg
                viewBox="0 0 160 160"
                className="h-full w-full -rotate-90 overflow-visible"
                aria-hidden="true"
              >
                <circle
                  cx="80"
                  cy="80"
                  r={donutRadius}
                  fill="none"
                  stroke="var(--surface-container-high)"
                  strokeWidth="14"
                />
                {chartEntries.map((entry, index) => {
                  const fraction =
                    totalCount > 0 ? entry.count / totalCount : 0;
                  const segmentLength = fraction * donutCircumference;
                  const dashArray = `${segmentLength} ${donutCircumference - segmentLength}`;
                  const dashOffset = -cumulativeFraction * donutCircumference;
                  cumulativeFraction += fraction;

                  return (
                    <motion.circle
                      key={entry.key}
                      cx="80"
                      cy="80"
                      r={donutRadius}
                      fill="none"
                      stroke={entry.color}
                      strokeWidth="14"
                      strokeDasharray={dashArray}
                      strokeDashoffset={dashOffset}
                      initial={{ strokeDasharray: `0 ${donutCircumference}` }}
                      animate={{ strokeDasharray: dashArray }}
                      transition={{
                        ...progressTransition,
                        delay: 0.08 + index * 0.05,
                      }}
                    />
                  );
                })}
              </svg>

              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <p className={`${metricValueClass} text-[2rem]`}>
                  {formatCount(totalCount)}
                </p>
                <p className={eyebrowClass}>Challenges</p>
              </div>
            </div>

            <p className="mt-2 text-center text-xs leading-5 text-[var(--text-tertiary)]">
              {formatCount(chartEntries.length)} active domains indexed.
            </p>
          </div>

          <div className="grid gap-2.5 lg:pt-1">
            {chartEntries.map((entry) => (
              <div
                key={entry.key}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[1.125rem] bg-[var(--surface-container-low)] px-3.5 py-3"
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: entry.color }}
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                    {entry.label}
                  </p>
                </div>
                <div className="shrink-0 text-right font-mono text-xs text-[var(--text-secondary)]">
                  <span>{formatCount(entry.count)}</span>
                  <span className="ml-2">{entry.share}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
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
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon
              className="h-4 w-4 text-[var(--text-secondary)]"
              strokeWidth={1.75}
            />
            <p className={eyebrowClass}>{label}</p>
          </div>
          <p className="mt-1.5 max-w-[18ch] text-pretty text-xs leading-5 text-[var(--text-tertiary)]">
            {detail}
          </p>
        </div>
        <p className={`${secondaryMetricValueClass} shrink-0`}>
          {clampedValue}%
        </p>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--surface-container-high)]">
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
        <div className="mt-4 rounded-[1.375rem] bg-[var(--surface-container-lowest)] p-5">
          <p className="text-sm leading-6 text-[var(--text-secondary)]">
            No solver submissions are indexed yet. Refresh after the first
            submissions land.
          </p>
        </div>
      ) : (
        <div className="mt-4 grid gap-2.5">
          {submissions.map((submission) => {
            const explorerUrl = getExplorerAddressUrl(
              submission.solver_address,
            );

            return (
              <div key={submission.id} className={feedItemShellClass}>
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                  <div className="min-w-0">
                    {explorerUrl ? (
                      <a
                        href={explorerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex max-w-full items-center gap-2 font-mono text-sm text-[var(--text-primary)]"
                        title={submission.solver_address}
                      >
                        <span className="truncate">
                          {shortAddress(submission.solver_address)}
                        </span>
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

                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      <span
                        className={pillClass}
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
                      <span
                        className={`${pillClass} bg-[var(--surface-container-low)] text-[var(--text-secondary)]`}
                      >
                        Score {formatWadToScore(submission.score)}
                      </span>
                    </div>
                  </div>

                  <div className="flex justify-between gap-4 md:block md:text-right">
                    <span className="font-mono text-xs text-[var(--text-secondary)]">
                      {formatDate(submission.submitted_at)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
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
    <div className="rounded-[1.625rem] bg-[var(--surface-container-low)] px-4 py-3.5 md:px-5">
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
    <div className={pageStackClass}>
      <div className={sectionShellClass}>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.95fr)]">
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
        <div className="mt-5 grid gap-3 xl:grid-cols-3">
          {[1, 2, 3].map((item) => (
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

      <div className={sectionShellClass}>
        <div className="skeleton h-5 w-40" />
        <div className="mt-5 space-y-3">
          {[1, 2, 3, 4].map((row) => (
            <div key={row} className="skeleton h-16 w-full" />
          ))}
        </div>
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
  const capitalReturnedRate =
    data && data.totalRewardUsdc > 0
      ? clampPercent((data.distributedUsdc / data.totalRewardUsdc) * 100)
      : 0;
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
    <div className={pageStackClass}>
      <motion.section
        className={sectionShellClass}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={revealTransition}
      >
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.95fr)] lg:items-start">
          <div className="max-w-none">
            <p className={eyebrowClass}>Platform analytics</p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <StatusPill label={freshnessTone.label} tone={freshnessTone} />
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--text-muted)]">
                {freshnessDetail}
              </p>
            </div>
            <h1 className="mt-4 font-display text-[2.1rem] font-semibold leading-[1.05] tracking-tight text-[var(--text-primary)] md:text-[2.5rem] xl:whitespace-nowrap">
              Capital, participation, payout
            </h1>
            <p className="mt-3 max-w-[48ch] text-pretty text-sm leading-6 text-[var(--text-secondary)] md:text-base md:leading-7">
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
              title="Posting → submission → settlement"
              description="Three public checkpoints from posted rewards to settled payout."
            />

            <div className="mt-5 grid gap-3 xl:grid-cols-3">
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
                step="03 Settlement"
                title="Payout"
                description="Rewards finalized and released from escrow."
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

            <div className="mt-4">
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
              description="Solver participation and where challenge demand is concentrating."
            />

            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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

            <div className="mt-5 w-full">
              <DomainDonutPanel
                eyebrow="Domain mix"
                title="Demand by domain"
                description="Challenge volume by domain."
                entries={domainEntries}
                emptyLabel="Domain distribution will appear once challenges are indexed."
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
              eyebrow="Core outcomes"
              title="Completion and payout conversion"
              description="How posted demand turns into completed challenges and solver payouts."
            />

            <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.85fr)]">
              <div className="grid gap-3">
                <ProgressRail
                  label="Completion rate"
                  value={data.completionRate ?? 0}
                  detail="Challenges completed."
                  icon={CheckCircle2}
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
                  label="Finalized"
                  value={formatCount(finalizedChallenges)}
                  detail="Completed payout loop."
                />
              </div>
            </div>
          </motion.section>

          <motion.div
            className="w-full"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...revealTransition, delay: 0.16 }}
          >
            <RecentSubmissionsTable submissions={data.recentSubmissions} />
          </motion.div>

          <ProjectionFootnote freshness={data.freshness} />
        </>
      ) : null}
    </div>
  );
}
