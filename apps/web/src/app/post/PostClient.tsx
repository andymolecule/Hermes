"use client";

import HermesFactoryAbiJson from "@hermes/common/abi/HermesFactory.json";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { type Abi, parseUnits } from "viem";
import { useAccount, usePublicClient, useSignMessage, useWriteContract } from "wagmi";
import yaml from "yaml";
import { FileCode, Wallet, ArrowRight, Coins, Eye, AlertCircle, Loader2 } from "lucide-react";
import { YamlEditor } from "../../components/YamlEditor";
import { buildPinSpecMessage, computeSpecHash } from "../../lib/pin-spec-auth";
import { accelerateChallengeIndex } from "../../lib/api";
import { CHAIN_ID, FACTORY_ADDRESS, USDC_ADDRESS } from "../../lib/config";
import { formatUsdc } from "../../lib/format";

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
] as const;

type FormState = {
  id: string;
  title: string;
  description: string;
  domain: string;
  type: string;
  train: string;
  test: string;
  metric: string;
  container: string;
  reward: string;
  distribution: "winner_take_all" | "top_3" | "proportional";
  deadline: string;
  minimumScore: string;
  disputeWindow: string;
};

const initialState: FormState = {
  id: "",
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
};

function buildSpec(state: FormState) {
  return {
    id: state.id || `web-${Date.now()}`,
    title: state.title,
    domain: state.domain,
    type: state.type,
    description: state.description,
    dataset: { train: state.train, test: state.test },
    scoring: { container: state.container, metric: state.metric },
    reward: {
      total: Number(state.reward),
      distribution: state.distribution,
    },
    deadline: state.deadline,
    minimum_score: Number(state.minimumScore),
    dispute_window_hours: Number(state.disputeWindow),
    lab_tba: "0x0000000000000000000000000000000000000000",
  };
}

type ChallengeSpec = ReturnType<typeof buildSpec>;

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const inputClasses = "w-full rounded-lg px-3 py-2.5 text-sm font-sans border outline-none transition-all focus:ring-2 focus:ring-cobalt-200/20 focus:border-cobalt-200";
const selectClasses = "w-full rounded-lg px-3 py-2.5 text-sm font-sans border outline-none transition-all focus:ring-2 focus:ring-cobalt-200/20 focus:border-cobalt-200 cursor-pointer appearance-none";

function inputStyle() {
  return {
    backgroundColor: "var(--surface-default)",
    borderColor: "var(--border-default)",
    color: "var(--text-primary)",
  };
}

