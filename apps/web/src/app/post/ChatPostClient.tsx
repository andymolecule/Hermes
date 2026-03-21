"use client";

import { useChainModal, useConnectModal } from "@rainbow-me/rainbowkit";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  useAccount,
  usePublicClient,
  useSignTypedData,
  useWriteContract,
} from "wagmi";
import { CHAIN_ID, FACTORY_ADDRESS, USDC_ADDRESS } from "../../lib/config";
import { computeProtocolFee } from "../../lib/format";
import {
  APP_CHAIN_NAME,
  getWrongChainMessage,
  isWrongWalletChain,
} from "../../lib/wallet/network";
import {
  getErrorMessage,
  isUserRejectedError,
  waitForTransactionReceiptWithTimeout,
} from "../../lib/wallet/tx";
import { ChatComposer } from "./ChatComposer";
import { PostNotice } from "./PostSections";
import { ReviewPanel } from "./ReviewPanel";
import {
  approveUsdc,
  assertFactoryIsSupported,
  createChallengeWithApproval,
  createChallengeWithPermit,
  finalizeManagedChallengePost,
  publishManagedAuthoringSession,
  signRewardPermit,
} from "./managed-post-flow";
import {
  getFundingSummaryMessage,
  getRewardUnitsFromInput,
  isPermitUnsupportedError,
  usePostFunding,
} from "./post-funding";
import { useChatStream } from "./use-chat-stream";

/* ── Helpers ───────────────────────────────────────────── */

function buildHostReturnUrl(input: {
  baseUrl: string | null;
  sessionId: string;
  challengeId: string;
  specCid: string;
}) {
  if (!input.baseUrl) return null;
  const url = new URL(input.baseUrl);
  url.searchParams.set("agora_event", "challenge_live");
  url.searchParams.set("agora_session_id", input.sessionId);
  url.searchParams.set("agora_challenge_id", input.challengeId);
  url.searchParams.set("agora_spec_cid", input.specCid);
  if (typeof window !== "undefined") {
    url.searchParams.set(
      "agora_challenge_url",
      `${window.location.origin}/challenges/${input.challengeId}`,
    );
  }
  return url.toString();
}

/* ── Main component ────────────────────────────────────── */

