import {
  type ChallengeIntentOutput,
  type CompilationResultOutput,
  type ConfirmationContractOutput,
  type DryRunPreviewOutput,
  type OfficialScorerTemplateIdOutput,
  type TrustedChallengeSpecOutput,
  PROTOCOL_FEE_PERCENT,
  getOfficialScorerMetric,
  lookupOfficialScorer,
} from "@agora/common";

export interface ParsedThreshold {
  operator: "gte" | "lte";
  value: number;
}
function formatUsdc(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);
}

function formatDeadline(deadlineIso: string, timezone: string) {
  try {
    return `${new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone,
    }).format(new Date(deadlineIso))} (${timezone})`;
  } catch {
    return `${new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(new Date(deadlineIso))} (UTC)`;
  }
}

function buildRewardSummary(input: {
  rewardTotal: string;
  distribution: ChallengeIntentOutput["distribution"];
}) {
  const total = Number(input.rewardTotal);
  const net = total - total * (PROTOCOL_FEE_PERCENT / 100);

  if (!Number.isFinite(total) || total <= 0) {
    return "Reward will be funded in USDC at publish time.";
  }

  if (input.distribution === "top_3") {
    return `Top 3 split ${formatUsdc(net * 0.6)} / ${formatUsdc(net * 0.25)} / ${formatUsdc(net * 0.15)} USDC after the ${PROTOCOL_FEE_PERCENT}% protocol fee.`;
  }
  if (input.distribution === "proportional") {
    return `Payouts are distributed proportionally from ${formatUsdc(net)} USDC after the ${PROTOCOL_FEE_PERCENT}% protocol fee.`;
  }
  return `Winner takes ${formatUsdc(net)} USDC after the ${PROTOCOL_FEE_PERCENT}% protocol fee.`;
}

function escapeMetricPattern(metric: string) {
  return metric.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function metricPattern(metric: string) {
  if (metric === "exact_match") {
    return "(?:exact\\s*match|match)";
  }
  if (metric === "tolerant_match") {
    return "(?:tolerant\\s*match|match)";
  }
  return escapeMetricPattern(metric);
}

export function parsePayoutThreshold(
  metric: string,
  comparator: "maximize" | "minimize",
  sourceText: string,
): ParsedThreshold | undefined {
  const operatorPattern =
    comparator === "minimize"
      ? "(<=|<|at most|less than|under|below|no more than)"
      : "(>=|>|at least|more than|above|over|no less than)";

  const thresholdPattern = new RegExp(
    `${metricPattern(metric)}[^0-9<>]{0,20}${operatorPattern}\\s*([0-9]+(?:\\.[0-9]+)?)`,
    "i",
  );
  const match = thresholdPattern.exec(sourceText);
  if (!match) {
    return undefined;
  }

  const parsed = Number(match[2]);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return {
    operator: comparator === "minimize" ? "lte" : "gte",
    value: parsed,
  };
}

export function buildAuthoringChecklist(input: {
  template: OfficialScorerTemplateIdOutput;
  metric: string;
  comparator: "maximize" | "minimize";
  challengeSpec: TrustedChallengeSpecOutput;
  submissionContract: CompilationResultOutput["submission_contract"];
  dryRun: DryRunPreviewOutput;
}): ConfirmationContractOutput {
  const template = lookupOfficialScorer(input.template);
  const metric = getOfficialScorerMetric(input.template, input.metric);
  const submissionColumns =
    input.submissionContract.kind === "csv_table"
      ? input.submissionContract.columns.required.join(", ")
      : "the required file contract";
  const normalizationNote =
    input.comparator === "minimize"
      ? " Agora normalizes lower-is-better raw metrics into a higher-is-better payout score for ranking and settlement."
      : "";

  return {
    solver_submission:
      input.submissionContract.kind === "csv_table"
        ? `Solvers upload a CSV with columns: ${submissionColumns}.`
        : "Solvers upload the required result artifact.",
    scoring_summary: `Agora will score submissions with ${metric?.label ?? input.metric} (${input.comparator === "minimize" ? "lower is better" : "higher is better"}) using the ${template?.label ?? input.template}.${normalizationNote}${input.challengeSpec.minimum_score !== undefined ? ` Submissions below ${input.challengeSpec.minimum_score} are ineligible for payout.` : ""}`,
    public_private_summary: input.challengeSpec.artifacts.map((artifact) => {
      const accessLabel =
        artifact.visibility === "private"
          ? "hidden for evaluation"
          : "visible to solvers";
      return `${artifact.file_name ?? artifact.role}: ${accessLabel}`;
    }),
    reward_summary: buildRewardSummary({
      rewardTotal: input.challengeSpec.reward.total,
      distribution: input.challengeSpec.reward.distribution,
    }),
    deadline_summary: formatDeadline(
      input.challengeSpec.deadline,
      input.challengeSpec.tags
        ?.find((tag) => tag.startsWith("tz:"))
        ?.slice(3) ?? "UTC",
    ),
    dry_run_summary: input.dryRun.summary,
  };
}
