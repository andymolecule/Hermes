"use client";

import {
  type CompilationResultOutput,
  type PostingSessionOutput,
  parseCsvHeaders,
} from "@agora/common";
import { useChainModal, useConnectModal } from "@rainbow-me/rainbowkit";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Loader2,
  Pencil,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import {
  type ReactNode,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  useAccount,
  usePublicClient,
  useSignTypedData,
  useWriteContract,
} from "wagmi";
import { CHAIN_ID, FACTORY_ADDRESS, USDC_ADDRESS } from "../../lib/config";
import { computeProtocolFee, formatUsdc } from "../../lib/format";
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
import { GuidedComposer } from "./GuidedComposer";
import {
  type GuidedCompileState,
  type GuidedFieldKey,
  type ManagedIntentState,
  type UploadedArtifact,
  buildManagedIntentFromGuidedState,
  buildPostingArtifactsFromGuidedState,
  clarificationTargetFromQuestions,
  clearGuidedDraft,
  createInitialGuidedState,
  guidedComposerReducer,
  isReadyToCompile,
  listReadinessIssues,
  loadGuidedDraft,
  saveGuidedDraft,
} from "./guided-state";
import {
  approveUsdc,
  assertFactoryIsSupported,
  createChallengeWithApproval,
  createChallengeWithPermit,
  finalizeManagedChallengePost,
  publishManagedPostingSession,
  signRewardPermit,
} from "./managed-post-flow";
import {
  getFundingSummaryMessage,
  getRewardUnitsFromInput,
  isPermitUnsupportedError,
  usePostFunding,
} from "./post-funding";
import { cx } from "./post-ui";

type Step = 1 | 2 | 3;

const STEP_LABELS: Record<Step, string> = {
  1: "Describe",
  2: "Review",
  3: "Publish",
};

/* ── Utility functions ─────────────────────────────────── */

function toIsoWithOffset(localValue: string) {
  if (!localValue) {
    return new Date().toISOString();
  }
  return new Date(localValue).toISOString();
}

function parseApiErrorMessage(text: string) {
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim().length > 0) {
      return parsed.error;
    }
  } catch {
    return text || "Request failed.";
  }
  return text || "Request failed.";
}

function buildPostingIntent(intent: ManagedIntentState) {
  return {
    title: intent.title,
    description: intent.description,
    payout_condition: intent.payoutCondition,
    reward_total: intent.rewardTotal,
    distribution: intent.distribution,
    deadline: toIsoWithOffset(intent.deadline),
    domain: intent.domain,
    tags: intent.tags
      .split(",")
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean),
    solver_instructions: intent.solverInstructions,
    timezone: intent.timezone,
  };
}

function formatRuntimeLabel(value: string) {
  return value
    .split("_")
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

/* ── API helpers ───────────────────────────────────────── */

async function pinDataFile(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch("/api/pin-data", {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    throw new Error(parseApiErrorMessage(await response.text()));
  }
  return (await response.json()) as { cid: string };
}

async function createPostingSession(input: {
  posterAddress?: `0x${string}`;
  intent: ManagedIntentState;
  uploads: UploadedArtifact[];
}) {
  const response = await fetch("/api/posting/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      poster_address: input.posterAddress,
      intent: buildPostingIntent(input.intent),
      uploaded_artifacts: buildPostingArtifactsFromGuidedState(input.uploads),
    }),
  });

  if (!response.ok) {
    throw new Error(parseApiErrorMessage(await response.text()));
  }

  const payload = (await response.json()) as {
    data: { session: PostingSessionOutput };
  };
  return payload.data.session;
}

async function compilePostingSession(input: {
  sessionId: string;
  posterAddress?: `0x${string}`;
  intent: ManagedIntentState;
  uploads: UploadedArtifact[];
}) {
  const response = await fetch(
    `/api/posting/sessions/${input.sessionId}/compile`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        poster_address: input.posterAddress,
        intent: buildPostingIntent(input.intent),
        uploaded_artifacts: buildPostingArtifactsFromGuidedState(input.uploads),
      }),
    },
  );

  if (!response.ok) {
    throw new Error(parseApiErrorMessage(await response.text()));
  }

  const payload = (await response.json()) as {
    data: { session: PostingSessionOutput };
  };
  return payload.data.session;
}

