"use client";

import HermesFactoryAbiJson from "@hermes/common/abi/HermesFactory.json";
import {
  defaultPresetIdForChallengeType,
  getDisputeWindowMinHours,
  isTestnetChain,
  PRESET_REGISTRY,
  validatePresetIntegrity,
  validateScoringContainer,
} from "@hermes/common";
import { useRef, useState } from "react";
import { type Abi, parseUnits } from "viem";
import { useAccount, usePublicClient, useSignMessage, useWriteContract } from "wagmi";
import { useConnectModal, useChainModal } from "@rainbow-me/rainbowkit";
import {
  Wallet, ArrowRight, AlertCircle, Loader2, CheckCircle,
  FlaskConical, BarChart3, Settings2, ShieldAlert, ChevronRight, Check,
  Upload, Eye, X, Tag
} from "lucide-react";
import { motion } from "motion/react";
import { buildPinSpecMessage, computeSpecHash } from "../../lib/pin-spec-auth";
import { accelerateChallengeIndex } from "../../lib/api";
import { CHAIN_ID, FACTORY_ADDRESS, USDC_ADDRESS } from "../../lib/config";
import { formatUsdc, computeProtocolFee } from "../../lib/format";

const HermesFactoryAbi = HermesFactoryAbiJson as unknown as Abi;

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
] as const;

type PostChallengeType = "prediction" | "optimization" | "reproducibility" | "red_team" | "custom";

