"use client";

import {
  ACTIVE_CONTRACT_VERSION,
  CHALLENGE_STATUS,
  SUBMISSION_RESULT_FORMAT,
  computeSubmissionResultHash,
  importSubmissionSealPublicKey,
  isValidPinnedSpecCid,
  sealSubmission,
  serializeSealedSubmissionEnvelope,
  validateCsvHeaders,
} from "@agora/common";
import AgoraChallengeAbiJson from "@agora/common/abi/AgoraChallenge.json";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle,
  FileCheck,
  FileUp,
  Loader2,
  Upload,
  Wallet,
} from "lucide-react";
import { useRef, useState } from "react";
import type { Abi } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { createSubmissionRecord, getSubmissionPublicKey } from "../lib/api";
import { CHAIN_ID } from "../lib/config";
import { ScoringTrustNotice } from "./ScoringTrustNotice";

const AgoraChallengeAbi = AgoraChallengeAbiJson as unknown as Abi;

interface SubmitSolutionProps {
  challengeId: string;
  challengeAddress: string;
  challengeStatus: string;
  deadline: string;
  expectedColumns?: string[] | null;
}

export function SubmitSolution({
  challengeId,
  challengeAddress,
  challengeStatus,
  deadline,
  expectedColumns,
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
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isOpen = challengeStatus === CHALLENGE_STATUS.open;
  const isPastDeadline = new Date(deadline).getTime() <= Date.now();
  const canSubmit = isOpen && !isPastDeadline;

  if (!canSubmit) {
    return (
      <div className="rounded-[2px] border border-black p-6 bg-white">
        <div className="flex items-start gap-3">
          <Upload
            className="mt-0.5 w-5 h-5 text-black/40 shrink-0"
            strokeWidth={1.75}
          />
          <div className="min-w-0">
            <h3 className="text-lg font-bold font-mono tracking-wider uppercase mb-2 text-black">
              Submissions Closed
            </h3>
            <p className="text-sm text-black/60 font-medium leading-relaxed">
              {isPastDeadline
                ? "Submission deadline has passed."
                : `This challenge is ${challengeStatus} — submissions are not open.`}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const isSuccess = status.startsWith("success:");
  const isError = status && !isSuccess && !isSubmitting && !uploading;
  const hasResult = inputMode === "file" ? !!resultFile : !!resultText.trim();

  async function pinResultToIpfs(file: File): Promise<string> {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const pinRes = await fetch("/api/pin-data", {
        method: "POST",
        body: formData,
      });
      if (!pinRes.ok) throw new Error(await pinRes.text());
      const { cid } = (await pinRes.json()) as { cid: string };
      return cid;
    } finally {
      setUploading(false);
    }
  }

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
    if (!address) {
      setStatus("Wallet address not available. Reconnect and retry.");
      return;
    }
    if (!hasResult) {
      setStatus("Upload a result file or enter your answer.");
      return;
    }

    try {
      setIsSubmitting(true);

      // Pre-flight CSV header validation (saves gas on malformed files)
      if (
        inputMode === "file" &&
        resultFile &&
        expectedColumns?.length &&
        resultFile.name.endsWith(".csv")
      ) {
        setStatus("Validating CSV format...");
        const fileText = await resultFile.text();
        const validation = validateCsvHeaders(fileText, expectedColumns);
        if (!validation.valid) {
          setStatus(
            `Missing required columns: ${validation.missingColumns.join(", ")}`,
          );
          setIsSubmitting(false);
          return;
        }
      }

      const submissionPublicKey = await getSubmissionPublicKey();
      const publicKey = await importSubmissionSealPublicKey(
        submissionPublicKey.publicKeyPem,
      );
      const normalizedAddress = address.toLowerCase();

      let sourceFile: File;
      if (inputMode === "file") {
        if (!resultFile) throw new Error("No file selected.");
        sourceFile = resultFile;
      } else {
        const blob = new Blob([resultText.trim()], { type: "text/plain" });
        sourceFile = new File([blob], "result.txt", { type: "text/plain" });
      }

      setStatus("Sealing submission locally...");
      const sealedEnvelope = await sealSubmission({
        challengeId,
        solverAddress: normalizedAddress,
        fileName: sourceFile.name || "submission.bin",
        mimeType: sourceFile.type || "application/octet-stream",
        bytes: new Uint8Array(await sourceFile.arrayBuffer()),
        keyId: submissionPublicKey.kid,
        publicKey,
      });
      const sealedFile = new File(
        [serializeSealedSubmissionEnvelope(sealedEnvelope)],
        "sealed-submission.json",
        { type: "application/json" },
      );

      setStatus("Uploading sealed submission to IPFS...");
      const cid = await pinResultToIpfs(sealedFile);
      if (!isValidPinnedSpecCid(cid)) {
        throw new Error("Pinned CID is invalid.");
      }

      const resultHash = computeSubmissionResultHash(cid);
      const contractVersion = await publicClient.readContract({
        address: challengeAddress as `0x${string}`,
        abi: AgoraChallengeAbi,
        functionName: "contractVersion",
      }) as bigint;
      if (Number(contractVersion) !== ACTIVE_CONTRACT_VERSION) {
        throw new Error(
          `Unsupported challenge contract version ${contractVersion}. Refresh against the active v${ACTIVE_CONTRACT_VERSION} deployment and retry.`,
        );
      }

      setStatus("Submitting on-chain — confirm in your wallet...");
      const tx = await writeContractAsync({
        account: address,
        address: challengeAddress as `0x${string}`,
        abi: AgoraChallengeAbi,
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
        resultFormat: SUBMISSION_RESULT_FORMAT.sealedV1,
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
      } else if (
        message.includes("User rejected") ||
        message.includes("user rejected")
      ) {
        setStatus("Transaction cancelled.");
      } else {
        setStatus(message);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="rounded-[2px] border border-black p-6 bg-white">
      <h3 className="text-xl font-display font-bold mb-4 flex items-center gap-2 text-black uppercase tracking-tight">
        <Upload className="w-5 h-5" strokeWidth={2.5} />
        Submit Solution
      </h3>

      <div className="mb-5">
        <ScoringTrustNotice compact />
      </div>

      {/* Wallet connection */}
      {!isConnected ? (
        <div className="space-y-4">
          <p className="text-sm font-medium text-black/70">
            Connect your wallet to submit a solution. Rewards are paid to the
            wallet you submit from.
          </p>
          <ConnectButton.Custom>
            {({ openConnectModal, mounted }) => (
              <button
                onClick={openConnectModal}
                type="button"
                disabled={!mounted}
                className="btn-primary inline-flex items-center justify-center gap-2 px-6 py-2.5 font-semibold text-sm uppercase font-mono tracking-wider"
              >
                <Wallet className="w-4 h-4" />
                Connect Wallet
              </button>
            )}
          </ConnectButton.Custom>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Wallet info + payout notice */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 border border-black/10 bg-surface-base">
            <div className="flex items-center gap-2 text-sm text-black/80 font-bold">
              <Wallet className="w-4 h-4" strokeWidth={2} />
              <span className="font-mono">
                {address?.slice(0, 6)}...{address?.slice(-4)}
              </span>
            </div>
            <span className="text-[10px] font-mono tracking-wider uppercase font-bold text-black/60">
              ← Rewards paid here
            </span>
          </div>

          {/* Input mode toggle */}
          <div className="flex border border-black p-0.5 bg-surface-base w-fit">
            <button
              type="button"
              onClick={() => setInputMode("file")}
              className={`px-4 py-2 text-xs font-bold font-mono uppercase tracking-wider transition-colors ${
                inputMode === "file"
                  ? "bg-black text-white"
                  : "text-black/60 hover:text-black"
              }`}
            >
              Upload File
            </button>
            <button
              type="button"
              onClick={() => setInputMode("text")}
              className={`px-4 py-2 text-xs font-bold font-mono uppercase tracking-wider transition-colors ${
                inputMode === "text"
                  ? "bg-black text-white"
                  : "text-black/60 hover:text-black"
              }`}
            >
              Text Answer
            </button>
          </div>

          {/* File upload with drag-and-drop */}
          {inputMode === "file" && (
            <div>
              <input
                id="submission-file"
                ref={fileInputRef}
                type="file"
                className="hidden"
                disabled={isSubmitting}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setResultFile(file);
                    setStatus("");
                  }
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
              />
              <button
                type="button"
                disabled={isSubmitting}
                className={`flex flex-col items-center justify-center gap-3 p-8 border border-dashed cursor-pointer transition-colors ${
                  dragging
                    ? "border-black bg-black/10"
                    : resultFile
                      ? "border-black bg-black/5 hover:bg-black/5"
                      : "border-black/30 hover:bg-black/5"
                }`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  const file = e.dataTransfer.files[0];
                  if (file) {
                    setResultFile(file);
                    setStatus("");
                  }
                }}
                onClick={() => !isSubmitting && fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (isSubmitting) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
              >
                {resultFile ? (
                  <>
                    <FileCheck
                      className="w-8 h-8 text-black"
                      strokeWidth={1.5}
                    />
                    <span className="text-sm font-bold text-black font-mono">
                      {resultFile.name}
                    </span>
                    <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-black/60 bg-white border border-black/10 px-2 py-0.5">
                      {(resultFile.size / 1024).toFixed(1)} KB — click to change
                    </span>
                  </>
                ) : (
                  <>
                    <FileUp
                      className="w-8 h-8 text-black/40"
                      strokeWidth={1.5}
                    />
                    <span className="text-sm font-medium text-black/70">
                      Drop your result file here or{" "}
                      <span className="text-black font-bold underline underline-offset-2">
                        browse
                      </span>
                    </span>
                    <span className="text-[10px] font-mono uppercase font-bold tracking-wider text-black/40">
                      Encrypted locally before upload
                    </span>
                    <span className="text-[10px] font-mono uppercase font-bold tracking-wider text-black/40">
                      CSV, JSON, or any file format
                    </span>
                  </>
                )}
              </button>
              <p className="text-[10px] font-mono uppercase tracking-wider font-bold text-black/50 mt-2">
                Hidden from the public. Agora-operated scoring can decrypt for
                scoring.
              </p>
            </div>
          )}

          {/* Text input */}
          {inputMode === "text" && (
            <div className="flex flex-col">
              <label
                htmlFor="submission-text"
                className="block text-[10px] font-bold font-mono tracking-wider uppercase text-black/70 mb-2"
              >
                Your answer
              </label>
              <textarea
                id="submission-text"
                className="w-full px-4 py-3 text-sm border font-mono border-black bg-white text-black placeholder:text-black/40 resize-none input-focus"
                rows={4}
                placeholder="Type your answer here (e.g., a number, JSON object, prediction result...)"
                value={resultText}
                onChange={(e) => {
                  setResultText(e.target.value);
                  setStatus("");
                }}
                disabled={isSubmitting}
              />
              <p className="text-[10px] font-mono uppercase tracking-wider font-bold text-black/50 mt-2">
                Encrypted locally, sealed to IPFS, hash recorded on-chain.
              </p>
              <p className="text-[10px] font-mono uppercase tracking-wider font-bold text-black/50 mt-1">
                Hidden from the public. Agora-operated scoring can decrypt for
                scoring.
              </p>
            </div>
          )}

          {/* Submit button */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || uploading || !hasResult}
            className="btn-primary w-full flex items-center justify-center gap-2 py-3.5 text-xs font-bold font-mono uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
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
            <div className="flex items-start gap-3 p-4 border border-black bg-[#f4f4f0] text-black text-sm">
              <CheckCircle
                className="w-5 h-5 mt-0.5 shrink-0"
                strokeWidth={2}
              />
              <div>
                <p className="font-bold underline text-base font-display">
                  Submission confirmed!
                </p>
                {txHash && (
                  <a
                    href={`https://sepolia.basescan.org/tx/${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-mono font-bold mt-2 inline-flex items-center gap-1 hover:underline"
                  >
                    View on Basescan <ArrowRight className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>
          )}

          {isError && (
            <div className="flex items-start gap-3 p-4 border border-black bg-white text-black text-sm">
              <AlertCircle
                className="w-5 h-5 mt-0.5 shrink-0"
                strokeWidth={2}
              />
              <p className="break-all font-mono text-xs font-bold uppercase tracking-wide leading-relaxed">
                {status}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
