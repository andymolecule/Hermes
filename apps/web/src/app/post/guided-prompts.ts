"use client";

import type {
  GuidedFieldKey,
  GuidedPromptConfig,
  InputKind,
} from "./guided-state";

type GuidedPromptDefinition = GuidedPromptConfig & {
  placeholder?: string;
  helper?: string;
  options?: { label: string; value: string }[];
};

export const GUIDED_PROMPT_ORDER = [
  "problem",
  "uploads",
  "winningCondition",
  "rewardTotal",
  "distribution",
  "deadline",
  "disputeWindow",
  "solverInstructions",
] as const satisfies readonly Exclude<GuidedFieldKey, "title">[];

export const GUIDED_DISTRIBUTION_OPTIONS = [
  { label: "Winner takes all", value: "winner_take_all" },
  { label: "Top 3 split (60 / 25 / 15)", value: "top_3" },
  { label: "Proportional to score", value: "proportional" },
] as const satisfies readonly { label: string; value: string }[];

export const GUIDED_SUBMISSION_WINDOW_OPTIONS = [
  { label: "15 min", value: "15m" },
  { label: "30 min", value: "0" },
  { label: "7 days", value: "7" },
  { label: "14 days", value: "14" },
  { label: "30 days", value: "30" },
  { label: "60 days", value: "60" },
  { label: "90 days", value: "90" },
] as const satisfies readonly { label: string; value: string }[];

export const GUIDED_DISPUTE_WINDOW_OPTIONS = [
  { label: "None (testnet)", value: "0" },
  { label: "7 days", value: "168" },
  { label: "14 days", value: "336" },
  { label: "30 days", value: "720" },
  { label: "60 days", value: "1440" },
  { label: "90 days", value: "2160" },
] as const satisfies readonly { label: string; value: string }[];

export const INPUT_KIND_LABELS: Record<InputKind, string> = {
  textarea: "Long answer",
  file: "File upload",
  currency: "Currency",
  select: "Select",
  date: "Date",
  text: "Text",
};

export const GUIDED_PROMPTS: Record<
  (typeof GUIDED_PROMPT_ORDER)[number],
  GuidedPromptDefinition
> = {
  problem: {
    id: "problem",
    prompt: "What scientific problem do you want solved?",
    inputKind: "textarea",
    placeholder:
      "Explain the task in plain language. What should solvers predict, reproduce, rank, or optimize?",
    helper:
      "Start with the scientific question. Files, payout, and deadline come next.",
  },
  uploads: {
    id: "uploads",
    prompt: "Upload the data files for this bounty.",
    inputKind: "file",
    helper:
      "Descriptive file names help Agora figure out which data is public and which stays hidden for scoring.",
  },
  winningCondition: {
    id: "winningCondition",
    prompt: "What counts as a winning result?",
    inputKind: "textarea",
    placeholder:
      "Example: Highest Spearman correlation on the hidden labels wins.",
  },
  rewardTotal: {
    id: "rewardTotal",
    prompt: "How much USDC should this bounty pay?",
    inputKind: "currency",
    placeholder: "500",
    helper: "Agora charges a 10% protocol fee. Solvers receive the rest.",
  },
  distribution: {
    id: "distribution",
    prompt: "How should the reward split across winners?",
    inputKind: "select",
    options: [...GUIDED_DISTRIBUTION_OPTIONS],
  },
  deadline: {
    id: "deadline",
    prompt: "When should submissions close?",
    inputKind: "select",
    options: [...GUIDED_SUBMISSION_WINDOW_OPTIONS],
    helper:
      "The deadline is computed from now when the challenge is published.",
  },
  disputeWindow: {
    id: "disputeWindow",
    prompt: "How long should the dispute window last?",
    inputKind: "select",
    options: [...GUIDED_DISPUTE_WINDOW_OPTIONS],
    helper:
      "After scoring, anyone can dispute. The window must pass before payouts unlock.",
  },
  solverInstructions: {
    id: "solverInstructions",
    prompt: "Anything else solvers should know?",
    inputKind: "textarea",
    optional: true,
    canSkip: true,
    placeholder:
      "Optional: scientific caveats, accepted formats, allowed assumptions, or forbidden shortcuts.",
  },
};
