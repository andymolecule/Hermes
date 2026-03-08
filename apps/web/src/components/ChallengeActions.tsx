"use client";

import { CHALLENGE_STATUS } from "@agora/common";
import AgoraChallengeAbi from "@agora/common/abi/AgoraChallenge.json";
import { CheckCircle, Clock, Coins, Gavel, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { Abi } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { API_BASE_URL } from "../lib/config";

const abi = AgoraChallengeAbi as unknown as Abi;

interface Props {
  challengeId: string;
  contractAddress: string;
}

interface ClaimableResponse {
  onChainStatus: string;
  finalizableAfter: string;
  claimable: string;
}

export function ChallengeActions({
  challengeId,
  contractAddress,
}: Props) {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync: writeContract } = useWriteContract();

  const [info, setInfo] = useState<ClaimableResponse | null>(null);
  const [actionStatus, setActionStatus] = useState<string>("");
  const [txHash, setTxHash] = useState<string>("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [loading, setLoading] = useState(false);

  // Fetch on-chain status + claimable amount
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    setInfo(null);

    async function fetchInfo() {
      try {
        const params = new URLSearchParams();
        if (address) params.set("address", address);
        if (refreshNonce > 0) params.set("refresh", String(refreshNonce));
        const base = API_BASE_URL.replace(/\/$/, "");
        const query = params.toString();
        const res = await fetch(
          `${base}/api/challenges/${challengeId}/claimable${query ? `?${query}` : ""}`,
          { signal: controller.signal },
        );
        if (!res.ok) {
          throw new Error(`Claimable request failed (${res.status})`);
        }
        const json = (await res.json()) as { data?: ClaimableResponse };
        if (!cancelled) setInfo(json.data ?? null);
      } catch {
        if (!cancelled) {
          setInfo(null);
        }
      }
    }
    fetchInfo();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [challengeId, address, refreshNonce]);

  useEffect(() => {
    if (!challengeId) return;
    setActionStatus("");
    setTxHash("");
  }, [challengeId]);

  if (!info) return null;

  const now = Date.now();
  const finalizableAfterMs = new Date(info.finalizableAfter).getTime();
  const isPastDisputeWindow = now > finalizableAfterMs;
  const isFinalized = info.onChainStatus === CHALLENGE_STATUS.finalized;
  const isCancelled = info.onChainStatus === CHALLENGE_STATUS.cancelled;
  const claimableUsdc = Number(info.claimable) / 1e6; // USDC has 6 decimals
  const hasClaimable = claimableUsdc > 0;

  // Nothing to show while the challenge is still open
  if (!isPastDisputeWindow && !isFinalized) return null;

  async function handleFinalize() {
    if (!writeContract || !publicClient) return;
    setLoading(true);
    setActionStatus("Finalizing — confirm in your wallet...");
    try {
      const hash = await writeContract({
        address: contractAddress as `0x${string}`,
        abi,
        functionName: "finalize",
        args: [],
      });
      setActionStatus("Waiting for confirmation...");
      await publicClient.waitForTransactionReceipt({ hash });
      setTxHash(hash);
      setRefreshNonce((value) => value + 1);
      setActionStatus("Finalized ✅");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("ChallengeFinalized")) {
        setActionStatus("Already finalized ✅");
      } else if (msg.includes("rejected") || msg.includes("denied")) {
        setActionStatus("Transaction cancelled");
      } else {
        setActionStatus(`Error: ${msg.slice(0, 100)}`);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleClaim() {
    if (!writeContract || !publicClient) return;
    setLoading(true);
    setActionStatus("Claiming — confirm in your wallet...");
    try {
      const hash = await writeContract({
        address: contractAddress as `0x${string}`,
        abi,
        functionName: "claim",
        args: [],
      });
      setActionStatus("Waiting for confirmation...");
      await publicClient.waitForTransactionReceipt({ hash });
      setTxHash(hash);
      setRefreshNonce((value) => value + 1);
      setActionStatus("Claimed ✅");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("NothingToClaim")) {
        setActionStatus("Nothing to claim");
      } else if (msg.includes("rejected") || msg.includes("denied")) {
        setActionStatus("Transaction cancelled");
      } else {
        setActionStatus(`Error: ${msg.slice(0, 100)}`);
      }
    } finally {
      setLoading(false);
    }
  }

  // Format finalize-after date
  const finalizeDate = new Date(info.finalizableAfter).toLocaleDateString(
    "en-US",
    {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    },
  );

  return (
    <div className="border border-black p-6 bg-white rounded-[2px] space-y-4">
      <h3 className="text-sm font-bold font-mono tracking-wider uppercase text-black flex items-center gap-2">
        <Gavel className="w-4 h-4" strokeWidth={2} /> Challenge Actions
      </h3>

      {/* Finalize section */}
      {!isFinalized && !isCancelled && (
        <div className="space-y-2">
          {isPastDisputeWindow ? (
            <>
              <p className="text-xs text-black/60 font-mono">
                Dispute window has passed. Finalization runs automatically, but
                you can trigger it now.
              </p>
              {isConnected ? (
                <button
                  type="button"
                  onClick={handleFinalize}
                  disabled={loading}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold font-mono uppercase tracking-wider border border-black bg-white hover:bg-black hover:text-white transition-colors disabled:opacity-50"
                >
                  {loading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Gavel className="w-3.5 h-3.5" strokeWidth={2} />
                  )}
                  Finalize Now
                </button>
              ) : (
                <p className="text-xs text-black/40 font-mono">
                  Connect wallet to finalize
                </p>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2 text-xs text-black/50 font-mono">
              <Clock className="w-3.5 h-3.5" />
              Finalization available after {finalizeDate}
            </div>
          )}
        </div>
      )}

      {/* Finalized status */}
      {isFinalized && !hasClaimable && (
        <div className="flex items-center gap-2 text-xs font-mono text-black/60">
          <CheckCircle className="w-3.5 h-3.5 text-green-600" />
          Challenge finalized
          {address ? " — no rewards for this wallet" : ""}
        </div>
      )}

      {/* Cancelled status */}
      {isCancelled && (
        <div className="text-xs font-mono text-black/60">
          Challenge was cancelled. Funds returned to poster.
        </div>
      )}

      {/* Claim section */}
      {isFinalized && hasClaimable && (
        <div className="space-y-2">
          <p className="text-xs text-black/60 font-mono">
            You have unclaimed rewards from this challenge.
          </p>
          <button
            type="button"
            onClick={handleClaim}
            disabled={loading}
            className="inline-flex items-center gap-2 px-6 py-3 text-sm font-bold font-mono uppercase tracking-wider border-2 border-black bg-[#EAB308] text-black hover:bg-[#CA8A04] transition-colors disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Coins className="w-4 h-4" strokeWidth={2} />
            )}
            Claim {claimableUsdc.toFixed(2)} USDC
          </button>
        </div>
      )}

      {/* Status message */}
      {actionStatus && (
        <p className="text-xs font-mono text-black/70 border-t border-black/10 pt-3 mt-3">
          {actionStatus}
          {txHash && (
            <>
              {" "}
              <a
                href={`https://sepolia.basescan.org/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline text-blue-600"
              >
                View tx ↗
              </a>
            </>
          )}
        </p>
      )}
    </div>
  );
}
