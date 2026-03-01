"use client";

import HermesFactoryAbiJson from "@hermes/common/abi/HermesFactory.json";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useMemo, useState } from "react";
import { type Abi, parseUnits } from "viem";
import { useAccount, usePublicClient, useSignMessage, useWriteContract } from "wagmi";
import {
  Wallet, ArrowRight, Coins, AlertCircle, Loader2, CheckCircle,
  FlaskConical, BarChart3, Pill, ChevronRight, Check, Settings2,
  Upload, Eye, X,
} from "lucide-react";
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
] as const;

// ─── Challenge Type Presets ─────────────────────────

type ChallengeType = "reproducibility" | "prediction" | "docking";

const TYPE_PRESETS: Record<
  ChallengeType,
  {
    label: string;
    desc: string;
    icon: typeof FlaskConical;
    container: string;
    metric: string;
    domain: string;
  }
> = {
  reproducibility: {
    label: "Reproducibility",
    desc: "Reproduce a published result or score from a paper",
    icon: FlaskConical,
    container: "ghcr.io/hermes-science/repro-scorer:latest",
    metric: "rmse",
    domain: "longevity",
  },
  prediction: {
    label: "Prediction",
    desc: "Predict outcomes from sequence, expression, or other data",
    icon: BarChart3,
    container: "ghcr.io/hermes-science/prediction-scorer:latest",
    metric: "r2",
    domain: "omics",
  },
  docking: {
    label: "Docking",
    desc: "Dock small molecules to a protein target and score binding",
    icon: Pill,
    container: "ghcr.io/hermes-science/docking-scorer:latest",
    metric: "spearman",
    domain: "drug_discovery",
  },
};

// ─── Form State ─────────────────────────────────────

type FormState = {
  title: string;
  description: string;
  domain: string;
  type: ChallengeType;
  train: string;
  test: string;
  metric: string;
  container: string;
  reward: string;
  distribution: "winner_take_all" | "top_3" | "proportional";
  deadline: string;
  minimumScore: string;
  disputeWindow: string;
  submissionFormat: string;
  evaluationCriteria: string;
  successDefinition: string;
};

const initialState: FormState = {
  title: "",
  description: "",
  domain: "longevity",
  type: "reproducibility",
  train: "",
  test: "",
  metric: "rmse",
  container: "ghcr.io/hermes-science/repro-scorer:latest",
  reward: "10",
  distribution: "winner_take_all",
  deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  minimumScore: "0",
  disputeWindow: "168",
  submissionFormat: "",
  evaluationCriteria: "",
  successDefinition: "",
};

