"use client";

import AgoraFactoryAbiJson from "@agora/common/abi/AgoraFactory.json";
import {
  ACTIVE_CONTRACT_VERSION,
  CHALLENGE_LIMITS,
  PROTOCOL_FEE_PERCENT,
  computeSpecHash,
  defaultPresetIdForChallengeType,
  getPinSpecAuthorizationTypedData,
  isTestnetChain,
  PRESET_REGISTRY,
  SUBMISSION_LIMITS,
  validateChallengeScoreability,
  validateChallengeSpec,
  validatePresetIntegrity,
  validateScoringContainer,
} from "@agora/common";
import { Fragment, useEffect, useRef, useState } from "react";
import { type Abi, parseSignature, parseUnits } from "viem";
import { useAccount, usePublicClient, useSignTypedData, useWriteContract } from "wagmi";
import { useConnectModal, useChainModal } from "@rainbow-me/rainbowkit";
import {
  Wallet, ArrowRight, AlertCircle, Loader2, CheckCircle,
  FlaskConical, BarChart3, Settings2, ShieldAlert, ChevronRight, Check,
  Upload, Eye, X, Tag
} from "lucide-react";
import { motion } from "motion/react";
import { accelerateChallengeIndex } from "../../lib/api";
import { CHAIN_ID, FACTORY_ADDRESS, USDC_ADDRESS } from "../../lib/config";
import { formatUsdc, computeProtocolFee } from "../../lib/format";
import { ScoringTrustNotice } from "../../components/ScoringTrustNotice";

const AgoraFactoryAbi = AgoraFactoryAbiJson as unknown as Abi;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const DEFAULT_PERMIT_VERSION = "1";
const PERMIT_LIFETIME_SECONDS = 60 * 60;

const DISTRIBUTION_TO_ENUM = {
  winner_take_all: 0,
  top_3: 1,
  proportional: 2,
} as const;

const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "version",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "nonces",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "DOMAIN_SEPARATOR",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
] as const;

type FundingMethod = "permit" | "approve";
type FundingStatus = "idle" | "checking" | "ready" | "error";
type PendingAction = "idle" | "approving" | "signingPermit" | "creating";
type WalletPublicClient = NonNullable<ReturnType<typeof usePublicClient>>;

type PostingFundingState = {
  status: FundingStatus;
  method: FundingMethod;
  tokenName: string;
  permitVersion: string;
  allowance: bigint;
  balance: bigint;
  message?: string;
};

const initialPostingFundingState: PostingFundingState = {
  status: "idle",
  method: "approve",
  tokenName: "USDC",
  permitVersion: DEFAULT_PERMIT_VERSION,
  allowance: 0n,
  balance: 0n,
};

function getRewardUnitsFromInput(reward: string) {
  return parseUnits(reward.trim() || "0", 6);
}

async function loadPostingFundingState({
  publicClient,
  address,
  usdcAddress,
  factoryAddress,
  rewardUnits,
}: {
  publicClient: WalletPublicClient;
  address: `0x${string}`;
  usdcAddress: `0x${string}`;
  factoryAddress: `0x${string}`;
  rewardUnits: bigint;
}): Promise<PostingFundingState> {
  const [
    balanceResult,
    allowanceResult,
    nameResult,
    noncesResult,
    domainSeparatorResult,
    versionResult,
  ] = await Promise.allSettled([
    publicClient.readContract({
      address: usdcAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address],
    }),
    publicClient.readContract({
      address: usdcAddress,
      abi: erc20Abi,
      functionName: "allowance",
      args: [address, factoryAddress],
    }),
    publicClient.readContract({
      address: usdcAddress,
      abi: erc20Abi,
      functionName: "name",
    }),
    publicClient.readContract({
      address: usdcAddress,
      abi: erc20Abi,
      functionName: "nonces",
      args: [address],
    }),
    publicClient.readContract({
      address: usdcAddress,
      abi: erc20Abi,
      functionName: "DOMAIN_SEPARATOR",
    }),
    publicClient.readContract({
      address: usdcAddress,
      abi: erc20Abi,
      functionName: "version",
    }),
  ]);

  if (balanceResult.status !== "fulfilled" || allowanceResult.status !== "fulfilled") {
    return {
      ...initialPostingFundingState,
      status: "error",
      message: "Unable to read token balance or allowance.",
    };
  }

  const tokenName = nameResult.status === "fulfilled" ? String(nameResult.value) : "USDC";
  const permitSupported =
    nameResult.status === "fulfilled"
    && noncesResult.status === "fulfilled"
    && domainSeparatorResult.status === "fulfilled";

  const balance = balanceResult.value as bigint;
  const allowance = allowanceResult.value as bigint;

  if (balance < rewardUnits) {
    return {
      status: "ready",
      method: permitSupported ? "permit" : "approve",
      tokenName,
      permitVersion:
        versionResult.status === "fulfilled"
          ? String(versionResult.value)
          : DEFAULT_PERMIT_VERSION,
      allowance,
      balance,
      message: `Wallet needs ${formatUsdc(Number(rewardUnits - balance) / 1e6)} more USDC.`,
    };
  }

  return {
    status: "ready",
    method: permitSupported ? "permit" : "approve",
    tokenName,
    permitVersion:
      versionResult.status === "fulfilled"
        ? String(versionResult.value)
        : DEFAULT_PERMIT_VERSION,
    allowance,
    balance,
  };
}

type PostChallengeType = "prediction" | "optimization" | "reproducibility" | "docking" | "red_team" | "custom";

// ─── Icon mapping for presets ───────────────────────
const TYPE_ICONS: Record<PostChallengeType, typeof FlaskConical> = {
  prediction: BarChart3,
  optimization: FlaskConical,
  reproducibility: FlaskConical,
  docking: FlaskConical,
  red_team: ShieldAlert,
  custom: Settings2,
};

const METRIC_OPTIONS = [
  { value: "rmse", label: "RMSE", hint: "Lower is better" },
  { value: "r2", label: "R²", hint: "Higher is better" },
  { value: "mae", label: "MAE", hint: "Lower is better" },
  { value: "pearson", label: "Pearson", hint: "Higher is better" },
  { value: "spearman", label: "Spearman", hint: "Higher is better" },
  { value: "custom", label: "Custom metric", hint: "" },
];

const WINNER_LABELS: Record<string, string> = {
  winner_take_all: "Winner takes entire reward pool",
  top_3: "Reward split among top 3 scorers",
  proportional: "Reward distributed proportionally by score",
};

const DISTRIBUTION_SUMMARY_LABELS = {
  winner_take_all: "Winner Take All",
  top_3: "Top 3",
  proportional: "Proportional",
} as const;

function requirePresetForType(type: string) {
  const id = defaultPresetIdForChallengeType(type as Parameters<typeof defaultPresetIdForChallengeType>[0]);
  if (!id || id === "custom") return undefined;
  const preset = PRESET_REGISTRY[id];
  if (!preset) throw new Error(`Required preset "${id}" missing from PRESET_REGISTRY.`);
  return preset;
}

const reproducibilityPreset = requirePresetForType("reproducibility")!;
const predictionPreset = requirePresetForType("prediction")!;
const dockingPreset = requirePresetForType("docking")!;

if (!reproducibilityPreset || !predictionPreset || !dockingPreset) {
  throw new Error(
    "Required presets (reproducibility/prediction/docking) are missing from PRESET_REGISTRY.",
  );
}

const REGISTRY_PRESETS = Object.values(PRESET_REGISTRY);

const TYPE_CONFIG = {
  prediction: {
    label: "Prediction",
    description: "Solvers predict held-out outcomes from a labeled training dataset",
    defaultDomain: "omics",
    metricHint: "r2",
    container: predictionPreset.container,
    defaultMinimumScore: predictionPreset.defaultMinimumScore,
    presetId: predictionPreset.id,
    scoringTemplate: predictionPreset.scoringDescription,
  },
  optimization: {
    label: "Optimization",
    description: "Solvers submit parameters; your scorer runs the simulation",
    defaultDomain: "drug_discovery",
    metricHint: "custom",
    container: "",
    defaultMinimumScore: 0,
    presetId: "custom",
    scoringTemplate: "",
  },
  reproducibility: {
    label: "Reproducibility",
    description: "Solvers reproduce a posted reference artifact from shared source data",
    defaultDomain: "other",
    metricHint: "custom",
    container: reproducibilityPreset.container,
    defaultMinimumScore: reproducibilityPreset.defaultMinimumScore,
    presetId: reproducibilityPreset.id,
    scoringTemplate: reproducibilityPreset.scoringDescription,
  },
  docking: {
    label: "Docking",
    description: "Solvers rank molecules by docking score against a protein target",
    defaultDomain: "drug_discovery",
    metricHint: "spearman",
    container: dockingPreset.container,
    defaultMinimumScore: dockingPreset.defaultMinimumScore,
    presetId: dockingPreset.id,
    scoringTemplate: dockingPreset.scoringDescription,
  },
  red_team: {
    label: "Red Team",
    description: "Solvers find adversarial inputs that break a model or claim",
    defaultDomain: "other",
    metricHint: "custom",
    container: "",
    defaultMinimumScore: 0,
    presetId: "custom",
    scoringTemplate: "",
  },
  custom: {
    label: "Custom",
    description: "Bring your own scorer and rules",
    defaultDomain: "other",
    metricHint: "custom",
    container: "",
    defaultMinimumScore: 0,
    presetId: "custom",
    scoringTemplate: "",
  },
} as const;

const AVAILABLE_TYPE_OPTIONS: PostChallengeType[] = ["reproducibility", "prediction"];
const COMING_SOON_TYPE_OPTIONS: PostChallengeType[] = ["optimization", "docking", "red_team"];

const TYPE_FORM_COPY: Record<"reproducibility" | "prediction", {
  titlePlaceholder: string;
  descriptionPlaceholder: string;
  tagPlaceholder: string;
}> = {
  reproducibility: {
    titlePlaceholder: "e.g. Reproduce normalized assay summary statistics from the Lee et al. pipeline",
    descriptionPlaceholder: "Describe the reference artifact solvers should reproduce, what source data they should work from, and any constraints on ordering, preprocessing, or rounding.",
    tagPlaceholder: "e.g. reproducibility, assay, csv",
  },
  prediction: {
    titlePlaceholder: "e.g. Predict assay response from tabular feature measurements",
    descriptionPlaceholder: "Describe the target outcome, what the training and evaluation rows represent, and any scientific context solvers need to build a credible model.",
    tagPlaceholder: "e.g. prediction, tabular, assay",
  },
};

const MARKETPLACE_CATEGORY_OPTIONS = [
  { value: "longevity", label: "Longevity" },
  { value: "drug_discovery", label: "Drug Discovery" },
  { value: "protein_design", label: "Protein Design" },
  { value: "omics", label: "Omics" },
  { value: "neuroscience", label: "Neuroscience" },
  { value: "other", label: "Other" },
] as const;

const PAYOUT_RULE_OPTIONS: Array<{
  value: FormState["distribution"];
  label: string;
  hint: string;
}> = [
  {
    value: "winner_take_all",
    label: "Winner takes all",
    hint: "Best when the reward pool is small or you care most about the single top result.",
  },
  {
    value: "top_3",
    label: "Top 3",
    hint: "Rewards multiple strong submissions and encourages broader participation.",
  },
  {
    value: "proportional",
    label: "Proportional",
    hint: "Distributes payout by score when you want many valid submissions to earn something.",
  },
];

// ─── Pipeline diagrams per type ──────────────────────

type PipelineFlow = {
  stages: Array<{
    title: string;
    action: string;
    schemaLabel: "IN" | "OUT" | "EVAL";
    schemaValue: string;
    tone: "poster" | "solver" | "scorer";
  }>;
  helper: string;
  systemNote?: string;
};