// ─── Icon mapping for presets ───────────────────────
const TYPE_ICONS: Record<PostChallengeType, typeof FlaskConical> = {
  prediction: BarChart3,
  optimization: FlaskConical,
  reproducibility: FlaskConical,
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

const REGISTRY_PRESETS = Object.values(PRESET_REGISTRY);
const REPRODUCIBILITY_PRESET_ID =
  defaultPresetIdForChallengeType("reproducibility");
const PREDICTION_PRESET_ID = defaultPresetIdForChallengeType("prediction");
const reproducibilityPreset =
  REPRODUCIBILITY_PRESET_ID &&
    REPRODUCIBILITY_PRESET_ID !== "custom"
    ? PRESET_REGISTRY[REPRODUCIBILITY_PRESET_ID]
    : undefined;
const predictionPreset =
  PREDICTION_PRESET_ID && PREDICTION_PRESET_ID !== "custom"
    ? PRESET_REGISTRY[PREDICTION_PRESET_ID]
    : undefined;

if (!reproducibilityPreset || !predictionPreset) {
  throw new Error(
    "Required presets (reproducibility/prediction) are missing from PRESET_REGISTRY.",
  );
}

// ─── Reproducibility sub-presets ─────────────────────
const REPRO_SUB_PRESETS = [
  { id: "csv_comparison_v1", label: "CSV Comparison", desc: "Row-by-row comparison against ground truth" },
  { id: "file_hash_v1", label: "File Hash Match", desc: "SHA-256 exact match (100 or 0)" },
  { id: "number_absdiff_v1", label: "Number Match", desc: "Score = 100 − abs(answer − target)" },
] as const;

const TYPE_CONFIG = {
  prediction: {
    label: "Prediction",
    description: "Solvers predict outcomes on held-out test data (Kaggle-style)",
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
    description: "Solvers reproduce a known result from a published pipeline",
    defaultDomain: "other",
    metricHint: "custom",
    container: reproducibilityPreset.container,
    defaultMinimumScore: reproducibilityPreset.defaultMinimumScore,
    presetId: reproducibilityPreset.id,
    scoringTemplate: reproducibilityPreset.scoringDescription,
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

const TYPE_OPTIONS = Object.keys(TYPE_CONFIG) as PostChallengeType[];

// ─── Pipeline diagrams per type ──────────────────────

type PipelineFlow = {
  posterAction: string;
  posterFiles: string;
  solverAction: string;
  solverFiles: string;
  scorerAction: string;
  scorerResult: string;
  helper: string;
};

const PIPELINE_FLOWS: Record<PostChallengeType, PipelineFlow> = {
  prediction: {
    posterAction: "Uploads",
    posterFiles: "train + test + labels",
    solverAction: "Submits",
    solverFiles: "predictions",
    scorerAction: "Compares",
    scorerResult: "vs. labels \u2192 score",
    helper: "Solvers train on your data and predict values for the test set. The scorer compares their predictions against your hidden labels.",
  },
  reproducibility: {
    posterAction: "Uploads",
    posterFiles: "inputs + expected",
    solverAction: "Submits",
    solverFiles: "reproduced_output",
    scorerAction: "Compares",
    scorerResult: "vs. expected \u2192 score",
    helper: "Solvers reproduce a known result from your input data. The scorer compares their output to yours.",
  },
  optimization: {
    posterAction: "Uploads",
    posterFiles: "evaluation_bundle",
    solverAction: "Submits",
    solverFiles: "parameters",
    scorerAction: "Simulates",
    scorerResult: "with your image \u2192 score",
    helper: "Solvers submit parameters. Your scorer runs the simulation and returns a score.",
  },
  red_team: {
    posterAction: "Uploads",
    posterFiles: "model + baseline data",
    solverAction: "Submits",
    solverFiles: "adversarial inputs",
    scorerAction: "Measures",
    scorerResult: "model degradation \u2192 score",
    helper: "Solvers find inputs that break your model. Your scorer measures how much the model degrades on adversarial cases.",
  },
  custom: {
    posterAction: "Uploads",
    posterFiles: "public + private data",
    solverAction: "Submits",
    solverFiles: "solution",
    scorerAction: "Evaluates",
    scorerResult: "with docker \u2192 score",
    helper: "Define your own scoring logic via a Docker container.",
  },
};

function PipelineVisual({ type }: { type: PostChallengeType }) {
  const flow = PIPELINE_FLOWS[type];

  return (
    <div className="pipeline-diagram">
      <div className="pipeline-visual">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="pipeline-node"
        >
          <div className="pipeline-icon"><Upload size={18} /></div>
          <div className="pipeline-title">Poster</div>
          <div className="pipeline-action">{flow.posterAction}</div>
          <div className="pipeline-files">{flow.posterFiles}</div>
        </motion.div>

        <div className="pipeline-track">
          <motion.div
            className="pipeline-dot"
            animate={{ x: ["-100%", "200%"] }}
            transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
          />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="pipeline-node"
        >
          <div className="pipeline-icon"><Wallet size={18} /></div>
          <div className="pipeline-title">Solver</div>
          <div className="pipeline-action">{flow.solverAction}</div>
          <div className="pipeline-files">{flow.solverFiles}</div>
        </motion.div>

        <div className="pipeline-track">
          <motion.div
            className="pipeline-dot"
            animate={{ x: ["-100%", "200%"] }}
            transition={{ repeat: Infinity, duration: 1.5, ease: "linear", delay: 0.75 }}
          />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="pipeline-node pipeline-node-scorer"
        >
          <div className="pipeline-icon"><CheckCircle size={18} /></div>
          <div className="pipeline-title">Scorer</div>
          <div className="pipeline-action">{flow.scorerAction}</div>
          <div className="pipeline-files">{flow.scorerResult}</div>
        </motion.div>
      </div>
      <p className="pipeline-diagram-helper">
        {flow.helper}
      </p>
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

// ─── Example templates for "Load Example" ─────────
const EXAMPLES: Record<string, { label: string; state: Partial<FormState> }> = {
  prediction: {
    label: "Gene Expression Prediction",
    state: {
      title: "Predict gene expression from promoter sequences",
      description: "Predict expression levels from promoter sequence inputs.\nProvide your model details and any preprocessing steps.",
      domain: "omics",
      type: "prediction",
      train: "https://example.com/train.csv",
      test: "https://example.com/test.csv",
      hiddenLabels: "https://example.com/labels.csv",
      metric: "r2",
      reward: "10",
      distribution: "top_3",
      submissionType: "csv",
      submissionFormat: "CSV with columns: id, prediction",
      idColumn: "id",
      labelColumn: "prediction",
      tags: ["prediction", "omics"],
    },
  },
  reproducibility: {
    label: "Longevity Clock Reproduction",
    state: {
      title: "Reproduce a published longevity score",
      description: "Reproduce the published score for the provided dataset.\nInclude your methodology, preprocessing steps, and any assumptions.",
      domain: "longevity",
      type: "reproducibility",
      train: "https://example.com/input_data.csv",
      test: "https://example.com/expected_output.csv",
      reward: "10",
      distribution: "winner_take_all",
      reproPresetId: "csv_comparison_v1",
      tolerance: "1e-4",
      tags: ["reproducibility", "longevity"],
    },
  },
};

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
  expectedSubmissionColumns: string[];
};

const defaultPreset = TYPE_CONFIG.reproducibility;

const initialState: FormState = {
  title: "",
  description: "",
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
  disputeWindow: "168",
  submissionType: "number",
  submissionFormat: '{"answer": <number>}',
  evaluationCriteria: "",
  successDefinition: "",
  idColumn: "id",
  labelColumn: "prediction",
  reproPresetId: "csv_comparison_v1",
  tolerance: "",
  tags: [],
  detectedColumns: [],
  expectedSubmissionColumns: [],
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

  return {
    id: `web-${Date.now()}`,
    preset_id: presetId,
    title: state.title,
    domain: state.domain,
    type: state.type,
    description: state.description,
    dataset,
    scoring: { container: state.container, metric: state.metric },
    reward: {
      total: Number(state.reward),
      distribution: state.distribution,
    },
    deadline: computeDeadlineIso(state.deadlineDays),
    minimum_score: Number(state.minimumScore),
    dispute_window_hours: Number(state.disputeWindow),
    evaluation: {
      submission_format: state.submissionFormat || undefined,
      criteria: state.evaluationCriteria || undefined,
      success_definition: state.successDefinition || undefined,
      id_column: state.idColumn || undefined,
      label_column: state.labelColumn || undefined,
      ...(state.tolerance ? { tolerance: state.tolerance } : {}),
      ...(state.expectedSubmissionColumns.length > 0
        ? { submission_columns: state.expectedSubmissionColumns }
        : {}),
    },
    ...(state.tags.length > 0 ? { tags: state.tags } : {}),
    lab_tba: "0x0000000000000000000000000000000000000000",
  };
}

// ─── Deadline Helpers ────────────────────────────────

/** Compute a fresh deadline ISO from days. Always computed live, never stored stale. */
function computeDeadlineIso(days: string): string {
  const d = Number(days);
  if (d === 0) return new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 min for testnet
  return new Date(Date.now() + d * 24 * 60 * 60 * 1000).toISOString();
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
        <>
          <Loader2 size={20} className="animate-spin drop-zone-area-icon" />
          <span className="drop-zone-area-label">Uploading &amp; pinning to IPFS…</span>
        </>
      ) : (
        <>
          <Upload size={20} className="drop-zone-area-icon" />
          <span className="drop-zone-area-label">Click to browse or drag a file</span>
          <span className="drop-zone-area-sub">or paste an IPFS / HTTPS link below</span>
          <input
            className="drop-zone-url-input"
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onClick={(e) => e.stopPropagation()}
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
  const [isPosting, setIsPosting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [uploadingField, setUploadingField] = useState<"train" | "test" | "hiddenLabels" | null>(null);
  const [fileNames, setFileNames] = useState<Record<string, string>>({});
  const [tagInput, setTagInput] = useState("");

  const { isConnected, chainId, address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { signMessageAsync } = useSignMessage();
  const { openConnectModal } = useConnectModal();
  const { openChainModal } = useChainModal();

  const isWrongChain = isConnected && chainId !== CHAIN_ID;
  const walletReady = isConnected && !isWrongChain;

  const rewardValue = Number(state.reward || 0);
  const { feeUsdc: protocolFeeValue, payoutUsdc: winnerPayoutValue } = computeProtocolFee(rewardValue);

  const isCustomType = state.type === "custom" || state.type === "optimization" || state.type === "red_team";

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
        // Auto-fill columns only if user hasn't edited them yet
        ...(shouldDetectColumns && detectedCols.length > 0
          ? {
              detectedColumns: detectedCols,
              ...(s.expectedSubmissionColumns.length === 0
                ? { expectedSubmissionColumns: detectedCols }
                : {}),
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

  function loadExample(key: string) {
    const example = EXAMPLES[key];
    if (!example) return;
    const t = (example.state.type ?? "reproducibility") as PostChallengeType;
    const typePreset = TYPE_CONFIG[t];
    setState({
      ...initialState,
      container: typePreset.container,
      metric: typePreset.metricHint,
      domain: typePreset.defaultDomain,
      minimumScore: String(typePreset.defaultMinimumScore),
      evaluationCriteria: typePreset.scoringTemplate,
      ...example.state,
    } as FormState);
    setStatus("");
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
      tolerance: "",
      train: "",
      test: "",
      // Reset repro sub-preset to default when switching to reproducibility
      ...(t === "reproducibility" ? { reproPresetId: "csv_comparison_v1" } : {}),
      // Prediction: default to CSV submission with id + prediction columns
      ...(t === "prediction" ? {
        submissionType: "csv",
        submissionFormat: "CSV with columns: id, prediction",
        idColumn: "id",
        labelColumn: "prediction",
      } : {}),
    }));
    setFileNames({});
  }

  function validateInput() {
    if (!state.title.trim() || !state.description.trim())
      return "Title and description are required.";
    if (!Number.isFinite(rewardValue) || rewardValue <= 0)
      return "Reward must be a positive number.";
    if (rewardValue < 1 || rewardValue > 30)
      return "Reward must be between 1 and 30 USDC.";

    // Per-type required uploads
    if (state.type === "prediction") {
      if (!state.train.trim()) return "Training dataset is required for prediction challenges.";
      if (!state.test.trim()) return "Test dataset is required for prediction challenges.";
      if (!state.hiddenLabels.trim()) return "Hidden labels are required for prediction challenges. Upload the ground truth used for scoring.";
    } else if (state.type === "reproducibility") {
      if (!state.train.trim()) return "Input bundle is required for reproducibility challenges.";
      if (!state.test.trim()) return "Expected artifact is required for reproducibility challenges. Upload the reference output the scorer compares against.";
    } else if (state.type === "optimization") {
      if (!state.train.trim()) return "Evaluation bundle is required for optimization challenges.";
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

    const disputeWindow = Number(state.disputeWindow);
    const minDispute = getDisputeWindowMinHours(CHAIN_ID);
    if (!Number.isFinite(disputeWindow) || disputeWindow < minDispute || disputeWindow > 2160)
      return `Dispute window must be between ${minDispute} and 2160 hours.`;
    return null;
  }

  async function handleSubmit() {
    if (!walletReady) return; // button is disabled — should not reach here
    if (!FACTORY_ADDRESS || !USDC_ADDRESS) {
      setStatus("Missing NEXT_PUBLIC_HERMES_FACTORY_ADDRESS or NEXT_PUBLIC_HERMES_USDC_ADDRESS.");
      return;
    }
    if (!publicClient) { setStatus("Wallet client is not ready. Reconnect wallet and retry."); return; }
    const error = validateInput();
    if (error) { setStatus(error); return; }

    try {
      setIsPosting(true);
      setStatus("Pinning spec to IPFS...");
      const spec = buildSpec(state);
      if (!address) throw new Error("Wallet address is required to authorize spec pinning.");

      const timestamp = Date.now();
      const specHash = computeSpecHash(spec);
      const message = buildPinSpecMessage({ address, timestamp, specHash });
      const signature = await signMessageAsync({ account: address, message });

      const pinRes = await fetch("/api/pin-spec", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spec, auth: { address, timestamp, specHash, signature } }),
      });
      if (!pinRes.ok) throw new Error(await pinRes.text());
      const { specCid } = (await pinRes.json()) as { specCid: string };

      const rewardUnits = parseUnits(String(spec.reward.total), 6);
      const minimumScoreWad = parseUnits(String(spec.minimum_score ?? 0), 18);
      const deadlineTs = new Date(spec.deadline).getTime();

      const currentBalance = await publicClient.readContract({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      }) as bigint;
      if (currentBalance < rewardUnits) {
        const missing = rewardUnits - currentBalance;
        throw new Error(
          `Insufficient USDC balance. Need ${formatUsdc(Number(rewardUnits) / 1e6)} USDC, missing ${formatUsdc(Number(missing) / 1e6)} USDC.`,
        );
      }

      const currentAllowance = await publicClient.readContract({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address, FACTORY_ADDRESS],
      }) as bigint;

      if (currentAllowance < rewardUnits) {
        setStatus("Approving USDC allowance...");
        const approveTx = await writeContractAsync({
          account: address,
          address: USDC_ADDRESS,
          abi: erc20Abi,
          functionName: "approve",
          args: [FACTORY_ADDRESS, rewardUnits],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveTx });
      } else {
        setStatus("USDC already approved, creating challenge...");
      }

      setStatus("Creating challenge on-chain...");
      const createTx = await writeContractAsync({
        account: address,
        address: FACTORY_ADDRESS,
        abi: HermesFactoryAbi,
        functionName: "createChallenge",
        args: [
          specCid, rewardUnits, BigInt(Math.floor(deadlineTs / 1000)),
          BigInt(spec.dispute_window_hours ?? 168), minimumScoreWad,
          DISTRIBUTION_TO_ENUM[spec.reward.distribution as keyof typeof DISTRIBUTION_TO_ENUM] ?? 0,
          "0x0000000000000000000000000000000000000000",
          0n, // maxSubmissions (0 = use off-chain defaults)
          0n, // maxSubmissionsPerSolver (0 = use off-chain defaults)
        ],
      });

      await publicClient.waitForTransactionReceipt({ hash: createTx });
      setStatus("Challenge confirmed on-chain. Accelerating indexer sync...");
      try {
        await accelerateChallengeIndex({ txHash: createTx });
        setStatus(`success: Challenge posted. tx=${createTx}. Indexed immediately.`);
      } catch {
        setStatus(`success: Challenge posted on-chain (tx=${createTx}). Indexer will sync it shortly.`);
      }
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Failed to post challenge.";
      if (message.includes("USDC_TRANSFER_FAILED")) {
        setStatus("createChallenge reverted: USDC transfer failed. Confirm wallet has enough USDC and allowance for the same connected address.");
      } else {
        setStatus(message);
      }
    } finally {
      setIsPosting(false);
    }
  }

  const isSuccess = status.startsWith("success:");


  return (
    <div className="post-form">
      {/* Header */}
      <div className="post-header">
        <div className="post-header-left">
          <h1 className="page-title">Post Bounty</h1>
          <p className="page-subtitle">
            Define a computational challenge and fund it with USDC.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <select
            className="form-select"
            style={{ fontSize: "0.75rem", padding: "0.35rem 0.5rem", width: "auto" }}
            value=""
            onChange={(e) => { if (e.target.value) loadExample(e.target.value); e.target.value = ""; }}
          >
            <option value="">Load Example…</option>
            {Object.entries(EXAMPLES).map(([key, ex]) => (
              <option key={key} value={key}>{ex.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Challenge Type Selector ── */}
      <div className="type-selector">
        {TYPE_OPTIONS.map((key) => {
          const preset = TYPE_CONFIG[key];
          const Icon = TYPE_ICONS[key];
          const active = state.type === key;
          return (
            <button
              key={key}
              type="button"
              className={`type-card ${active ? "active" : ""}`}
              onClick={() => selectType(key)}
            >
              <div className="type-card-check">
                {active && <Check size={10} strokeWidth={3} />}
              </div>
              <div className="type-card-icon">
                <Icon size={18} />
              </div>
              <div className="type-card-title">{preset.label}</div>
              <div className="type-card-desc">{preset.description}</div>
            </button>
          );
        })}
      </div>

      {/* ── Section 1: Problem ── */}
      <div className="form-section">
        <div className="form-section-header">
          <span className="form-section-step">1</span>
          <span className="form-section-title">Problem</span>
        </div>
        <div className="form-section-body">
          <div className="form-grid">
            <FormField label="Title">
              <input className="form-input" placeholder="e.g. Find the optimal protein fold"
                value={state.title} onChange={(e) => setState((s) => ({ ...s, title: e.target.value }))} />
            </FormField>
            <FormField label="Domain">
              <select className="form-select" value={state.domain}
                onChange={(e) => setState((s) => ({ ...s, domain: e.target.value }))}>
                <option value="longevity">Longevity</option>
                <option value="drug_discovery">Drug Discovery</option>
                <option value="protein_design">Protein Design</option>
                <option value="omics">Omics</option>
                <option value="neuroscience">Neuroscience</option>
                <option value="other">Other</option>
              </select>
            </FormField>
            <FormField label="Description" className="span-full">
              <textarea className="form-textarea" placeholder="What problem are you trying to solve? What should solvers achieve?"
                value={state.description} onChange={(e) => setState((s) => ({ ...s, description: e.target.value }))} />
            </FormField>
            <FormField label="Tags" hint="Press Enter or comma to add" className="span-full">
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", alignItems: "center" }}>
                {state.tags.map((tag) => (
                  <span key={tag} style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem", padding: "0.2rem 0.5rem", borderRadius: "12px", background: "var(--surface-inset)", fontSize: "0.72rem", color: "var(--text-secondary)", border: "1px solid var(--border-subtle)" }}>
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
                  placeholder={state.tags.length === 0 ? "e.g. longevity, prediction, omics" : "Add tag…"}
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
        <div className="form-section-header">
          <span className="form-section-step">2</span>
          <span className="form-section-title">Data &amp; Inputs</span>
        </div>
        <div className="form-section-body">
          <PipelineVisual type={state.type} />
          <div className="form-grid">
            {/* ── Prediction: 3 uploads ── */}
            {state.type === "prediction" && (
              <>
                <FormField label="Train (with labels)" hint="Public dataset solvers use to build and train models">
                  <DataUploadField
                    value={state.train}
                    onChange={(v) => { setState((s) => ({ ...s, train: v })); if (!v) setFileNames((p) => ({ ...p, train: "" })); }}
                    uploading={uploadingField === "train"}
                    onUpload={(file) => handleFileUpload(file, "train")}
                    placeholder="ipfs://... or https://..."
                    fileName={fileNames.train}
                  />
                </FormField>
                <FormField label="Test (no labels)" hint="Public test inputs — solvers predict values for these rows">
                  <DataUploadField
                    value={state.test}
                    onChange={(v) => { setState((s) => ({ ...s, test: v })); if (!v) setFileNames((p) => ({ ...p, test: "" })); }}
                    uploading={uploadingField === "test"}
                    onUpload={(file) => handleFileUpload(file, "test")}
                    placeholder="ipfs://... or https://..."
                    fileName={fileNames.test}
                  />
                </FormField>
                <FormField label="Hidden labels (for scoring)" hint="Ground truth labels the scorer compares submissions against" className="span-full">
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
                <FormField label="Input dataset (visible to solvers)" hint="Source data and inputs solvers must reproduce from">
                  <DataUploadField
                    value={state.train}
                    onChange={(v) => { setState((s) => ({ ...s, train: v })); if (!v) setFileNames((p) => ({ ...p, train: "" })); }}
                    uploading={uploadingField === "train"}
                    onUpload={(file) => handleFileUpload(file, "train")}
                    placeholder="ipfs://... or https://..."
                    fileName={fileNames.train}
                  />
                </FormField>
                <FormField label="Expected output (used for scoring)" hint="Reference artifact the scorer compares submissions against">
                  <DataUploadField
                    value={state.test}
                    onChange={(v) => {
                      setState((s) => ({
                        ...s, test: v,
                        // Clear detected columns when file is removed
                        ...(!v ? { detectedColumns: [], expectedSubmissionColumns: [] } : {}),
                      }));
                      if (!v) setFileNames((p) => ({ ...p, test: "" }));
                    }}
                    uploading={uploadingField === "test"}
                    onUpload={(file) => handleFileUpload(file, "test")}
                    placeholder="ipfs://... or https://..."
                    fileName={fileNames.test}
                  />
                </FormField>
                <FormField label="Tolerance" hint="Numeric tolerance for comparison (e.g. 1e-4). Leave empty for exact match.">
                  <input className="form-input form-input-mono" placeholder="e.g. 1e-4 or 0.001"
                    value={state.tolerance} onChange={(e) => setState((s) => ({ ...s, tolerance: e.target.value }))} />
                </FormField>
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
        <div className="form-section-header">
          <span className="form-section-step">3</span>
          <span className="form-section-title">Evaluation</span>
        </div>
        <div className="form-section-body">
          <div className="form-grid">
            {/* Submission format — always shown */}
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

            {/* ── Prediction-specific fields ── */}
            {state.type === "prediction" && (
              <>
                <div className="span-full" style={{ borderTop: "1px solid var(--border-subtle)", margin: "0.25rem 0" }} />
                <FormField label="ID column" hint="Column name for row identifiers in test.csv">
                  <input className="form-input form-input-mono" placeholder="id"
                    value={state.idColumn} onChange={(e) => setState((s) => ({ ...s, idColumn: e.target.value }))} />
                </FormField>
                <FormField label="Label column" hint="Column name solvers must predict">
                  <input className="form-input form-input-mono" placeholder="prediction"
                    value={state.labelColumn} onChange={(e) => setState((s) => ({ ...s, labelColumn: e.target.value }))} />
                </FormField>
                <FormField label="Metric" hint={METRIC_OPTIONS.find(m => m.value === state.metric)?.hint ?? ""}>
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
                <FormField label="Scoring detail" hint="Additional context (optional)">
                  <input className="form-input" placeholder="e.g. Evaluated on held-out test split"
                    value={state.evaluationCriteria} onChange={(e) => setState((s) => ({ ...s, evaluationCriteria: e.target.value }))} />
                </FormField>
                {/* Submission preview */}
                <div className="span-full">
                  <p style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", margin: "0 0 0.25rem", fontWeight: 600 }}>Expected submission format</p>
                  <pre style={{ margin: 0, padding: "0.5rem 0.75rem", background: "var(--surface-inset)", borderRadius: "6px", fontSize: "0.72rem", fontFamily: "var(--font-mono)", color: "var(--text-secondary)", lineHeight: 1.6, overflowX: "auto" }}>
                    {`${state.idColumn || "id"},${state.labelColumn || "prediction"}
SAMPLE_001,1.23
SAMPLE_002,0.85
SAMPLE_003,2.10`}
                  </pre>
                </div>
                <p className="span-full" style={{ fontSize: "0.72rem", color: "var(--text-tertiary)", margin: 0, fontStyle: "italic" }}>
                  The scorer compares each row of solver predictions against your hidden labels using {METRIC_OPTIONS.find(m => m.value === state.metric)?.label ?? state.metric}.
                </p>
              </>
            )}

            {/* ── Reproducibility-specific fields ── */}
            {state.type === "reproducibility" && (
              <>
                <div className="span-full" style={{ borderTop: "1px solid var(--border-subtle)", margin: "0.25rem 0" }} />
                {/* Locked scoring method badge */}
                <div className="span-full">
                  <p style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", margin: "0 0 0.35rem", fontWeight: 600 }}>Scoring method</p>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.75rem", background: "var(--surface-base)", border: "1px solid var(--border-default)", borderRadius: "6px" }}>
                    <Check size={14} style={{ color: "#000" }} />
                    <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-primary)" }}>CSV Comparison</span>
                    <span style={{ fontSize: "0.72rem", color: "var(--text-tertiary)" }}>&mdash; Row-by-row comparison against ground truth</span>
                  </div>
                </div>
                <FormField label="Scoring description" hint="Describe how submissions are compared to expected output" className="span-full">
                  <textarea className="form-textarea" placeholder="e.g. Row-by-row comparison of output CSV against expected_output.csv with numeric tolerance 1e-4"
                    value={state.evaluationCriteria} onChange={(e) => setState((s) => ({ ...s, evaluationCriteria: e.target.value }))} />
                </FormField>
                {/* Auto-detected submission format */}
                <div className="span-full">
                  <p style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", margin: "0 0 0.35rem", fontWeight: 600 }}>
                    Expected submission format
                    {state.detectedColumns.length > 0 && (
                      <span style={{ fontWeight: 400, fontStyle: "italic", marginLeft: "0.5rem" }}>
                        (auto-detected from {fileNames.test || "expected output"})
                      </span>
                    )}
                  </p>
                  {state.detectedColumns.length > 0 ? (
                    <>
                      <pre style={{ margin: 0, padding: "0.5rem 0.75rem", background: "var(--surface-inset)", borderRadius: "6px", fontSize: "0.72rem", fontFamily: "var(--font-mono)", color: "var(--text-secondary)", lineHeight: 1.6, overflowX: "auto" }}>
                        {state.detectedColumns.join(",")}
                      </pre>
                      <input
                        className="form-input form-input-mono"
                        style={{ marginTop: "0.35rem", fontSize: "0.72rem" }}
                        value={state.expectedSubmissionColumns.join(",")}
                        onChange={(e) => setState((s) => ({
                          ...s,
                          expectedSubmissionColumns: e.target.value.split(",").map((c) => c.trim()).filter(Boolean),
                        }))}
                        placeholder="Edit column names if needed"
                      />
                      <p style={{ fontSize: "0.72rem", color: "var(--text-tertiary)", margin: "0.25rem 0 0", fontStyle: "italic" }}>
                        Submission CSV must match these columns. Edit above if needed.
                      </p>
                    </>
                  ) : (
                    <p style={{ fontSize: "0.72rem", color: "var(--text-tertiary)", margin: 0, fontStyle: "italic" }}>
                      Upload expected output to auto-detect submission columns.
                    </p>
                  )}
                </div>
                <p className="span-full" style={{ fontSize: "0.72rem", color: "var(--text-tertiary)", margin: 0, fontStyle: "italic" }}>
                  The scorer does a row-by-row comparison of the solver&#39;s output against your expected output.
                </p>
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
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.75rem", background: "var(--surface-inset)", borderRadius: "6px", fontSize: "0.75rem", fontFamily: "var(--font-mono)" }}>
                  <span style={{ fontWeight: 600, color: "var(--text-secondary)" }}>Scorer:</span>
                  <span style={{ color: "var(--text-primary)" }}>{engineDisplayName(state.container)}</span>
                </div>
                <p style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", margin: 0, fontStyle: "italic" }}>
                  Managed scorer — scoring is deterministic and independently verifiable.
                </p>
              </div>
            )}

          </div>
        </div>
      </div>

      {/* ── Section 4: Reward & Execution ── */}
      <div className="form-section">
        <div className="form-section-header">
          <span className="form-section-step">4</span>
          <span className="form-section-title">Reward &amp; Execution</span>
        </div>
        <div className="form-section-body">
          <div className="form-grid">
            <FormField label="Reward (USDC)" hint="Between 1 and 30 USDC">
              <input className="form-input form-input-mono" type="number" min={1} max={30}
                value={state.reward} onChange={(e) => setState((s) => ({ ...s, reward: e.target.value }))} />
            </FormField>
            <FormField label="Winner selection" hint={WINNER_LABELS[state.distribution] ?? ""}>
              <select className="form-select" value={state.distribution}
                onChange={(e) => setState((s) => ({ ...s, distribution: e.target.value as FormState["distribution"] }))}>
                <option value="winner_take_all">Winner Take All</option>
                <option value="top_3">Top 3</option>
                <option value="proportional">Proportional</option>
              </select>
            </FormField>
            <FormField label="Submission deadline" hint="How long solvers have to submit">
              <select className="form-select" value={state.deadlineDays}
                onChange={(e) => setState((s) => ({ ...s, deadlineDays: e.target.value }))}>
                {isTestnetChain(CHAIN_ID) && <option value="0">Quick test (15 min)</option>}
                <option value="7">7 days</option>
                <option value="14">14 days</option>
                <option value="30">30 days</option>
                <option value="60">60 days</option>
                <option value="90">90 days</option>
              </select>
            </FormField>
            <FormField label="Dispute window" hint="Time for anyone to challenge scores before payout">
              <select className="form-select" value={state.disputeWindow}
                onChange={(e) => setState((s) => ({ ...s, disputeWindow: e.target.value }))}>
                {isTestnetChain(CHAIN_ID) && <option value="0">No dispute window (testnet only)</option>}
                {isTestnetChain(CHAIN_ID) && <option value="1">1 hour — Testing</option>}
                <option value="168">7 days — Standard</option>
                <option value="336">14 days</option>
                <option value="720">30 days</option>
                <option value="1440">60 days</option>
                <option value="2160">90 days — Maximum</option>
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

      {/* ── Challenge Summary ── */}
      <div className="cost-card">
        <h3 className="cost-card-title">
          <Eye size={14} /> Challenge Summary
        </h3>
        <div className="cost-row">
          <span className="cost-row-label" style={{ color: "var(--text-secondary)" }}>Type</span>
          <span className="cost-row-value">{TYPE_CONFIG[state.type].label}</span>
        </div>
        <div className="cost-row">
          <span className="cost-row-label" style={{ color: "var(--text-secondary)" }}>Deposit</span>
          <span className="cost-row-value accent">{formatUsdc(rewardValue)} USDC</span>
        </div>
        <div className="cost-row">
          <span className="cost-row-label" style={{ color: "var(--text-tertiary)" }}>Protocol fee (5%)</span>
          <span className="cost-row-value" style={{ color: "var(--text-tertiary)" }}>{formatUsdc(protocolFeeValue)} USDC</span>
        </div>
        <div className="cost-row">
          <span className="cost-row-label" style={{ color: "var(--text-tertiary)" }}>Net winner payout</span>
          <span className="cost-row-value" style={{ color: "var(--text-tertiary)" }}>{formatUsdc(winnerPayoutValue)} USDC</span>
        </div>
        <div style={{ borderTop: "1px solid var(--border-subtle)", margin: "0.5rem 0" }} />
        <div className="cost-row">
          <span className="cost-row-label" style={{ color: "var(--text-tertiary)" }}>Winner</span>
          <span className="cost-row-value" style={{ color: "var(--text-secondary)", fontSize: "0.78rem" }}>{state.distribution.replace(/_/g, " ")}</span>
        </div>
        <div className="cost-row">
          <span className="cost-row-label" style={{ color: "var(--text-tertiary)" }}>Scorer</span>
          <span className="cost-row-value" style={{ color: "var(--text-secondary)", fontSize: "0.72rem", fontFamily: "var(--font-mono)" }}>
            {isCustomType ? (state.container.length > 40 ? state.container.slice(0, 40) + "…" : state.container || "—") : engineDisplayName(state.container)}
          </span>
        </div>
        {/* Challenge Timeline */}
        <div style={{ borderTop: "1px solid var(--border-subtle)", margin: "0.5rem 0" }} />
        <p style={{ fontSize: "0.68rem", fontWeight: 600, color: "var(--text-tertiary)", margin: "0 0 0.35rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Challenge Timeline
        </p>
        {/* Horizontal timeline with checkpoint marks */}
        <div style={{ position: "relative", display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "0.5rem 0 0" }}>
          {/* Connecting line */}
          <div style={{ position: "absolute", top: "0.85rem", left: "0.5rem", right: "0.5rem", height: "2px", background: "var(--border-default)", borderRadius: "1px" }} />
          {/* Progress fill — from first to second checkpoint */}
          <div style={{ position: "absolute", top: "0.85rem", left: "0.5rem", width: "20%", height: "2px", background: "#3D2E1F", borderRadius: "1px" }} />

          {[
            { label: "Submissions open", sub: state.deadlineDays === "0" ? "15 min" : `${state.deadlineDays} days`, active: true },
            { label: "Deadline", sub: formatDeadlineDate(state.deadlineDays), active: false },
            { label: "Scoring", sub: "automatic", active: false },
            { label: "Dispute window", sub: state.disputeWindow === "0" ? "none" : `${state.disputeWindow}h`, active: false },
            { label: "Payout", sub: formatPayoutDate(state.deadlineDays, state.disputeWindow), active: false },
          ].map((step, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", position: "relative", zIndex: 1, flex: "1 1 0", minWidth: 0 }}>
              {/* Checkpoint dot */}
              <div style={{
                width: "0.75rem", height: "0.75rem", borderRadius: "50%",
                background: step.active ? "#3D2E1F" : "var(--surface-default)",
                border: step.active ? "2px solid #3D2E1F" : "2px solid var(--border-default)",
                boxShadow: "0 0 0 3px var(--surface-default)",
                marginBottom: "0.35rem",
              }} />
              <span style={{ fontSize: "0.72rem", fontWeight: 600, color: step.active ? "#3D2E1F" : "var(--text-secondary)", lineHeight: 1.3, textAlign: "center" }}>{step.label}</span>
              <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", lineHeight: 1.3, textAlign: "center", marginTop: "0.1rem", fontFamily: "var(--font-mono)" }}>{step.sub}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Submit ── */}
      <div className="post-submit-row">
        <button
          type="button"
          disabled={isPosting || !walletReady}
          onClick={() => {
            const error = validateInput();
            if (error) { setStatus(error); return; }
            setShowPreview(true);
          }}
          className="post-submit-btn"
        >
          {isPosting ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
          {isPosting ? "Posting…" : "Review & Post"}
        </button>
        {!isConnected ? (
          <button type="button" onClick={() => openConnectModal?.()} className="post-submit-hint" style={{ cursor: "pointer", background: "none", border: "none", padding: 0 }}>
            <Wallet size={13} /> Connect wallet to post
          </button>
        ) : isWrongChain ? (
          <button type="button" onClick={() => openChainModal?.()} className="post-submit-hint" style={{ cursor: "pointer", background: "none", border: "none", padding: 0, color: "#D97706" }}>
            <AlertCircle size={13} /> Switch to Base Sepolia
          </button>
        ) : null}
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
                Review Challenge
              </h3>
              <button type="button" onClick={() => setShowPreview(false)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-tertiary)" }}>
                <X size={18} />
              </button>
            </div>
            <div className="preview-summary">
              <div className="preview-row"><span className="preview-label">Title</span><span className="preview-value">{state.title || "—"}</span></div>
              <div className="preview-row"><span className="preview-label">Domain</span><span className="preview-value">{state.domain}</span></div>
              <div className="preview-row"><span className="preview-label">Type</span><span className="preview-value">{TYPE_CONFIG[state.type].label}</span></div>
              {state.description && <div className="preview-row span-full"><span className="preview-label">Description</span><span className="preview-value">{state.description}</span></div>}
              {state.tags.length > 0 && <div className="preview-row"><span className="preview-label">Tags</span><span className="preview-value">{state.tags.join(", ")}</span></div>}
              <div className="preview-divider" />
              <div className="preview-row"><span className="preview-label">Container</span><span className="preview-value" style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>{state.container || "—"}</span></div>
              {state.type === "reproducibility" && <div className="preview-row"><span className="preview-label">Scoring method</span><span className="preview-value">{REPRO_SUB_PRESETS.find(rp => rp.id === state.reproPresetId)?.label ?? state.reproPresetId}</span></div>}
              {state.type === "reproducibility" && state.tolerance && <div className="preview-row"><span className="preview-label">Tolerance</span><span className="preview-value" style={{ fontFamily: "monospace" }}>{state.tolerance}</span></div>}
              {state.type === "prediction" && state.metric && <div className="preview-row"><span className="preview-label">Metric</span><span className="preview-value">{state.metric}</span></div>}
              {state.type === "prediction" && state.idColumn && <div className="preview-row"><span className="preview-label">ID column</span><span className="preview-value" style={{ fontFamily: "monospace" }}>{state.idColumn}</span></div>}
              {state.type === "prediction" && state.labelColumn && <div className="preview-row"><span className="preview-label">Label column</span><span className="preview-value" style={{ fontFamily: "monospace" }}>{state.labelColumn}</span></div>}
              {state.type === "prediction" && state.hiddenLabels && <div className="preview-row"><span className="preview-label">Hidden labels</span><span className="preview-value" style={{ fontFamily: "monospace", fontSize: "0.72rem" }}>{state.hiddenLabels.length > 40 ? state.hiddenLabels.slice(0, 40) + "…" : state.hiddenLabels}</span></div>}
              {state.submissionFormat && <div className="preview-row"><span className="preview-label">Submission format</span><span className="preview-value">{state.submissionFormat}</span></div>}
              {state.successDefinition && <div className="preview-row"><span className="preview-label">Success criteria</span><span className="preview-value">{state.successDefinition}</span></div>}
              {state.evaluationCriteria && <div className="preview-row span-full"><span className="preview-label">Evaluation</span><span className="preview-value">{state.evaluationCriteria}</span></div>}
              <div className="preview-divider" />
              <div className="preview-row"><span className="preview-label">Reward</span><span className="preview-value">{state.reward} USDC</span></div>
              <div className="preview-row"><span className="preview-label">Distribution</span><span className="preview-value">{state.distribution.replace(/_/g, " ")}</span></div>
              <div className="preview-row"><span className="preview-label">Submission window</span><span className="preview-value">{state.deadlineDays === "0" ? "15 min" : `${state.deadlineDays} days`}</span></div>
              <div className="preview-row"><span className="preview-label">Dispute window</span><span className="preview-value">{state.disputeWindow === "0" ? "none" : `${state.disputeWindow}h`}</span></div>
              <div className="preview-row"><span className="preview-label">Payout released</span><span className="preview-value">{formatPayoutDate(state.deadlineDays, state.disputeWindow)}</span></div>

            </div>
            <div className="preview-actions">
              <button type="button" onClick={() => setShowPreview(false)}
                className="dash-btn" style={{ fontSize: "0.8rem" }}>
                ← Edit
              </button>
              <button type="button" disabled={isPosting}
                onClick={() => { setShowPreview(false); handleSubmit(); }}
                className="dash-btn dash-btn-primary" style={{ fontSize: "0.8rem" }}>
                {isPosting ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
                Confirm &amp; Post On-Chain
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
