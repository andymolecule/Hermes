"use client";

import HermesFactoryAbiJson from "@hermes/common/abi/HermesFactory.json";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useMemo, useState } from "react";
import { type Abi, parseUnits } from "viem";
import { useAccount, usePublicClient, useSignMessage, useWriteContract } from "wagmi";
import yaml from "yaml";
import { Wallet, ArrowRight, Coins, AlertCircle, Loader2, CheckCircle } from "lucide-react";
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

function FormField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      <label style={{
        fontSize: "0.65rem",
        fontWeight: 600,
        textTransform: "uppercase" as const,
        letterSpacing: "0.08em",
        color: "var(--text-tertiary)",
        fontFamily: "var(--font-mono)",
      }}>
        {label}
      </label>
      {children}
      {hint ? (
        <span style={{ fontSize: "0.7rem", color: "var(--text-tertiary)" }}>{hint}</span>
      ) : null}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.75rem",
  fontSize: "0.85rem",
  fontFamily: "inherit",
  border: "1px solid var(--border-default)",
  borderRadius: "6px",
  background: "var(--surface-default)",
  color: "var(--text-primary)",
  outline: "none",
  transition: "border-color 150ms ease, box-shadow 150ms ease",
};

const monoInputStyle: React.CSSProperties = {
  ...inputStyle,
  fontFamily: "var(--font-mono)",
  fontSize: "0.78rem",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: "pointer",
  appearance: "none" as const,
};