async function getPostingSession(sessionId: string) {
  const response = await fetch(`/api/posting/sessions/${sessionId}`, {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(parseApiErrorMessage(await response.text()));
  }

  const payload = (await response.json()) as {
    data: { session: PostingSessionOutput };
  };
  return payload.data.session;
}

function getCompilation(session: PostingSessionOutput | null | undefined) {
  return (session?.compilation ?? null) as CompilationResultOutput | null;
}

function clearCompiledSessionData(
  current: PostingSessionOutput | null,
): PostingSessionOutput | null {
  if (!current) {
    return current;
  }

  return {
    ...current,
    state: "draft",
    compilation: null,
    clarification_questions: [],
    review_summary: null,
    failure_message: null,
  };
}

/* ── Small UI components ───────────────────────────────── */

function Notice({
  tone,
  children,
}: {
  tone: "info" | "success" | "error" | "warning";
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        "rounded-[2px] border px-4 py-3 text-sm",
        tone === "info" && "border-accent-200 bg-accent-50 text-accent-700",
        tone === "success" &&
          "border-emerald-300 bg-emerald-50 text-emerald-800",
        tone === "error" && "border-red-300 bg-red-50 text-red-800",
        tone === "warning" && "border-amber-300 bg-amber-50 text-amber-900",
      )}
    >
      {children}
    </div>
  );
}

function StepIndicator({ step }: { step: Step }) {
  return (
    <nav aria-label="Posting progress" className="flex items-center gap-1">
      {([1, 2, 3] as Step[]).map((s, i) => (
        <div key={s} className="flex items-center gap-1">
          {i > 0 ? <ChevronRight className="h-3 w-3 text-warm-400" /> : null}
          <div
            aria-current={s === step ? "step" : undefined}
            className={cx(
              "flex items-center gap-1.5 rounded-[2px] px-3 py-1.5 font-mono text-xs font-bold uppercase tracking-wider",
              s === step
                ? "border-2 border-warm-900 bg-warm-900 text-white shadow-[2px_2px_0px_var(--color-warm-900)]"
                : s < step
                  ? "border border-warm-300 bg-white text-warm-900"
                  : "border border-warm-200 bg-warm-50 text-warm-400",
            )}
          >
            {s < step ? <Check className="h-3 w-3" /> : null}
            {STEP_LABELS[s]}
          </div>
        </div>
      ))}
    </nav>
  );
}

/* ── Main component ────────────────────────────────────── */