const PIPELINE_FLOWS: Record<PostChallengeType, PipelineFlow> = {
  prediction: {
    stages: [
      {
        title: "Poster",
        action: "Publishes dataset",
        schemaLabel: "IN",
        schemaValue: "{train, test, hidden_labels}",
        tone: "poster",
      },
      {
        title: "Solver",
        action: "Computes predictions",
        schemaLabel: "OUT",
        schemaValue: "[predictions.csv]",
        tone: "solver",
      },
      {
        title: "Scorer",
        action: "Validates + scores",
        schemaLabel: "EVAL",
        schemaValue: "(hidden_labels -> metric)",
        tone: "scorer",
      },
    ],
    helper: "Source data moves directly from the posted challenge spec into solver outputs and deterministic scoring.",
    systemNote: "No extra middle actor sits between solver and scorer here. The reference bundle stays attached to the scorer stage, and settlement happens later in Reward & Execution.",
  },
  reproducibility: {
    stages: [
      {
        title: "Poster",
        action: "Publishes reference run",
        schemaLabel: "IN",
        schemaValue: "{inputs, expected_output}",
        tone: "poster",
      },
      {
        title: "Solver",
        action: "Recreates output",
        schemaLabel: "OUT",
        schemaValue: "[reproduced_output.csv]",
        tone: "solver",
      },
      {
        title: "Scorer",
        action: "Diffs + scores",
        schemaLabel: "EVAL",
        schemaValue: "(expected_output -> diff)",
        tone: "scorer",
      },
    ],
    helper: "Public benchmark workflow: source data in, reproduced CSV out, deterministic comparison against the posted reference.",
  },
  optimization: {
    stages: [
      {
        title: "Poster",
        action: "Publishes eval bundle",
        schemaLabel: "IN",
        schemaValue: "{evaluation_bundle}",
        tone: "poster",
      },
      {
        title: "Solver",
        action: "Searches parameters",
        schemaLabel: "OUT",
        schemaValue: "[parameters.json]",
        tone: "solver",
      },
      {
        title: "Scorer",
        action: "Runs simulation",
        schemaLabel: "EVAL",
        schemaValue: "(bundle + params -> score)",
        tone: "scorer",
      },
    ],
    helper: "The compute-heavy step lives inside the scorer stage, which executes your simulation bundle against solver-supplied parameters.",
    systemNote: "There is no extra actor between solver and scorer here; the simulation engine is the scorer itself.",
  },
  docking: {
    stages: [
      {
        title: "Poster",
        action: "Publishes docking inputs",
        schemaLabel: "IN",
        schemaValue: "{target, ligands}",
        tone: "poster",
      },
      {
        title: "Solver",
        action: "Ranks candidates",
        schemaLabel: "OUT",
        schemaValue: "[docking_scores.csv]",
        tone: "solver",
      },
      {
        title: "Scorer",
        action: "Benchmarks ranking",
        schemaLabel: "EVAL",
        schemaValue: "(reference_scores -> rank_score)",
        tone: "scorer",
      },
    ],
    helper: "The docking workflow is a single compute lane: shared inputs in, ranked scores out, then deterministic benchmark scoring.",
    systemNote: "The reference docking data belongs to the scorer stage. It is the critical function between raw solver output and the final score.",
  },
  red_team: {
    stages: [
      {
        title: "Poster",
        action: "Publishes target model",
        schemaLabel: "IN",
        schemaValue: "{model, baseline_data}",
        tone: "poster",
      },
      {
        title: "Solver",
        action: "Crafts attacks",
        schemaLabel: "OUT",
        schemaValue: "[adversarial_inputs]",
        tone: "solver",
      },
      {
        title: "Scorer",
        action: "Measures degradation",
        schemaLabel: "EVAL",
        schemaValue: "(baseline -> delta_score)",
        tone: "scorer",
      },
    ],
    helper: "The red-team path stays linear: target model context in, adversarial examples out, then degradation measured deterministically.",
    systemNote: "Baseline evaluation is the important hidden function here. It lives inside the scorer stage rather than as a separate actor.",
  },
  custom: {
    stages: [
      {
        title: "Poster",
        action: "Publishes protocol",
        schemaLabel: "IN",
        schemaValue: "{public_inputs, eval_bundle}",
        tone: "poster",
      },
      {
        title: "Solver",
        action: "Submits solution",
        schemaLabel: "OUT",
        schemaValue: "[solution_payload]",
        tone: "solver",
      },
      {
        title: "Scorer",
        action: "Executes custom logic",
        schemaLabel: "EVAL",
        schemaValue: "(custom_eval -> score)",
        tone: "scorer",
      },
    ],
    helper: "Custom challenges still follow the same three-stage pipeline, but the scoring function is fully defined by your protocol.",
    systemNote: "The only extra function is your custom evaluation container, which is represented directly in the scorer stage.",
  },
};

function PipelineVisual({ type }: { type: PostChallengeType }) {
  const flow = PIPELINE_FLOWS[type];
  const icons = {
    poster: Upload,
    solver: Wallet,
    scorer: CheckCircle,
  } as const;

  return (
    <div className="pipeline-diagram">
      <div className="pipeline-visual">
        {flow.stages.map((stage, index) => {
          const Icon = icons[stage.tone];

          return (
            <Fragment key={stage.title}>
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + (index * 0.08) }}
                className={`pipeline-node pipeline-node-${stage.tone}`}
              >
                <div className="pipeline-node-header">
                  <div className={`pipeline-icon pipeline-icon-${stage.tone}`}><Icon size={18} /></div>
                  <div className="pipeline-title">{stage.title}</div>
                </div>
                <div className="pipeline-divider" />
                <div className="pipeline-action">{stage.action}</div>
                <div className="pipeline-schema">
                  <span className={`pipeline-schema-prefix pipeline-schema-prefix-${stage.tone}`}>{stage.schemaLabel}:</span>
                  <span className="pipeline-schema-value">{stage.schemaValue}</span>
                </div>
              </motion.div>
              {index < flow.stages.length - 1 ? (
                <div className="pipeline-arrow" aria-hidden="true">
                  <div className="pipeline-arrow-line" />
                  <div className="pipeline-arrow-head" />
                </div>
              ) : null}
            </Fragment>
          );
        })}
        <div className="pipeline-visual-summary">
          {flow.helper}
        </div>
      </div>
      <div className="pipeline-diagram-copy">
        {flow.systemNote ? (
          <p className="pipeline-system-note">
            {flow.systemNote}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function SectionHeader({ step, title }: { step: number; title: string }) {
  return (
    <div className="form-section-header">
      <div className="form-section-heading">
        <span className="form-section-step">{step}</span>
        <span className="form-section-title">{title}</span>
      </div>
      <span className="form-section-meta">Step {step} of 5</span>
    </div>
  );
}

function engineDisplayName(container: string): string {
  const linkedPresets = REGISTRY_PRESETS.filter((preset) => preset.container === container);
  if (linkedPresets.length === 0) {
    return container.length > 40 ? container.slice(0, 40) + "…" : container;
  }
  const names = Array.from(new Set(linkedPresets.map((preset) => preset.label)));
  if (names.length === 1) return `${names[0]} (official)`;
  return `${names[0]} (+${names.length - 1} preset${names.length > 2 ? "s" : ""})`;
}

function scoringRuleLabel(state: FormState): string {
  if (state.type === "reproducibility") return "Deterministic CSV comparison";
  if (state.type === "prediction") {
    const metricLabel = METRIC_OPTIONS.find((metric) => metric.value === state.metric)?.label ?? state.metric;
    return `${metricLabel} on hidden labels`;
  }
  return engineDisplayName(state.container);
}

const SUBMISSION_TYPES = [
  { value: "number", label: "🔢 Number", desc: "Solvers submit a numeric answer.", format: '{"answer": <number>}' },
  { value: "text", label: "📝 Text", desc: "Solvers submit a text response.", format: '{"answer": <string>}' },
  { value: "json", label: "📄 JSON Object", desc: "Solvers submit a structured JSON file.", format: "JSON object (define schema in validation rules)" },
  { value: "csv", label: "📊 CSV", desc: "Solvers submit a CSV file with results.", format: "CSV file" },
  { value: "file", label: "📦 File Upload", desc: "Solvers upload a file (model, archive, etc).", format: "File upload (ZIP, tar.gz, or binary)" },
  { value: "custom", label: "⚙️ Custom", desc: "Define your own submission format.", format: "" },
] as const;

// ─── Form State ─────────────────────────────────────

type FormState = {
  title: string;
  description: string;
  referenceLink: string;
  domain: string;
  type: PostChallengeType;
  train: string;
  test: string;
  hiddenLabels: string;
  metric: string;
  container: string;
  reward: string;
  distribution: "winner_take_all" | "top_3" | "proportional";
  deadlineDays: string;
  minimumScore: string;
  disputeWindow: string;
  submissionType: string;
  submissionFormat: string;
  evaluationCriteria: string;
  successDefinition: string;
  idColumn: string;
  labelColumn: string;
  reproPresetId: string;
  tolerance: string;
  tags: string[];
  detectedColumns: string[];
};

const defaultPreset = TYPE_CONFIG.reproducibility;

const initialState: FormState = {
  title: "",
  description: "",
  referenceLink: "",
  domain: defaultPreset.defaultDomain,
  type: "reproducibility",
  train: "",
  test: "",
  hiddenLabels: "",
  metric: defaultPreset.metricHint,
  container: defaultPreset.container,
  reward: "10",
  distribution: "winner_take_all",
  deadlineDays: "7",
  minimumScore: String(defaultPreset.defaultMinimumScore),
  disputeWindow: String(CHALLENGE_LIMITS.defaultDisputeWindowHours),
  submissionType: "csv",
  submissionFormat: "CSV matching the expected output columns and row order",
  evaluationCriteria: defaultPreset.scoringTemplate,
  successDefinition: "",
  idColumn: "id",
  labelColumn: "prediction",
  reproPresetId: "csv_comparison_v1",
  tolerance: "0.001",
  tags: [],
  detectedColumns: [],
};

function buildSpec(state: FormState) {
  const train = state.train.trim();
  const test = state.test.trim();
  const hiddenLabels = state.hiddenLabels.trim();
  const dataset =
    train || test || hiddenLabels
      ? {
        ...(train ? { train } : {}),
        ...(test ? { test } : {}),
        ...(hiddenLabels ? { hidden_labels: hiddenLabels } : {}),
      }
      : undefined;

  // For reproducibility, use the selected sub-preset; otherwise use TYPE_CONFIG default
  const presetId = state.type === "reproducibility"
    ? state.reproPresetId
    : TYPE_CONFIG[state.type].presetId;

  const minimumScore = state.minimumScore.trim();
  const disputeWindow = state.disputeWindow.trim();
  const referenceLink = state.referenceLink.trim();

  return {
    schema_version: 2 as const,
    id: `web-${Date.now()}`,
    preset_id: presetId,
    title: state.title,
    domain: state.domain,
    type: state.type,
    description: state.description,
    ...(referenceLink ? { reference_url: referenceLink } : {}),
    dataset,
    scoring: { container: state.container, metric: state.metric },
    reward: {
      total: Number(state.reward),
      distribution: state.distribution,
    },
    deadline: computeDeadlineIso(state.deadlineDays),
    ...(minimumScore ? { minimum_score: Number(minimumScore) } : {}),
    ...(disputeWindow ? { dispute_window_hours: Number(disputeWindow) } : {}),
    evaluation: {
      submission_format: state.submissionFormat || undefined,
      criteria: state.evaluationCriteria || undefined,
      success_definition: state.successDefinition || undefined,
      id_column: state.idColumn || undefined,
      label_column: state.labelColumn || undefined,
      ...(state.tolerance ? { tolerance: state.tolerance } : {}),
    },
    ...(state.tags.length > 0 ? { tags: state.tags } : {}),
    lab_tba: "0x0000000000000000000000000000000000000000",
  };
}

// ─── Deadline Helpers ────────────────────────────────

/** Compute a fresh deadline ISO from days. Always computed live, never stored stale.
 *  Quick-test (0 days) adds a 2-min buffer beyond the displayed 30 min to
 *  absorb IPFS pinning, wallet confirmations, and slow RPC round-trips. */
const QUICK_TEST_MINUTES = 30;
const QUICK_TEST_BUFFER_MINUTES = 2;

function computeDeadlineIso(days: string): string {
  const d = Number(days);
  if (d === 0) return new Date(Date.now() + (QUICK_TEST_MINUTES + QUICK_TEST_BUFFER_MINUTES) * 60 * 1000).toISOString();
  return new Date(Date.now() + d * 24 * 60 * 60 * 1000).toISOString();
}

function isUserRejectedError(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("user rejected")
    || normalized.includes("user denied")
    || normalized.includes("rejected the request")
    || normalized.includes("denied transaction signature");
}

function isPermitUnsupportedError(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("typed data")
    || normalized.includes("sign typed data")
    || normalized.includes("eth_signtypeddata")
    || normalized.includes("method not supported")
    || normalized.includes("unsupported method")
    || normalized.includes("not implemented")
    || normalized.includes("does not support");
}

/** Format a deadline date for display. */
function formatDeadlineDate(days: string): string {
  return new Date(computeDeadlineIso(days)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Format payout date (deadline + dispute window). */
function formatPayoutDate(days: string, disputeWindowHours: string): string {
  const deadlineMs = new Date(computeDeadlineIso(days)).getTime();
  const payoutMs = deadlineMs + Number(disputeWindowHours) * 3600000;
  return new Date(payoutMs).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ─── CSV Header Detection ───────────────────────────

/** Read the first line of a CSV file and return column names. Handles BOM, \r\n, and quoted headers. */
function readCsvHeader(file: File): Promise<string[]> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      let text = reader.result as string;
      // Strip UTF-8 BOM
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      // Get first line, strip \r
      const firstLine = text.split("\n")[0]?.replace(/\r$/, "").trim();
      if (!firstLine || !firstLine.includes(",")) { resolve([]); return; }
      // Quote-aware split: respect commas inside double quotes
      const cols: string[] = [];
      let current = "";
      let inQuotes = false;
      for (const ch of firstLine) {
        if (ch === '"') { inQuotes = !inQuotes; continue; }
        if (ch === "," && !inQuotes) { cols.push(current.trim()); current = ""; continue; }
        current += ch;
      }
      cols.push(current.trim());
      resolve(cols.filter(Boolean));
    };
    reader.onerror = () => resolve([]);
    reader.readAsText(file.slice(0, 4096));
  });
}

// ─── Helpers ────────────────────────────────────────

function FormField({
  label, hint, children, className,
}: {
  label: string; hint?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`form-field ${className ?? ""}`}>
      <label className="form-label">{label}</label>
      {children}
      {hint ? <span className="form-hint">{hint}</span> : null}
    </div>
  );
}

