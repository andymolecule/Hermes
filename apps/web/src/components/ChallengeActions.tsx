"use client";

import { ACTIVE_CONTRACT_VERSION, CHALLENGE_STATUS } from "@agora/common";
import AgoraChallengeAbi from "@agora/common/abi/AgoraChallenge.json";
import {
  AlertCircle,
  CheckCircle,
  Clock,
  Coins,
  Gavel,
  Loader2,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { Abi } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { getChallengeClaimableInfo } from "../lib/api";
import { formatDateTime, formatUsdc } from "../lib/format";
import type { ChallengeClaimableInfo } from "../lib/types";
import { assertSupportedContractVersion } from "../lib/wallet/challenge-version";
import {
  getExplorerTxUrl,
  getWrongChainMessage,
  isWrongWalletChain,
} from "../lib/wallet/network";
import { getErrorMessage, isUserRejectedError } from "../lib/wallet/tx-errors";
import {
  simulateAndWriteContract,
  waitForTransactionReceiptWithTimeout,
} from "../lib/wallet/tx-flow";

const abi = AgoraChallengeAbi as unknown as Abi;

interface Props {
  challengeId: string;
  contractAddress: string;
}

export function ChallengeActions({ challengeId, contractAddress }: Props) {
  const { address, chainId, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [info, setInfo] = useState<ChallengeClaimableInfo | null>(null);
  const [fetchError, setFetchError] = useState("");
  const [actionStatus, setActionStatus] = useState("");
  const [txHash, setTxHash] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function fetchInfo() {
      try {
        if (!cancelled) setFetchError("");
        const next = await getChallengeClaimableInfo({
          challengeId,
          address,
          refresh: refreshNonce,
        });
        if (!cancelled) {
          setInfo(next);
          setFetchError("");
        }
      } catch (error) {
        if (!cancelled) {
          setFetchError(
            getErrorMessage(
              error,
              "Unable to load challenge actions right now.",
            ),
          );
        }
      }
    }

    void fetchInfo();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [address, challengeId, refreshNonce]);

  useEffect(() => {
    if (!challengeId) return;
    setActionStatus("");
    setTxHash("");
  }, [challengeId]);

  if (!info && !fetchError) return null;
  if (!info) {
    return (
      <div className="border border-[var(--border-default)] p-6 bg-white rounded-lg space-y-4">
        <h3 className="text-sm font-bold font-mono tracking-wider uppercase text-[var(--color-warm-900)] flex items-center gap-2">
          <Gavel className="w-4 h-4" strokeWidth={2} /> Challenge Actions
        </h3>
        <div className="flex items-start gap-2 text-xs font-mono text-[var(--text-muted)]">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div className="space-y-3">
            <p>{fetchError || "Unable to load challenge actions right now."}</p>
            <button
              type="button"
              onClick={() => setRefreshNonce((value) => value + 1)}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold font-mono uppercase tracking-wider border border-[var(--border-default)] bg-white rounded-md hover:bg-[var(--color-warm-900)] hover:text-white transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isFinalized = info.onChainStatus === CHALLENGE_STATUS.finalized;
  const isCancelled = info.onChainStatus === CHALLENGE_STATUS.cancelled;
  const isDisputed = info.onChainStatus === CHALLENGE_STATUS.disputed;
  const isOpen = info.onChainStatus === CHALLENGE_STATUS.open;
  const claimableUsdc = Number(info.claimable) / 1e6;
  const hasClaimable = info.canClaim && claimableUsdc > 0;
  const wrongChain = isConnected && isWrongWalletChain(chainId);
  const walletActionBlockedMessage = !isConnected
    ? "Connect wallet to continue."
    : wrongChain
      ? getWrongChainMessage(chainId)
      : null;
  const txUrl = txHash ? getExplorerTxUrl(txHash) : null;

  if (isOpen) return null;

  async function assertSupportedVersion() {
    if (!publicClient) {
      throw new Error("Wallet client is not ready.");
    }

    await assertSupportedContractVersion({
      publicClient,
      address: contractAddress as `0x${string}`,
      abi,
      contractLabel: "challenge",
    });
  }

  async function handleFinalize() {
    if (!publicClient || !writeContractAsync || !address) return;
    setLoading(true);
    setActionStatus("Finalizing — confirm in your wallet...");
    try {
      if (wrongChain) throw new Error(getWrongChainMessage(chainId));
      await assertSupportedVersion();
      const hash = await simulateAndWriteContract({
        publicClient,
        writeContractAsync,
        account: address,
        address: contractAddress as `0x${string}`,
        abi,
        functionName: "finalize",
        args: [],
      });
      setActionStatus("Waiting for confirmation...");
      await waitForTransactionReceiptWithTimeout({ publicClient, hash });
      setTxHash(hash);
      setRefreshNonce((value) => value + 1);
      setActionStatus("Finalized ✅");
    } catch (error) {
      const message = getErrorMessage(error, "Finalize failed.");
      if (message.includes("ChallengeFinalized")) {
        setActionStatus("Already finalized ✅");
      } else if (isUserRejectedError(error)) {
        setActionStatus("Transaction cancelled");
      } else {
        setActionStatus(`Error: ${message.slice(0, 100)}`);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleClaim() {
    if (!publicClient || !writeContractAsync || !address) return;
    setLoading(true);
    setActionStatus("Claiming — confirm in your wallet...");
    try {
      if (wrongChain) throw new Error(getWrongChainMessage(chainId));
      await assertSupportedVersion();
      const hash = await simulateAndWriteContract({
        publicClient,
        writeContractAsync,
        account: address,
        address: contractAddress as `0x${string}`,
        abi,
        functionName: "claim",
        args: [],
      });
      setActionStatus("Waiting for confirmation...");
      await waitForTransactionReceiptWithTimeout({ publicClient, hash });
      setTxHash(hash);
      setRefreshNonce((value) => value + 1);
      setActionStatus("Claimed ✅");
    } catch (error) {
      const message = getErrorMessage(error, "Claim failed.");
      if (message.includes("NothingToClaim")) {
        setActionStatus("Nothing to claim");
      } else if (isUserRejectedError(error)) {
        setActionStatus("Transaction cancelled");
      } else {
        setActionStatus(`Error: ${message.slice(0, 100)}`);
      }
    } finally {
      setLoading(false);
    }
  }

  const reviewEndsDate = formatDateTime(info.reviewEndsAt);
  const scoringGraceDate = formatDateTime(info.scoringGraceEndsAt);
  const earliestFinalizeDate = formatDateTime(info.earliestFinalizeAt);

  return (
    <div className="border border-[var(--border-default)] p-6 bg-white rounded-lg space-y-4">
      <h3 className="text-sm font-bold font-mono tracking-wider uppercase text-[var(--color-warm-900)] flex items-center gap-2">
        <Gavel className="w-4 h-4" strokeWidth={2} /> Challenge Actions
      </h3>

      {fetchError ? (
        <div className="flex items-start gap-2 text-xs font-mono text-[var(--text-muted)] border-b border-[var(--border-subtle)] pb-3">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div className="space-y-1">
            <p>{fetchError}</p>
            <button
              type="button"
              onClick={() => setRefreshNonce((value) => value + 1)}
              className="underline underline-offset-2"
            >
              Retry
            </button>
          </div>
        </div>
      ) : null}

      {!info.supportedVersion && (
        <div className="flex items-start gap-2 text-xs font-mono text-[var(--text-muted)]">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>
            Unsupported challenge contract version {info.contractVersion}. This
            runtime only supports v{ACTIVE_CONTRACT_VERSION} actions.
          </span>
        </div>
      )}

      {!isFinalized && !isCancelled && !isDisputed && info.supportedVersion && (
        <div className="space-y-2">
          {info.canFinalize ? (
            <>
              <p className="text-xs text-[var(--text-muted)] font-mono">
                Dispute window has passed. Finalization runs automatically, but
                you can trigger it now.
              </p>
              {!walletActionBlockedMessage ? (
                <button
                  type="button"
                  onClick={handleFinalize}
                  disabled={loading}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold font-mono uppercase tracking-wider border border-[var(--border-default)] bg-white rounded-md hover:bg-[var(--color-warm-900)] hover:text-white transition-colors disabled:opacity-50"
                >
                  {loading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Gavel className="w-3.5 h-3.5" strokeWidth={2} />
                  )}
                  Finalize Now
                </button>
              ) : (
                <p className="text-xs text-[var(--text-muted)] font-mono">
                  {walletActionBlockedMessage}
                </p>
              )}
            </>
          ) : info.finalizeBlockedReason === "review_window_active" ? (
            <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] font-mono">
              <Clock className="w-3.5 h-3.5" />
              Review window ends {reviewEndsDate}. Finalization may take longer
              if scoring is still incomplete.
            </div>
          ) : info.finalizeBlockedReason === "scoring_incomplete" ? (
            <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] font-mono">
              <Clock className="w-3.5 h-3.5" />
              Waiting for scorer completion or grace period at{" "}
              {scoringGraceDate}.
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] font-mono">
              <Clock className="w-3.5 h-3.5" />
              Earliest finalization check {earliestFinalizeDate}
            </div>
          )}
        </div>
      )}

      {isDisputed && (
        <div className="flex items-start gap-2 text-xs font-mono text-[var(--text-muted)]">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>Payout is on hold while this challenge is disputed.</span>
        </div>
      )}

      {isFinalized && !hasClaimable && (
        <div className="flex items-center gap-2 text-xs font-mono text-[var(--text-muted)]">
          <CheckCircle className="w-3.5 h-3.5 text-green-600" />
          Challenge finalized
          {address ? " — no rewards for this wallet" : ""}
        </div>
      )}

      {isCancelled && (
        <div className="text-xs font-mono text-[var(--text-muted)]">
          Challenge was cancelled. Funds returned to poster.
        </div>
      )}

      {isFinalized && hasClaimable && (
        <div className="space-y-2">
          <p className="text-xs text-[var(--text-muted)] font-mono">
            You have unclaimed rewards from this challenge.
          </p>
          {!walletActionBlockedMessage ? (
            <button
              type="button"
              onClick={handleClaim}
              disabled={loading}
              className="inline-flex items-center gap-2 px-6 py-3 text-sm font-bold font-mono uppercase tracking-wider border-2 border-[var(--color-warm-900)] bg-[#EAB308] text-[var(--color-warm-900)] rounded-md hover:bg-[#CA8A04] transition-colors disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Coins className="w-4 h-4" strokeWidth={2} />
              )}
              Claim {formatUsdc(claimableUsdc.toFixed(2))} USDC
            </button>
          ) : (
            <p className="text-xs text-[var(--text-muted)] font-mono">
              {walletActionBlockedMessage}
            </p>
          )}
        </div>
      )}

      {actionStatus && (
        <p className="text-xs font-mono text-[var(--text-muted)] border-t border-[var(--border-subtle)] pt-3 mt-3">
          {actionStatus}
          {txUrl ? (
            <>
              {" "}
              <a
                href={txUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline text-blue-600"
              >
                View tx ↗
              </a>
            </>
          ) : null}
        </p>
      )}
    </div>
  );
}
