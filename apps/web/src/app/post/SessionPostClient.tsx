"use client";

import { useChainModal, useConnectModal } from "@rainbow-me/rainbowkit";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
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
  getWrongChainMessage,
  isWrongWalletChain,
} from "../../lib/wallet/network";
import {
  getErrorMessage,
  isUserRejectedError,
  waitForTransactionReceiptWithTimeout,
} from "../../lib/wallet/tx";
import { AuthoringWorkspace } from "./AuthoringWorkspace";
import { PostNotice } from "./PostSections";
import { ReviewPanel } from "./ReviewPanel";
import {
  approveUsdc,
  assertFactoryIsSupported,
  createChallengeWithApproval,
  createChallengeWithPermit,
  finalizeAuthoringPublish,
  prepareAuthoringPublish,
  signRewardPermit,
} from "./authoring-publish-flow";
import {
  getRewardUnitsFromInput,
  isPermitUnsupportedError,
  usePostFunding,
} from "./post-funding";
import { useAuthoringSession } from "./use-authoring-session";

interface SessionPostClientProps {
  hostedSessionId?: string | null;
}

export function SessionPostClient({
  hostedSessionId = null,
}: SessionPostClientProps) {
  const [isPublishing, setIsPublishing] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [postedChallengeId, setPostedChallengeId] = useState<string | null>(
    null,
  );
  const [publishStatusMessage, setPublishStatusMessage] = useState<string | null>(
    null,
  );
  const [publishErrorMessage, setPublishErrorMessage] = useState<string | null>(
    null,
  );

  const { isConnected, chainId, address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();
  const { openConnectModal } = useConnectModal();
  const { openChainModal } = useChainModal();
  const isWrongChain = isConnected && isWrongWalletChain(chainId);

  const {
    form,
    session,
    sessionId,
    uploads,
    artifactOptions,
    isLoadingSession,
    isSubmitting,
    statusMessage,
    errorMessage,
    updateField,
    uploadFiles,
    removeUpload,
    refreshSession,
    validateSession,
    compilation,
  } = useAuthoringSession({
    hostedSessionId,
    onCompileReady: () => setReviewOpen(true),
  });

  const rewardInput =
    compilation?.reward?.total ?? (form.reward_total || "0");
  const { feeUsdc, payoutUsdc } = computeProtocolFee(Number(rewardInput || 0));

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

  async function handleApprove() {
    if (!publicClient || !writeContractAsync || !address) {
      return;
    }

    try {
      setIsApproving(true);
      setPublishErrorMessage(null);
      const rewardUnits = getRewardUnitsFromInput(rewardInput);
      const latestFunding = await refreshPostingFundingState(rewardUnits);
      if (latestFunding.balance < rewardUnits) {
        throw new Error(latestFunding.message ?? "Insufficient USDC balance.");
      }
      if (latestFunding.allowance >= rewardUnits) {
        setPublishStatusMessage("Allowance already covers this reward.");
        return;
      }

      setPublishStatusMessage("Approve USDC in your wallet...");
      const approveTx = await approveUsdc({
        publicClient,
        writeContractAsync,
        address,
        usdcAddress: USDC_ADDRESS,
        factoryAddress: FACTORY_ADDRESS,
        rewardUnits,
      });
      setPublishStatusMessage("Approval submitted. Waiting for confirmation...");
      await waitForTransactionReceiptWithTimeout({
        publicClient,
        hash: approveTx,
      });
      await waitForAllowanceUpdate(rewardUnits);
      setPublishStatusMessage("USDC approved. You can publish now.");
    } catch (error) {
      setPublishErrorMessage(
        isUserRejectedError(error)
          ? "Approval cancelled."
          : getErrorMessage(error, "Approval failed."),
      );
    } finally {
      setIsApproving(false);
    }
  }

  async function handlePublish() {
    if (!session || !compilation || !publicClient || !writeContractAsync || !address) {
      return;
    }
    if (!sessionId) {
      setPublishErrorMessage("No authoring session found. Validate a session first.");
      return;
    }

    try {
      setIsPublishing(true);
      setPublishErrorMessage(null);
      const rewardUnits = getRewardUnitsFromInput(compilation.reward.total);
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

      setPublishStatusMessage("Pinning the compiled challenge spec...");
      const prepared = await prepareAuthoringPublish({
        sessionId,
      });

      let createTx: `0x${string}`;
      if (
        latestFunding.method === "permit" &&
        latestFunding.allowance < rewardUnits
      ) {
        setPublishStatusMessage("Sign permit in your wallet...");
        try {
          const permit = await signRewardPermit({
            publicClient,
            address,
            tokenName: latestFunding.tokenName,
            permitVersion: latestFunding.permitVersion,
            chainId: CHAIN_ID,
            usdcAddress: prepared.usdcAddress,
            factoryAddress: prepared.factoryAddress,
            rewardUnits: prepared.rewardUnits,
            signTypedDataAsync,
          });
          setPublishStatusMessage("Creating the challenge on-chain...");
          createTx = await createChallengeWithPermit({
            publicClient,
            writeContractAsync,
            address,
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
        setPublishStatusMessage("Creating the challenge on-chain...");
        createTx = await createChallengeWithApproval({
          publicClient,
          writeContractAsync,
          address,
          prepared,
        });
      }

      setPublishStatusMessage("Waiting for chain confirmation...");
      const publishedSession = await finalizeAuthoringPublish({
        sessionId,
        createTx,
        publicClient,
      });
      setPostedChallengeId(publishedSession.challenge_id);
      setPublishStatusMessage("Challenge published successfully.");
    } catch (error) {
      setPublishErrorMessage(
        isUserRejectedError(error)
          ? "Publish cancelled."
          : getErrorMessage(error, "Publish failed."),
      );
    } finally {
      setIsPublishing(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 pb-12">
      <header className="rounded-md bg-white p-8">
        <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-warm-400">
          Agora · Post
        </div>
        <h1 className="mt-4 font-display text-[2.25rem] font-bold leading-[0.95] tracking-[-0.02em] text-warm-900 sm:text-[2.75rem]">
          Create a science bounty
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-warm-500">
          Fill the structured challenge contract directly. Agora validates the
          session, returns exact blockers, and only reaches publish once the
          dry-run passes.
        </p>
      </header>

      {postedChallengeId ? (
        <PostNotice tone="success">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              Challenge published. ID:{" "}
              <span className="font-mono">{postedChallengeId}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
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

      <div className="flex flex-col gap-0 md:flex-row" style={{ minHeight: 560 }}>
        <div className={`flex-1 ${reviewOpen ? "" : "w-full"}`}>
          <AuthoringWorkspace
            form={form}
            session={session}
            sessionId={sessionId}
            uploads={uploads}
            artifactOptions={artifactOptions}
            isLoadingSession={isLoadingSession}
            isSubmitting={isSubmitting}
            statusMessage={statusMessage}
            errorMessage={errorMessage}
            onFieldChange={updateField}
            onValidate={() => {
              void validateSession();
            }}
            onRefresh={() => {
              void refreshSession();
            }}
            onFilesSelected={(files) => {
              void uploadFiles(files);
            }}
            onRemoveUpload={removeUpload}
            onOpenReview={() => setReviewOpen(true)}
          />
        </div>

        {compilation ? (
          <ReviewPanel
            session={session}
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
            statusMessage={publishStatusMessage}
            errorMessage={publishErrorMessage}
          />
        ) : null}
      </div>

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
