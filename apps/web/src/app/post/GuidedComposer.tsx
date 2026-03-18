"use client";

import type { ClarificationQuestionOutput } from "@agora/common";
import { Check, CircleAlert, Loader2, Pencil, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { GUIDED_PROMPTS, GUIDED_PROMPT_ORDER } from "./guided-prompts";
import {
  type GuidedComposerState,
  type GuidedFieldKey,
  type UploadedArtifact,
  answerSummaryForPrompt,
  buildUploadHintCopy,
  clarificationHelperText,
  clarificationTargetFromQuestions,
  getFieldValue,
  getLastVisitedPromptIndex,
  getPromptStatus,
  readyUploadCount,
} from "./guided-state";
import { cx, truncateMiddle } from "./post-ui";

const STATUS_DOT: Record<string, string> = {
  ready: "bg-emerald-500",
  uploading: "bg-amber-400 animate-pulse",
  error: "bg-red-500",
};

function UploadEditor({
  uploads,
  onFilesSelected,
  onRenameUpload,
  onRemoveUpload,
  onConfirm,
  disabled,
}: {
  uploads: UploadedArtifact[];
  onFilesSelected: (files: FileList | null) => void;
  onRenameUpload: (id: string, fileName: string) => void;
  onRemoveUpload: (id: string) => void;
  onConfirm: () => void;
  disabled: boolean;
}) {
  const hints = buildUploadHintCopy();
  const [dragActive, setDragActive] = useState(false);

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) {
      return;
    }
    onFilesSelected(files);
  }

  return (
    <div className="space-y-4">
      <label
        className={cx(
          "flex cursor-pointer flex-col items-center justify-center rounded-[2px] border-2 border-dashed px-5 py-8 text-center transition motion-reduce:transition-none",
          dragActive
            ? "border-warm-900 bg-warm-50"
            : "border-warm-300 bg-white hover:border-warm-900",
        )}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          if (
            event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            return;
          }
          setDragActive(false);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!dragActive) {
            setDragActive(true);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          handleFiles(event.dataTransfer.files);
        }}
      >
        <Upload className="h-8 w-8 text-warm-500" />
        <div className="mt-3 text-sm font-semibold text-warm-900">
          Drop files here or click to upload
        </div>
        <div className="mt-1 text-xs text-warm-500">
          CSV, SDF, PDB, or other data files
        </div>
        <input
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            handleFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </label>

      {uploads.length > 0 ? (
        <div className="divide-y divide-warm-200 rounded-[2px] border border-warm-300 bg-white">
          {uploads.map((artifact) => (
            <div
              key={artifact.id}
              className="flex items-center gap-3 px-4 py-3"
            >
              <span
                className={cx(
                  "h-2 w-2 shrink-0 rounded-full",
                  STATUS_DOT[artifact.status] ?? "bg-warm-300",
                )}
              />
              <input
                value={artifact.file_name}
                onChange={(event) =>
                  onRenameUpload(artifact.id, event.target.value)
                }
                aria-label="File name"
                className="min-w-0 flex-1 bg-transparent text-sm text-warm-900 outline-none placeholder:text-warm-400"
                placeholder="file_name.csv"
              />
              {artifact.uri ? (
                <span className="shrink-0 font-mono text-[10px] text-warm-400">
                  {truncateMiddle(artifact.uri)}
                </span>
              ) : artifact.error ? (
                <span className="shrink-0 text-[10px] text-red-600">
                  {artifact.error}
                </span>
              ) : (
                <span className="shrink-0 text-[10px] text-warm-400">
                  Uploading...
                </span>
              )}
              <button
                type="button"
                aria-label={`Remove ${artifact.file_name || "file"}`}
                onClick={() => onRemoveUpload(artifact.id)}
                className="shrink-0 text-warm-400 transition hover:text-warm-900 motion-reduce:transition-none"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {uploads.some((artifact) => artifact.detected_columns?.length) ? (
        <div className="flex flex-wrap gap-1.5">
          {uploads
            .flatMap((artifact) => artifact.detected_columns ?? [])
            .slice(0, 8)
            .map((column) => (
              <span
                key={column}
                className="rounded-[2px] border border-warm-200 bg-warm-50 px-2 py-0.5 font-mono text-[10px] text-warm-700"
              >
                {column}
              </span>
            ))}
        </div>
      ) : null}

      <div className="rounded-[2px] border border-warm-300 bg-warm-50 px-4 py-3 text-xs leading-5 text-warm-600">
        Descriptive names help Agora map files during compile.{" "}
        {hints.map(({ hint, trailing }) => (
          <span key={hint}>
            <span className="font-mono text-warm-800">{hint}</span>
            {trailing}
          </span>
        ))}
      </div>

      <button
        type="button"
        onClick={onConfirm}
        disabled={disabled}
        className="btn-primary rounded-[2px] px-5 py-2.5 font-mono text-sm font-semibold uppercase tracking-wider disabled:pointer-events-none disabled:opacity-40"
      >
        Confirm files
      </button>
    </div>
  );
}

export function GuidedComposer({
  state,
  clarificationQuestions,
  isCompiling,
  onEditPrompt,
  onAnswerPrompt,
  onSkipOptionalPrompt,
  onFilesSelected,
  onRenameUpload,
  onRemoveUpload,
  onConfirmUploads,
}: {
  state: GuidedComposerState;
  clarificationQuestions: ClarificationQuestionOutput[];
  isCompiling: boolean;
  onEditPrompt: (field: Exclude<GuidedFieldKey, "title">) => void;
  onAnswerPrompt: (
    field: Exclude<GuidedFieldKey, "title" | "uploads">,
    value: string,
  ) => void;
  onSkipOptionalPrompt: (field: "solverInstructions") => void;
  onFilesSelected: (files: FileList | null) => void;
  onRenameUpload: (id: string, fileName: string) => void;
  onRemoveUpload: (id: string) => void;
  onConfirmUploads: () => void;
}) {
  const activePromptId = state.activePromptId;
  const lastVisitedIndex = getLastVisitedPromptIndex(state);
  const activePromptIndex = activePromptId
    ? GUIDED_PROMPT_ORDER.indexOf(activePromptId)
    : lastVisitedIndex;
  const clarificationTarget = useMemo(
    () =>
      clarificationQuestions.length > 0
        ? clarificationTargetFromQuestions(clarificationQuestions)
        : null,
    [clarificationQuestions],
  );
  const activeClarifications = useMemo(
    () =>
      clarificationTarget && clarificationTarget === activePromptId
        ? clarificationQuestions
        : [],
    [activePromptId, clarificationQuestions, clarificationTarget],
  );
  const promptRefs = useRef<
    Partial<Record<Exclude<GuidedFieldKey, "title">, HTMLDivElement | null>>
  >({});
  const [draftValue, setDraftValue] = useState("");
  const activePromptValue =
    activePromptId && activePromptId !== "uploads"
      ? (getFieldValue(state, activePromptId) ??
        (activePromptId === "distribution"
          ? "winner_take_all"
          : activePromptId === "deadline"
            ? "7"
            : activePromptId === "disputeWindow"
              ? "168"
              : ""))
      : "";

  useEffect(() => {
    if (!activePromptId || activePromptId === "uploads") {
      return;
    }
    setDraftValue(activePromptValue);
  }, [activePromptId, activePromptValue]);

  useEffect(() => {
    if (!activePromptId) {
      return;
    }
    promptRefs.current[activePromptId]?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [activePromptId]);

  const answeredCount = GUIDED_PROMPT_ORDER.filter((id) => {
    const s = getPromptStatus(state, id);
    return (
      s === "locked" ||
      s === "suggested" ||
      (id === "uploads" && state.uploads.length > 0)
    );
  }).length;

  return (
    <div className="space-y-3">
      {/* Progress bar */}
      <div className="flex items-center gap-3">
        <div className="h-1.5 flex-1 rounded-full bg-warm-200">
          <div
            className="h-1.5 rounded-full bg-warm-900 transition-all duration-500"
            style={{
              width: `${(answeredCount / GUIDED_PROMPT_ORDER.length) * 100}%`,
            }}
          />
        </div>
        <span className="shrink-0 font-mono text-[10px] font-bold tracking-wider text-warm-400">
          {answeredCount}/{GUIDED_PROMPT_ORDER.length}
        </span>
      </div>

      {GUIDED_PROMPT_ORDER.map((promptId, index) => {
        if (index > lastVisitedIndex && promptId !== activePromptId) {
          return null;
        }

        const prompt = GUIDED_PROMPTS[promptId];
        const status = getPromptStatus(state, promptId);
        const isActive = promptId === activePromptId;
        const answer = answerSummaryForPrompt(state, promptId);
        const dimmed = activePromptIndex >= 0 && index > activePromptIndex;
        const submitDisabled =
          prompt.inputKind !== "select" && draftValue.trim().length === 0;
        const hasAnswer =
          status === "locked" ||
          status === "suggested" ||
          (promptId === "uploads" && state.uploads.length > 0);

        if (hasAnswer && !isActive) {
          return (
            <div
              key={promptId}
              ref={(node) => {
                promptRefs.current[promptId] = node;
              }}
              className={cx(
                "flex items-center gap-3 rounded-[2px] border border-warm-300 bg-white px-4 py-3",
                dimmed && "opacity-40",
              )}
            >
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[2px] bg-emerald-600 text-white">
                <Check className="h-3.5 w-3.5" strokeWidth={3} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-warm-500">
                  {prompt.prompt}
                </div>
                <div className="mt-0.5 truncate text-sm text-warm-900">
                  {answer}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onEditPrompt(promptId)}
                className="inline-flex shrink-0 items-center gap-1 rounded-[2px] border border-warm-300 bg-white px-2.5 py-1 text-xs font-medium text-warm-700 transition hover:border-warm-900 hover:text-warm-900 motion-reduce:transition-none"
              >
                <Pencil className="h-3 w-3" />
                Edit
              </button>
            </div>
          );
        }

        if (isActive) {
          return (
            <div
              key={promptId}
              ref={(node) => {
                promptRefs.current[promptId] = node;
              }}
              className="rounded-[2px] border-2 border-warm-900 bg-white p-5 shadow-[4px_4px_0px_var(--color-warm-900)]"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[2px] bg-warm-900 font-mono text-xs font-bold text-white">
                  {index + 1}
                </div>
                <h3 className="font-display text-lg font-semibold tracking-tight text-warm-900">
                  {prompt.prompt}
                </h3>
              </div>

              {prompt.helper ? (
                <p className="ml-10 mt-2 text-sm text-warm-600">
                  {prompt.helper}
                </p>
              ) : null}

              {activeClarifications.length > 0 ? (
                <div className="ml-10 mt-4 rounded-[2px] border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <div className="font-semibold">
                    {clarificationHelperText(clarificationTarget ?? "problem")}
                  </div>
                  <div className="mt-2 space-y-2">
                    {activeClarifications.map((question) => (
                      <div key={question.id}>
                        <div className="font-medium text-warm-900">
                          {question.prompt}
                        </div>
                        <div className="mt-0.5 text-warm-700">
                          {question.next_step}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="ml-10 mt-4">
                {prompt.inputKind === "file" ? (
                  <UploadEditor
                    uploads={state.uploads}
                    onFilesSelected={onFilesSelected}
                    onRenameUpload={onRenameUpload}
                    onRemoveUpload={onRemoveUpload}
                    onConfirm={onConfirmUploads}
                    disabled={
                      readyUploadCount(state) === 0 ||
                      state.uploads.some(
                        (artifact) => artifact.status === "uploading",
                      )
                    }
                  />
                ) : (
                  <form
                    className="space-y-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (promptId === "uploads") {
                        return;
                      }
                      const normalizedValue =
                        prompt.inputKind === "select"
                          ? draftValue
                          : draftValue.trim();
                      if (!normalizedValue) {
                        return;
                      }
                      onAnswerPrompt(promptId, normalizedValue);
                    }}
                  >
                    {prompt.inputKind === "textarea" ? (
                      <textarea
                        value={draftValue}
                        onChange={(event) => setDraftValue(event.target.value)}
                        rows={4}
                        aria-label={prompt.prompt}
                        placeholder={prompt.placeholder}
                        className="w-full rounded-[2px] border border-warm-300 bg-white px-4 py-3 text-sm text-warm-900 outline-none transition focus:border-warm-900 focus:shadow-[2px_2px_0px_var(--color-warm-900)] motion-reduce:transition-none"
                      />
                    ) : prompt.inputKind === "currency" ? (
                      <div className="flex items-center gap-2">
                        <input
                          value={draftValue}
                          onChange={(event) =>
                            setDraftValue(event.target.value)
                          }
                          inputMode="decimal"
                          aria-label={prompt.prompt}
                          placeholder={prompt.placeholder}
                          className="w-full rounded-[2px] border border-warm-300 bg-white px-4 py-3 text-sm text-warm-900 outline-none transition focus:border-warm-900 focus:shadow-[2px_2px_0px_var(--color-warm-900)] motion-reduce:transition-none"
                        />
                        <span className="shrink-0 font-mono text-sm font-bold text-warm-500">
                          USDC
                        </span>
                      </div>
                    ) : prompt.inputKind === "date" ? (
                      <input
                        type="datetime-local"
                        value={draftValue}
                        onChange={(event) => setDraftValue(event.target.value)}
                        aria-label={prompt.prompt}
                        className="w-full rounded-[2px] border border-warm-300 bg-white px-4 py-3 text-sm text-warm-900 outline-none transition focus:border-warm-900 focus:shadow-[2px_2px_0px_var(--color-warm-900)] motion-reduce:transition-none"
                      />
                    ) : prompt.inputKind === "select" ? (
                      <div
                        className="flex flex-wrap gap-2"
                        aria-label={prompt.prompt}
                      >
                        {(prompt.options ?? []).map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            aria-pressed={draftValue === option.value}
                            onClick={() => setDraftValue(option.value)}
                            className={cx(
                              "rounded-[2px] border px-4 py-2.5 text-sm font-medium transition motion-reduce:transition-none",
                              draftValue === option.value
                                ? "border-warm-900 bg-warm-900 text-white shadow-[2px_2px_0px_var(--color-warm-900)]"
                                : "border-warm-300 bg-white text-warm-700 hover:border-warm-900",
                            )}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <input
                        value={draftValue}
                        onChange={(event) => setDraftValue(event.target.value)}
                        aria-label={prompt.prompt}
                        placeholder={prompt.placeholder}
                        className="w-full rounded-[2px] border border-warm-300 bg-white px-4 py-3 text-sm text-warm-900 outline-none transition focus:border-warm-900 focus:shadow-[2px_2px_0px_var(--color-warm-900)] motion-reduce:transition-none"
                      />
                    )}

                    {prompt.optional ? (
                      <div className="text-xs text-warm-500">
                        Optional — you can skip this and still compile.
                      </div>
                    ) : null}

                    <div className="flex flex-wrap gap-3">
                      <button
                        type="submit"
                        disabled={submitDisabled}
                        className="btn-primary rounded-[2px] px-6 py-2.5 font-mono text-sm font-semibold uppercase tracking-wider disabled:pointer-events-none disabled:opacity-40"
                      >
                        Continue
                      </button>
                      {prompt.canSkip ? (
                        <button
                          type="button"
                          onClick={() =>
                            onSkipOptionalPrompt("solverInstructions")
                          }
                          className="btn-secondary rounded-[2px] px-5 py-2.5 font-mono text-sm font-semibold uppercase tracking-wider"
                        >
                          Skip
                        </button>
                      ) : null}
                    </div>
                  </form>
                )}
              </div>
            </div>
          );
        }

        return null;
      })}

      {!state.activePromptId ? (
        <div className="rounded-[2px] border-2 border-emerald-600 bg-emerald-50 p-5 shadow-[4px_4px_0px_var(--color-emerald-600)]">
          <div className="flex items-center gap-3">
            {isCompiling ? (
              <Loader2 className="h-5 w-5 animate-spin text-emerald-700" />
            ) : (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[2px] bg-emerald-600 text-white">
                <Check className="h-4 w-4" strokeWidth={3} />
              </div>
            )}
            <div>
              <div className="font-display text-base font-semibold tracking-tight text-emerald-900">
                All answers locked
              </div>
              <div className="mt-0.5 text-sm text-emerald-700">
                {isCompiling
                  ? "Compiling your challenge into a scoring contract..."
                  : "Generate the review contract when you are ready."}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {state.compileState === "needs_review" ? (
        <div className="rounded-[2px] border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Agora compiled a contract, but an operator must review it before you
          can publish.
        </div>
      ) : null}

      {state.compileState === "ready" ? (
        <div className="rounded-[2px] border border-emerald-400 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Contract locked. Continue to review before funding.
        </div>
      ) : null}

      {state.compileState === "needs_clarification" &&
      clarificationQuestions.length === 0 ? (
        <div className="rounded-[2px] border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Agora needs more context before it can lock the contract.
        </div>
      ) : null}

      {state.uploads.some((artifact) => artifact.status === "error") ? (
        <div className="flex items-center gap-2 rounded-[2px] border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          <CircleAlert className="h-4 w-4 shrink-0" />
          One or more uploads failed. Remove and re-upload before compile.
        </div>
      ) : null}
    </div>
  );
}