function buildSpec(state: FormState) {
  const train = state.train.trim();
  const test = state.test.trim();
  const dataset =
    train || test
      ? {
          ...(train ? { train } : {}),
          ...(test ? { test } : {}),
        }
      : undefined;

  return {
    id: `web-${Date.now()}`,
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
    deadline: state.deadline,
    minimum_score: Number(state.minimumScore),
    dispute_window_hours: Number(state.disputeWindow),
    evaluation: {
      submission_format: state.submissionFormat || undefined,
      criteria: state.evaluationCriteria || undefined,
      success_definition: state.successDefinition || undefined,
    },
    lab_tba: "0x0000000000000000000000000000000000000000",
  };
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
  value, onChange, uploading, onUpload, placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  uploading: boolean;
  onUpload: (file: File) => void;
  placeholder: string;
}) {
  const [dragging, setDragging] = useState(false);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) onUpload(file);
  }

  return (
    <div
      className={`drop-zone ${dragging ? "dragging" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <input
        className="form-input form-input-mono"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={uploading}
      />
      {uploading ? (
        <span className="drop-zone-hint"><Loader2 size={12} className="animate-spin" /> Uploading...</span>
      ) : (
        <span className="drop-zone-hint"><Upload size={12} /> or drag a file here</span>
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
  const [uploadingField, setUploadingField] = useState<"train" | "test" | null>(null);

  const { isConnected, chainId, address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { signMessageAsync } = useSignMessage();

  const rewardValue = Number(state.reward || 0);
  const { feeUsdc: protocolFeeValue, payoutUsdc: winnerPayoutValue } = computeProtocolFee(rewardValue);

  async function handleFileUpload(file: File, field: "train" | "test") {
    setUploadingField(field);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/pin-data", { method: "POST", body: formData });
      if (!res.ok) throw new Error(await res.text());
      const { cid } = (await res.json()) as { cid: string };
      setState((s) => ({ ...s, [field]: cid }));
    } catch (err) {
      setStatus(`Upload failed: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setUploadingField(null);
    }
  }

  function selectType(t: ChallengeType) {
    const preset = TYPE_PRESETS[t];
    setState((s) => ({
      ...s,
      type: t,
      container: preset.container,
      metric: preset.metric,
      domain: preset.domain,
    }));
  }

  function validateInput() {
    if (!state.title.trim() || !state.description.trim())
      return "Title and description are required.";
    // if (!state.train.trim() || !state.test.trim())
    //   return "Train and test dataset links are required.";
    if (!Number.isFinite(rewardValue) || rewardValue <= 0)
      return "Reward must be a positive number.";
    if (rewardValue < 1 || rewardValue > 30)
      return "Reward must be between 1 and 30 USDC.";
    const minScore = Number(state.minimumScore);
    if (!Number.isFinite(minScore) || minScore < 0 || minScore > 1)
      return "Minimum score must be between 0 and 1.";
    const disputeWindow = Number(state.disputeWindow);
    if (!Number.isFinite(disputeWindow) || disputeWindow < 168 || disputeWindow > 2160)
      return "Review period must be between 168 and 2160 hours (7–90 days).";
    if (new Date(state.deadline).getTime() <= Date.now())
      return "Deadline must be in the future.";
    return null;
  }

  async function handleSubmit() {
    if (!isConnected) { setStatus("Connect wallet first."); return; }
    if (!FACTORY_ADDRESS || !USDC_ADDRESS) {
      setStatus("Missing NEXT_PUBLIC_HERMES_FACTORY_ADDRESS or NEXT_PUBLIC_HERMES_USDC_ADDRESS.");
      return;
    }
    if (chainId !== CHAIN_ID) { setStatus(`Wrong network. Expected chain id ${CHAIN_ID}.`); return; }
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
      const signature = await signMessageAsync({ message });

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

      // Check existing allowance — skip approve if already sufficient
      const currentAllowance = await publicClient.readContract({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address, FACTORY_ADDRESS],
      }) as bigint;

      if (currentAllowance < rewardUnits) {
        setStatus("Approving USDC allowance...");
        const approveTx = await writeContractAsync({
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
        address: FACTORY_ADDRESS,
        abi: HermesFactoryAbi,
        functionName: "createChallenge",
        args: [
          specCid, rewardUnits, BigInt(Math.floor(deadlineTs / 1000)),
          BigInt(spec.dispute_window_hours ?? 168), minimumScoreWad,
          DISTRIBUTION_TO_ENUM[spec.reward.distribution as keyof typeof DISTRIBUTION_TO_ENUM] ?? 0,
          "0x0000000000000000000000000000000000000000",
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
      setStatus(submitError instanceof Error ? submitError.message : "Failed to post challenge.");
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
        <ConnectButton />
      </div>

      {/* ── Challenge Type Selector ── */}
      <div className="type-selector">
        {(Object.entries(TYPE_PRESETS) as [ChallengeType, typeof TYPE_PRESETS[ChallengeType]][]).map(
          ([key, preset]) => {
            const Icon = preset.icon;
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
                <div className="type-card-desc">{preset.desc}</div>
              </button>
            );
          },
        )}
      </div>

      {/* ── Section 1: Challenge Info ── */}
      <div className="form-section">
        <div className="form-section-header">
          <span className="form-section-step">1</span>
          <span className="form-section-title">Challenge Info</span>
        </div>
        <div className="form-section-body">
          <div className="form-grid">
            <FormField label="Title">
              <input className="form-input" placeholder="e.g. Predict COVID mutations"
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
              <textarea className="form-textarea" placeholder="What are solvers trying to achieve?"
                value={state.description} onChange={(e) => setState((s) => ({ ...s, description: e.target.value }))} />
            </FormField>
          </div>
        </div>
      </div>

      {/* ── Section 2: Data ── */}
      <div className="form-section">
        <div className="form-section-header">
          <span className="form-section-step">2</span>
          <span className="form-section-title">Data</span>
        </div>
        <div className="form-section-body">
          <div className="form-grid">
            <FormField label="Train dataset">
              <DataUploadField
                value={state.train}
                onChange={(v) => setState((s) => ({ ...s, train: v }))}
                uploading={uploadingField === "train"}
                onUpload={(file) => handleFileUpload(file, "train")}
                placeholder="ipfs://Qm... or https://..."
              />
            </FormField>
            <FormField label="Test dataset">
              <DataUploadField
                value={state.test}
                onChange={(v) => setState((s) => ({ ...s, test: v }))}
                uploading={uploadingField === "test"}
                onUpload={(file) => handleFileUpload(file, "test")}
                placeholder="ipfs://Qm... or https://..."
              />
            </FormField>
          </div>
        </div>
      </div>

      {/* ── Section 3: Evaluation & Success Criteria ── */}
      <div className="form-section">
        <div className="form-section-header">
          <span className="form-section-step">3</span>
          <span className="form-section-title">Evaluation &amp; Success Criteria</span>
        </div>
        <div className="form-section-body">
          <div className="form-grid">
            <FormField label="Submission format" hint="What file format should solvers submit?">
              <input className="form-input" placeholder="e.g. CSV with columns: id, prediction"
                value={state.submissionFormat} onChange={(e) => setState((s) => ({ ...s, submissionFormat: e.target.value }))} />
            </FormField>
            <FormField label="What does success look like?" hint="Define the winning outcome">
              <input className="form-input" placeholder="e.g. Reproduce Figure 3 within 5% tolerance"
                value={state.successDefinition} onChange={(e) => setState((s) => ({ ...s, successDefinition: e.target.value }))} />
            </FormField>
            <FormField label="How submissions are evaluated" hint="Explain the scoring method" className="span-full">
              <textarea className="form-textarea" placeholder="e.g. Submissions are scored by RMSE against the held-out test set. Lower error = higher score. Minimum qualifying score is 0.7."
                value={state.evaluationCriteria} onChange={(e) => setState((s) => ({ ...s, evaluationCriteria: e.target.value }))} />
            </FormField>
          </div>
        </div>
      </div>

      {/* ── Section 4: Reward & Rules ── */}
      <div className="form-section">
        <div className="form-section-header">
          <span className="form-section-step">4</span>
          <span className="form-section-title">Reward &amp; Rules</span>
        </div>
        <div className="form-section-body">
          <div className="form-grid">
            <FormField label="Reward (USDC)" hint="Between 1 and 30 USDC">
              <input className="form-input form-input-mono" type="number" min={1} max={30}
                value={state.reward} onChange={(e) => setState((s) => ({ ...s, reward: e.target.value }))} />
            </FormField>
            <FormField label="Distribution">
              <select className="form-select" value={state.distribution}
                onChange={(e) => setState((s) => ({ ...s, distribution: e.target.value as FormState["distribution"] }))}>
                <option value="winner_take_all">Winner Take All</option>
                <option value="top_3">Top 3</option>
                <option value="proportional">Proportional</option>
              </select>
            </FormField>
            <FormField label="Deadline">
              <input className="form-input" type="datetime-local"
                value={state.deadline.slice(0, 16)}
                onChange={(e) => {
                  const ts = Date.parse(e.target.value);
                  if (Number.isFinite(ts)) setState((s) => ({ ...s, deadline: new Date(ts).toISOString() }));
                }} />
            </FormField>
            <FormField label="Review period" hint="How long before payout (168–2160 hours)">
              <select className="form-select" value={state.disputeWindow}
                onChange={(e) => setState((s) => ({ ...s, disputeWindow: e.target.value }))}>
                <option value="168">7 days (168h) — Standard</option>
                <option value="336">14 days (336h)</option>
                <option value="720">30 days (720h)</option>
                <option value="1440">60 days (1440h)</option>
                <option value="2160">90 days (2160h) — Maximum</option>
              </select>
            </FormField>
          </div>
        </div>
      </div>

      {/* ── Advanced Settings ── */}
      <button
        type="button"
        className={`advanced-toggle ${showAdvanced ? "open" : ""}`}
        onClick={() => setShowAdvanced(!showAdvanced)}
      >
        <Settings2 size={14} />
        <ChevronRight size={14} />
        Advanced Settings
        <span className="form-hint" style={{ marginLeft: "auto" }}>
          Scoring container, metric, minimum score
        </span>
      </button>

      {showAdvanced && (
        <div className="advanced-body">
          <FormField label="Scoring container" hint="Docker image for grading">
            <input className="form-input form-input-mono"
              value={state.container} onChange={(e) => setState((s) => ({ ...s, container: e.target.value }))} />
          </FormField>
          <FormField label="Metric">
            <select className="form-select" value={state.metric}
              onChange={(e) => setState((s) => ({ ...s, metric: e.target.value }))}>
              <option value="rmse">RMSE</option>
              <option value="mae">MAE</option>
              <option value="r2">R²</option>
              <option value="pearson">Pearson</option>
              <option value="spearman">Spearman</option>
              <option value="custom">Custom</option>
            </select>
          </FormField>
          <FormField label="Minimum score" hint="0 to 1">
            <input className="form-input form-input-mono" type="number" min={0} max={1} step={0.01}
              value={state.minimumScore} onChange={(e) => setState((s) => ({ ...s, minimumScore: e.target.value }))} />
          </FormField>
        </div>
      )}

      {/* ── Cost Breakdown ── */}
      <div className="cost-card">
        <h3 className="cost-card-title">
          <Coins size={14} /> Cost Breakdown
        </h3>
        <div className="cost-row">
          <span className="cost-row-label" style={{ color: "var(--text-secondary)" }}>You deposit now</span>
          <span className="cost-row-value accent">
            {formatUsdc(rewardValue)} USDC
          </span>
        </div>
        <div className="cost-row">
          <span className="cost-row-label" style={{ color: "var(--text-tertiary)" }}>Protocol fee (5%, from pool)</span>
          <span className="cost-row-value" style={{ color: "var(--text-tertiary)" }}>
            {formatUsdc(protocolFeeValue)} USDC
          </span>
        </div>
        <div className="cost-row">
          <span className="cost-row-label" style={{ color: "var(--text-tertiary)" }}>Net winner payout</span>
          <span className="cost-row-value" style={{ color: "var(--text-tertiary)" }}>
            {formatUsdc(winnerPayoutValue)} USDC
          </span>
        </div>
      </div>

      {/* ── Submit ── */}
      <div className="post-submit-row">
        <button
          type="button"
          disabled={isPosting}
          onClick={() => {
            const error = validateInput();
            if (error) { setStatus(error); return; }
            setShowPreview(true);
          }}
          className="dash-btn dash-btn-primary"
          style={{ padding: "0.65rem 1.5rem", fontSize: "0.85rem", opacity: isPosting ? 0.6 : 1 }}
        >
          {isPosting ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
          {isPosting ? "Posting..." : "Review & Post"}
        </button>
        {!isConnected && (
          <span className="form-hint">
            Connect wallet to submit →
          </span>
        )}
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
              <div className="preview-row"><span className="preview-label">Type</span><span className="preview-value">{state.type}</span></div>
              {state.description && <div className="preview-row span-full"><span className="preview-label">Description</span><span className="preview-value">{state.description}</span></div>}
              <div className="preview-divider" />
              {state.submissionFormat && <div className="preview-row"><span className="preview-label">Submission format</span><span className="preview-value">{state.submissionFormat}</span></div>}
              {state.successDefinition && <div className="preview-row"><span className="preview-label">Success criteria</span><span className="preview-value">{state.successDefinition}</span></div>}
              {state.evaluationCriteria && <div className="preview-row span-full"><span className="preview-label">Evaluation</span><span className="preview-value">{state.evaluationCriteria}</span></div>}
              <div className="preview-divider" />
              <div className="preview-row"><span className="preview-label">Reward</span><span className="preview-value">{state.reward} USDC</span></div>
              <div className="preview-row"><span className="preview-label">Distribution</span><span className="preview-value">{state.distribution.replace(/_/g, " ")}</span></div>
              <div className="preview-row"><span className="preview-label">Deadline</span><span className="preview-value">{new Date(state.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span></div>
              <div className="preview-row"><span className="preview-label">Review period</span><span className="preview-value">{state.disputeWindow}h</span></div>
              <div className="preview-row"><span className="preview-label">Min score</span><span className="preview-value">{state.minimumScore}</span></div>
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
