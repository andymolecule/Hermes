"use client";

import HermesChallengeAbiJson from "@hermes/common/abi/HermesChallenge.json";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useState } from "react";
import type { Abi } from "viem";
import { keccak256, toHex } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import {
    Upload,
    Loader2,
    CheckCircle,
    AlertCircle,
    Wallet,
    ArrowRight,
    FileUp,
    FileCheck,
} from "lucide-react";
import { CHAIN_ID } from "../lib/config";

const HermesChallengeAbi = HermesChallengeAbiJson as unknown as Abi;

interface SubmitSolutionProps {
    challengeId: string;
    challengeAddress: string;
    challengeStatus: string;
    deadline: string;
}

export function SubmitSolution({
    challengeId,
    challengeAddress,
    challengeStatus,
    deadline,
}: SubmitSolutionProps) {
    const { address, isConnected, chainId } = useAccount();
    const publicClient = usePublicClient();
    const { writeContractAsync } = useWriteContract();

    const [resultFile, setResultFile] = useState<File | null>(null);
    const [resultText, setResultText] = useState("");
    const [inputMode, setInputMode] = useState<"file" | "text">("file");
    const [uploading, setUploading] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [status, setStatus] = useState("");
    const [txHash, setTxHash] = useState("");

    const isActive = challengeStatus === "active";
    const isPastDeadline = new Date(deadline).getTime() <= Date.now();
    const canSubmit = isActive && !isPastDeadline;

    if (!canSubmit) {
        return (
            <div className="rounded-lg border border-border-default p-5 bg-surface-default">
                <h3 className="text-sm font-semibold mb-2 flex items-center gap-2 text-primary">
                    <Upload className="w-4 h-4 text-cobalt-200" />
                    Submit Solution
                </h3>
                <p className="text-sm text-muted">
                    {isPastDeadline
                        ? "Submission deadline has passed."
                        : `This challenge is ${challengeStatus} — submissions are not open.`}
                </p>
            </div>
        );
    }

    const isSuccess = status.startsWith("success:");
    const isError = status && !isSuccess && !isSubmitting && !uploading;
    const hasResult = inputMode === "file" ? !!resultFile : !!resultText.trim();

    async function handleSubmit() {
        if (!isConnected) {
            setStatus("Connect your wallet first.");
            return;
        }
        if (chainId !== CHAIN_ID) {
            setStatus(`Wrong network. Switch to chain ${CHAIN_ID}.`);
            return;
        }
        if (!publicClient) {
            setStatus("Wallet client not ready. Reconnect and retry.");
            return;
        }
        if (!hasResult) {
            setStatus("Upload a result file or enter your answer.");
            return;
        }

        try {
            setIsSubmitting(true);

            let tx: `0x${string}`;

            if (inputMode === "file" && resultFile) {
                // Upload file to IPFS via FormData
                setStatus("Uploading result file to IPFS...");
                const formData = new FormData();
                formData.append("file", resultFile);
                const pinRes = await fetch("/api/pin-data", {
                    method: "POST",
                    body: formData,
                });
                if (!pinRes.ok) throw new Error(await pinRes.text());
                const { cid } = (await pinRes.json()) as { cid: string };

                const resultHash = keccak256(toHex(cid));

                setStatus("Submitting on-chain — confirm in your wallet...");
                tx = await writeContractAsync({
                    account: address,
                    address: challengeAddress as `0x${string}`,
                    abi: HermesChallengeAbi,
                    functionName: "submit",
                    args: [resultHash],
                });

                setStatus("Waiting for confirmation...");
                await publicClient!.waitForTransactionReceipt({ hash: tx });
            } else {
                // Text input — wrap in a file and pin as FormData
                setStatus("Pinning result to IPFS...");
                const blob = new Blob([resultText.trim()], { type: "text/plain" });
                const textFile = new File([blob], "result.txt", { type: "text/plain" });
                const formData = new FormData();
                formData.append("file", textFile);
                const pinRes = await fetch("/api/pin-data", {
                    method: "POST",
                    body: formData,
                });
                if (!pinRes.ok) throw new Error(await pinRes.text());
                const { cid } = (await pinRes.json()) as { cid: string };

                const resultHash = keccak256(toHex(cid));

                setStatus("Submitting on-chain — confirm in your wallet...");
                tx = await writeContractAsync({
                    account: address,
                    address: challengeAddress as `0x${string}`,
                    abi: HermesChallengeAbi,
                    functionName: "submit",
                    args: [resultHash],
                });

                setStatus("Waiting for confirmation...");
                await publicClient!.waitForTransactionReceipt({ hash: tx });
            }

            setTxHash(tx);
            setStatus(`success: Submission confirmed! tx=${tx}`);
        } catch (error) {
            const message =
                error instanceof Error ? error.message : "Submission failed.";
            if (message.includes("DeadlinePassed")) {
                setStatus("Deadline has passed. Cannot submit.");
            } else if (message.includes("InvalidStatus")) {
                setStatus("Challenge is no longer accepting submissions.");
            } else if (message.includes("User rejected") || message.includes("user rejected")) {
                setStatus("Transaction cancelled.");
            } else {
                setStatus(message);
            }
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <div className="rounded-lg border border-border-default p-5 bg-surface-default">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2 text-primary">
                <Upload className="w-4 h-4 text-cobalt-200" />
                Submit Solution
            </h3>

            {/* Wallet connection */}
            {!isConnected ? (
                <div className="space-y-3">
                    <p className="text-sm text-secondary">
                        Connect your wallet to submit a solution. Rewards are paid to the wallet you submit from.
                    </p>
                    <ConnectButton />
                </div>
            ) : (
                <div className="space-y-4">
                    {/* Wallet info + payout notice */}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs text-muted">
                            <Wallet className="w-3.5 h-3.5" />
                            <span className="font-mono">{address?.slice(0, 6)}...{address?.slice(-4)}</span>
                        </div>
                        <span className="text-[11px] text-cobalt-200">Rewards paid here ↑</span>
                    </div>

                    {/* Input mode toggle */}
                    <div className="flex gap-1 p-0.5 rounded-md bg-surface-inset w-fit">
                        <button
                            type="button"
                            onClick={() => setInputMode("file")}
                            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${inputMode === "file"
                                ? "bg-surface-default text-primary shadow-sm"
                                : "text-muted hover:text-secondary"
                                }`}
                        >
                            Upload File
                        </button>
                        <button
                            type="button"
                            onClick={() => setInputMode("text")}
                            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${inputMode === "text"
                                ? "bg-surface-default text-primary shadow-sm"
                                : "text-muted hover:text-secondary"
                                }`}
                        >
                            Text Answer
                        </button>
                    </div>

                    {/* File upload */}
                    {inputMode === "file" && (
                        <div>
                            <label
                                className={`flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${resultFile
                                    ? "border-cobalt-200 bg-cobalt-100/30"
                                    : "border-border-default hover:border-cobalt-200 hover:bg-surface-inset"
                                    }`}
                            >
                                <input
                                    type="file"
                                    className="hidden"
                                    disabled={isSubmitting}
                                    onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) {
                                            setResultFile(file);
                                            setStatus("");
                                        }
                                        e.currentTarget.value = "";
                                    }}
                                />
                                {resultFile ? (
                                    <>
                                        <FileCheck className="w-6 h-6 text-cobalt-200" />
                                        <span className="text-sm font-medium text-primary">{resultFile.name}</span>
                                        <span className="text-[11px] text-muted">
                                            {(resultFile.size / 1024).toFixed(1)} KB — click to change
                                        </span>
                                    </>
                                ) : (
                                    <>
                                        <FileUp className="w-6 h-6 text-muted" />
                                        <span className="text-sm text-secondary">
                                            Drop your result file here or <span className="text-cobalt-200 font-medium">browse</span>
                                        </span>
                                        <span className="text-[11px] text-muted">
                                            CSV, JSON, or any file format
                                        </span>
                                    </>
                                )}
                            </label>
                        </div>
                    )}

                    {/* Text input */}
                    {inputMode === "text" && (
                        <div>
                            <label className="block text-xs font-medium text-secondary mb-1.5">
                                Your answer
                            </label>
                            <textarea
                                className="w-full px-3 py-2.5 text-sm border border-border-default rounded-md bg-surface-default text-primary placeholder:text-muted resize-none input-focus"
                                rows={3}
                                placeholder="Type your answer here (e.g., a number, JSON object, prediction result...)"
                                value={resultText}
                                onChange={(e) => { setResultText(e.target.value); setStatus(""); }}
                                disabled={isSubmitting}
                            />
                            <p className="text-[11px] text-muted mt-1">
                                Your answer will be stored on IPFS and its hash recorded on-chain.
                            </p>
                        </div>
                    )}

                    {/* Submit button */}
                    <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={isSubmitting || uploading || !hasResult}
                        className="btn-primary w-full flex items-center justify-center gap-2 py-2.5 text-sm font-semibold rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                {status}
                            </>
                        ) : (
                            <>
                                Submit Solution
                                <ArrowRight className="w-4 h-4" />
                            </>
                        )}
                    </button>

                    {/* How it works */}
                    {!isSuccess && !isError && (
                        <p className="text-[11px] text-muted text-center">
                            Your result is pinned to IPFS automatically. Only the hash is stored on-chain.
                        </p>
                    )}

                    {/* Status messages */}
                    {isSuccess && (
                        <div className="flex items-start gap-2 p-3 rounded-md bg-green-50 border border-green-200 text-green-700 text-sm">
                            <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" />
                            <div>
                                <p className="font-medium">Submission confirmed!</p>
                                {txHash && (
                                    <a
                                        href={`https://sepolia.basescan.org/tx/${txHash}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-xs text-green-600 underline mt-1 block font-mono"
                                    >
                                        View on Basescan →
                                    </a>
                                )}
                            </div>
                        </div>
                    )}

                    {isError && (
                        <div className="flex items-start gap-2 p-3 rounded-md bg-red-50 border border-red-200 text-red-700 text-sm">
                            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                            <p className="break-all">{status}</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