export function PostClient() {
  const [state, setState] = useState<FormState>(initialState);
  const [mode, setMode] = useState<"form" | "yaml">("form");
  const [yamlText, setYamlText] = useState(() =>
    yaml.stringify(buildSpec(initialState)),
  );
  const [status, setStatus] = useState<string>("");
  const [isPosting, setIsPosting] = useState(false);

  const { isConnected, chainId, address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { signMessageAsync } = useSignMessage();

  const rewardValue = Number(state.reward || 0);
  const protocolFeeRate = 0.05;
  const protocolFeeValue = rewardValue * protocolFeeRate;
  const winnerPayoutValue = Math.max(rewardValue - protocolFeeValue, 0);

  const specPreview = useMemo(
    () => (mode === "yaml" ? yamlText : yaml.stringify(buildSpec(state))),
    [mode, state, yamlText],
  );

  function validateInput() {
    if (mode === "yaml") return null;
    if (!state.title.trim() || !state.description.trim())
      return "Title and description are required.";
    if (!state.train.trim() || !state.test.trim())
      return "Train and test dataset links are required.";
    if (!Number.isFinite(rewardValue) || rewardValue <= 0)
      return "Reward must be a positive number.";
    if (rewardValue < 1 || rewardValue > 30)
      return "Reward must be between 1 and 30 USDC.";
    const disputeWindow = Number(state.disputeWindow);
    if (!Number.isFinite(disputeWindow) || disputeWindow < 168 || disputeWindow > 2160)
      return "Dispute window must be between 168 and 2160 hours.";
    if (new Date(state.deadline).getTime() <= Date.now())
      return "Deadline must be in the future.";
    return null;
  }

  function parseSpecInput(): ChallengeSpec {
    if (mode === "yaml") {
      const parsed = yaml.parse(yamlText) as ChallengeSpec;
      if (!parsed || typeof parsed !== "object")
        throw new Error("YAML must define a valid challenge spec object.");
      return parsed;
    }
    return buildSpec(state);
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
      const spec = parseSpecInput();
      if (!spec.title?.trim() || !spec.description?.trim()) throw new Error("Spec must include title and description.");
      if (!spec.dataset?.train || !spec.dataset?.test) throw new Error("Spec must include dataset.train and dataset.test.");
      const deadlineTs = new Date(spec.deadline).getTime();
      if (!Number.isFinite(deadlineTs) || deadlineTs <= Date.now()) throw new Error("Spec deadline must be a valid future timestamp.");
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

      setStatus("Approving USDC allowance...");
      const approveTx = await writeContractAsync({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "approve",
        args: [FACTORY_ADDRESS, rewardUnits],
      });
      await publicClient.waitForTransactionReceipt({ hash: approveTx });

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
        await accelerateChallengeIndex({ specCid, txHash: createTx });
        setStatus(`Challenge posted successfully. tx=${createTx}. Indexed immediately.`);
      } catch {
        setStatus(`Challenge posted on-chain (tx=${createTx}). Indexer will sync it shortly.`);
      }
    } catch (submitError) {
      setStatus(submitError instanceof Error ? submitError.message : "Failed to post challenge.");
    } finally {
      setIsPosting(false);
    }
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
        className="flex items-center justify-between"
      >
        <div>
          <h1 className="text-3xl font-display font-bold mb-1" style={{ color: "var(--text-primary)" }}>
            Post Challenge
          </h1>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Define a computational challenge and fund it with USDC.
          </p>
        </div>
        <ConnectButton />
      </motion.div>

      {/* Mode toggle */}
      <div className="flex gap-2 p-1.5 rounded-xl w-fit" style={{ backgroundColor: "var(--surface-inset)" }}>
        <button
          type="button"
          onClick={() => setMode("form")}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer ${mode === "form"
              ? "bg-white shadow-sm"
              : "hover:bg-white/50"
            }`}
          style={{ color: mode === "form" ? "var(--text-primary)" : "var(--text-muted)" }}
        >
          <Wallet className="w-4 h-4" />
          Form
        </button>
        <button
          type="button"
          onClick={() => setMode("yaml")}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer ${mode === "yaml"
              ? "bg-white shadow-sm"
              : "hover:bg-white/50"
            }`}
          style={{ color: mode === "yaml" ? "var(--text-primary)" : "var(--text-muted)" }}
        >
          <FileCode className="w-4 h-4" />
          YAML
        </button>
      </div>

      {/* Form */}
      {mode === "form" ? (
        <motion.div
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          className="rounded-2xl border p-6 space-y-6"
          style={{ backgroundColor: "var(--surface-default)", borderColor: "var(--border-default)" }}
        >
          {/* Basic Info */}
          <div>
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
              Basic Info
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="Title">
                <input className={inputClasses} style={inputStyle()} placeholder="e.g. Predict COVID mutations"
                  value={state.title} onChange={(e) => setState((s) => ({ ...s, title: e.target.value }))} />
              </FormField>
              <FormField label="ID (optional)">
                <input className={inputClasses} style={inputStyle()} placeholder="auto-generated if empty"
                  value={state.id} onChange={(e) => setState((s) => ({ ...s, id: e.target.value }))} />
              </FormField>
              <div className="sm:col-span-2">
                <FormField label="Description">
                  <textarea className={`${inputClasses} min-h-24 resize-y`} style={inputStyle()}
                    placeholder="What are solvers trying to achieve?"
                    value={state.description} onChange={(e) => setState((s) => ({ ...s, description: e.target.value }))} />
                </FormField>
              </div>
              <FormField label="Domain">
                <select className={selectClasses} style={inputStyle()} value={state.domain}
                  onChange={(e) => setState((s) => ({ ...s, domain: e.target.value }))}>
                  <option value="longevity">longevity</option>
                  <option value="drug_discovery">drug_discovery</option>
                  <option value="omics">omics</option>
                  <option value="protein_design">protein_design</option>
                  <option value="neuroscience">neuroscience</option>
                  <option value="other">other</option>
                </select>
              </FormField>
              <FormField label="Type">
                <select className={selectClasses} style={inputStyle()} value={state.type}
                  onChange={(e) => setState((s) => ({ ...s, type: e.target.value }))}>
                  <option value="reproducibility">reproducibility</option>
                  <option value="prediction">prediction</option>
                  <option value="docking">docking</option>
                </select>
              </FormField>
            </div>
          </div>

          <hr style={{ borderColor: "var(--border-subtle)" }} />

          {/* Datasets */}
          <div>
            <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
              Datasets & Scoring
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="Train dataset URL">
                <input className={`${inputClasses} font-mono text-xs`} style={inputStyle()} placeholder="ipfs://... or https://..."
                  value={state.train} onChange={(e) => setState((s) => ({ ...s, train: e.target.value }))} />
              </FormField>
              <FormField label="Test dataset URL">
                <input className={`${inputClasses} font-mono text-xs`} style={inputStyle()} placeholder="ipfs://... or https://..."
                  value={state.test} onChange={(e) => setState((s) => ({ ...s, test: e.target.value }))} />
              </FormField>
              <FormField label="Scoring container">
                <input className={`${inputClasses} font-mono text-xs`} style={inputStyle()}
                  value={state.container} onChange={(e) => setState((s) => ({ ...s, container: e.target.value }))} />
              </FormField>
              <FormField label="Metric">
                <input className={inputClasses} style={inputStyle()}
                  value={state.metric} onChange={(e) => setState((s) => ({ ...s, metric: e.target.value }))} />
              </FormField>
            </div>
          </div>

          <hr style={{ borderColor: "var(--border-subtle)" }} />

          {/* Reward & Rules */}
          <div>
            <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
              Reward & Rules
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="Reward (USDC)">
                <input className={`${inputClasses} font-mono`} style={inputStyle()} type="number" min={1}
                  value={state.reward} onChange={(e) => setState((s) => ({ ...s, reward: e.target.value }))} />
              </FormField>
              <FormField label="Distribution">
                <select className={selectClasses} style={inputStyle()} value={state.distribution}
                  onChange={(e) => setState((s) => ({ ...s, distribution: e.target.value as FormState["distribution"] }))}>
                  <option value="winner_take_all">winner_take_all</option>
                  <option value="top_3">top_3</option>
                  <option value="proportional">proportional</option>
                </select>
              </FormField>
              <FormField label="Deadline">
                <input className={inputClasses} style={inputStyle()} type="datetime-local"
                  value={state.deadline.slice(0, 16)}
                  onChange={(e) => {
                    const ts = Date.parse(e.target.value);
                    if (Number.isFinite(ts)) setState((s) => ({ ...s, deadline: new Date(ts).toISOString() }));
                  }} />
              </FormField>
              <FormField label="Minimum Score">
                <input className={`${inputClasses} font-mono`} style={inputStyle()} type="number" min={0} max={1} step={0.01}
                  value={state.minimumScore} onChange={(e) => setState((s) => ({ ...s, minimumScore: e.target.value }))} />
              </FormField>
              <FormField label="Dispute Window (hours)">
                <input className={`${inputClasses} font-mono`} style={inputStyle()} type="number" min={168} max={2160}
                  value={state.disputeWindow} onChange={(e) => setState((s) => ({ ...s, disputeWindow: e.target.value }))} />
              </FormField>
            </div>
          </div>
        </motion.div>
      ) : (
        <YamlEditor value={yamlText} onChange={setYamlText} />
      )}

      {/* Cost Breakdown */}
      <div className="rounded-2xl border p-5" style={{ backgroundColor: "var(--surface-default)", borderColor: "var(--border-default)" }}>
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
          <Coins className="w-4 h-4 text-cobalt-200" />
          Cost Breakdown
        </h3>
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>You deposit now</span>
            <span className="text-sm font-mono font-semibold text-cobalt-200">{formatUsdc(rewardValue)} USDC</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm" style={{ color: "var(--text-muted)" }}>Protocol fee at finalization (from pool)</span>
            <span className="text-sm font-mono" style={{ color: "var(--text-muted)" }}>{formatUsdc(protocolFeeValue)} USDC</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm" style={{ color: "var(--text-muted)" }}>Net winner payout</span>
            <span className="text-sm font-mono" style={{ color: "var(--text-muted)" }}>{formatUsdc(winnerPayoutValue)} USDC</span>
          </div>
        </div>
      </div>

      {/* Preview */}
      <div className="rounded-2xl border p-5" style={{ backgroundColor: "var(--surface-default)", borderColor: "var(--border-default)" }}>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
          <Eye className="w-4 h-4 text-cobalt-200" />
          YAML Preview
        </h3>
        <pre className="text-xs font-mono p-4 rounded-lg overflow-x-auto leading-relaxed"
          style={{ backgroundColor: "var(--surface-inset)", color: "var(--text-secondary)" }}
        >
          <code>{specPreview}</code>
        </pre>
      </div>

      {/* Submit */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={isPosting}
          onClick={handleSubmit}
          className="flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-medium transition-all bg-cobalt-200 text-white hover:bg-cobalt-300 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-sm hover:shadow-md"
        >
          {isPosting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
          {isPosting ? "Posting..." : "Post Challenge"}
        </button>
      </div>

      {/* Status */}
      {status ? (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-3 rounded-xl border p-4"
          style={{
            borderColor: status.includes("success") ? "var(--color-success)" : "var(--border-default)",
            backgroundColor: status.includes("success") ? "var(--color-success-bg)" : "var(--surface-default)",
          }}
        >
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "var(--text-muted)" }} />
          <p className="text-sm break-all" style={{ color: "var(--text-secondary)" }}>{status}</p>
        </motion.div>
      ) : null}
    </div>
  );
}