export function PostClient() {
  const [state, setState] = useState<FormState>(initialState);
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

  function validateInput() {
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
    <div style={{ maxWidth: 720, display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 className="page-title">Post Bounty</h1>
          <p className="page-subtitle">
            Define a computational challenge and fund it with USDC.
          </p>
        </div>
        <ConnectButton />
      </div>

      {/* Form Card */}
      <div style={{
        border: "1px solid var(--border-default)",
        borderRadius: "8px",
        background: "var(--surface-default)",
        padding: "1.5rem",
        display: "flex",
        flexDirection: "column",
        gap: "1.5rem",
      }}>
        {/* Basic Info */}
        <div>
          <h3 style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "1rem", color: "var(--text-primary)" }}>
            Basic Info
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <FormField label="Title">
              <input style={inputStyle} placeholder="e.g. Predict COVID mutations"
                value={state.title} onChange={(e) => setState((s) => ({ ...s, title: e.target.value }))} />
            </FormField>
            <FormField label="Type">
              <select style={selectStyle} value={state.type}
                onChange={(e) => setState((s) => ({ ...s, type: e.target.value }))}>
                <option value="reproducibility">Reproducibility</option>
                <option value="prediction">Prediction</option>
                <option value="docking">Docking</option>
              </select>
            </FormField>
            <div style={{ gridColumn: "1 / -1" }}>
              <FormField label="Description">
                <textarea style={{ ...inputStyle, minHeight: 80, resize: "vertical" as const }}
                  placeholder="What are solvers trying to achieve?"
                  value={state.description} onChange={(e) => setState((s) => ({ ...s, description: e.target.value }))} />
              </FormField>
            </div>
          </div>
        </div>

        <hr style={{ border: "none", borderTop: "1px solid var(--border-subtle)" }} />

        {/* Datasets & Scoring */}
        <div>
          <h3 style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "1rem", color: "var(--text-primary)" }}>
            Datasets & Scoring
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <FormField label="Train dataset" hint="IPFS or HTTPS URL">
              <input style={monoInputStyle} placeholder="ipfs://... or https://..."
                value={state.train} onChange={(e) => setState((s) => ({ ...s, train: e.target.value }))} />
            </FormField>
            <FormField label="Test dataset" hint="IPFS or HTTPS URL">
              <input style={monoInputStyle} placeholder="ipfs://... or https://..."
                value={state.test} onChange={(e) => setState((s) => ({ ...s, test: e.target.value }))} />
            </FormField>
            <FormField label="Scoring container">
              <input style={monoInputStyle}
                value={state.container} onChange={(e) => setState((s) => ({ ...s, container: e.target.value }))} />
            </FormField>
            <FormField label="Metric">
              <input style={inputStyle}
                value={state.metric} onChange={(e) => setState((s) => ({ ...s, metric: e.target.value }))} />
            </FormField>
          </div>
        </div>

        <hr style={{ border: "none", borderTop: "1px solid var(--border-subtle)" }} />

        {/* Reward & Rules */}
        <div>
          <h3 style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "1rem", color: "var(--text-primary)" }}>
            Reward & Rules
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <FormField label="Reward (USDC)" hint="Between 1 and 30 USDC">
              <input style={monoInputStyle} type="number" min={1} max={30}
                value={state.reward} onChange={(e) => setState((s) => ({ ...s, reward: e.target.value }))} />
            </FormField>
            <FormField label="Distribution">
              <select style={selectStyle} value={state.distribution}
                onChange={(e) => setState((s) => ({ ...s, distribution: e.target.value as FormState["distribution"] }))}>
                <option value="winner_take_all">Winner Take All</option>
                <option value="top_3">Top 3</option>
                <option value="proportional">Proportional</option>
              </select>
            </FormField>
            <FormField label="Deadline">
              <input style={inputStyle} type="datetime-local"
                value={state.deadline.slice(0, 16)}
                onChange={(e) => {
                  const ts = Date.parse(e.target.value);
                  if (Number.isFinite(ts)) setState((s) => ({ ...s, deadline: new Date(ts).toISOString() }));
                }} />
            </FormField>
            <FormField label="Minimum Score" hint="0 to 1">
              <input style={monoInputStyle} type="number" min={0} max={1} step={0.01}
                value={state.minimumScore} onChange={(e) => setState((s) => ({ ...s, minimumScore: e.target.value }))} />
            </FormField>
            <FormField label="Dispute Window (hours)" hint="168 to 2160">
              <input style={monoInputStyle} type="number" min={168} max={2160}
                value={state.disputeWindow} onChange={(e) => setState((s) => ({ ...s, disputeWindow: e.target.value }))} />
            </FormField>
          </div>
        </div>
      </div>

      {/* Cost Breakdown */}
      <div style={{
        border: "1px solid var(--border-default)",
        borderRadius: "8px",
        background: "var(--surface-default)",
        padding: "1.25rem",
      }}>
        <h3 style={{
          fontSize: "0.82rem", fontWeight: 600, marginBottom: "0.75rem",
          color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "0.5rem",
        }}>
          <Coins size={14} /> Cost Breakdown
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "0.82rem", color: "var(--text-secondary)" }}>You deposit now</span>
            <span style={{ fontSize: "0.82rem", fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--dash-blue, var(--text-primary))" }}>
              {formatUsdc(rewardValue)} USDC
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "0.82rem", color: "var(--text-tertiary)" }}>Protocol fee (5%, from pool)</span>
            <span style={{ fontSize: "0.82rem", fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
              {formatUsdc(protocolFeeValue)} USDC
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "0.82rem", color: "var(--text-tertiary)" }}>Net winner payout</span>
            <span style={{ fontSize: "0.82rem", fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
              {formatUsdc(winnerPayoutValue)} USDC
            </span>
          </div>
        </div>
      </div>

      {/* Submit */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <button
          type="button"
          disabled={isPosting}
          onClick={handleSubmit}
          className="dash-btn dash-btn-primary"
          style={{ padding: "0.65rem 1.5rem", fontSize: "0.85rem", opacity: isPosting ? 0.6 : 1 }}
        >
          {isPosting ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
          {isPosting ? "Posting..." : "Post Challenge"}
        </button>
        {!isConnected && (
          <span style={{ fontSize: "0.78rem", color: "var(--text-tertiary)" }}>
            Connect wallet to submit →
          </span>
        )}
      </div>

      {/* Status */}
      {status ? (
        <div style={{
          display: "flex", alignItems: "flex-start", gap: "0.75rem",
          border: `1px solid ${isSuccess ? "var(--color-success)" : "var(--border-default)"}`,
          background: isSuccess ? "var(--color-success-bg)" : "var(--surface-default)",
          padding: "1rem",
          borderRadius: "8px",
        }}>
          {isSuccess
            ? <CheckCircle size={16} style={{ color: "var(--color-success)", flexShrink: 0, marginTop: 2 }} />
            : <AlertCircle size={16} style={{ color: "var(--text-tertiary)", flexShrink: 0, marginTop: 2 }} />
          }
          <p style={{ fontSize: "0.82rem", wordBreak: "break-all", color: "var(--text-secondary)" }}>
            {isSuccess ? status.replace("success: ", "") : status}
          </p>
        </div>
      ) : null}
    </div>
  );
}
