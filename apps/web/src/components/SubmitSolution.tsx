"use client";

import {
  CHALLENGE_STATUS,
  SUBMISSION_LIMITS,
  SUBMISSION_RESULT_FORMAT,
  type SubmissionContractOutput,
  deriveExpectedColumns,
  importSubmissionSealPublicKey,
  isValidPinnedSpecCid,
  sealSubmission,
  serializeSealedSubmissionEnvelope,
  validateSubmissionTextAgainstContract,
} from "@agora/common";
import AgoraChallengeAbiJson from "@agora/common/abi/AgoraChallenge.json";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle,
  FileUp,
  Loader2,
  Lock,
  ShieldCheck,
  Upload,
  Wallet,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Abi } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import {
  createSubmissionIntent,
  createSubmissionRecord,
  getSubmissionPublicKey,
} from "../lib/api";
import { formatUsdc, shortAddress } from "../lib/format";
import { assertSupportedContractVersion } from "../lib/wallet/challenge-version";
import {
  APP_CHAIN_NAME,
  getExplorerTxUrl,
  getWrongChainMessage,
  isWrongWalletChain,
} from "../lib/wallet/network";
import { getErrorMessage, isUserRejectedError } from "../lib/wallet/tx-errors";
import {
  simulateAndWriteContract,
  waitForTransactionReceiptWithTimeout,
} from "../lib/wallet/tx-flow";
import { ScoringTrustNotice } from "./ScoringTrustNotice";
import { WalletButton } from "./WalletButton";

const AgoraChallengeAbi = AgoraChallengeAbiJson as unknown as Abi;
const MAX_UPLOAD_MB = SUBMISSION_LIMITS.maxUploadBytes / 1024 / 1024;
const PRIVATE_SUBMISSION_COPY =
  "Submission contents are sealed in your browser before upload, so other solvers cannot read them while the challenge is open.";
const PRIVATE_SUBMISSION_DISCLOSURE_COPY =
  "Your wallet address and transaction remain visible on-chain. After scoring begins, replay artifacts may be published for public verification.";
const PRIVATE_SUBMISSION_UNAVAILABLE_COPY =
  "Private answer protection is currently unavailable. Agora requires sealed submissions to keep submission contents hidden while a challenge is open. Retry later after sealed submissions are restored.";

function getFileSelectionError(file: { size: number }) {
  return getSubmissionSizeError(
    file.size,
    "Selected file is empty. Choose a non-empty result file and retry.",
    `Selected file exceeds the ${MAX_UPLOAD_MB} MB limit. Choose a smaller file and retry.`,
  );
}

function getTextSubmissionError(text: string) {
  return getSubmissionSizeError(
    new TextEncoder().encode(text).byteLength,
    "Your answer is empty. Enter a non-empty answer and retry.",
    `Your answer exceeds the ${MAX_UPLOAD_MB} MB limit. Shorten it and retry.`,
  );
}

function getSubmissionSizeError(
  size: number,
  emptyMessage: string,
  tooLargeMessage: string,
) {
  if (size <= 0) {
    return emptyMessage;
  }
  if (size > SUBMISSION_LIMITS.maxUploadBytes) {
    return tooLargeMessage;
  }
  return null;
}

function getSubmissionSealingErrorMessage(error: unknown) {
  if (
    error instanceof Error &&
    (error.message.includes("Submission sealing is not configured") ||
      error.message.includes("Submission sealing worker is unavailable"))
  ) {
    return PRIVATE_SUBMISSION_UNAVAILABLE_COPY;
  }
  return "Unable to confirm private answer protection right now. Retry in a moment before submitting.";
}

function formatExpectedColumns(columns: string[]) {
  return columns.join(", ");
}

interface SubmitSolutionProps {
  challengeId: string;
  challengeAddress: string;
  challengeStatus: string;
  deadline: string;
  submissionContract?: SubmissionContractOutput | null;
  submissionUnavailableReason?: string | null;
}

