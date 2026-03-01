"use client";

import HermesChallengeAbiJson from "@hermes/common/abi/HermesChallenge.json";
import { isValidPinnedSpecCid } from "@hermes/common";
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
} from "lucide-react";
import { CHAIN_ID } from "../lib/config";
import { createSubmissionRecord } from "../lib/api";

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

    const [resultCid, setResultCid] = useState("");
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
    const isError = status && !isSuccess && !isSubmitting;

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
        const cid = resultCid.trim();
        if (!cid) {
            setStatus("Provide a result CID or upload a result file.");
            return;
        }
        if (!cid.startsWith("ipfs://")) {
            setStatus("Result CID must start with ipfs://");
            return;
        }
        if (!isValidPinnedSpecCid(cid)) {
            setStatus("Result CID is invalid.");
            return;
        }

        try {
            setIsSubmitting(true);
            setStatus("Preparing submission...");

            // Contract stores keccak256(resultCid), while DB stores raw CID.
            const resultHash = keccak256(toHex(cid));

            setStatus("Submitting on-chain...");
            const tx = await writeContractAsync({
                account: address,
                address: challengeAddress as `0x${string}`,
                abi: HermesChallengeAbi,
                functionName: "submit",
                args: [resultHash],
            });

            setStatus("Waiting for confirmation...");
            await publicClient.waitForTransactionReceipt({ hash: tx });

            setStatus("Recording submission metadata...");
            await createSubmissionRecord({
                challengeId,
                resultCid: cid,
                txHash: tx,
            });

            setTxHash(tx);
            setStatus(`success: Submission confirmed! tx=${tx}`);
        } catch (error) {
            const message =
                error instanceof Error ? error.message : "Submission failed.";
            if (message.includes("DeadlinePassed")) {
                setStatus("Deadline has passed. Cannot submit.");
            } else if (message.includes("InvalidStatus")) {
                setStatus("Challenge is no longer accepting submissions.");
            } else {
                setStatus(message);
            }
        } finally {
            setIsSubmitting(false);
        }
    }

    async function handleFileUpload(file: File) {
        setUploading(true);
        try {
            const formData = new FormData();
            formData.append("file", file);
            const response = await fetch("/api/pin-data", {
                method: "POST",
                body: formData,
            });
            if (!response.ok) {
                throw new Error(await response.text());
            }
            const json = (await response.json()) as { cid: string };
            setResultCid(json.cid);
            setStatus("Result file pinned to IPFS.");
        } catch (error) {
            setStatus(
                error instanceof Error
                    ? `Upload failed: ${error.message}`
                    : "Upload failed.",
            );
        } finally {
            setUploading(false);
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
                        Connect your wallet to submit a solution.
                    </p>
                    <ConnectButton />
                </div>
            ) : (
                <div className="space-y-4">
                    {/* Wallet info */}
                    <div className="flex items-center gap-2 text-xs text-muted">
                        <Wallet className="w-3.5 h-3.5" />
                        <span className="font-mono">{address?.slice(0, 6)}...{address?.slice(-4)}</span>
                    </div>

                    {/* Result input */}
                    <div>
                        <label className="block text-xs font-medium text-secondary mb-1.5">
                            Result CID
                        </label>
                        <textarea
                            className="w-full px-3 py-2.5 text-sm border border-border-default rounded-md bg-surface-default text-primary placeholder:text-muted font-mono resize-none input-focus"
                            rows={2}
                            placeholder="ipfs://... (required for oracle scoring and verification)"
                            value={resultCid}
                            onChange={(e) => setResultCid(e.target.value)}
                            disabled={isSubmitting || uploading}
                        />
                        <p className="text-[11px] text-muted mt-1">
                            The contract stores keccak256(CID). The full CID is recorded off-chain for scoring and verification.
                        </p>
                        <div className="mt-2">
                            <label className="inline-flex items-center gap-2 text-xs text-secondary cursor-pointer">
                                <input
                                    type="file"
                                    className="hidden"
                                    disabled={isSubmitting || uploading}
                                    onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) void handleFileUpload(file);
                                        e.currentTarget.value = "";
                                    }}
                                />
                                {uploading ? (
                                    <>
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        Uploading to IPFS...
                                    </>
                                ) : (
                                    <>
                                        <Upload className="w-3.5 h-3.5" />
                                        Upload result file
                                    </>
                                )}
                            </label>
                        </div>
                    </div>

                    {/* Submit button */}
                    <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={isSubmitting || uploading || !resultCid.trim()}
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