export function ChatPostClient() {
  const searchParams = useSearchParams();
  const requestedReturnTo = searchParams.get("return_to")?.trim() || null;

  const [isPublishing, setIsPublishing] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [postedChallengeId, setPostedChallengeId] = useState<string | null>(
    null,
  );
  const [hostReturnUrl, setHostReturnUrl] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { isConnected, chainId, address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();
  const { openConnectModal } = useConnectModal();
  const { openChainModal } = useChainModal();
  const isWrongChain = isConnected && isWrongWalletChain(chainId);

  /* Chat stream */
  const {
    messages,
    isStreaming,
    streamingText,
    compilation,
    pendingQuestions,
    uploads,
    sessionId,
    sendMessage,
    submitAnswers,
    cannotAnswer,
    sendFiles,
    removeUpload,
  } = useChatStream({
    posterAddress: address as `0x${string}` | undefined,
    onCompileReady: () => setReviewOpen(true),
  });

  const rewardInput = compilation?.challenge_spec?.reward?.total ?? "10";
  const { feeUsdc, payoutUsdc } = computeProtocolFee(Number(rewardInput || 0));

  /* Funding */
  const {
    fundingState,
    allowanceReady,
    balanceReady,
    refreshPostingFundingState,
    waitForAllowanceUpdate,
    setFundingState,
  } = usePostFunding({
    showPreview: reviewOpen,
    walletReady: isConnected && !isWrongChain,
    publicClient,
    address: address as `0x${string}` | undefined,
    factoryAddress: FACTORY_ADDRESS,
    usdcAddress: USDC_ADDRESS,
    rewardInput,
  });

  const requiresApproval = fundingState.method === "approve" && !allowanceReady;

  /* ── Approve USDC ──────────────────────────────── */

  async function handleApprove() {
    if (!publicClient || !writeContractAsync || !address) return;

    try {
      setIsApproving(true);
      setErrorMessage(null);
      const rewardUnits = getRewardUnitsFromInput(rewardInput);
      const latestFunding = await refreshPostingFundingState(rewardUnits);
      if (latestFunding.balance < rewardUnits) {
        throw new Error(latestFunding.message ?? "Insufficient USDC balance.");
      }
      if (latestFunding.allowance >= rewardUnits) {
        setStatusMessage("Allowance already covers this reward.");
        return;
      }

      setStatusMessage("Approve USDC in your wallet...");
      const approveTx = await approveUsdc({
        publicClient,
        writeContractAsync,
        address,
        usdcAddress: USDC_ADDRESS,
        factoryAddress: FACTORY_ADDRESS,
        rewardUnits,
      });
      setStatusMessage("Approval submitted. Waiting for confirmation...");
      await waitForTransactionReceiptWithTimeout({
        publicClient,
        hash: approveTx,
      });
      await waitForAllowanceUpdate(rewardUnits);
      setStatusMessage("USDC approved. You can publish now.");
    } catch (error) {
      setErrorMessage(
        isUserRejectedError(error)
          ? "Approval cancelled."
          : getErrorMessage(error, "Approval failed."),
      );
    } finally {
      setIsApproving(false);
    }
  }

  /* ── Publish on-chain ──────────────────────────── */

  async function handlePublish() {
    if (!compilation || !publicClient || !writeContractAsync || !address)
      return;
    if (!sessionId) {
      setErrorMessage("No authoring session found. Send more messages first.");
      return;
    }

    try {
      setIsPublishing(true);
      setErrorMessage(null);
      setHostReturnUrl(null);
      const rewardUnits = getRewardUnitsFromInput(
        compilation.challenge_spec.reward.total,
      );
      const latestFunding = await refreshPostingFundingState(rewardUnits);
      if (latestFunding.balance < rewardUnits) {
        throw new Error(latestFunding.message ?? "Insufficient USDC balance.");
      }
      if (
        latestFunding.method === "approve" &&
        latestFunding.allowance < rewardUnits
      ) {
        throw new Error("Approve USDC before publishing this challenge.");
      }

      await assertFactoryIsSupported({
        publicClient,
        factoryAddress: FACTORY_ADDRESS,
      });

      setStatusMessage("Pinning the compiled challenge spec...");
      const prepared = await publishManagedAuthoringSession({
        sessionId,
        spec: compilation.challenge_spec,
        address,
        chainId: CHAIN_ID,
        signTypedDataAsync,
        returnTo: requestedReturnTo ?? undefined,
      });

      let createTx: `0x${string}`;
      if (
        latestFunding.method === "permit" &&
        latestFunding.allowance < rewardUnits
      ) {
        setStatusMessage("Sign permit in your wallet...");
        try {
          const permit = await signRewardPermit({
            publicClient,
            address,
            tokenName: latestFunding.tokenName,
            permitVersion: latestFunding.permitVersion,
            chainId: CHAIN_ID,
            usdcAddress: USDC_ADDRESS,
            factoryAddress: FACTORY_ADDRESS,
            rewardUnits,
            signTypedDataAsync,
          });
          setStatusMessage("Creating the challenge on-chain...");
          createTx = await createChallengeWithPermit({
            publicClient,
            writeContractAsync,
            address,
            factoryAddress: FACTORY_ADDRESS,
            prepared,
            permit,
          });
        } catch (error) {
          const permitMessage = getErrorMessage(
            error,
            "Permit signature failed.",
          );
          if (
            !isUserRejectedError(error) &&
            isPermitUnsupportedError(permitMessage)
          ) {
            setFundingState((current) => ({ ...current, method: "approve" }));
          }
          throw error;
        }
      } else {
        setStatusMessage("Creating the challenge on-chain...");
        createTx = await createChallengeWithApproval({
          publicClient,
          writeContractAsync,
          address,
          factoryAddress: FACTORY_ADDRESS,
          prepared,
        });
      }

      setStatusMessage("Waiting for chain confirmation...");
      const registration = await finalizeManagedChallengePost({
        createTx,
        publicClient,
      });
      setPostedChallengeId(registration.challengeId);
      const nextHostReturnUrl = buildHostReturnUrl({
        baseUrl: prepared.returnTo,
        sessionId,
        challengeId: registration.challengeId,
        specCid: prepared.specCid,
      });
      setHostReturnUrl(nextHostReturnUrl);
      setStatusMessage("Challenge published successfully.");
    } catch (error) {
      setErrorMessage(
        isUserRejectedError(error)
          ? "Publish cancelled."
          : getErrorMessage(error, "Publish failed."),
      );
    } finally {
      setIsPublishing(false);
    }
  }

  /* ── Render ────────────────────────────────────── */

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 pb-12">
      {/* Header */}
      <header className="rounded-md bg-white p-8">
        <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-warm-400">
          Agora · Post
        </div>
        <h1 className="mt-4 font-display text-[2.25rem] font-bold leading-[0.95] tracking-[-0.02em] text-warm-900 sm:text-[2.75rem]">
          Create a science bounty
        </h1>
        <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-warm-500">
          Describe your problem in plain language. Agora figures out the scoring
          engine, maps your files, and compiles a deterministic contract.
        </p>
      </header>

      {/* Success notice */}
      {postedChallengeId ? (
        <PostNotice tone="success">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              Challenge published. ID:{" "}
              <span className="font-mono">{postedChallengeId}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {hostReturnUrl ? (
                <a
                  href={hostReturnUrl}
                  className="btn-secondary inline-flex items-center gap-2 rounded-[2px] px-4 py-2 font-mono text-xs font-semibold uppercase tracking-wider"
                >
                  Return to host
                  <ArrowRight className="h-3.5 w-3.5" />
                </a>
              ) : null}
              <Link
                href={`/challenges/${postedChallengeId}`}
                className="btn-secondary inline-flex items-center gap-2 rounded-[2px] px-4 py-2 font-mono text-xs font-semibold uppercase tracking-wider"
              >
                View challenge
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </PostNotice>
      ) : null}

      {/* Chat + Review layout */}
      <div
        className="flex flex-col gap-0 md:flex-row"
        style={{ minHeight: 560 }}
      >
        {/* Chat side */}
        <div className={`flex-1 ${reviewOpen ? "" : "w-full"}`}>
          <ChatComposer
            messages={messages}
            isStreaming={isStreaming}
            streamingText={streamingText}
            pendingQuestions={pendingQuestions}
            uploads={uploads}
            onSendMessage={sendMessage}
            onSubmitAnswers={submitAnswers}
            onCannotAnswer={cannotAnswer}
            onFilesSelected={(files) => void sendFiles(files)}
            onRemoveUpload={removeUpload}
            disabled={!!postedChallengeId}
          />
        </div>

        {/* Review panel */}
        {compilation ? (
          <ReviewPanel
            compilation={compilation}
            isOpen={reviewOpen}
            onClose={() => setReviewOpen(false)}
            onPublish={() => void handlePublish()}
            onApprove={() => void handleApprove()}
            onConnectWallet={() => openConnectModal?.()}
            onSwitchChain={() => openChainModal?.()}
            isPublishing={isPublishing}
            isApproving={isApproving}
            isConnected={isConnected}
            isWrongChain={!!isWrongChain}
            wrongChainMessage={getWrongChainMessage(chainId)}
            fundingState={fundingState}
            allowanceReady={allowanceReady}
            balanceReady={balanceReady}
            requiresApproval={requiresApproval}
            rewardInput={rewardInput}
            feeUsdc={feeUsdc}
            payoutUsdc={payoutUsdc}
            statusMessage={statusMessage}
            errorMessage={errorMessage}
          />
        ) : null}
      </div>

      {/* Footer */}
      <div className="text-center text-xs text-warm-500">
        Need a custom scorer?{" "}
        <span className="font-mono text-warm-700">
          agora post ./challenge.yaml
        </span>{" "}
        supports advanced configuration from the CLI.
      </div>
    </div>
  );
}