export function SubmitSolution({
  challengeId,
  challengeAddress,
  challengeStatus,
  deadline,
  submissionContract,
  submissionUnavailableReason,
}: SubmitSolutionProps) {
  const { address, isConnected, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const wrongChain = isConnected && isWrongWalletChain(chainId);
  const isOpen = challengeStatus === CHALLENGE_STATUS.open;
  const isPastDeadline = new Date(deadline).getTime() <= Date.now();
  const canSubmit = isOpen && !isPastDeadline;
  const submissionKeyQuery = useQuery({
    queryKey: ["submission-public-key"],
    queryFn: getSubmissionPublicKey,
    staleTime: 5 * 60 * 1000,
    retry: false,
    enabled: canSubmit,
  });

  const [resultFile, setResultFile] = useState<File | null>(null);
  const [resultText, setResultText] = useState("");
  const [inputMode, setInputMode] = useState<"file" | "text">("file");
  const [uploading, setUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState("");
  const [txHash, setTxHash] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const requiredColumns = deriveExpectedColumns(submissionContract);
  const requiresCsvSubmission = submissionContract?.kind === "csv_table";
  const requiresFileSubmission = Boolean(submissionContract);

  useEffect(() => {
    if (requiresFileSubmission) {
      setInputMode("file");
    }
  }, [requiresFileSubmission]);

  const submissionPublicKey = submissionKeyQuery.data;
  const isCheckingSealing = submissionKeyQuery.isLoading;
  const sealingUnavailableMessage =
    !submissionPublicKey && submissionKeyQuery.isError
      ? getSubmissionSealingErrorMessage(submissionKeyQuery.error)
      : null;
  const dropZoneDisabled =
    isSubmitting || uploading || isCheckingSealing || !submissionPublicKey;

  if (!canSubmit) {
    return (
      <div className="rounded-lg border border-[var(--border-default)] p-6 bg-white">
        <div className="flex items-start gap-3">
          <Upload
            className="mt-0.5 w-5 h-5 text-[var(--text-muted)] shrink-0"
            strokeWidth={1.75}
          />
          <div className="min-w-0">
            <h3 className="text-lg font-bold font-mono tracking-wider uppercase mb-2 text-[var(--color-warm-900)]">
              Submissions Closed
            </h3>
            <p className="text-sm text-[var(--text-muted)] font-medium leading-relaxed">
              {isPastDeadline
                ? "Submission deadline has passed."
                : `This challenge is ${challengeStatus} — submissions are not open.`}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (submissionUnavailableReason) {
    return (
      <div className="rounded-lg border border-[var(--border-default)] p-6 bg-white">
        <div className="flex items-start gap-3">
          <AlertCircle
            className="mt-0.5 w-5 h-5 text-[var(--text-muted)] shrink-0"
            strokeWidth={1.75}
          />
          <div className="min-w-0">
            <h3 className="text-lg font-bold font-mono tracking-wider uppercase mb-2 text-[var(--color-warm-900)]">
              Submission Unavailable
            </h3>
            <p className="text-sm text-[var(--text-muted)] font-medium leading-relaxed">
              {submissionUnavailableReason}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const isSuccess = status.startsWith("success:");
  const isError = status && !isSuccess && !isSubmitting && !uploading;
  const hasResult = inputMode === "file" ? !!resultFile : !!resultText.trim();

  function resetDragState() {
    dragDepthRef.current = 0;
    setDragging(false);
  }

  function selectResultFile(file: File) {
    const selectionError = getFileSelectionError(file);
    if (selectionError) {
      setResultFile(null);
      resetDragState();
      setStatus(selectionError);
      return;
    }

    setResultFile(file);
    resetDragState();
    setStatus("");
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) selectResultFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleDragEnter(e: React.DragEvent<HTMLButtonElement>) {
    if (dropZoneDisabled) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current += 1;
    setDragging(true);
  }

  function handleDragOver(e: React.DragEvent<HTMLButtonElement>) {
    if (dropZoneDisabled) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    if (!dragging) setDragging(true);
  }

  function handleDragLeave(e: React.DragEvent<HTMLButtonElement>) {
    if (dropZoneDisabled) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragging(false);
  }

  function handleDrop(e: React.DragEvent<HTMLButtonElement>) {
    if (dropZoneDisabled) return;
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (!file) {
      resetDragState();
      setStatus("Drop a file to attach it, then submit when ready.");
      return;
    }
    selectResultFile(file);
  }

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
    if (wrongChain) {
      setStatus(getWrongChainMessage(chainId));
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
    if (isCheckingSealing) {
      setStatus("Checking private answer protection. Wait a moment and retry.");
      return;
    }
    if (!submissionPublicKey) {
      setStatus(
        sealingUnavailableMessage ??
          "Private answer protection is unavailable. Retry later.",
      );
      return;
    }
    if (!hasResult) {
      setStatus(
        requiresCsvSubmission
          ? `Upload a CSV file with columns: ${formatExpectedColumns(requiredColumns)}.`
          : requiresFileSubmission
            ? "Upload a result file before submitting."
            : "Upload a result file or enter your answer.",
      );
      return;
    }
    if (requiresFileSubmission && inputMode !== "file") {
      setStatus(
        requiresCsvSubmission
          ? `This challenge requires a CSV file upload with columns: ${formatExpectedColumns(requiredColumns)}.`
          : "This challenge requires a file upload.",
      );
      return;
    }

    try {
      setIsSubmitting(true);

      // Pre-flight CSV header validation (saves gas on malformed files)
      if (inputMode === "file" && resultFile && requiresCsvSubmission) {
        setStatus("Validating CSV format...");
        const fileText = await resultFile.text();
        const validation = validateSubmissionTextAgainstContract(
          fileText,
          submissionContract,
        );
        if (!validation.valid) {
          setStatus(
            validation.message ??
              "Submission does not match the challenge CSV contract.",
          );
          setIsSubmitting(false);
          return;
        }
      }

      const publicKey = await importSubmissionSealPublicKey(
        submissionPublicKey.publicKeyPem,
      );
      const normalizedAddress = address.toLowerCase();

      let sourceFile: File;
      if (inputMode === "file") {
        if (!resultFile) throw new Error("No file selected.");
        const fileSelectionError = getFileSelectionError(resultFile);
        if (fileSelectionError) {
          setStatus(fileSelectionError);
          return;
        }
        sourceFile = resultFile;
      } else {
        const trimmedResultText = resultText.trim();
        const textSubmissionError = getTextSubmissionError(trimmedResultText);
        if (textSubmissionError) {
          setStatus(textSubmissionError);
          return;
        }
        const blob = new Blob([trimmedResultText], { type: "text/plain" });
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

      setStatus("Reserving submission intent...");
      const submissionIntent = await createSubmissionIntent({
        challengeId,
        solverAddress: normalizedAddress as `0x${string}`,
        resultCid: cid,
        resultFormat: SUBMISSION_RESULT_FORMAT.sealedSubmissionV2,
      });
      if (wrongChain) {
        throw new Error(getWrongChainMessage(chainId));
      }
      await assertSupportedContractVersion({
        publicClient,
        address: challengeAddress as `0x${string}`,
        abi: AgoraChallengeAbi,
        contractLabel: "challenge",
      });

      setStatus("Submitting on-chain — confirm in your wallet...");
      const tx = await simulateAndWriteContract({
        publicClient,
        writeContractAsync,
        account: address,
        address: challengeAddress as `0x${string}`,
        abi: AgoraChallengeAbi,
        functionName: "submit",
        args: [submissionIntent.resultHash],
      });

      setStatus("Waiting for confirmation...");
      await waitForTransactionReceiptWithTimeout({ publicClient, hash: tx });

      let metadataWarning: string | null = null;
      try {
        setStatus("Confirming submission metadata...");
        await createSubmissionRecord({
          challengeId,
          resultCid: cid,
          txHash: tx,
          resultFormat: SUBMISSION_RESULT_FORMAT.sealedSubmissionV2,
        });
      } catch (registrationError) {
        metadataWarning =
          registrationError instanceof Error
            ? registrationError.message
            : "Metadata reconciliation may take a minute.";
      }

      setTxHash(tx);
      setStatus(
        metadataWarning
          ? `success: Submission confirmed! tx=${tx} Metadata reconciliation may take a minute.`
          : `success: Submission confirmed! tx=${tx}`,
      );
    } catch (error) {
      const message = getErrorMessage(error, "Submission failed.");
      if (message.includes("DeadlinePassed")) {
        setStatus("Deadline has passed. Cannot submit.");
      } else if (message.includes("InvalidStatus")) {
        setStatus("Challenge is no longer accepting submissions.");
      } else if (isUserRejectedError(error)) {
        setStatus("Transaction cancelled.");
      } else {
        setStatus(message);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="rounded-lg border border-[var(--border-default)] p-6 bg-white">
      <h3 className="text-xl font-display font-bold mb-4 flex items-center gap-2 text-[var(--color-warm-900)] uppercase tracking-tight">
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
          <WalletButton className="btn-primary inline-flex items-center justify-center gap-2 px-6 py-2.5 font-semibold text-sm uppercase font-mono tracking-wider" />
        </div>
      ) : (
        <div className="space-y-5">
          {wrongChain ? (
            <div className="flex items-start gap-3 p-4 border border-[var(--border-default)] bg-white text-[var(--color-warm-900)] text-sm rounded-lg">
              <AlertCircle
                className="w-5 h-5 mt-0.5 shrink-0"
                strokeWidth={2}
              />
              <p className="break-all font-mono text-xs font-bold uppercase tracking-wide leading-relaxed">
                {getWrongChainMessage(chainId)}
              </p>
            </div>
          ) : null}

          {/* Wallet info + payout notice */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 border border-[var(--border-subtle)] bg-[var(--surface-inset)] rounded-lg">
            <div className="flex items-center gap-2 text-sm text-[var(--color-warm-900)] font-bold">
              <Wallet className="w-4 h-4" strokeWidth={2} />
              <span className="font-mono">{shortAddress(address ?? "")}</span>
            </div>
            <span className="text-[10px] font-mono tracking-wider uppercase font-bold text-[var(--text-muted)]">
              ← Rewards paid here
            </span>
          </div>

          {isCheckingSealing ? (
            <div className="flex items-start gap-3 p-4 border border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--color-warm-900)] text-sm rounded-lg">
              <Loader2 className="w-5 h-5 mt-0.5 shrink-0 animate-spin" />
              <p className="font-mono text-xs font-bold uppercase tracking-wide leading-relaxed">
                Checking private answer protection...
              </p>
            </div>
          ) : sealingUnavailableMessage ? (
            <div className="flex items-start gap-3 p-4 border border-[var(--border-default)] bg-white text-[var(--color-warm-900)] text-sm rounded-lg">
              <AlertCircle
                className="w-5 h-5 mt-0.5 shrink-0"
                strokeWidth={2}
              />
              <div className="space-y-2">
                <p className="font-bold text-base font-display">
                  Private Answer Protection Unavailable
                </p>
                <p className="font-mono text-xs font-bold uppercase tracking-wide leading-relaxed">
                  {sealingUnavailableMessage}
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Input mode toggle */}
              <div className="flex border border-[var(--border-default)] p-0.5 bg-[var(--surface-inset)] w-fit rounded-lg">
                <button
                  type="button"
                  onClick={() => setInputMode("file")}
                  className={`px-4 py-2 text-xs font-bold font-mono uppercase tracking-wider transition-colors rounded-md ${
                    inputMode === "file"
                      ? "bg-[var(--color-warm-900)] text-white"
                      : "text-[var(--text-muted)] hover:text-[var(--color-warm-900)]"
                  }`}
                >
                  Upload File
                </button>
                {!requiresFileSubmission && (
                  <button
                    type="button"
                    onClick={() => setInputMode("text")}
                    className={`px-4 py-2 text-xs font-bold font-mono uppercase tracking-wider transition-colors rounded-md ${
                      inputMode === "text"
                        ? "bg-[var(--color-warm-900)] text-white"
                        : "text-[var(--text-muted)] hover:text-[var(--color-warm-900)]"
                    }`}
                  >
                    Text Answer
                  </button>
                )}
              </div>

              {requiresCsvSubmission && (
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-4">
                  <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    Required CSV columns
                  </div>
                  <div className="mt-2 font-mono text-xs font-bold text-[var(--color-warm-900)] break-all">
                    {formatExpectedColumns(requiredColumns)}
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
                    Agora checks these headers locally before sealing and before
                    you confirm the wallet transaction.
                  </p>
                </div>
              )}

              {/* File upload with drag-and-drop */}
              {inputMode === "file" && (
                <div className="w-full">
                  <input
                    id="submission-file"
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    disabled={dropZoneDisabled}
                    onChange={handleFileInputChange}
                  />
                  <button
                    type="button"
                    disabled={dropZoneDisabled}
                    className={`w-full flex flex-col items-center justify-center gap-3 p-8 border border-dashed rounded-lg transition-all duration-300 ${
                      dragging
                        ? "border-[var(--color-warm-900)] bg-[var(--color-warm-900)]/10"
                        : resultFile
                          ? "border-[#7A9A6D] bg-gradient-to-b from-[#F0F5ED] to-[#FAFAF8]"
                          : "border-[var(--border-default)] hover:bg-[var(--surface-inset)]"
                    } ${dropZoneDisabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
                    onDragEnter={handleDragEnter}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() =>
                      !dropZoneDisabled && fileInputRef.current?.click()
                    }
                  >
                    {resultFile ? (
                      <>
                        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-[#E8F0E4] mb-1">
                          <ShieldCheck
                            className="w-6 h-6 text-[#5A7D4F]"
                            strokeWidth={1.75}
                          />
                        </div>
                        <span className="text-sm font-bold text-[var(--color-warm-900)] font-mono">
                          {resultFile.name}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-[#5A7D4F] bg-[#E8F0E4] border border-[#C4D9BC] px-2 py-0.5 rounded-sm flex items-center gap-1">
                            <Lock className="w-3 h-3" />
                            Sealed locally
                          </span>
                          <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-[var(--text-muted)] bg-white border border-[var(--border-subtle)] px-2 py-0.5 rounded-sm">
                            {(resultFile.size / 1024).toFixed(1)} KB — click to
                            change
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
                        <FileUp
                          className="w-8 h-8 text-[var(--text-muted)]"
                          strokeWidth={1.5}
                        />
                        <span className="text-sm font-medium text-[var(--text-secondary)]">
                          Drop your result file here or{" "}
                          <span className="text-[var(--color-warm-900)] font-bold underline underline-offset-2">
                            browse
                          </span>
                        </span>
                        <span className="text-[10px] font-mono uppercase font-bold tracking-wider text-[var(--text-muted)]">
                          {requiresCsvSubmission
                            ? "CSV file with the required columns"
                            : "CSV, JSON, or any file format"}
                        </span>
                      </>
                    )}
                  </button>
                  {/* Consolidated sealing notice */}
                  <div className="flex items-start gap-2.5 mt-3 p-3 rounded-lg bg-[var(--surface-inset)] border border-[var(--border-subtle)]">
                    <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[var(--text-muted)]" />
                    <div className="space-y-0.5">
                      <p className="text-[10px] font-mono uppercase tracking-wider font-bold text-[var(--text-secondary)] leading-relaxed">
                        {PRIVATE_SUBMISSION_COPY}
                      </p>
                      <p className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] leading-relaxed">
                        {PRIVATE_SUBMISSION_DISCLOSURE_COPY}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Text input */}
              {inputMode === "text" && (
                <div className="flex flex-col w-full">
                  <label
                    htmlFor="submission-text"
                    className="block text-[10px] font-bold font-mono tracking-wider uppercase text-[var(--text-muted)] mb-2"
                  >
                    Your answer
                  </label>
                  <textarea
                    id="submission-text"
                    className="w-full px-4 py-3 text-sm border font-mono border-[var(--border-default)] bg-white text-[var(--color-warm-900)] placeholder:text-[var(--text-muted)] resize-none input-focus rounded-lg"
                    rows={4}
                    placeholder="Type your answer here (e.g., a number, JSON object, prediction result...)"
                    value={resultText}
                    onChange={(e) => {
                      setResultText(e.target.value);
                      setStatus("");
                    }}
                    disabled={isSubmitting}
                  />
                  {/* Consolidated sealing notice */}
                  <div className="flex items-start gap-2.5 mt-3 p-3 rounded-lg bg-[var(--surface-inset)] border border-[var(--border-subtle)]">
                    <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[var(--text-muted)]" />
                    <div className="space-y-0.5">
                      <p className="text-[10px] font-mono uppercase tracking-wider font-bold text-[var(--text-secondary)] leading-relaxed">
                        {PRIVATE_SUBMISSION_COPY}
                      </p>
                      <p className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] leading-relaxed">
                        {PRIVATE_SUBMISSION_DISCLOSURE_COPY}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Submit button */}
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting || uploading || !hasResult || wrongChain}
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
            </>
          )}

          {/* Status messages */}
          {isSuccess && (
            <div className="flex items-start gap-3 p-4 border border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--color-warm-900)] text-sm rounded-lg">
              <CheckCircle
                className="w-5 h-5 mt-0.5 shrink-0"
                strokeWidth={2}
              />
              <div>
                <p className="font-bold underline text-base font-display">
                  Submission confirmed!
                </p>
                {txHash && getExplorerTxUrl(txHash) && (
                  <a
                    href={getExplorerTxUrl(txHash) ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-mono font-bold mt-2 inline-flex items-center gap-1 hover:underline"
                  >
                    View on {APP_CHAIN_NAME} explorer{" "}
                    <ArrowRight className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>
          )}

          {isError && (
            <div className="flex items-start gap-3 p-4 border border-[var(--border-default)] bg-white text-[var(--color-warm-900)] text-sm rounded-lg">
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
