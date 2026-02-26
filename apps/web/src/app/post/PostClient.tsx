"use client";

import HermesFactoryAbiJson from "@hermes/common/abi/HermesFactory.json";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useMemo, useState } from "react";
import { type Abi, parseUnits } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import yaml from "yaml";
import { YamlEditor } from "../../components/YamlEditor";
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
  maxSubs: string;
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
  reward: "50",
  distribution: "winner_take_all",
  deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  minimumScore: "0",
  disputeWindow: "48",
  maxSubs: "3",
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
    max_submissions_per_wallet: Number(state.maxSubs),
    lab_tba: "0x0000000000000000000000000000000000000000",
  };
}

type ChallengeSpec = ReturnType<typeof buildSpec>;

export function PostClient() {
  const [state, setState] = useState<FormState>(initialState);
  const [mode, setMode] = useState<"form" | "yaml">("form");
  const [yamlText, setYamlText] = useState(() =>
    yaml.stringify(buildSpec(initialState)),
  );
  const [status, setStatus] = useState<string>("");
  const [isPosting, setIsPosting] = useState(false);

  const { isConnected, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const rewardValue = Number(state.reward || 0);
  const feeValue = rewardValue * 0.05;
  const totalValue = rewardValue + feeValue;

  const specPreview = useMemo(
    () => (mode === "yaml" ? yamlText : yaml.stringify(buildSpec(state))),
    [mode, state, yamlText],
  );

  function validateInput() {
    if (mode === "yaml") {
      return null;
    }
    if (!state.title.trim() || !state.description.trim()) {
      return "Title and description are required.";
    }
    if (!state.train.trim() || !state.test.trim()) {
      return "Train and test dataset links are required.";
    }
    if (!Number.isFinite(rewardValue) || rewardValue <= 0) {
      return "Reward must be a positive number.";
    }
    if (Number(state.maxSubs) < 1 || Number(state.maxSubs) > 3) {
      return "Max submissions per wallet must be 1-3.";
    }
    if (new Date(state.deadline).getTime() <= Date.now()) {
      return "Deadline must be in the future.";
    }
    return null;
  }

  function parseSpecInput(): ChallengeSpec {
    if (mode === "yaml") {
      const parsed = yaml.parse(yamlText) as ChallengeSpec;
      if (!parsed || typeof parsed !== "object") {
        throw new Error("YAML must define a valid challenge spec object.");
      }
      return parsed;
    }
    return buildSpec(state);
  }

  async function handleSubmit() {
    if (!isConnected) {
      setStatus("Connect wallet first.");
      return;
    }
    if (!FACTORY_ADDRESS || !USDC_ADDRESS) {
      setStatus(
        "Missing NEXT_PUBLIC_HERMES_FACTORY_ADDRESS or NEXT_PUBLIC_HERMES_USDC_ADDRESS.",
      );
      return;
    }
    if (chainId !== CHAIN_ID) {
      setStatus(`Wrong network. Expected chain id ${CHAIN_ID}.`);
      return;
    }
    if (!publicClient) {
      setStatus("Wallet client is not ready. Reconnect wallet and retry.");
      return;
    }
    const error = validateInput();
    if (error) {
      setStatus(error);
      return;
    }

    try {
      setIsPosting(true);
      setStatus("Pinning spec to IPFS...");

      const spec = parseSpecInput();
      if (!spec.title?.trim() || !spec.description?.trim()) {
        throw new Error("Spec must include title and description.");
      }
      if (!spec.dataset?.train || !spec.dataset?.test) {
        throw new Error("Spec must include dataset.train and dataset.test.");
      }
      const deadlineTs = new Date(spec.deadline).getTime();
      if (!Number.isFinite(deadlineTs) || deadlineTs <= Date.now()) {
        throw new Error("Spec deadline must be a valid future timestamp.");
      }

      const pinRes = await fetch("/api/pin-spec", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spec }),
      });
      if (!pinRes.ok) {
        throw new Error(await pinRes.text());
      }
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
          specCid,
          rewardUnits,
          BigInt(Math.floor(deadlineTs / 1000)),
          BigInt(spec.dispute_window_hours ?? 48),
          spec.max_submissions_per_wallet ?? 3,
          minimumScoreWad,
          DISTRIBUTION_TO_ENUM[
            spec.reward.distribution as keyof typeof DISTRIBUTION_TO_ENUM
          ] ?? 0,
          "0x0000000000000000000000000000000000000000",
        ],
      });

      await publicClient.waitForTransactionReceipt({ hash: createTx });
      setStatus(`Challenge posted on-chain: ${createTx}`);
      setStatus(`Challenge posted successfully. tx=${createTx}.`);
    } catch (submitError) {
      setStatus(
        submitError instanceof Error
          ? submitError.message
          : "Failed to post challenge.",
      );
    } finally {
      setIsPosting(false);
    }
  }

  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="card-row">
        <h1 style={{ margin: 0 }}>Post Challenge</h1>
        <ConnectButton />
      </div>

      <div className="card" style={{ padding: 12, display: "flex", gap: 8 }}>
        <button
          type="button"
          className={`btn ${mode === "form" ? "primary" : ""}`}
          onClick={() => setMode("form")}
        >
          Form
        </button>
        <button
          type="button"
          className={`btn ${mode === "yaml" ? "primary" : ""}`}
          onClick={() => setMode("yaml")}
        >
          YAML
        </button>
      </div>

      {mode === "form" ? (
        <div className="card grid grid-2" style={{ padding: 14 }}>
          <input
            className="input"
            placeholder="Title"
            value={state.title}
            onChange={(e) => setState((s) => ({ ...s, title: e.target.value }))}
          />
          <input
            className="input"
            placeholder="ID (optional)"
            value={state.id}
            onChange={(e) => setState((s) => ({ ...s, id: e.target.value }))}
          />
          <textarea
            className="textarea"
            placeholder="Description"
            value={state.description}
            onChange={(e) =>
              setState((s) => ({ ...s, description: e.target.value }))
            }
          />
          <div className="inline-grid-2">
            <select
              className="select"
              value={state.domain}
              onChange={(e) =>
                setState((s) => ({ ...s, domain: e.target.value }))
              }
            >
              <option value="longevity">longevity</option>
              <option value="drug_discovery">drug_discovery</option>
              <option value="omics">omics</option>
              <option value="protein_design">protein_design</option>
              <option value="neuroscience">neuroscience</option>
              <option value="other">other</option>
            </select>
            <select
              className="select"
              value={state.type}
              onChange={(e) =>
                setState((s) => ({ ...s, type: e.target.value }))
              }
            >
              <option value="reproducibility">reproducibility</option>
              <option value="prediction">prediction</option>
              <option value="docking">docking</option>
            </select>
          </div>
          <input
            className="input"
            placeholder="Dataset train URL / ipfs://"
            value={state.train}
            onChange={(e) => setState((s) => ({ ...s, train: e.target.value }))}
          />
          <input
            className="input"
            placeholder="Dataset test URL / ipfs://"
            value={state.test}
            onChange={(e) => setState((s) => ({ ...s, test: e.target.value }))}
          />
          <input
            className="input"
            placeholder="Scoring container"
            value={state.container}
            onChange={(e) =>
              setState((s) => ({ ...s, container: e.target.value }))
            }
          />
          <input
            className="input"
            placeholder="Metric"
            value={state.metric}
            onChange={(e) =>
              setState((s) => ({ ...s, metric: e.target.value }))
            }
          />
          <input
            className="input"
            type="number"
            min={1}
            placeholder="Reward (USDC)"
            value={state.reward}
            onChange={(e) =>
              setState((s) => ({ ...s, reward: e.target.value }))
            }
          />
          <select
            className="select"
            value={state.distribution}
            onChange={(e) =>
              setState((s) => ({
                ...s,
                distribution: e.target.value as FormState["distribution"],
              }))
            }
          >
            <option value="winner_take_all">winner_take_all</option>
            <option value="top_3">top_3</option>
            <option value="proportional">proportional</option>
          </select>
          <input
            className="input"
            type="datetime-local"
            value={state.deadline.slice(0, 16)}
            onChange={(e) => {
              const value = e.target.value;
              const ts = Date.parse(value);
              if (Number.isFinite(ts)) {
                setState((s) => ({
                  ...s,
                  deadline: new Date(ts).toISOString(),
                }));
              }
            }}
          />
          <div className="inline-grid-3">
            <input
              className="input"
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={state.minimumScore}
              onChange={(e) =>
                setState((s) => ({ ...s, minimumScore: e.target.value }))
              }
            />
            <input
              className="input"
              type="number"
              min={24}
              max={168}
              value={state.disputeWindow}
              onChange={(e) =>
                setState((s) => ({ ...s, disputeWindow: e.target.value }))
              }
            />
            <input
              className="input"
              type="number"
              min={1}
              max={3}
              value={state.maxSubs}
              onChange={(e) =>
                setState((s) => ({ ...s, maxSubs: e.target.value }))
              }
            />
          </div>
        </div>
      ) : (
        <YamlEditor value={yamlText} onChange={setYamlText} />
      )}

      <div className="card" style={{ padding: 14 }}>
        <h3 style={{ marginTop: 0 }}>Cost Breakdown</h3>
        <div className="grid" style={{ gap: 4 }}>
          <div className="card-row muted">
            <span>Reward pool</span>
            <span>{formatUsdc(rewardValue)} USDC</span>
          </div>
          <div className="card-row muted">
            <span>Protocol fee (5%)</span>
            <span>{formatUsdc(feeValue)} USDC</span>
          </div>
          <div className="card-row">
            <strong>Total spend</strong>
            <strong>{formatUsdc(totalValue)} USDC</strong>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 14 }}>
        <h3 style={{ marginTop: 0 }}>Preview</h3>
        <pre style={{ overflowX: "auto", margin: 0 }}>
          <code>{specPreview}</code>
        </pre>
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <button
          type="button"
          className="btn primary"
          disabled={isPosting}
          onClick={handleSubmit}
        >
          {isPosting ? "Posting..." : "Post Challenge"}
        </button>
      </div>

      {status ? (
        <div className="card" style={{ padding: 12 }}>
          {status}
        </div>
      ) : null}
    </div>
  );
}
