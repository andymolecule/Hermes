"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type { PostStep } from "./PostSections";
import {
  type GuidedCompileState,
  type GuidedFieldKey,
  type UploadedArtifact,
  buildManagedIntentFromGuidedState,
  clearGuidedDraft,
  createInitialGuidedState,
  guidedComposerReducer,
  hydrateGuidedStateFromAuthoringDraft,
  isReadyToCompile,
  listReadinessIssues,
  loadGuidedDraft,
  questionTargetFromQuestions,
  saveGuidedDraft,
} from "./guided-state";
import {
  clearCompiledSessionData,
  getAuthoringSession,
  getAuthoringSessionRequestStatus,
  getCompilation,
  pinAuthoringFile,
  submitAuthoringSession,
} from "./post-authoring-api";

type Step = PostStep;

export function usePostAuthoringWorkflow(input: {
  hostedDraftId: string | null;
  posterAddress?: `0x${string}`;
  persistDraft?: boolean;
  onRemoteDraftCleared?: () => void;
}) {
  const { hostedDraftId, onRemoteDraftCleared, persistDraft, posterAddress } =
    input;
  const [step, setStep] = useState<Step>(1);
  const [guidedState, dispatch] = useReducer(
    guidedComposerReducer,
    undefined,
    () => createInitialGuidedState(),
  );
  const [session, setSession] = useState<Awaited<
    ReturnType<typeof getAuthoringSession>
  > | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCompiling, setIsCompiling] = useState(false);

  const guidedStateRef = useRef(guidedState);
  useEffect(() => {
    guidedStateRef.current = guidedState;
  }, [guidedState]);

  const isHostedDraftFlow = hostedDraftId !== null;
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
  const questions = session?.questions ?? [];

  const dispatchCompileState = useCallback(
    (compileState: GuidedCompileState) => {
      dispatch({ type: "set_compile_state", compileState });
    },
    [],
  );

  const clearRemoteAuthoringDraft = useCallback(
    (message: string) => {
      onRemoteDraftCleared?.();
      setSession(null);
      dispatch({ type: "set_draft_id", draftId: null });
      dispatchCompileState(
        isReadyToCompile(guidedStateRef.current) ? "ready_to_compile" : "idle",
      );
      setStatusMessage(null);
      setErrorMessage(message);
      setStep(1);
    },
    [dispatchCompileState, onRemoteDraftCleared],
  );

  const resetInterviewForEdit = useCallback(() => {
    setStep(1);
    setStatusMessage(null);
    setErrorMessage(null);
    setSession((current) => clearCompiledSessionData(current));
  }, []);

  useEffect(() => {
    if (isHostedDraftFlow) {
      return;
    }
    const restored = loadGuidedDraft();
    if (restored) {
      dispatch({ type: "hydrate", state: restored });
    }
  }, [isHostedDraftFlow]);

  useEffect(() => {
    if (isHostedDraftFlow || persistDraft === false) {
      return;
    }
    saveGuidedDraft(guidedState);
  }, [guidedState, isHostedDraftFlow, persistDraft]);

  useEffect(() => {
    const restoreDraftId = hostedDraftId ?? guidedState.draftId;
    if (!restoreDraftId || session?.id === restoreDraftId) {
      return;
    }

    let cancelled = false;

    void getAuthoringSession(restoreDraftId)
      .then((restoredSession) => {
        if (cancelled) {
          return;
        }
        setSession(restoredSession);
        dispatch({ type: "set_draft_id", draftId: restoredSession.id });
        if (hostedDraftId) {
          dispatch({
            type: "hydrate",
            state: hydrateGuidedStateFromAuthoringDraft(restoredSession),
          });
        }
        if (restoredSession.state === "publishable") {
          dispatch({ type: "set_compile_state", compileState: "ready" });
          setStep(2);
        } else if (restoredSession.state === "awaiting_input") {
          dispatch({
            type: "apply_questions",
            field: questionTargetFromQuestions(restoredSession.questions ?? []),
          });
          setStep(1);
        } else if (restoredSession.state === "published") {
          dispatch({ type: "set_compile_state", compileState: "ready" });
          setStep(3);
          setStatusMessage(
            "This session was already pinned and is ready for on-chain publish confirmation.",
          );
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        clearRemoteAuthoringDraft(
          getAuthoringSessionRequestStatus(error) === 404
            ? hostedDraftId
              ? "This linked session is no longer available. Next step: reopen the host workflow and create a fresh handoff."
              : "Your saved compiled session expired. Next step: regenerate it from your session answers."
            : hostedDraftId
              ? "Could not restore the linked session. Next step: reopen the host workflow and try the publish handoff again."
              : "Could not restore the saved compiled session. Next step: regenerate it from your session answers.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [
    clearRemoteAuthoringDraft,
    guidedState.draftId,
    hostedDraftId,
    session?.id,
  ]);

  const handlePromptAnswer = useCallback(
    (field: Exclude<GuidedFieldKey, "title" | "uploads">, value: string) => {
      if (value.trim().length === 0) {
        return;
      }
      resetInterviewForEdit();
      dispatch({ type: "answer_prompt", field, value });
    },
    [resetInterviewForEdit],
  );

  const handleSkipOptionalPrompt = useCallback(
    (field: "solverInstructions") => {
      resetInterviewForEdit();
      dispatch({ type: "skip_optional_prompt", field });
    },
    [resetInterviewForEdit],
  );

  const handleEditPrompt = useCallback(
    (field: Exclude<GuidedFieldKey, "title">) => {
      resetInterviewForEdit();
      dispatch({ type: "edit_prompt", field });
    },
    [resetInterviewForEdit],
  );

  const handleTitleChange = useCallback(
    (value: string) => {
      resetInterviewForEdit();
      dispatch({ type: "set_title", value });
    },
    [resetInterviewForEdit],
  );

  const updateUploads = useCallback(
    (nextUploads: UploadedArtifact[]) => {
      resetInterviewForEdit();
      dispatch({ type: "set_uploads", uploads: nextUploads });
    },
    [resetInterviewForEdit],
  );

  const handleFilesSelected = useCallback(
    async (files: FileList | null) => {
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
          const pinResult = await pinAuthoringFile(file);
          updateUploads(
            guidedStateRef.current.uploads.map((artifact) =>
              artifact.id === localId
                ? {
                    ...artifact,
                    id: pinResult.id ?? artifact.id,
                    uri: pinResult.uri,
                    detected_columns: pinResult.detected_columns,
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
    },
    [updateUploads],
  );

  const handleRenameUpload = useCallback(
    (id: string, fileName: string) => {
      updateUploads(
        guidedStateRef.current.uploads.map((artifact) =>
          artifact.id === id ? { ...artifact, file_name: fileName } : artifact,
        ),
      );
    },
    [updateUploads],
  );

  const handleRemoveUpload = useCallback(
    (id: string) => {
      updateUploads(
        guidedStateRef.current.uploads.filter((artifact) => artifact.id !== id),
      );
    },
    [updateUploads],
  );

  const handleConfirmUploads = useCallback(() => {
    resetInterviewForEdit();
    dispatch({ type: "confirm_uploads" });
  }, [resetInterviewForEdit]);

  const handleCompile = useCallback(async () => {
    if (!compileReady) {
      setErrorMessage(
        `This session is not ready to compile yet. Next step: ${draftIssues[0]}`,
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

      const compiledSession = await submitAuthoringSession({
        sessionId: guidedStateRef.current.draftId ?? undefined,
        posterAddress,
        intent: managedIntent,
        uploads: guidedStateRef.current.uploads,
      });
      setSession(compiledSession);
      dispatch({ type: "set_draft_id", draftId: compiledSession.id });

      if (compiledSession.state === "awaiting_input") {
        dispatch({
          type: "apply_questions",
          field: questionTargetFromQuestions(compiledSession.questions ?? []),
        });
        setStep(1);
        setStatusMessage(
          "Agora needs a little more context before it can lock the challenge contract.",
        );
      } else if (compiledSession.state === "rejected") {
        dispatchCompileState(compileReady ? "ready_to_compile" : "idle");
        setStep(1);
        setStatusMessage(null);
        setErrorMessage(
          compiledSession.reasons[0] ??
            "Agora could not compile this challenge into a supported Gems contract.",
        );
      } else {
        dispatchCompileState("ready");
        setStep(2);
        setStatusMessage(
          "Agora mapped your files, chose a managed runtime, and prepared a publishable contract.",
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
  }, [
    compileReady,
    dispatchCompileState,
    draftIssues,
    managedIntent,
    posterAddress,
  ]);

  const handleRefreshCompiledDeadline = useCallback(() => {
    resetInterviewForEdit();
    dispatch({ type: "edit_prompt", field: "deadline" });
    setStatusMessage(
      "Submission window unlocked. Reconfirm the deadline and regenerate the contract.",
    );
  }, [resetInterviewForEdit]);

  const clearPersistedDraft = useCallback(() => {
    if (!isHostedDraftFlow) {
      clearGuidedDraft();
    }
  }, [isHostedDraftFlow]);

  return {
    step,
    setStep,
    guidedState,
    dispatch,
    managedIntent,
    session,
    setSession,
    compilation,
    questions,
    compileReady,
    draftIssues,
    isCompiling,
    statusMessage,
    setStatusMessage,
    errorMessage,
    setErrorMessage,
    isHostedDraftFlow,
    handlePromptAnswer,
    handleSkipOptionalPrompt,
    handleEditPrompt,
    handleTitleChange,
    handleFilesSelected,
    handleRenameUpload,
    handleRemoveUpload,
    handleConfirmUploads,
    handleCompile,
    handleRefreshCompiledDeadline,
    clearPersistedDraft,
  };
}