function ChoiceField<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
  className,
  variant = "default",
}: {
  label: string;
  hint?: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; hint?: string }>;
  onChange: (next: T) => void;
  className?: string;
  variant?: "default" | "compact";
}) {
  return (
    <div className={`form-field ${className ?? ""}`}>
      <label className="form-label">{label}</label>
      <div className={`choice-grid ${variant === "compact" ? "compact" : ""}`}>
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              className={`choice-card ${variant === "compact" ? "compact" : ""} ${active ? "active" : ""}`}
              onClick={() => onChange(option.value)}
            >
              <span className="choice-card-title">{option.label}</span>
              {option.hint ? <span className="choice-card-hint">{option.hint}</span> : null}
            </button>
          );
        })}
      </div>
      {hint ? <span className="form-hint">{hint}</span> : null}
    </div>
  );
}

// ─── Data Upload Field ──────────────────────────────

function DataUploadField({
  value, onChange, uploading, onUpload, placeholder, fileName,
}: {
  value: string;
  onChange: (v: string) => void;
  uploading: boolean;
  onUpload: (file: File) => void;
  placeholder: string;
  fileName?: string;
}) {
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) onUpload(file);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onUpload(file);
    // Reset so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const hasValue = value.trim().length > 0;
  const isIpfs = value.startsWith("ipfs://") || /^Qm[A-Za-z0-9]{44}/.test(value) || /^bafy[A-Za-z0-9]+/.test(value);

  // Uploaded / has URL — show compact success row
  if (hasValue && !uploading) {
    return (
      <div className="drop-zone has-value">
        <div className="drop-zone-filled">
          <CheckCircle size={14} className="drop-zone-filled-icon" />
          <span className="drop-zone-filled-name">{fileName || (isIpfs ? value.slice(0, 24) + "…" : value)}</span>
          <button type="button" className="drop-zone-clear" onClick={() => onChange("")} aria-label="Clear">
            <X size={12} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`drop-zone-area ${dragging ? "dragging" : ""} ${uploading ? "uploading" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => !uploading && fileInputRef.current?.click()}
    >
      <input
        ref={fileInputRef}
        type="file"
        className="drop-zone-file-input"
        onChange={handleFileSelect}
        tabIndex={-1}
      />
      {uploading ? (
        <div className="drop-zone-copy">
          <Loader2 size={20} className="animate-spin drop-zone-area-icon" />
          <span className="drop-zone-area-label">Uploading and pinning to IPFS</span>
          <span className="drop-zone-area-sub">This usually completes in a few seconds.</span>
        </div>
      ) : (
        <>
          <div className="drop-zone-copy">
            <Upload size={20} className="drop-zone-area-icon" />
            <span className="drop-zone-area-label">Drop a file or click to upload</span>
            <span className="drop-zone-area-sub">CSV works best here. You can also paste an IPFS or HTTPS link below.</span>
          </div>
          <input
            className="drop-zone-url-input"
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const f = e.dataTransfer.files[0]; if (f) onUpload(f); }}
          />
        </>
      )}
    </div>
  );
}

// ─── Component ──────────────────────────────────────

export function PostClient() {
  const [state, setState] = useState<FormState>(initialState);
  const [status, setStatus] = useState<string>("");
  const [pendingAction, setPendingAction] = useState<PendingAction>("idle");
  const [fundingState, setFundingState] = useState<PostingFundingState>(initialPostingFundingState);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [uploadingField, setUploadingField] = useState<"train" | "test" | "hiddenLabels" | null>(null);
  const [fileNames, setFileNames] = useState<Record<string, string>>({});
  const [tagInput, setTagInput] = useState("");

  const { isConnected, chainId, address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();
  const { openConnectModal } = useConnectModal();
  const { openChainModal } = useChainModal();

  const isWrongChain = isConnected && chainId !== CHAIN_ID;
  const walletReady = isConnected && !isWrongChain;
  const isBusy = pendingAction !== "idle";

  const rewardValue = Number(state.reward || 0);
  const { feeUsdc: protocolFeeValue, payoutUsdc: winnerPayoutValue } = computeProtocolFee(rewardValue);
  const previewRewardUnits = (() => {
    try {
      return getRewardUnitsFromInput(state.reward);
    } catch {
      return 0n;
    }
  })();
  const allowanceReady = fundingState.allowance >= previewRewardUnits;
  const balanceReady = fundingState.balance >= previewRewardUnits;

  const isCustomType = state.type === "custom" || state.type === "optimization" || state.type === "red_team";

  useEffect(() => {
    if (!showPreview) {
      setFundingState(initialPostingFundingState);
      return;
    }
    if (!walletReady || !publicClient || !address || !FACTORY_ADDRESS || !USDC_ADDRESS) {
      setFundingState(initialPostingFundingState);
      return;
    }
    const checkedPublicClient = publicClient;
    const checkedAddress = address as `0x${string}`;

    let cancelled = false;

    async function checkFundingPath() {
      setFundingState((current) => ({
        ...current,
        status: "checking",
        message: undefined,
      }));

      try {
        const nextState = await loadPostingFundingState({
          publicClient: checkedPublicClient,
          address: checkedAddress,
          usdcAddress: USDC_ADDRESS,
          factoryAddress: FACTORY_ADDRESS,
          rewardUnits: previewRewardUnits,
        });
        if (!cancelled) setFundingState(nextState);
      } catch {
        if (!cancelled) {
          setFundingState({
            ...initialPostingFundingState,
            status: "error",
            message: "Unable to determine the posting flow for this token.",
          });
        }
      }
    }

    void checkFundingPath();

    return () => {
      cancelled = true;
    };
  }, [showPreview, walletReady, publicClient, address, previewRewardUnits]);

  async function handleFileUpload(file: File, field: "train" | "test" | "hiddenLabels") {
    setUploadingField(field);
    setStatus("");
    try {
      // Pin to IPFS + detect CSV columns in parallel (zero added latency)
      const shouldDetectColumns = field === "test" && state.type === "reproducibility";
      const [pinResult, detectedCols] = await Promise.all([
        (async () => {
          const formData = new FormData();
          formData.append("file", file);
          const res = await fetch("/api/pin-data", { method: "POST", body: formData });
          if (!res.ok) {
            const body = await res.text();
            let msg = "Upload failed";
            try { msg = JSON.parse(body).error || msg; } catch { msg = body || msg; }
            throw new Error(msg);
          }
          return (await res.json()) as { cid: string };
        })(),
        shouldDetectColumns ? readCsvHeader(file) : Promise.resolve([] as string[]),
      ]);
      setState((s) => ({
        ...s,
        [field]: pinResult.cid,
        ...(shouldDetectColumns && detectedCols.length > 0
          ? {
              detectedColumns: detectedCols,
            }
          : {}),
      }));
      setFileNames((prev) => ({ ...prev, [field]: file.name }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      setStatus(`Upload failed: ${msg}`);
    } finally {
      setUploadingField(null);
    }
  }

  function addTag(tag: string) {
    const trimmed = tag.trim().toLowerCase();
    if (!trimmed || state.tags.includes(trimmed)) return;
    setState((s) => ({ ...s, tags: [...s.tags, trimmed] }));
    setTagInput("");
  }

  function removeTag(tag: string) {
    setState((s) => ({ ...s, tags: s.tags.filter((t) => t !== tag) }));
  }

  function selectType(t: PostChallengeType) {
    if (!AVAILABLE_TYPE_OPTIONS.includes(t)) return;
    const preset = TYPE_CONFIG[t];
    setState((s) => ({
      ...s,
      type: t,
      container: preset.container,
      metric: preset.metricHint,
      domain: preset.defaultDomain,
      minimumScore: String(preset.defaultMinimumScore),
      evaluationCriteria: preset.scoringTemplate || s.evaluationCriteria,
      // Clear type-specific fields when switching
      hiddenLabels: "",
      tolerance: t === "reproducibility" ? "0.001" : "",
      train: "",
      test: "",
      // Reset repro sub-preset to default when switching to reproducibility
      ...(t === "reproducibility"
        ? {
          reproPresetId: "csv_comparison_v1",
          submissionType: "csv",
          submissionFormat:
            "CSV matching the expected output columns and row order",
        }
        : {}),
      // Prediction: default to CSV submission with id + prediction columns
      ...(t === "prediction" ? {
        submissionType: "csv",
        submissionFormat: "CSV with columns: id, prediction",
        idColumn: "id",
        labelColumn: "prediction",
      } : {}),
      // Docking: default to CSV submission
      ...(t === "docking" ? { submissionType: "csv", submissionFormat: "CSV with columns: ligand_id, docking_score" } : {}),
    }));
    setFileNames({});
  }

  function validateInput() {
    if (!state.title.trim() || !state.description.trim())
      return "Title and description are required.";
    if (state.referenceLink.trim()) {
      try {
        new URL(state.referenceLink.trim());
      } catch {
        return "Reference paper or protocol link must be a valid URL.";
      }
    }
    if (!Number.isFinite(rewardValue) || rewardValue <= 0)
      return "Reward must be a positive number.";
    if (
      rewardValue < CHALLENGE_LIMITS.rewardMinUsdc ||
      rewardValue > CHALLENGE_LIMITS.rewardMaxUsdc
    )
      return `Reward must be between ${CHALLENGE_LIMITS.rewardMinUsdc} and ${CHALLENGE_LIMITS.rewardMaxUsdc} USDC.`;

    // Per-type required uploads
    if (state.type === "prediction") {
      if (!state.train.trim()) return "Training dataset is required for prediction challenges.";
      if (!state.test.trim()) return "Test dataset is required for prediction challenges.";
      if (!state.hiddenLabels.trim()) return "Hidden labels are required for prediction challenges. Upload the ground truth used for scoring.";
    } else if (state.type === "reproducibility") {
      if (!state.train.trim()) return "Input dataset is required for reproducibility challenges.";
      if (!state.test.trim()) return "Reference output is required for reproducibility challenges. Upload the CSV the scorer compares submissions against.";
    } else if (state.type === "optimization") {
      if (!state.train.trim()) return "Evaluation bundle is required for optimization challenges.";
    } else if (state.type === "docking") {
      if (!state.train.trim()) return "Target structure is required for docking challenges.";
      if (!state.test.trim()) return "Ligand set is required for docking challenges.";
    } else if (state.type === "red_team") {
      if (!state.train.trim()) return "Baseline data is required for red team challenges.";
    }

    if (!state.container.trim())
      return "Scoring container is required.";
    // Validate container reference
    const containerError = validateScoringContainer(state.container);
    if (containerError)
      return containerError;
    const presetId = state.type === "reproducibility"
      ? state.reproPresetId
      : TYPE_CONFIG[state.type].presetId;
    const presetIntegrityError = validatePresetIntegrity(presetId, state.container);
    if (presetIntegrityError)
      return presetIntegrityError;

    const minScore = Number(state.minimumScore);
    if (state.minimumScore.trim() && !Number.isFinite(minScore))
      return "Minimum score must be a valid number.";

    if (state.tolerance.trim() && !Number.isFinite(Number(state.tolerance)))
      return "Tolerance must be a valid number (e.g. 1e-4 or 0.001).";
    if (state.tolerance.trim() && Number(state.tolerance) < 0)
      return "Tolerance must be zero or greater.";

    if (state.disputeWindow.trim()) {
      const disputeWindow = Number(state.disputeWindow);
      if (
        !Number.isFinite(disputeWindow) ||
        disputeWindow < 0 ||
        disputeWindow > CHALLENGE_LIMITS.disputeWindowMaxHours
      )
        return `Dispute window must be between 0 and ${CHALLENGE_LIMITS.disputeWindowMaxHours} hours.`;
    }

    const specResult = validateChallengeSpec(buildSpec(state), CHAIN_ID);
    if (!specResult.success) {
      return specResult.error.issues[0]?.message ?? "Challenge spec is invalid.";
    }

    const scoreability = validateChallengeScoreability(specResult.data);
    if (!scoreability.ok) {
      return scoreability.errors[0] ?? "Challenge is not scoreable.";
    }
    return null;
  }

  async function refreshPostingFundingState(rewardUnits: bigint) {
    if (!walletReady || !publicClient || !address || !FACTORY_ADDRESS || !USDC_ADDRESS) {
      const nextState = { ...initialPostingFundingState };
      setFundingState(nextState);
      return nextState;
    }
    const checkedPublicClient = publicClient;
    const checkedAddress = address as `0x${string}`;
    const nextState = await loadPostingFundingState({
      publicClient: checkedPublicClient,
      address: checkedAddress,
      usdcAddress: USDC_ADDRESS,
      factoryAddress: FACTORY_ADDRESS,
      rewardUnits,
    });
    setFundingState(nextState);
    return nextState;
  }

  async function prepareChallengeCreation() {
    if (!walletReady) throw new Error("Connect the correct wallet before posting.");
    if (!FACTORY_ADDRESS || !USDC_ADDRESS) {
      throw new Error("Missing NEXT_PUBLIC_AGORA_FACTORY_ADDRESS or NEXT_PUBLIC_AGORA_USDC_ADDRESS.");
    }
    if (!publicClient) throw new Error("Wallet client is not ready. Reconnect wallet and retry.");
    if (!address) throw new Error("Wallet address is required to post a challenge.");

    const validationError = validateInput();
    if (validationError) throw new Error(validationError);

    setStatus("Pinning spec to IPFS...");
    const spec = { ...buildSpec(state), deadline: computeDeadlineIso(state.deadlineDays) };
    const specHash = computeSpecHash(spec);
    const nonceRes = await fetch("/api/pin-spec", {
      method: "GET",
      cache: "no-store",
    });
    if (!nonceRes.ok) throw new Error(await nonceRes.text());

    const { nonce } = (await nonceRes.json()) as { nonce: string };
    const typedData = getPinSpecAuthorizationTypedData({
      chainId: CHAIN_ID,
      wallet: address,
      specHash,
      nonce,
    });
    const signature = await signTypedDataAsync({
      account: address,
      ...typedData,
    });

    const pinRes = await fetch("/api/pin-spec", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ spec, auth: { address, nonce, specHash, signature } }),
    });
    if (!pinRes.ok) throw new Error(await pinRes.text());

    const { specCid } = (await pinRes.json()) as { specCid: string };

    return {
      specCid,
      rewardUnits: parseUnits(String(spec.reward.total), 6),
      deadlineSeconds: BigInt(Math.floor(new Date(spec.deadline).getTime() / 1000)),
      disputeWindowHours: BigInt(
        spec.dispute_window_hours ?? CHALLENGE_LIMITS.defaultDisputeWindowHours,
      ),
      minimumScoreWad: parseUnits(String(spec.minimum_score ?? 0), 18),
      distributionType:
        DISTRIBUTION_TO_ENUM[spec.reward.distribution as keyof typeof DISTRIBUTION_TO_ENUM] ?? 0,
    };
  }

  async function finalizeChallengePost(createTx: `0x${string}`) {
    if (!publicClient) throw new Error("Wallet client is not ready. Reconnect wallet and retry.");
    await publicClient.waitForTransactionReceipt({ hash: createTx });
    setStatus("Challenge confirmed on-chain. Accelerating indexer sync...");
    try {
      await accelerateChallengeIndex({ txHash: createTx });
      setStatus(`success: Challenge posted. tx=${createTx}. Indexed immediately.`);
    } catch {
      setStatus(`success: Challenge posted on-chain (tx=${createTx}). Indexer will sync it shortly.`);
    }
    setShowPreview(false);
  }

  async function handleApprove() {
    if (!walletReady || !publicClient || !address || !FACTORY_ADDRESS || !USDC_ADDRESS) return;

    try {
      setPendingAction("approving");
      setStatus("");

      const validationError = validateInput();
      if (validationError) throw new Error(validationError);

      const rewardUnits = getRewardUnitsFromInput(state.reward);
      const latestFunding = await refreshPostingFundingState(rewardUnits);
      if (latestFunding.balance < rewardUnits) {
        throw new Error(latestFunding.message ?? "Insufficient USDC balance.");
      }
      if (latestFunding.allowance >= rewardUnits) {
        setStatus("USDC allowance already confirmed. Click Create Challenge to continue.");
        return;
      }

      setStatus("Approve USDC in your wallet...");
      const { request } = await publicClient.simulateContract({
        account: address,
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "approve",
        args: [FACTORY_ADDRESS, rewardUnits],
      });
      const approveTx = await writeContractAsync(request);
      setStatus("Approval submitted. Waiting for confirmation...");
      await publicClient.waitForTransactionReceipt({ hash: approveTx });

      const refreshedFunding = await refreshPostingFundingState(rewardUnits);
      if (refreshedFunding.allowance < rewardUnits) {
        throw new Error("Allowance did not update after approval. Please retry.");
      }
      setStatus("USDC approved. Click Create Challenge to post on-chain.");
    } catch (approveError) {
      const message = approveError instanceof Error ? approveError.message : "Approval failed.";
      setStatus(message);
    } finally {
      setPendingAction("idle");
    }
  }

  async function handleCreate() {
    if (!walletReady || !publicClient || !address || !FACTORY_ADDRESS || !USDC_ADDRESS) return;

    try {
      setStatus("");

      const validationError = validateInput();
      if (validationError) throw new Error(validationError);

      const rewardUnits = getRewardUnitsFromInput(state.reward);
      const latestFunding = await refreshPostingFundingState(rewardUnits);
      if (latestFunding.balance < rewardUnits) {
        throw new Error(latestFunding.message ?? "Insufficient USDC balance.");
      }

      const factoryVersion = await publicClient.readContract({
        address: FACTORY_ADDRESS,
        abi: AgoraFactoryAbi,
        functionName: "contractVersion",
      }) as bigint;
      if (Number(factoryVersion) !== ACTIVE_CONTRACT_VERSION) {
        throw new Error(
          `Unsupported factory contract version ${factoryVersion}. Update NEXT_PUBLIC_AGORA_FACTORY_ADDRESS to the active v${ACTIVE_CONTRACT_VERSION} factory and retry.`,
        );
      }

      if (latestFunding.method === "permit" && latestFunding.allowance < rewardUnits) {
        setPendingAction("signingPermit");
        setStatus(`Sign ${latestFunding.tokenName} permit in your wallet...`);
        const permitDeadline = BigInt(Math.floor(Date.now() / 1000) + PERMIT_LIFETIME_SECONDS);
        const permitNonce = await publicClient.readContract({
          address: USDC_ADDRESS,
          abi: erc20Abi,
          functionName: "nonces",
          args: [address],
        }) as bigint;

        let signature: `0x${string}`;
        try {
          signature = await signTypedDataAsync({
            account: address,
            domain: {
              name: latestFunding.tokenName,
              version: latestFunding.permitVersion,
              chainId: CHAIN_ID,
              verifyingContract: USDC_ADDRESS,
            },
            types: {
              Permit: [
                { name: "owner", type: "address" },
                { name: "spender", type: "address" },
                { name: "value", type: "uint256" },
                { name: "nonce", type: "uint256" },
                { name: "deadline", type: "uint256" },
              ],
            },
            primaryType: "Permit",
            message: {
              owner: address,
              spender: FACTORY_ADDRESS,
              value: rewardUnits,
              nonce: permitNonce,
              deadline: permitDeadline,
            },
          });
        } catch (permitError) {
          const permitMessage = permitError instanceof Error ? permitError.message : "Permit signature failed.";
          if (isUserRejectedError(permitMessage)) throw permitError;
          if (isPermitUnsupportedError(permitMessage)) {
            setFundingState((current) => ({
              ...current,
              method: "approve",
              status: "ready",
              message: "Wallet cannot sign token permits. Approve USDC first, then create the challenge.",
            }));
            setStatus("Wallet cannot sign token permits. Approve USDC first, then create the challenge.");
            return;
          }
          throw permitError;
        }

        const prepared = await prepareChallengeCreation();
        const parsedSignature = parseSignature(signature);
        const permitV = Number(parsedSignature.v ?? BigInt(27 + parsedSignature.yParity));

        setPendingAction("creating");
        setStatus("Creating challenge on-chain...");
        const { request } = await publicClient.simulateContract({
          account: address,
          address: FACTORY_ADDRESS,
          abi: AgoraFactoryAbi,
          functionName: "createChallengeWithPermit",
          args: [
            prepared.specCid,
            prepared.rewardUnits,
            prepared.deadlineSeconds,
            prepared.disputeWindowHours,
            prepared.minimumScoreWad,
            prepared.distributionType,
            ZERO_ADDRESS,
            BigInt(SUBMISSION_LIMITS.maxPerChallenge),
            BigInt(SUBMISSION_LIMITS.maxPerSolverPerChallenge),
            permitDeadline,
            permitV,
            parsedSignature.r,
            parsedSignature.s,
          ],
        });
        const createTx = await writeContractAsync(request);
        await finalizeChallengePost(createTx);
        return;
      }

      if (latestFunding.allowance < rewardUnits) {
        throw new Error("Approve USDC before creating the challenge.");
      }

      const prepared = await prepareChallengeCreation();
      setPendingAction("creating");
      setStatus("Creating challenge on-chain...");
      const { request } = await publicClient.simulateContract({
        account: address,
        address: FACTORY_ADDRESS,
        abi: AgoraFactoryAbi,
        functionName: "createChallenge",
        args: [
          prepared.specCid,
          prepared.rewardUnits,
          prepared.deadlineSeconds,
          prepared.disputeWindowHours,
          prepared.minimumScoreWad,
          prepared.distributionType,
          ZERO_ADDRESS,
          BigInt(SUBMISSION_LIMITS.maxPerChallenge),
          BigInt(SUBMISSION_LIMITS.maxPerSolverPerChallenge),
        ],
      });
      const createTx = await writeContractAsync(request);
      await finalizeChallengePost(createTx);
    } catch (createError) {
      const message = createError instanceof Error ? createError.message : "Failed to post challenge.";
      if (message.includes("USDC_TRANSFER_FAILED") || message.includes("TransferFromFailed")) {
        setStatus("createChallenge reverted during USDC transfer. Confirm the connected wallet still has enough USDC and allowance for the factory.");
      } else {
        setStatus(message);
      }
    } finally {
      setPendingAction("idle");
    }
  }

  const isSuccess = status.startsWith("success:");
  const postingCtaLabel = !isConnected
    ? "Connect Wallet to Deploy"
    : isWrongChain
      ? "Switch to Base Sepolia"
      : "Confirm & Publish Challenge";
  const postingCtaDisabled = isBusy
    || (!isConnected && !openConnectModal)
    || (isWrongChain && !openChainModal)
    || (isConnected && !isWrongChain && !walletReady);

  const handlePrimarySubmitAction = () => {
    if (!isConnected) {
      openConnectModal?.();
      return;
    }
    if (isWrongChain) {
      openChainModal?.();
      return;
    }
    const error = validateInput();
    if (error) {
      setStatus(error);
      return;
    }
    setShowPreview(true);
  };

  const renderTypeCard = (key: PostChallengeType, { disabled = false }: { disabled?: boolean } = {}) => {
    const preset = TYPE_CONFIG[key];
    const Icon = TYPE_ICONS[key];
    const active = !disabled && state.type === key;

    return (
      <button
        key={key}
        type="button"
        className={`type-card ${active ? "active" : ""} ${disabled ? "disabled" : ""}`}
        onClick={() => {
          if (!disabled) selectType(key);
        }}
        disabled={disabled}
      >
        <div className="type-card-check">
          {active && <Check size={10} strokeWidth={3} />}
        </div>
        <div className="type-card-icon">
          <Icon size={18} />
        </div>
        <div className="type-card-title-row">
          <div className="type-card-title">{preset.label}</div>
          {disabled ? <span className="type-card-status">Coming soon</span> : <span className="type-card-status available">Available now</span>}
        </div>
        <div className="type-card-desc">
          {preset.description}
          {disabled && " Self-serve posting is not open for this workflow yet."}
        </div>
      </button>
    );
  };

  const scientistCopy = TYPE_FORM_COPY[state.type as "reproducibility" | "prediction"] ?? TYPE_FORM_COPY.reproducibility;
  const usesNumericDrift = state.type === "reproducibility" && Number(state.tolerance || "0") > 0;


  return (
    <div className="post-form">
      {/* Header */}
      <div className="post-header">
        <div className="post-header-left">
          <h1 className="page-title">Post Bounty</h1>
          <p className="page-subtitle">
            Post a reproducibility benchmark or prediction challenge and fund it with USDC.
          </p>
        </div>
      </div>

      {/* ── Challenge Type Selector ── */}
      <div className="type-group">
        <div className="type-group-header">
          <div className="type-group-title">Available now</div>
          <p className="type-group-copy">
            Start with the workflows that are fully self-serve and ready for real poster and solver use today.
          </p>
        </div>
        <div className="type-selector type-selector-primary">
          {AVAILABLE_TYPE_OPTIONS.map((key) => renderTypeCard(key))}
        </div>
      </div>

      <div className="type-group type-group-muted">
        <div className="type-group-header">
          <div className="type-group-title">Coming soon</div>
          <p className="type-group-copy">
            These workflows still need additional scorer and product work before self-serve posting opens.
          </p>
        </div>
        <div className="type-selector type-selector-muted">
          {COMING_SOON_TYPE_OPTIONS.map((key) => renderTypeCard(key, { disabled: true }))}
        </div>
      </div>

      {/* ── Section 1: Problem ── */}
      <div className="form-section">
        <SectionHeader step={1} title="Scientific Brief" />
        <div className="form-section-body">
          <div className="form-grid">
            <FormField label="Bounty title" className="span-full measure-medium">
              <input className="form-input" placeholder={scientistCopy.titlePlaceholder}
                value={state.title} onChange={(e) => setState((s) => ({ ...s, title: e.target.value }))} />
            </FormField>
            <FormField label="Challenge brief" className="span-full">
              <textarea className="form-textarea" placeholder={scientistCopy.descriptionPlaceholder}
                value={state.description} onChange={(e) => setState((s) => ({ ...s, description: e.target.value }))} />
            </FormField>
            <FormField
              label="Reference paper or protocol link (optional)"
              hint="Link the publication, methods page, notebook, or protocol that defines the target artifact."
              className="span-full measure-medium"
            >
              <input className="form-input" placeholder="https://..."
                value={state.referenceLink} onChange={(e) => setState((s) => ({ ...s, referenceLink: e.target.value }))} />
            </FormField>
            <ChoiceField
              label="Marketplace category"
              hint="Used for discovery on Agora. Does not affect scoring or payout."
              value={state.domain}
              options={MARKETPLACE_CATEGORY_OPTIONS}
              onChange={(next) => setState((s) => ({ ...s, domain: next }))}
              className="span-full"
              variant="compact"
            />
            <FormField label="Keywords (optional)" hint="Optional search keywords — press Enter or comma to add" className="span-full">
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", alignItems: "center" }}>
                {state.tags.map((tag) => (
                  <span key={tag} style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem", padding: "0.2rem 0.5rem", borderRadius: "12px", background: "#FAFAFA", fontSize: "0.72rem", color: "var(--text-secondary)", border: "1px solid #E5E7EB" }}>
                    <Tag size={10} />
                    {tag}
                    <button type="button" onClick={() => removeTag(tag)}
                      style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--text-tertiary)", lineHeight: 1, display: "flex" }}>
                      <X size={10} />
                    </button>
                  </span>
                ))}
                <input
                  className="form-input"
                  style={{ flex: 1, minWidth: "120px", border: "none", padding: "0.25rem 0", fontSize: "0.8rem", background: "transparent" }}
                  placeholder={state.tags.length === 0 ? scientistCopy.tagPlaceholder : "Add keyword…"}
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.key === "Enter" || e.key === ",") && tagInput.trim()) {
                      e.preventDefault();
                      addTag(tagInput);
                    }
                    if (e.key === "Backspace" && !tagInput && state.tags.length > 0) {
                      removeTag(state.tags[state.tags.length - 1]!);
                    }
                  }}
                  onBlur={() => { if (tagInput.trim()) addTag(tagInput); }}
                />
              </div>
            </FormField>
          </div>
        </div>
      </div>

      {/* ── Section 2: Data & Inputs (type-adaptive) ── */}
      <div className="form-section">
        <SectionHeader step={2} title="Data & Reference Artifacts" />
        <div className="form-section-body">
          <PipelineVisual type={state.type} />
          <div className="form-grid">
            {/* ── Prediction: 3 uploads ── */}
            {state.type === "prediction" && (
              <>
                <FormField label="Training dataset (with labels)" hint="Public labeled data solvers use to fit and validate their models">
                  <DataUploadField
                    value={state.train}
                    onChange={(v) => { setState((s) => ({ ...s, train: v })); if (!v) setFileNames((p) => ({ ...p, train: "" })); }}
                    uploading={uploadingField === "train"}
                    onUpload={(file) => handleFileUpload(file, "train")}
                    placeholder="ipfs://... or https://..."
                    fileName={fileNames.train}
                  />
                </FormField>
                <FormField label="Evaluation inputs (without labels)" hint="Public rows solvers generate predictions for">
                  <DataUploadField
                    value={state.test}
                    onChange={(v) => { setState((s) => ({ ...s, test: v })); if (!v) setFileNames((p) => ({ ...p, test: "" })); }}
                    uploading={uploadingField === "test"}
                    onUpload={(file) => handleFileUpload(file, "test")}
                    placeholder="ipfs://... or https://..."
                    fileName={fileNames.test}
                  />
                </FormField>
                <FormField label="Hidden scoring labels" hint="Ground-truth targets used by the official scorer after submission" className="span-full">
                  <DataUploadField
                    value={state.hiddenLabels}
                    onChange={(v) => { setState((s) => ({ ...s, hiddenLabels: v })); if (!v) setFileNames((p) => ({ ...p, hiddenLabels: "" })); }}
                    uploading={uploadingField === "hiddenLabels"}
                    onUpload={(file) => handleFileUpload(file, "hiddenLabels")}
                    placeholder="ipfs://... or https://..."
                    fileName={fileNames.hiddenLabels}
                  />
                </FormField>
              </>
            )}

            {/* ── Reproducibility: 2 uploads + tolerance ── */}
            {state.type === "reproducibility" && (
              <>
                <FormField label="Source dataset" hint="Public source data and inputs solvers must reproduce from">
                  <DataUploadField
                    value={state.train}
                    onChange={(v) => { setState((s) => ({ ...s, train: v })); if (!v) setFileNames((p) => ({ ...p, train: "" })); }}
                    uploading={uploadingField === "train"}
                    onUpload={(file) => handleFileUpload(file, "train")}
                    placeholder="ipfs://... or https://..."
                    fileName={fileNames.train}
                  />
                </FormField>
                <FormField
                  label="Reference output"
                  hint="This CSV is posted with the challenge and becomes the public reference benchmark the official scorer compares submissions against."
                >
                  <DataUploadField
                    value={state.test}
                    onChange={(v) => {
                      setState((s) => ({
                        ...s, test: v,
                        // Clear detected columns when file is removed
                        ...(!v ? { detectedColumns: [] } : {}),
                      }));
                      if (!v) setFileNames((p) => ({ ...p, test: "" }));
                    }}
                    uploading={uploadingField === "test"}
                    onUpload={(file) => handleFileUpload(file, "test")}
                    placeholder="ipfs://... or https://..."
                    fileName={fileNames.test}
                  />
                </FormField>
                <div className="form-field span-full">
                  <label className="form-label">Match rule (How strict the official scorer should be when comparing numeric values)</label>
                  <div className="choice-grid">
                    <button
                      type="button"
                      className={`choice-card choice-card-with-input ${!usesNumericDrift ? "active" : ""}`}
                      onClick={() => setState((s) => ({ ...s, tolerance: "0" }))}
                    >
                      <span className="choice-card-title">Exact match</span>
                      <span className="choice-card-hint">All numeric values must match exactly.</span>
                      <div className="choice-card-inline-field">
                        <span className="choice-card-inline-label">Allowed drift</span>
                        <span className="choice-card-inline-static">None</span>
                      </div>
                    </button>
                    <button
                      type="button"
                      className={`choice-card choice-card-with-input ${usesNumericDrift ? "active" : ""}`}
                      onClick={() => {
                        if (!usesNumericDrift) {
                          setState((s) => ({
                            ...s,
                            tolerance: s.tolerance.trim() && Number(s.tolerance) > 0 ? s.tolerance : "0.001",
                          }));
                        }
                      }}
                    >
                      <span className="choice-card-title">Allow small drift</span>
                      <span className="choice-card-hint">Useful when minor rounding or floating-point noise should still count as correct.</span>
                      <div className="choice-card-inline-field">
                        <span className="choice-card-inline-label">Allowed drift</span>
                        <input
                          className="choice-card-inline-input form-input-mono"
                          placeholder="0.001"
                          value={usesNumericDrift ? state.tolerance : ""}
                          onChange={(e) => setState((s) => ({ ...s, tolerance: e.target.value }))}
                          onFocus={() => {
                            if (!usesNumericDrift) {
                              setState((s) => ({
                                ...s,
                                tolerance: s.tolerance.trim() && Number(s.tolerance) > 0 ? s.tolerance : "0.001",
                              }));
                            }
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                    </button>
                  </div>
                  <span className="form-hint">Absolute numeric tolerance is used for official scoring. Example: 0.001 means values within ±0.001 are treated as matching.</span>
                </div>
              </>
            )}

            {/* ── Optimization: 1 upload ── */}
            {state.type === "optimization" && (
              <FormField label="Evaluation bundle" hint="Config and data your scorer container needs" className="span-full">
                <DataUploadField
                  value={state.train}
                  onChange={(v) => { setState((s) => ({ ...s, train: v })); if (!v) setFileNames((p) => ({ ...p, train: "" })); }}
                  uploading={uploadingField === "train"}
                  onUpload={(file) => handleFileUpload(file, "train")}
                  placeholder="ipfs://... or https://..."
                  fileName={fileNames.train}
                />
              </FormField>
            )}

            {/* ── Docking: target + ligands ── */}
            {state.type === "docking" && (
              <>
                <FormField label="Target structure" hint="Protein target (PDB file or reference data for the scorer)">
                  <DataUploadField
                    value={state.train}
                    onChange={(v) => { setState((s) => ({ ...s, train: v })); if (!v) setFileNames((p) => ({ ...p, train: "" })); }}
                    uploading={uploadingField === "train"}
                    onUpload={(file) => handleFileUpload(file, "train")}
                    placeholder="ipfs://... or https://..."
                    fileName={fileNames.train}
                  />
                </FormField>
                <FormField label="Ligand set" hint="Molecules to dock — solvers rank these by predicted binding affinity">
                  <DataUploadField
                    value={state.test}
                    onChange={(v) => { setState((s) => ({ ...s, test: v })); if (!v) setFileNames((p) => ({ ...p, test: "" })); }}
                    uploading={uploadingField === "test"}
                    onUpload={(file) => handleFileUpload(file, "test")}
                    placeholder="ipfs://... or https://..."
                    fileName={fileNames.test}
                  />
                </FormField>
              </>
            )}

            {/* ── Red Team: baseline data + optional reference outputs ── */}
            {state.type === "red_team" && (
              <>
                <FormField label="Baseline data" hint="Data showing normal model behavior — solvers study this to craft adversarial inputs" className="span-full">
                  <DataUploadField
                    value={state.train}
                    onChange={(v) => { setState((s) => ({ ...s, train: v })); if (!v) setFileNames((p) => ({ ...p, train: "" })); }}
                    uploading={uploadingField === "train"}
                    onUpload={(file) => handleFileUpload(file, "train")}
                    placeholder="ipfs://... or https://..."
                    fileName={fileNames.train}
                  />
                </FormField>
                <FormField label="Reference outputs (optional)" hint="Baseline performance the scorer compares degradation against" className="span-full">
                  <DataUploadField
                    value={state.test}
                    onChange={(v) => { setState((s) => ({ ...s, test: v })); if (!v) setFileNames((p) => ({ ...p, test: "" })); }}
                    uploading={uploadingField === "test"}
                    onUpload={(file) => handleFileUpload(file, "test")}
                    placeholder="ipfs://... or https://..."
                    fileName={fileNames.test}
                  />
                </FormField>
              </>
            )}

            {/* ── Custom: 2 generic uploads ── */}
            {state.type === "custom" && (
              <>
                <FormField label="Public inputs" hint="Files or data available to solvers">
                  <DataUploadField
                    value={state.train}
                    onChange={(v) => { setState((s) => ({ ...s, train: v })); if (!v) setFileNames((p) => ({ ...p, train: "" })); }}
                    uploading={uploadingField === "train"}
                    onUpload={(file) => handleFileUpload(file, "train")}
                    placeholder="ipfs://... or https://..."
                    fileName={fileNames.train}
                  />
                </FormField>
                <FormField label="Evaluation dataset" hint="Used during scoring (visible on IPFS)">
                  <DataUploadField
                    value={state.test}
                    onChange={(v) => { setState((s) => ({ ...s, test: v })); if (!v) setFileNames((p) => ({ ...p, test: "" })); }}
                    uploading={uploadingField === "test"}
                    onUpload={(file) => handleFileUpload(file, "test")}
                    placeholder="ipfs://... or https://..."
                    fileName={fileNames.test}
                  />
                </FormField>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Section 3: Evaluation ── */}
      <div className="form-section">
        <SectionHeader step={3} title="Submission & Scoring" />
        <div className="form-section-body">
          <div className="form-grid">
            {!AVAILABLE_TYPE_OPTIONS.includes(state.type) && (
              <>
                <FormField label="Submission type" hint={SUBMISSION_TYPES.find(t => t.value === state.submissionType)?.desc ?? ""}>
                  <select className="form-select" value={state.submissionType}
                    onChange={(e) => {
                      const st = SUBMISSION_TYPES.find(t => t.value === e.target.value);
                      setState((s) => ({ ...s, submissionType: e.target.value, submissionFormat: st?.format ?? "" }));
                    }}>
                    {SUBMISSION_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </FormField>
                {state.submissionType === "custom" ? (
                  <FormField label="Custom format" hint="Describe the expected submission structure">
                    <input className="form-input" placeholder="e.g. ZIP containing model.pkl and predictions.csv"
                      value={state.submissionFormat} onChange={(e) => setState((s) => ({ ...s, submissionFormat: e.target.value }))} />
                  </FormField>
                ) : (
                  <FormField label="Submission rules" hint="What makes a submission valid? (plain English)">
                    <input className="form-input" placeholder="e.g. Must be a positive integer"
                      value={state.successDefinition} onChange={(e) => setState((s) => ({ ...s, successDefinition: e.target.value }))} />
                  </FormField>
                )}
              </>
            )}

            {/* ── Prediction-specific fields ── */}
            {state.type === "prediction" && (
              <>
                <div className="span-full">
                  <p style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", margin: "0 0 0.35rem", fontWeight: 600 }}>Submission artifact</p>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.75rem", background: "#FAFAFA", border: "1px solid #E5E7EB", borderRadius: "6px" }}>
                    <Check size={14} style={{ color: "#000" }} />
                    <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-primary)" }}>CSV predictions only</span>
                    <span style={{ fontSize: "0.72rem", color: "var(--text-tertiary)" }}>&mdash; Solvers submit one prediction row per evaluation input</span>
                  </div>
                </div>
                <FormField label="Row ID column" hint="Identifier column name in the evaluation input CSV">
                  <input className="form-input form-input-mono" placeholder="id"
                    value={state.idColumn} onChange={(e) => setState((s) => ({ ...s, idColumn: e.target.value }))} />
                </FormField>
                <FormField label="Target column" hint="Column name solvers must predict in their submission CSV">
                  <input className="form-input form-input-mono" placeholder="prediction"
                    value={state.labelColumn} onChange={(e) => setState((s) => ({ ...s, labelColumn: e.target.value }))} />
                </FormField>
                <FormField label="Primary metric" hint={METRIC_OPTIONS.find(m => m.value === state.metric)?.hint ?? ""}>
                  <select className="form-select" value={state.metric}
                    onChange={(e) => {
                      const m = METRIC_OPTIONS.find(o => o.value === e.target.value);
                      setState((s) => ({
                        ...s,
                        metric: e.target.value,
                        evaluationCriteria: m ? `Evaluated by ${m.label}. ${m.hint}.` : s.evaluationCriteria,
                      }));
                    }}>
                    {METRIC_OPTIONS.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Solver notes (optional)" hint="Add any scientific or dataset context that helps solvers build better predictions">
                  <input className="form-input" placeholder="e.g. Rows are assay replicates and scores are judged on Spearman correlation"
                    value={state.evaluationCriteria} onChange={(e) => setState((s) => ({ ...s, evaluationCriteria: e.target.value }))} />
                </FormField>
                {/* Solver output format preview */}
                <div className="span-full" style={{ borderTop: "1px solid var(--border-subtle)", margin: "0.25rem 0" }} />
                <div className="span-full">
                  <p style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", margin: "0 0 0.25rem", fontWeight: 600 }}>Required submission file</p>
                  <p style={{ fontSize: "0.68rem", color: "var(--text-tertiary)", margin: "0 0 0.35rem", lineHeight: 1.4 }}>
                    Solvers submit a CSV file with these columns:
                  </p>
                  <pre style={{ margin: 0, padding: "0.5rem 0.75rem", background: "#FAFAFA", border: "1px solid #E5E7EB", borderRadius: "6px", fontSize: "0.72rem", fontFamily: "var(--font-mono)", color: "var(--text-secondary)", lineHeight: 1.6, overflowX: "auto" }}>
                    {`${state.idColumn || "id"},${state.labelColumn || "prediction"}\n1,3.42\n2,7.89\n3,1.05\n...`}
                  </pre>
                  <p style={{ fontSize: "0.68rem", color: "var(--text-tertiary)", margin: "0.35rem 0 0", lineHeight: 1.4 }}>
                    <code style={{ fontSize: "0.68rem", background: "#FAFAFA", border: "1px solid #E5E7EB", padding: "0.1rem 0.3rem", borderRadius: "3px" }}>{state.idColumn || "id"}</code> must match the IDs in your test set. <code style={{ fontSize: "0.68rem", background: "#FAFAFA", border: "1px solid #E5E7EB", padding: "0.1rem 0.3rem", borderRadius: "3px" }}>{state.labelColumn || "prediction"}</code> is the numeric value scored by {METRIC_OPTIONS.find(m => m.value === state.metric)?.label ?? state.metric}.
                  </p>
                </div>
              </>
            )}

            {/* ── Reproducibility-specific fields ── */}
            {state.type === "reproducibility" && (
              <>
                <div
                  className="span-full"
                  style={{
                    display: "grid",
                    gap: "0.35rem",
                    padding: "0.75rem 0.9rem",
                    background: "#FAFAFA",
                    border: "1px solid #E5E7EB",
                    borderRadius: "6px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <AlertCircle size={15} style={{ color: "#000" }} />
                    <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--text-primary)" }}>
                      Open reference benchmark
                    </span>
                  </div>
                  <p style={{ margin: 0, fontSize: "0.72rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                    In the current protocol, the reference output is part of the posted challenge materials. This template is best for public artifact-matching and benchmark tasks, not blind holdout evaluation.
                  </p>
                </div>
                <div className="span-full">
                  <p style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", margin: "0 0 0.35rem", fontWeight: 600 }}>Submission artifact</p>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.75rem", background: "#FAFAFA", border: "1px solid #E5E7EB", borderRadius: "6px" }}>
                    <Check size={14} style={{ color: "#000" }} />
                    <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-primary)" }}>CSV output only</span>
                    <span style={{ fontSize: "0.72rem", color: "var(--text-tertiary)" }}>&mdash; Solvers submit a CSV matching the reference output columns and row order</span>
                  </div>
                </div>
                <div className="span-full">
                  <p style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", margin: "0 0 0.35rem", fontWeight: 600 }}>Official scoring rule</p>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.75rem", background: "#FAFAFA", border: "1px solid #E5E7EB", borderRadius: "6px" }}>
                    <Check size={14} style={{ color: "#000" }} />
                    <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-primary)" }}>Exact CSV comparison</span>
                    <span style={{ fontSize: "0.72rem", color: "var(--text-tertiary)" }}>&mdash; The official scorer compares each row against the posted reference output and applies the allowed numeric drift above</span>
                  </div>
                </div>
                <FormField label="Solver notes (optional)" hint="Add any human guidance that helps solvers reproduce the artifact correctly" className="span-full">
                  <textarea className="form-textarea" placeholder="e.g. Rows must stay in the original order and all values should be rounded to three decimals"
                    value={state.evaluationCriteria} onChange={(e) => setState((s) => ({ ...s, evaluationCriteria: e.target.value }))} />
                </FormField>
                {/* Solver output format */}
                <div className="span-full" style={{ borderTop: "1px solid var(--border-subtle)", margin: "0.25rem 0" }} />
                <div className="span-full">
                  <p style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", margin: "0 0 0.25rem", fontWeight: 600 }}>
                    Required submission columns
                    {state.detectedColumns.length > 0 && (
                      <span style={{ fontWeight: 400, fontStyle: "italic", marginLeft: "0.5rem" }}>
                        (auto-detected from {fileNames.test || "reference output"})
                      </span>
                    )}
                  </p>
                  {state.detectedColumns.length > 0 ? (
                    <>
                      <p style={{ fontSize: "0.68rem", color: "var(--text-tertiary)", margin: "0 0 0.35rem", lineHeight: 1.4 }}>
                        Solvers submit a CSV matching these columns:
                      </p>
                      <pre style={{ margin: 0, padding: "0.5rem 0.75rem", background: "#FAFAFA", border: "1px solid #E5E7EB", borderRadius: "6px", fontSize: "0.72rem", fontFamily: "var(--font-mono)", color: "var(--text-secondary)", lineHeight: 1.6, overflowX: "auto" }}>
                        {state.detectedColumns.join(",")}
                      </pre>
                      <p style={{ fontSize: "0.72rem", color: "var(--text-tertiary)", margin: "0.25rem 0 0", fontStyle: "italic" }}>
                        Solvers should keep the same column order and row order as the posted reference output.
                      </p>
                    </>
                  ) : (
                    <p style={{ fontSize: "0.72rem", color: "var(--text-tertiary)", margin: 0, fontStyle: "italic" }}>
                      Upload the reference output above to preview the required submission columns.
                    </p>
                  )}
                </div>
              </>
            )}

            {/* ── Optimization-specific fields ── */}
            {state.type === "optimization" && (
              <>
                <div className="span-full" style={{ borderTop: "1px solid var(--border-subtle)", margin: "0.25rem 0" }} />
                <FormField label="Scoring container" hint="Your OCI image that runs the simulation" className="span-full">
                  <input className="form-input form-input-mono"
                    placeholder="ghcr.io/org/scorer@sha256:..."
                    value={state.container}
                    onChange={(e) => setState((s) => ({ ...s, container: e.target.value }))}
                  />
                </FormField>
                <FormField label="Scoring description" hint="Describe the objective function" className="span-full">
                  <textarea className="form-textarea" placeholder="e.g. Minimize binding energy. Score = 100 - abs(energy - target_energy)."
                    value={state.evaluationCriteria} onChange={(e) => setState((s) => ({ ...s, evaluationCriteria: e.target.value }))} />
                </FormField>
                <p className="span-full" style={{ fontSize: "0.72rem", color: "var(--text-tertiary)", margin: 0, fontStyle: "italic" }}>
                  Your custom scorer container runs the solver's parameters through your simulation.
                </p>
              </>
            )}

            {/* ── Docking-specific fields ── */}
            {state.type === "docking" && (
              <>
                {/* Solver output format preview */}
                <div className="span-full">
                  <p style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", margin: "0 0 0.25rem", fontWeight: 600 }}>Solver output format</p>
                  <p style={{ fontSize: "0.68rem", color: "var(--text-tertiary)", margin: "0 0 0.35rem", lineHeight: 1.4 }}>
                    Solvers submit a CSV ranked by docking score:
                  </p>
                  <pre style={{ margin: 0, padding: "0.5rem 0.75rem", background: "#FAFAFA", border: "1px solid #E5E7EB", borderRadius: "6px", fontSize: "0.72rem", fontFamily: "var(--font-mono)", color: "var(--text-secondary)", lineHeight: 1.6, overflowX: "auto" }}>
                    {`ligand_id,docking_score\nZINC000001,-8.42\nZINC000002,-7.91\nZINC000003,-6.55\n...`}
                  </pre>
                  <p style={{ fontSize: "0.68rem", color: "var(--text-tertiary)", margin: "0.35rem 0 0", lineHeight: 1.4 }}>
                    Most negative score = best binding affinity. The scorer compares against reference docking scores using Spearman correlation.
                  </p>
                </div>
              </>
            )}

            {/* ── Red Team–specific fields ── */}
            {state.type === "red_team" && (
              <>
                <div className="span-full" style={{ borderTop: "1px solid var(--border-subtle)", margin: "0.25rem 0" }} />
                <FormField label="Scoring container" hint="Your Docker image that runs the model on adversarial inputs and measures degradation" className="span-full">
                  <input className="form-input form-input-mono"
                    placeholder="ghcr.io/org/red-team-scorer@sha256:..."
                    value={state.container}
                    onChange={(e) => setState((s) => ({ ...s, container: e.target.value }))}
                  />
                </FormField>
                <FormField label="Scoring description" hint="Explain how degradation is measured" className="span-full">
                  <textarea className="form-textarea" placeholder="e.g. Scorer runs model on adversarial inputs, measures accuracy drop vs baseline. Score = percentage degradation (0–100)."
                    value={state.evaluationCriteria} onChange={(e) => setState((s) => ({ ...s, evaluationCriteria: e.target.value }))} />
                </FormField>
                <p className="span-full" style={{ fontSize: "0.72rem", color: "var(--text-tertiary)", margin: 0, fontStyle: "italic" }}>
                  Your scorer loads the target model, runs it on adversarial inputs, and outputs a degradation score. Higher score = more degradation = better attack.
                </p>
              </>
            )}

            {/* ── Custom-specific fields ── */}
            {state.type === "custom" && (
              <>
                <div className="span-full" style={{ borderTop: "1px solid var(--border-subtle)", margin: "0.25rem 0" }} />
                <FormField label="Scoring container" hint="Your OCI image reference" className="span-full">
                  <input className="form-input form-input-mono"
                    placeholder="ghcr.io/org/scorer@sha256:..."
                    value={state.container}
                    onChange={(e) => setState((s) => ({ ...s, container: e.target.value }))}
                  />
                </FormField>
                <FormField label="Scoring description" hint="Explain the scoring logic for solvers" className="span-full">
                  <textarea className="form-textarea" placeholder="e.g. Exact hash match scores 100, partial matches scored by edit distance."
                    value={state.evaluationCriteria} onChange={(e) => setState((s) => ({ ...s, evaluationCriteria: e.target.value }))} />
                </FormField>
                <p className="span-full" style={{ fontSize: "0.72rem", color: "var(--text-tertiary)", margin: 0, fontStyle: "italic" }}>
                  Define your own scoring logic via a Docker container. The scoring description is informational.
                </p>
              </>
            )}

            {/* Managed scorer badge — for preset types only */}
            {!isCustomType && (
              <div className="span-full" style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.75rem", background: "#FAFAFA", border: "1px solid #E5E7EB", borderRadius: "6px", fontSize: "0.75rem", fontFamily: "var(--font-mono)" }}>
                  <span style={{ fontWeight: 600, color: "var(--text-secondary)" }}>Official scoring rule:</span>
                  <span style={{ color: "var(--text-primary)" }}>{scoringRuleLabel(state)}</span>
                </div>
                <p style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", margin: 0, fontStyle: "italic" }}>
                  Managed scorer — scoring is deterministic and independently verifiable.
                </p>
              </div>
            )}

            <div className="span-full">
              <ScoringTrustNotice />
            </div>

          </div>
        </div>
      </div>

      {/* ── Section 4: Reward & Execution ── */}
      <div className="form-section">
        <SectionHeader step={4} title="Reward & Timeline" />
        <div className="form-section-body">
          <div className="form-grid">
            <FormField
              label="Reward pool (USDC)"
              hint={`Escrowed on-chain. Between ${CHALLENGE_LIMITS.rewardMinUsdc} and ${CHALLENGE_LIMITS.rewardMaxUsdc} USDC.`}
              className="span-full measure-small"
            >
              <input className="form-input form-input-mono" type="number" min={CHALLENGE_LIMITS.rewardMinUsdc} max={CHALLENGE_LIMITS.rewardMaxUsdc}
                value={state.reward} onChange={(e) => setState((s) => ({ ...s, reward: e.target.value }))} />
            </FormField>
            <ChoiceField
              label="Payout rule"
              hint="Choose how the reward pool is distributed after protocol fees."
              value={state.distribution}
              options={PAYOUT_RULE_OPTIONS}
              onChange={(next) => setState((s) => ({ ...s, distribution: next }))}
              className="span-full"
            />
            <FormField label="Submission window" hint="How long solvers have to submit before scoring begins">
              <select className="form-select" value={state.deadlineDays}
                onChange={(e) => setState((s) => ({ ...s, deadlineDays: e.target.value }))}>
                {isTestnetChain(CHAIN_ID) && <option value="0">Quick test (30 min)</option>}
                <option value="7">7 days</option>
                <option value="14">14 days</option>
                <option value="30">30 days</option>
                <option value="60">60 days</option>
                <option value="90">90 days</option>
              </select>
            </FormField>
            <FormField label="Review window before payout" hint="Time for anyone to challenge scores before funds are released">
              <select className="form-select" value={state.disputeWindow}
                onChange={(e) => setState((s) => ({ ...s, disputeWindow: e.target.value }))}>
                {isTestnetChain(CHAIN_ID) && <option value="0">No dispute window (testnet only)</option>}
                {isTestnetChain(CHAIN_ID) && <option value="1">1 hour — Testing</option>}
                <option value={String(CHALLENGE_LIMITS.defaultDisputeWindowHours)}>7 days — Standard</option>
                <option value="336">14 days</option>
                <option value="720">30 days</option>
                <option value="1440">60 days</option>
                <option value={String(CHALLENGE_LIMITS.disputeWindowMaxHours)}>90 days — Maximum</option>
              </select>
            </FormField>
            {state.disputeWindow === "0" && (
              <div className="span-full" style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.75rem", background: "#fff3cd", borderRadius: "6px", fontSize: "0.75rem", color: "#856404", border: "1px solid #ffc107" }}>
                <AlertCircle size={14} />
                <span>No dispute window means funds are released <strong>immediately after scoring</strong>. Use only for testing.</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Advanced: Scoring Engine & Threshold (custom/optimization only) ── */}
      {isCustomType && (
        <>
          <button
            type="button"
            className={`advanced-toggle ${showAdvanced ? "open" : ""}`}
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            <Settings2 size={14} />
            <ChevronRight size={14} />
            Advanced Settings
            <span className="form-hint" style={{ marginLeft: "auto" }}>
              Minimum score threshold
            </span>
          </button>

          {showAdvanced && (
            <div className="advanced-body" style={{ gridTemplateColumns: "1fr" }}>
              <FormField label="Minimum score" hint="Submissions below this are rejected (0 = no threshold)">
                <input className="form-input form-input-mono" type="number" min={0} max={100}
                  placeholder="0"
                  value={state.minimumScore}
                  onChange={(e) => setState((s) => ({ ...s, minimumScore: e.target.value }))}
                />
              </FormField>
            </div>
          )}
        </>
      )}

      {/* ── Section 5: Challenge Summary ── */}
      <div className="form-section">
        <SectionHeader step={5} title="Review & Publish" />
        <div className="form-section-body">
          <div className="challenge-summary-layout">
            <div className="summary-column">
              <div className="summary-panel summary-receipt">
                <p className="summary-panel-eyebrow">Escrow & payout</p>
                <div className="receipt-row">
                  <span className="receipt-label">Deposit</span>
                  <span className="receipt-value">
                    <span>{formatUsdc(rewardValue)}</span>
                    <span className="receipt-unit">USDC</span>
                  </span>
                </div>
                <div className="receipt-row">
                  <span className="receipt-label">{`Protocol fee (${PROTOCOL_FEE_PERCENT}%)`}</span>
                  <span className="receipt-value receipt-value-muted">
                    <span>- {formatUsdc(protocolFeeValue)}</span>
                    <span className="receipt-unit">USDC</span>
                  </span>
                </div>
                <div className="receipt-divider" />
                <div className="receipt-row receipt-row-total">
                  <span className="receipt-label receipt-label-strong">Net payout</span>
                  <span className="receipt-total">
                    <span className="receipt-total-amount">{formatUsdc(winnerPayoutValue)}</span>
                    <span className="receipt-total-unit">USDC</span>
                  </span>
                </div>
              </div>

              <div className="summary-panel summary-parameters">
                <p className="summary-panel-eyebrow">Challenge setup</p>
                <div className="summary-kv-list">
                  <div className="summary-kv-row">
                    <span className="summary-kv-label">Type</span>
                    <span className="summary-kv-value">
                      <span className="summary-rule-badge">{TYPE_CONFIG[state.type].label}</span>
                    </span>
                  </div>
                  <div className="summary-kv-row">
                    <span className="summary-kv-label">Payout rule</span>
                    <span className="summary-kv-value">{DISTRIBUTION_SUMMARY_LABELS[state.distribution]}</span>
                  </div>
                  <div className="summary-kv-row">
                    <span className="summary-kv-label">Official scoring rule</span>
                    <span className="summary-kv-value">
                      {state.type === "reproducibility"
                        ? scoringRuleLabel(state)
                        : state.type === "prediction"
                          ? scoringRuleLabel(state)
                        : isCustomType
                          ? "Custom scorer"
                          : engineDisplayName(state.container)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="summary-panel summary-trust">
                <p className="summary-panel-eyebrow">Scoring trust</p>
                <div className="summary-trust-copy">
                  <span className="summary-trust-icon" aria-hidden="true">🔒</span>
                  <div>
                    <p className="summary-trust-title">Checkable Scoring</p>
                    <p className="summary-trust-text">
                      Agora operates scoring first, but the scorer image, posted inputs, and published outputs are designed to be replayable and independently checked.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="summary-column">
              <div className="summary-panel summary-timeline">
                <p className="summary-panel-eyebrow">Lifecycle</p>
                <div className="timeline-list">
                  {[
                    {
                      label: "Submissions open",
                      detail: state.deadlineDays === "0" ? "Duration: 30 min" : `Duration: ${state.deadlineDays} days`,
                      note: "Solvers can start submitting as soon as the contract is deployed.",
                      active: true,
                    },
                    {
                      label: "Deadline",
                      detail: formatDeadlineDate(state.deadlineDays),
                      note: "Submissions lock permanently once the deadline passes.",
                      active: false,
                    },
                    {
                      label: "Scoring",
                      detail: "Automatic",
                      note: "Managed scoring runs deterministically against the posted evaluation spec.",
                      active: false,
                    },
                    {
                      label: "Review window",
                      detail: state.disputeWindow === "0" ? "Duration: none" : `Duration: ${state.disputeWindow}h`,
                      note: "Anyone can challenge the result before payout is released.",
                      active: false,
                    },
                    {
                      label: "Payout",
                      detail: formatPayoutDate(state.deadlineDays, state.disputeWindow),
                      note: "Escrowed USDC is released automatically after scoring and disputes clear.",
                      active: false,
                    },
                  ].map((step) => (
                    <div key={step.label} className={`timeline-item ${step.active ? "active" : ""}`}>
                      <div className="timeline-marker" aria-hidden="true" />
                      <div className="timeline-copy">
                        <span className="timeline-label">{step.label}</span>
                        <span className="timeline-detail">{step.detail}</span>
                        <span className="timeline-note">{step.note}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Submit ── */}
      <div className="post-submit-row">
        <button
          type="button"
          disabled={postingCtaDisabled}
          onClick={handlePrimarySubmitAction}
          className="post-submit-btn"
        >
          {isBusy
            ? <Loader2 size={16} className="animate-spin" />
            : !isConnected
              ? <Wallet size={16} />
              : isWrongChain
                ? <AlertCircle size={16} />
                : <ArrowRight size={16} />}
          {isBusy ? "Waiting for wallet…" : postingCtaLabel}
        </button>
      </div>

      {/* ── Status ── */}
      {status ? (
        <div className={`post-status ${isSuccess ? "success" : ""}`}>
          {isSuccess
            ? <CheckCircle size={16} style={{ color: "var(--color-success)", flexShrink: 0, marginTop: 2 }} />
            : <AlertCircle size={16} style={{ color: "var(--text-tertiary)", flexShrink: 0, marginTop: 2 }} />
          }
          <p>
            {isSuccess ? status.replace("success: ", "") : status}
          </p>
        </div>
      ) : null}

      {/* ── Preview Overlay ── */}
      {showPreview && (
        <div className="preview-overlay" onClick={() => setShowPreview(false)}>
          <div className="preview-card" onClick={(e) => e.stopPropagation()}>
            <div className="preview-card-header">
                <h3 style={{ margin: 0, fontSize: "0.95rem", fontFamily: "var(--font-heading)" }}>
                  <Eye size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
                Review Before Publish
              </h3>
              <button type="button" onClick={() => setShowPreview(false)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-tertiary)" }}>
                <X size={18} />
              </button>
            </div>
            <div className="preview-summary">
              <div className="preview-row"><span className="preview-label">Bounty title</span><span className="preview-value">{state.title || "—"}</span></div>
              <div className="preview-row"><span className="preview-label">Marketplace category</span><span className="preview-value">{state.domain}</span></div>
              <div className="preview-row"><span className="preview-label">Type</span><span className="preview-value">{TYPE_CONFIG[state.type].label}</span></div>
              {state.description && <div className="preview-row span-full"><span className="preview-label">Challenge brief</span><span className="preview-value">{state.description}</span></div>}
              {state.referenceLink && <div className="preview-row span-full"><span className="preview-label">Reference link</span><span className="preview-value">{state.referenceLink}</span></div>}
              {state.tags.length > 0 && <div className="preview-row"><span className="preview-label">Keywords</span><span className="preview-value">{state.tags.join(", ")}</span></div>}
              <div className="preview-divider" />
              {!AVAILABLE_TYPE_OPTIONS.includes(state.type) && (
                <div className="preview-row"><span className="preview-label">Container</span><span className="preview-value" style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>{state.container || "—"}</span></div>
              )}
              {state.type === "reproducibility" && <div className="preview-row"><span className="preview-label">Official scoring rule</span><span className="preview-value">{scoringRuleLabel(state)}</span></div>}
              {state.type === "reproducibility" && state.tolerance && <div className="preview-row"><span className="preview-label">Allowed drift</span><span className="preview-value" style={{ fontFamily: "monospace" }}>{state.tolerance}</span></div>}
              {state.type === "prediction" && state.metric && <div className="preview-row"><span className="preview-label">Metric</span><span className="preview-value">{state.metric}</span></div>}
              {state.type === "prediction" && state.idColumn && <div className="preview-row"><span className="preview-label">ID column</span><span className="preview-value" style={{ fontFamily: "monospace" }}>{state.idColumn}</span></div>}
              {state.type === "prediction" && state.labelColumn && <div className="preview-row"><span className="preview-label">Label column</span><span className="preview-value" style={{ fontFamily: "monospace" }}>{state.labelColumn}</span></div>}
              {state.type === "prediction" && state.hiddenLabels && <div className="preview-row"><span className="preview-label">Hidden labels</span><span className="preview-value" style={{ fontFamily: "monospace", fontSize: "0.72rem" }}>{state.hiddenLabels.length > 40 ? state.hiddenLabels.slice(0, 40) + "…" : state.hiddenLabels}</span></div>}
              {state.submissionFormat && <div className="preview-row"><span className="preview-label">Submission format</span><span className="preview-value">{state.submissionFormat}</span></div>}
              {state.successDefinition && <div className="preview-row"><span className="preview-label">Success criteria</span><span className="preview-value">{state.successDefinition}</span></div>}
              {state.evaluationCriteria && <div className="preview-row span-full"><span className="preview-label">Evaluation</span><span className="preview-value">{state.evaluationCriteria}</span></div>}
              <div className="preview-divider" />
              <div className="preview-row"><span className="preview-label">Reward pool</span><span className="preview-value">{state.reward} USDC</span></div>
              <div className="preview-row"><span className="preview-label">Payout rule</span><span className="preview-value">{state.distribution.replace(/_/g, " ")}</span></div>
              <div className="preview-row"><span className="preview-label">Submission window</span><span className="preview-value">{state.deadlineDays === "0" ? "30 min" : `${state.deadlineDays} days`}</span></div>
              <div className="preview-row"><span className="preview-label">Review window</span><span className="preview-value">{state.disputeWindow === "0" ? "none" : `${state.disputeWindow}h`}</span></div>
              <div className="preview-row"><span className="preview-label">Payout released</span><span className="preview-value">{formatPayoutDate(state.deadlineDays, state.disputeWindow)}</span></div>
              <div className="preview-divider" />
              <div className="preview-row span-full">
                <span className="preview-label">Funding path</span>
                <span className="preview-value">
                  {fundingState.status === "checking"
                    ? "Checking token support and allowance..."
                    : fundingState.status === "error"
                      ? fundingState.message ?? "Unable to determine posting flow."
                      : !balanceReady
                        ? fundingState.message ?? "Wallet balance is too low for this reward."
                        : fundingState.method === "permit" && !allowanceReady
                          ? `${fundingState.tokenName} supports permit. Sign once, then submit the challenge in one transaction.`
                          : allowanceReady
                            ? "Allowance already covers this reward. You can create the challenge now."
                            : "This token requires approval before challenge creation."}
                </span>
              </div>
            </div>
            <div className="preview-actions">
              <button type="button" onClick={() => setShowPreview(false)}
                className="dash-btn" style={{ fontSize: "0.8rem" }}>
                ← Edit
              </button>
              {fundingState.status === "ready" && fundingState.method === "approve" && (
                <button
                  type="button"
                  disabled={isBusy || fundingState.status !== "ready" || allowanceReady || !balanceReady}
                  onClick={() => { void handleApprove(); }}
                  className="dash-btn"
                  style={{ fontSize: "0.8rem" }}
                >
                  {pendingAction === "approving"
                    ? <Loader2 size={14} className="animate-spin" />
                    : <Check size={14} />}
                  {allowanceReady ? "USDC Approved" : "Approve USDC"}
                </button>
              )}
              <button
                type="button"
                disabled={
                  isBusy
                  || fundingState.status !== "ready"
                  || !balanceReady
                  || (fundingState.method === "approve" && !allowanceReady)
                }
                onClick={() => { void handleCreate(); }}
                className="dash-btn dash-btn-primary"
                style={{ fontSize: "0.8rem" }}
              >
                {isBusy
                  ? <Loader2 size={14} className="animate-spin" />
                  : <ArrowRight size={14} />}
                {fundingState.method === "permit" && !allowanceReady
                  ? "Sign Permit & Create"
                  : "Create Challenge"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
