"use client";

import HermesFactoryAbiJson from "@hermes/common/abi/HermesFactory.json";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { type Abi, parseUnits } from "viem";
import { useAccount, usePublicClient, useSignMessage, useWriteContract } from "wagmi";
import yaml from "yaml";
import { FileCode, Wallet, ArrowRight, Coins, Eye, AlertCircle, Loader2, CheckCircle } from "lucide-react";
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
      <label className="block text-xs font-medium uppercase tracking-wider text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

const inputClasses = "w-full px-3 py-2.5 text-sm font-sans border border-border-default rounded bg-surface-default text-primary outline-none input-focus";
const selectClasses = "w-full px-3 py-2.5 text-sm font-sans border border-border-default rounded bg-surface-default text-primary outline-none cursor-pointer appearance-none input-focus";

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
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold mb-1 text-primary">
            Post Challenge
          </h1>
          <p className="text-sm text-tertiary">
            Define a computational challenge and fund it with USDC.
          </p>
        </div>
        <ConnectButton />
      </div>

      {/* Mode toggle */}
      <div className="flex gap-1 p-1 w-fit rounded-md bg-surface-inset">
        {(["form", "yaml"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium cursor-pointer rounded border-none transition-all duration-150 ${mode === m ? "bg-surface-default text-primary shadow-[0_1px_2px_rgba(14,26,33,0.06)]" : "bg-transparent text-muted"}`}
          >
            {m === "form" ? <Wallet className="w-4 h-4" /> : <FileCode className="w-4 h-4" />}
            {m === "form" ? "Form" : "YAML"}
          </button>
        ))}
      </div>

      {/* Form */}
      {mode === "form" ? (
        <div className="rounded-lg border border-border-default p-6 space-y-6 bg-surface-default">
          {/* Basic Info */}
          <div>
            <h3 className="text-sm font-semibold mb-4 text-primary">
              Basic Info
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="Title">
                <input className={inputClasses} placeholder="e.g. Predict COVID mutations"
                  value={state.title} onChange={(e) => setState((s) => ({ ...s, title: e.target.value }))} />
              </FormField>
              <FormField label="ID (optional)">
                <input className={inputClasses} placeholder="auto-generated if empty"
                  value={state.id} onChange={(e) => setState((s) => ({ ...s, id: e.target.value }))} />
              </FormField>
              <div className="sm:col-span-2">
                <FormField label="Description">
                  <textarea className={`${inputClasses} min-h-24 resize-y`}
                    placeholder="What are solvers trying to achieve?"
                    value={state.description} onChange={(e) => setState((s) => ({ ...s, description: e.target.value }))} />
                </FormField>
              </div>
              <FormField label="Domain">
                <select className={selectClasses} value={state.domain}
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
                <select className={selectClasses} value={state.type}
                  onChange={(e) => setState((s) => ({ ...s, type: e.target.value }))}>
                  <option value="reproducibility">reproducibility</option>
                  <option value="prediction">prediction</option>
                  <option value="docking">docking</option>
                </select>
              </FormField>
            </div>
          </div>

          <hr className="border-border-subtle" />

          {/* Datasets */}
          <div>
            <h3 className="text-sm font-semibold mb-4 text-primary">
              Datasets & Scoring
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="Train dataset URL">
                <input className={`${inputClasses} font-mono text-xs`} placeholder="ipfs://... or https://..."
                  value={state.train} onChange={(e) => setState((s) => ({ ...s, train: e.target.value }))} />
              </FormField>
              <FormField label="Test dataset URL">
                <input className={`${inputClasses} font-mono text-xs`} placeholder="ipfs://... or https://..."
                  value={state.test} onChange={(e) => setState((s) => ({ ...s, test: e.target.value }))} />
              </FormField>
              <FormField label="Scoring container">
                <input className={`${inputClasses} font-mono text-xs`}
                  value={state.container} onChange={(e) => setState((s) => ({ ...s, container: e.target.value }))} />
              </FormField>
              <FormField label="Metric">
                <input className={inputClasses}
                  value={state.metric} onChange={(e) => setState((s) => ({ ...s, metric: e.target.value }))} />
              </FormField>
            </div>
          </div>

          <hr className="border-border-subtle" />

          {/* Reward & Rules */}
          <div>
            <h3 className="text-sm font-semibold mb-4 text-primary">
              Reward & Rules
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="Reward (USDC)">
                <input className={`${inputClasses} font-mono`} type="number" min={1}
                  value={state.reward} onChange={(e) => setState((s) => ({ ...s, reward: e.target.value }))} />
              </FormField>
              <FormField label="Distribution">
                <select className={selectClasses} value={state.distribution}
                  onChange={(e) => setState((s) => ({ ...s, distribution: e.target.value as FormState["distribution"] }))}>
                  <option value="winner_take_all">winner_take_all</option>
                  <option value="top_3">top_3</option>
                  <option value="proportional">proportional</option>
                </select>
              </FormField>
              <FormField label="Deadline">
                <input className={inputClasses} type="datetime-local"
                  value={state.deadline.slice(0, 16)}
                  onChange={(e) => {
                    const ts = Date.parse(e.target.value);
                    if (Number.isFinite(ts)) setState((s) => ({ ...s, deadline: new Date(ts).toISOString() }));
                  }} />
              </FormField>
              <FormField label="Minimum Score">
                <input className={`${inputClasses} font-mono`} type="number" min={0} max={1} step={0.01}
                  value={state.minimumScore} onChange={(e) => setState((s) => ({ ...s, minimumScore: e.target.value }))} />
              </FormField>
              <FormField label="Dispute Window (hours)">
                <input className={`${inputClasses} font-mono`} type="number" min={168} max={2160}
                  value={state.disputeWindow} onChange={(e) => setState((s) => ({ ...s, disputeWindow: e.target.value }))} />
              </FormField>
            </div>
          </div>
        </div>
      ) : (
        <YamlEditor value={yamlText} onChange={setYamlText} />
      )}

      {/* Cost Breakdown */}
      <div className="rounded-lg border border-border-default p-5 bg-surface-default">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2 text-primary">
          <Coins className="w-4 h-4 text-cobalt-200" />
          Cost Breakdown
        </h3>
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium text-secondary">You deposit now</span>
            <span className="text-sm font-mono font-semibold text-cobalt-200 tabular-nums">{formatUsdc(rewardValue)} USDC</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted">Protocol fee at finalization (from pool)</span>
            <span className="text-sm font-mono text-muted tabular-nums">{formatUsdc(protocolFeeValue)} USDC</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted">Net winner payout</span>
            <span className="text-sm font-mono text-muted tabular-nums">{formatUsdc(winnerPayoutValue)} USDC</span>
          </div>
        </div>
      </div>

      {/* Preview */}
      <div className="rounded-lg border border-border-default p-5 bg-surface-default">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2 text-primary">
          <Eye className="w-4 h-4 text-cobalt-200" />
          YAML Preview
        </h3>
        <pre className="text-xs font-mono p-4 overflow-x-auto leading-relaxed bg-surface-inset text-secondary">
          <code>{specPreview}</code>
        </pre>
      </div>

      {/* Submit */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={isPosting}
          onClick={handleSubmit}
          className="flex items-center gap-2 px-6 py-3 text-sm font-medium shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed rounded btn-primary"
        >
          {isPosting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
          {isPosting ? "Posting..." : "Post Challenge"}
        </button>
      </div>

      {/* Status */}
      {status ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className={`flex items-start gap-3 border p-4 rounded-md ${isSuccess ? "border-success bg-success-bg" : "border-border-default bg-surface-default"}`}
          style={{
            borderColor: isSuccess ? "var(--color-success)" : undefined,
            backgroundColor: isSuccess ? "var(--color-success-bg)" : undefined,
          }}
        >
          {isSuccess
            ? <CheckCircle className="w-4 h-4 mt-0.5 shrink-0 text-success" />
            : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-muted" />
          }
          <p className="text-sm break-all text-secondary">
            {isSuccess ? status.replace("success: ", "") : status}
          </p>
        </motion.div>
      ) : null}
    </div>
  );
}