export function PostClient() {
  const [step, setStep] = useState<Step>(1);
  const [guidedState, dispatch] = useReducer(
    guidedComposerReducer,
    undefined,
    () => createInitialGuidedState(),
  );
  const [session, setSession] = useState<PostingSessionOutput | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCompiling, setIsCompiling] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [postedChallengeId, setPostedChallengeId] = useState<string | null>(
    null,
  );
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  const guidedStateRef = useRef(guidedState);
  useEffect(() => {
    guidedStateRef.current = guidedState;
  }, [guidedState]);

  const { isConnected, chainId, address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();
  const { openConnectModal } = useConnectModal();
  const { openChainModal } = useChainModal();

  const managedIntent = useMemo(
    () => buildManagedIntentFromGuidedState(guidedState),
    [guidedState],
  );
  const compileReady = useMemo(
    () => isReadyToCompile(guidedState),
    [guidedState],
  );
  const draftIssues = useMemo(
    () => listReadinessIssues(guidedState),
    [guidedState],
  );

  const compilation = getCompilation(session);
  const clarificationQuestions = session?.clarification_questions ?? [];
  const reviewSummary = session?.review_summary ?? null;
  const isReviewQueued = session?.state === "needs_review";
  const rewardInput =
    compilation?.challenge_spec.reward.total ?? managedIntent.rewardTotal;
  const { feeUsdc, payoutUsdc } = computeProtocolFee(Number(rewardInput || 0));
  const isWrongChain = isConnected && isWrongWalletChain(chainId);
  const publicArtifacts =
    compilation?.resolved_artifacts.filter(
      (artifact) => artifact.visibility === "public",
    ) ?? [];
  const privateArtifacts =
    compilation?.resolved_artifacts.filter(
      (artifact) => artifact.visibility === "private",
    ) ?? [];
  const {
    fundingState,
    allowanceReady,
    balanceReady,
    refreshPostingFundingState,
    waitForAllowanceUpdate,
    setFundingState,
  } = usePostFunding({
    showPreview: step === 3,
    walletReady: isConnected && !isWrongChain,
    publicClient,
    address: address as `0x${string}` | undefined,
    factoryAddress: FACTORY_ADDRESS,
    usdcAddress: USDC_ADDRESS,
    rewardInput,
  });
  const fundingSummary = getFundingSummaryMessage({
    fundingState,
    balanceReady,
    allowanceReady,
  });

  /* ── Effects ──────────────────────────────────────────── */

  useEffect(() => {
    const restored = loadGuidedDraft();
    if (restored) {
      dispatch({ type: "hydrate", state: restored });
    }
  }, []);

  useEffect(() => {
    saveGuidedDraft(guidedState);
  }, [guidedState]);

  useEffect(() => {
    if (!guidedState.sessionId || session) {
      return;
    }

    let cancelled = false;

    void getPostingSession(guidedState.sessionId)
      .then((restoredSession) => {
        if (cancelled) {
          return;
        }
        setSession(restoredSession);
        if (restoredSession.state === "ready") {
          dispatch({ type: "set_compile_state", compileState: "ready" });
          setStep(2);
        } else if (restoredSession.state === "needs_review") {
          dispatch({
            type: "set_compile_state",
            compileState: "needs_review",
          });
          setStep(2);
        } else if (restoredSession.state === "needs_clarification") {
          dispatch({
            type: "apply_clarification",
            field: clarificationTargetFromQuestions(
              restoredSession.clarification_questions ?? [],
            ),
          });
          setStep(1);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [guidedState.sessionId, session]);

  useEffect(() => {
    if (!session?.id || session.state !== "needs_review") {
      return;
    }

    let cancelled = false;
    const intervalId = window.setInterval(async () => {
      try {
        const refreshedSession = await getPostingSession(session.id);
        if (cancelled || refreshedSession.state === "needs_review") {
          return;
        }

        setSession(refreshedSession);

        if (refreshedSession.state === "ready") {
          dispatch({ type: "set_compile_state", compileState: "ready" });
          setStatusMessage(
            "Operator review approved this draft. You can continue to publish now.",
          );
          setErrorMessage(null);
          setStep(2);
          return;
        }

        if (refreshedSession.state === "needs_clarification") {
          dispatch({
            type: "apply_clarification",
            field: clarificationTargetFromQuestions(
              refreshedSession.clarification_questions ?? [],
            ),
          });
          setStatusMessage(
            "Agora needs a little more context before it can lock the challenge contract.",
          );
          setErrorMessage(null);
          setStep(1);
          return;
        }

        if (refreshedSession.state === "failed") {
          dispatch({
            type: "set_compile_state",
            compileState: compileReady ? "ready_to_compile" : "idle",
          });
          setStatusMessage(null);
          setErrorMessage(
            refreshedSession.failure_message ??
              "This draft could not be approved for managed publishing.",
          );
          setStep(1);
        }
      } catch {}
    }, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [compileReady, session?.id, session?.state]);

  /* ── Handlers ─────────────────────────────────────────── */

  function resetInterviewForEdit() {
    setStep(1);
    setStatusMessage(null);
    setErrorMessage(null);
    setSession((current) => clearCompiledSessionData(current));
  }

  function dispatchCompileState(compileState: GuidedCompileState) {
    dispatch({ type: "set_compile_state", compileState });
  }

  function handlePromptAnswer(
    field: Exclude<GuidedFieldKey, "title" | "uploads">,
    value: string,
  ) {
    if (value.trim().length === 0) {
      return;
    }
    resetInterviewForEdit();
    dispatch({ type: "answer_prompt", field, value });
  }

  function handleSkipOptionalPrompt(field: "solverInstructions") {
    resetInterviewForEdit();
    dispatch({ type: "skip_optional_prompt", field });
  }

  function handleEditPrompt(field: Exclude<GuidedFieldKey, "title">) {
    resetInterviewForEdit();
    dispatch({ type: "edit_prompt", field });
  }

  function handleTitleChange(value: string) {
    resetInterviewForEdit();
    dispatch({ type: "set_title", value });
  }

  function updateUploads(nextUploads: UploadedArtifact[]) {
    resetInterviewForEdit();
    dispatch({ type: "set_uploads", uploads: nextUploads });
  }

  async function handleFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) {
      return;
    }

    const list = Array.from(files);
    for (const file of list) {
      const localId = crypto.randomUUID();
      updateUploads([
        ...guidedStateRef.current.uploads,
        {
          id: localId,
          file_name: file.name,
          mime_type: file.type || undefined,
          size_bytes: file.size,
          status: "uploading",
        },
      ]);

      try {
        const [pinResult, headers] = await Promise.all([
          pinDataFile(file),
          file.type.includes("csv")
            ? file
                .slice(0, 4096)
                .text()
                .then((text) => parseCsvHeaders(text))
            : Promise.resolve([]),
        ]);
        updateUploads(
          guidedStateRef.current.uploads.map((artifact) =>
            artifact.id === localId
              ? {
                  ...artifact,
                  uri: pinResult.cid,
                  detected_columns: headers,
                  status: "ready",
                }
              : artifact,
          ),
        );
        setStatusMessage(
          `Uploaded ${file.name}. Agora can use it during compile.`,
        );
      } catch (error) {
        updateUploads(
          guidedStateRef.current.uploads.map((artifact) =>
            artifact.id === localId
              ? {
                  ...artifact,
                  status: "error",
                  error:
                    error instanceof Error ? error.message : "Upload failed.",
                }
              : artifact,
          ),
        );
        setErrorMessage(
          error instanceof Error ? error.message : "Upload failed.",
        );
      }
    }
  }

  function handleRenameUpload(id: string, fileName: string) {
    updateUploads(
      guidedStateRef.current.uploads.map((artifact) =>
        artifact.id === id ? { ...artifact, file_name: fileName } : artifact,
      ),
    );
  }

  function handleRemoveUpload(id: string) {
    updateUploads(
      guidedStateRef.current.uploads.filter((artifact) => artifact.id !== id),
    );
  }

  function handleConfirmUploads() {
    resetInterviewForEdit();
    dispatch({ type: "confirm_uploads" });
  }

  async function handleCompile() {
    if (!compileReady) {
      setErrorMessage(
        `This draft is not ready to compile yet. Next step: ${draftIssues[0]}`,
      );
      setStatusMessage(null);
      return;
    }

    try {
      setIsCompiling(true);
      dispatchCompileState("compiling");
      setErrorMessage(null);
      setStatusMessage(
        "Compiling your challenge into a deterministic scoring contract...",
      );

      let existingSessionId = guidedStateRef.current.sessionId;
      if (!existingSessionId) {
        const createdSession = await createPostingSession({
          posterAddress: address as `0x${string}` | undefined,
          intent: managedIntent,
          uploads: guidedStateRef.current.uploads,
        });
        existingSessionId = createdSession.id;
        dispatch({ type: "set_session_id", sessionId: createdSession.id });
      }

      const compiledSession = await compilePostingSession({
        sessionId: existingSessionId,
        posterAddress: address as `0x${string}` | undefined,
        intent: managedIntent,
        uploads: guidedStateRef.current.uploads,
      });
      setSession(compiledSession);
      dispatch({ type: "set_session_id", sessionId: compiledSession.id });

      if (compiledSession.state === "needs_clarification") {
        dispatch({
          type: "apply_clarification",
          field: clarificationTargetFromQuestions(
            compiledSession.clarification_questions ?? [],
          ),
        });
        setStep(1);
        setStatusMessage(
          "Agora needs a little more context before it can lock the challenge contract.",
        );
      } else if (compiledSession.state === "needs_review") {
        dispatchCompileState("needs_review");
        setStep(2);
        setStatusMessage(
          "Agora compiled a contract and queued it for operator review before publish.",
        );
      } else {
        dispatchCompileState("ready");
        setStep(2);
        setStatusMessage(
          "Agora mapped your files, chose a managed runtime, and prepared a review contract.",
        );
      }
    } catch (error) {
      dispatchCompileState(compileReady ? "ready_to_compile" : "idle");
      setErrorMessage(
        error instanceof Error ? error.message : "Compile failed.",
      );
      setStatusMessage(null);
    } finally {
      setIsCompiling(false);
    }
  }

  async function handleApprove() {
    if (!publicClient || !writeContractAsync || !address) {
      return;
    }

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
      setStatusMessage("USDC approved. You can publish the challenge now.");
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

  async function handlePublish() {
    if (!compilation || !publicClient || !writeContractAsync || !address) {
      return;
    }
    if (!session) {
      setErrorMessage("No posting session found. Recompile the draft first.");
      return;
    }

    try {
      setIsPublishing(true);
      setErrorMessage(null);
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
      const prepared = await publishManagedPostingSession({
        sessionId: session.id,
        spec: compilation.challenge_spec,
        address,
        chainId: CHAIN_ID,
        signTypedDataAsync,
      });

      let createTx: `0x${string}`;
      if (
        latestFunding.method === "permit" &&
        latestFunding.allowance < rewardUnits
      ) {
        setStatusMessage(
          `Sign ${latestFunding.tokenName} permit in your wallet...`,
        );
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
      clearGuidedDraft();
      setPostedChallengeId(registration.challengeId);
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

  /* ── Render ───────────────────────────────────────────── */

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 pb-24">
      {/* Header */}
      <header className="rounded-[2px] border-2 border-warm-900 bg-white p-6 shadow-[4px_4px_0px_var(--color-warm-900)]">
        <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-warm-500">
          Agora · Post
        </div>
        <h1 className="mt-3 font-display text-[2.25rem] font-bold leading-[0.95] tracking-[-0.03em] text-warm-900 sm:text-[2.75rem]">
          Create a science bounty
        </h1>
        <p className="mt-3 max-w-lg text-[15px] leading-6 text-warm-600">
          Describe your problem, upload data, and Agora compiles a deterministic
          scoring contract.
        </p>
      </header>

      {/* Step indicator */}
      <StepIndicator step={step} />

      {/* Notices */}
      {statusMessage ? <Notice tone="info">{statusMessage}</Notice> : null}
      {errorMessage ? <Notice tone="error">{errorMessage}</Notice> : null}
      {postedChallengeId ? (
        <Notice tone="success">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              Challenge published. ID:{" "}
              <span className="font-mono">{postedChallengeId}</span>
            </div>
            <Link
              href={`/challenges/${postedChallengeId}`}
              className="btn-secondary inline-flex items-center gap-2 rounded-[2px] px-4 py-2 text-xs font-mono font-semibold uppercase tracking-wider"
            >
              View challenge
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </Notice>
      ) : null}

      {/* ── Step 1: Describe ───────────────────────────── */}
      {step === 1 ? (
        <GuidedComposer
          state={guidedState}
          clarificationQuestions={clarificationQuestions}
          isCompiling={isCompiling}
          onEditPrompt={handleEditPrompt}
          onAnswerPrompt={handlePromptAnswer}
          onSkipOptionalPrompt={handleSkipOptionalPrompt}
          onFilesSelected={handleFilesSelected}
          onRenameUpload={handleRenameUpload}
          onRemoveUpload={handleRemoveUpload}
          onConfirmUploads={handleConfirmUploads}
        />
      ) : null}

      {/* ── Step 2: Review ─────────────────────────────── */}
      {step === 2 && compilation ? (
        <div className="space-y-4">
          {/* Title card */}
          <div className="rounded-[2px] border-2 border-warm-900 bg-white p-5 shadow-[4px_4px_0px_var(--color-warm-900)]">
            <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-warm-500">
              Challenge title
            </div>
            {editingTitle ? (
              <div className="mt-2 flex gap-2">
                <input
                  value={titleDraft}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  aria-label="Challenge title"
                  className="min-w-0 flex-1 rounded-[2px] border border-warm-300 bg-white px-3 py-2 text-sm text-warm-900 outline-none transition focus:border-warm-900 focus:shadow-[2px_2px_0px_var(--color-warm-900)] motion-reduce:transition-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    handleTitleChange(titleDraft);
                    setEditingTitle(false);
                  }}
                  className="btn-primary rounded-[2px] px-4 py-2 font-mono text-xs font-semibold uppercase tracking-wider"
                >
                  Save
                </button>
              </div>
            ) : (
              <div className="mt-2 flex items-center justify-between gap-3">
                <h2 className="font-display text-xl font-bold tracking-tight text-warm-900">
                  {managedIntent.title || "Untitled"}
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    setTitleDraft(managedIntent.title);
                    setEditingTitle(true);
                  }}
                  className="inline-flex shrink-0 items-center gap-1 rounded-[2px] border border-warm-300 bg-white px-2.5 py-1 text-xs font-medium text-warm-700 transition hover:border-warm-900 hover:text-warm-900 motion-reduce:transition-none"
                >
                  <Pencil className="h-3 w-3" />
                  Edit
                </button>
              </div>
            )}
          </div>

          {/* Review queued warning */}
          {isReviewQueued && reviewSummary ? (
            <Notice tone="warning">
              <div className="space-y-1">
                <div className="font-semibold">
                  Operator review required before publish
                </div>
                <div>{reviewSummary.summary}</div>
              </div>
            </Notice>
          ) : null}

          {/* Contract summary */}
          <div className="space-y-4 rounded-[2px] border border-warm-300 bg-white p-5">
            <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-warm-500">
              Contract summary
            </div>

            <div className="space-y-3 text-sm leading-6 text-warm-700">
              <p>{compilation.confirmation_contract.scoring_summary}</p>
              <p>{compilation.confirmation_contract.solver_submission}</p>
              <p>{compilation.confirmation_contract.reward_summary}</p>
              <p>{compilation.confirmation_contract.deadline_summary}</p>
              <p>{compilation.confirmation_contract.dry_run_summary}</p>
            </div>

            <div className="flex rounded-[2px] border-[2.5px] border-warm-900 bg-white shadow-[5px_5px_0px_var(--color-warm-900)]">
              <div className="flex-1 border-r-[2.5px] border-warm-900 p-4">
                <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-warm-500">
                  Runtime
                </div>
                <div className="mt-1 font-display text-lg font-bold tracking-tight text-warm-900">
                  {formatRuntimeLabel(compilation.runtime_family)}
                </div>
              </div>
              <div
                className={cx(
                  "flex-1 p-4",
                  compilation.dry_run.sample_score != null &&
                    "border-r-[2.5px] border-warm-900",
                )}
              >
                <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-warm-500">
                  Metric
                </div>
                <div className="mt-1 font-display text-lg font-bold tracking-tight text-warm-900">
                  {compilation.metric}
                </div>
              </div>
              {compilation.dry_run.sample_score != null ? (
                <div className="flex-1 p-4">
                  <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-warm-500">
                    Sample
                  </div>
                  <div className="mt-1 font-display text-lg font-bold tracking-tight text-emerald-700">
                    {compilation.dry_run.sample_score}
                  </div>
                </div>
              ) : null}
            </div>

            {/* Public / private files */}
            <div className="grid gap-4 border-t border-warm-200 pt-4 sm:grid-cols-2">
              <div>
                <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-warm-500">
                  Visible to solvers
                </div>
                {publicArtifacts.length === 0 ? (
                  <div className="mt-1 text-sm text-warm-400">None</div>
                ) : (
                  publicArtifacts.map((artifact) => (
                    <div
                      key={`${artifact.role}:${artifact.uri}`}
                      className="mt-1 text-sm text-warm-700"
                    >
                      {artifact.file_name ?? artifact.role}
                      <span className="ml-1 font-mono text-[10px] uppercase text-warm-400">
                        {artifact.role}
                      </span>
                    </div>
                  ))
                )}
              </div>
              <div>
                <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-warm-500">
                  Hidden for evaluation
                </div>
                {privateArtifacts.length === 0 ? (
                  <div className="mt-1 text-sm text-warm-400">None</div>
                ) : (
                  privateArtifacts.map((artifact) => (
                    <div
                      key={`${artifact.role}:${artifact.uri}`}
                      className="mt-1 text-sm text-warm-700"
                    >
                      {artifact.file_name ?? artifact.role}
                      <span className="ml-1 font-mono text-[10px] uppercase text-warm-400">
                        {artifact.role}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Public/private summary */}
            {compilation.confirmation_contract.public_private_summary.length >
            0 ? (
              <ul className="list-inside list-disc border-t border-warm-200 pt-4 text-sm text-warm-600">
                {compilation.confirmation_contract.public_private_summary.map(
                  (line) => (
                    <li key={line}>{line}</li>
                  ),
                )}
              </ul>
            ) : null}

            {/* Warnings */}
            {compilation.warnings.length > 0 ? (
              <Notice tone="warning">{compilation.warnings.join(" ")}</Notice>
            ) : null}
          </div>

          {/* Review reason codes */}
          {isReviewQueued && reviewSummary?.reason_codes.length ? (
            <div className="flex flex-wrap gap-2">
              {reviewSummary.reason_codes.map((code) => (
                <span
                  key={code}
                  className="rounded-[2px] border border-warm-300 bg-warm-50 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-warm-600"
                >
                  {code}
                </span>
              ))}
            </div>
          ) : null}

          {/* Raw spec */}
          <details className="rounded-[2px] border border-warm-300">
            <summary className="cursor-pointer px-4 py-3 font-mono text-xs font-bold uppercase tracking-wider text-warm-500">
              Raw spec preview
            </summary>
            <pre className="overflow-x-auto border-t border-warm-300 bg-warm-50 px-4 py-4 font-mono text-[11px] leading-5 text-warm-700">
              {JSON.stringify(compilation.challenge_spec, null, 2)}
            </pre>
          </details>
        </div>
      ) : null}

      {/* ── Step 3: Publish ────────────────────────────── */}
      {step === 3 && compilation ? (
        <div className="space-y-4">
          {/* Reward card */}
          <div className="rounded-[2px] border-2 border-warm-900 bg-white p-5 shadow-[4px_4px_0px_var(--color-warm-900)]">
            <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-warm-500">
              Reward
            </div>
            <div className="mt-3 flex items-baseline gap-3">
              <span className="font-display text-[2.75rem] font-bold leading-none tracking-[-0.03em] text-warm-900">
                {formatUsdc(Number(rewardInput || 0))}
              </span>
              <span className="font-mono text-lg font-bold uppercase tracking-wider text-warm-500">
                USDC
              </span>
            </div>
            <div className="mt-3 flex gap-4 text-sm text-warm-600">
              <span>
                Protocol fee:{" "}
                <span className="font-mono text-warm-900">
                  {formatUsdc(feeUsdc)}
                </span>
              </span>
              <span>
                Net payout:{" "}
                <span className="font-mono text-warm-900">
                  {formatUsdc(payoutUsdc)}
                </span>
              </span>
            </div>
          </div>

          {/* Wallet card */}
          <div className="rounded-[2px] border border-warm-300 bg-white p-5">
            <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-warm-500">
              Wallet
            </div>
            {!isConnected ? (
              <p className="mt-2 text-sm text-warm-600">
                Connect your wallet to fund and publish the bounty.
              </p>
            ) : isWrongChain ? (
              <p className="mt-2 text-sm text-warm-600">
                {getWrongChainMessage(chainId)}
              </p>
            ) : (
              <div className="mt-2 space-y-2">
                <div className="flex items-center justify-between border-b border-warm-200 py-2 text-sm">
                  <span className="text-warm-500">Method</span>
                  <span className="font-mono text-warm-900">
                    {fundingState.method}
                  </span>
                </div>
                <div className="flex items-center justify-between border-b border-warm-200 py-2 text-sm">
                  <span className="text-warm-500">Allowance</span>
                  <span className="font-mono text-warm-900">
                    {allowanceReady ? "Ready" : "Needed"}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2 text-sm">
                  <span className="text-warm-500">Balance</span>
                  <span className="font-mono text-warm-900">
                    {balanceReady ? "Ready" : "Insufficient"}
                  </span>
                </div>
                <div className="rounded-[2px] border border-warm-200 bg-warm-50 px-3 py-2 text-sm text-warm-600">
                  {fundingSummary}
                </div>
              </div>
            )}
          </div>

          {/* Final review summary */}
          <div className="rounded-[2px] border border-warm-300 bg-warm-50 p-5">
            <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-warm-500">
              What goes live
            </div>
            <div className="mt-2 space-y-1 text-sm text-warm-700">
              <div>{compilation.confirmation_contract.solver_submission}</div>
              <div>{compilation.confirmation_contract.scoring_summary}</div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Action bar ─────────────────────────────────── */}
      <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-[2px] border-2 border-warm-900 bg-white px-5 py-4 shadow-[4px_4px_0px_var(--color-warm-900)]">
        <div className="text-sm text-warm-600">
          {step === 1
            ? "Lock answers, then compile."
            : step === 2
              ? isReviewQueued
                ? "Waiting for operator review."
                : "Review the contract, then continue."
              : "Fund and publish your challenge."}
        </div>

        <div className="flex gap-3">
          {step > 1 ? (
            <button
              type="button"
              onClick={() =>
                setStep((current) => (current === 3 ? 2 : 1) as Step)
              }
              className="btn-secondary rounded-[2px] px-5 py-2.5 font-mono text-sm font-semibold uppercase tracking-wider"
            >
              Back
            </button>
          ) : null}

          {step === 1 ? (
            <button
              type="button"
              onClick={() => {
                void handleCompile();
              }}
              disabled={isCompiling || !compileReady}
              className="btn-primary inline-flex items-center gap-2 rounded-[2px] px-5 py-2.5 font-mono text-sm font-semibold uppercase tracking-wider disabled:pointer-events-none disabled:opacity-40"
            >
              {isCompiling ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Generate contract
            </button>
          ) : null}

          {step === 2 && !isReviewQueued ? (
            <button
              type="button"
              onClick={() => setStep(3)}
              className="btn-primary rounded-[2px] px-5 py-2.5 font-mono text-sm font-semibold uppercase tracking-wider"
            >
              Continue to publish
            </button>
          ) : null}

          {step === 2 && isReviewQueued ? (
            <div className="rounded-[2px] border border-amber-300 bg-amber-50 px-4 py-2.5 font-mono text-xs font-bold uppercase tracking-wider text-amber-900">
              Awaiting review
            </div>
          ) : null}

          {step === 3 ? (
            <>
              {!isConnected ? (
                <button
                  type="button"
                  onClick={() => openConnectModal?.()}
                  className="btn-primary inline-flex items-center gap-2 rounded-[2px] px-5 py-2.5 font-mono text-sm font-semibold uppercase tracking-wider"
                >
                  <Wallet className="h-4 w-4" />
                  Connect wallet
                </button>
              ) : isWrongChain ? (
                <button
                  type="button"
                  onClick={() => openChainModal?.()}
                  className="btn-primary rounded-[2px] px-5 py-2.5 font-mono text-sm font-semibold uppercase tracking-wider"
                >
                  Switch to {APP_CHAIN_NAME}
                </button>
              ) : (
                <>
                  {fundingState.method === "approve" && !allowanceReady ? (
                    <button
                      type="button"
                      onClick={() => {
                        void handleApprove();
                      }}
                      disabled={isApproving}
                      className="btn-secondary inline-flex items-center gap-2 rounded-[2px] px-5 py-2.5 font-mono text-sm font-semibold uppercase tracking-wider disabled:pointer-events-none disabled:opacity-40"
                    >
                      {isApproving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : null}
                      Approve USDC
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      void handlePublish();
                    }}
                    disabled={
                      isPublishing ||
                      (fundingState.method === "approve" && !allowanceReady)
                    }
                    className="btn-primary inline-flex items-center gap-2 rounded-[2px] px-5 py-2.5 font-mono text-sm font-semibold uppercase tracking-wider disabled:pointer-events-none disabled:opacity-40"
                  >
                    {isPublishing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    Publish challenge
                  </button>
                </>
              )}
            </>
          ) : null}
        </div>
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
