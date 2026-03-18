"use client";

import type { ClarificationQuestionOutput } from "@agora/common";
import { GUIDED_PROMPTS, GUIDED_PROMPT_ORDER } from "./guided-prompts";

export type UploadStatus = "uploading" | "ready" | "error";

export type UploadedArtifact = {
  id: string;
  uri?: string;
  file_name: string;
  mime_type?: string;
  size_bytes?: number;
  detected_columns?: string[];
  status: UploadStatus;
  error?: string;
};

export type InputKind =
  | "textarea"
  | "file"
  | "currency"
  | "select"
  | "date"
  | "text";

export type GuidedFieldKey =
  | "problem"
  | "title"
  | "uploads"
  | "winningCondition"
  | "rewardTotal"
  | "distribution"
  | "deadline"
  | "solverInstructions";

export type GuidedFieldStatus = "empty" | "collecting" | "suggested" | "locked";

export type GuidedDraftField<T> = {
  value: T | null;
  status: GuidedFieldStatus;
  source?: "user" | "system" | "compile";
};

export type GuidedPromptConfig = {
  id: GuidedFieldKey;
  prompt: string;
  inputKind: InputKind;
  optional?: boolean;
  canSkip?: boolean;
};

export type GuidedConversationMessage = {
  id: string;
  role: "assistant" | "user" | "system";
  content: string;
  targetFields?: GuidedFieldKey[];
  inputKind?: InputKind;
  inputOptions?: { label: string; value: string }[];
  state?: "pending" | "answered" | "editing";
};

export type GuidedCompileState =
  | "idle"
  | "ready_to_compile"
  | "compiling"
  | "needs_clarification"
  | "needs_review"
  | "ready";

export type GuidedComposerState = {
  fields: {
    problem: GuidedDraftField<string>;
    title: GuidedDraftField<string>;
    winningCondition: GuidedDraftField<string>;
    rewardTotal: GuidedDraftField<string>;
    distribution: GuidedDraftField<
      "winner_take_all" | "top_3" | "proportional"
    >;
    deadline: GuidedDraftField<string>;
    solverInstructions: GuidedDraftField<string>;
  };
  uploads: UploadedArtifact[];
  uploadsStatus: GuidedFieldStatus;
  transcript: GuidedConversationMessage[];
  activePromptId: Exclude<GuidedFieldKey, "title"> | null;
  compileState: GuidedCompileState;
  sessionId: string | null;
  timezone: string;
};

export type ManagedIntentState = {
  title: string;
  description: string;
  payoutCondition: string;
  rewardTotal: string;
  distribution: "winner_take_all" | "top_3" | "proportional";
  deadline: string;
  domain: string;
  tags: string;
  solverInstructions: string;
  timezone: string;
};

type GuidedNonUploadPromptKey = Exclude<GuidedFieldKey, "title" | "uploads">;

type GuidedAnswerAction =
  | {
      type: "answer_prompt";
      field: GuidedNonUploadPromptKey;
      value: string | "winner_take_all" | "top_3" | "proportional";
    }
  | {
      type: "skip_optional_prompt";
      field: "solverInstructions";
    }
  | {
      type: "edit_prompt";
      field: Exclude<GuidedFieldKey, "title">;
    }
  | {
      type: "set_title";
      value: string;
    }
  | {
      type: "set_uploads";
      uploads: UploadedArtifact[];
    }
  | {
      type: "confirm_uploads";
    }
  | {
      type: "set_compile_state";
      compileState: GuidedCompileState;
    }
  | {
      type: "set_session_id";
      sessionId: string | null;
    }
  | {
      type: "apply_clarification";
      field: Exclude<GuidedFieldKey, "title">;
    }
  | {
      type: "hydrate";
      state: GuidedComposerState;
    }
  | {
      type: "reset";
      timezone?: string;
    };

const STORAGE_KEY = "agora-post-guided-draft";

const REQUIRED_PROMPTS = [
  "problem",
  "uploads",
  "winningCondition",
  "rewardTotal",
  "distribution",
  "deadline",
] as const satisfies readonly Exclude<
  GuidedFieldKey,
  "title" | "solverInstructions"
>[];

const UPLOAD_HINTS = [
  "train.csv",
  "hidden_labels.csv",
  "evaluation_features.csv",
  "reference_output.csv",
];

export const GUIDED_STORAGE_KEY = STORAGE_KEY;

function defaultDeadline(now = Date.now()) {
  const nextWeek = new Date(now + 7 * 24 * 60 * 60 * 1000);
  nextWeek.setMinutes(nextWeek.getMinutes() - nextWeek.getTimezoneOffset());
  return nextWeek.toISOString().slice(0, 16);
}

export function resolveBrowserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function hasTextValue(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}

function promptIndex(field: Exclude<GuidedFieldKey, "title">) {
  return GUIDED_PROMPT_ORDER.indexOf(field);
}

export function getPromptStatus(
  state: GuidedComposerState,
  field: Exclude<GuidedFieldKey, "title">,
): GuidedFieldStatus {
  if (field === "uploads") {
    return state.uploadsStatus;
  }

  switch (field) {
    case "problem":
      return state.fields.problem.status;
    case "winningCondition":
      return state.fields.winningCondition.status;
    case "rewardTotal":
      return state.fields.rewardTotal.status;
    case "distribution":
      return state.fields.distribution.status;
    case "deadline":
      return state.fields.deadline.status;
    case "solverInstructions":
      return state.fields.solverInstructions.status;
  }
}

function setPromptStatus(
  state: GuidedComposerState,
  field: Exclude<GuidedFieldKey, "title">,
  status: GuidedFieldStatus,
) {
  if (field === "uploads") {
    state.uploadsStatus = status;
    return;
  }

  switch (field) {
    case "problem":
      state.fields.problem.status = status;
      return;
    case "winningCondition":
      state.fields.winningCondition.status = status;
      return;
    case "rewardTotal":
      state.fields.rewardTotal.status = status;
      return;
    case "distribution":
      state.fields.distribution.status = status;
      return;
    case "deadline":
      state.fields.deadline.status = status;
      return;
    case "solverInstructions":
      state.fields.solverInstructions.status = status;
      return;
  }
}

export function answerSummaryForPrompt(
  state: GuidedComposerState,
  field: Exclude<GuidedFieldKey, "title">,
) {
  if (field === "uploads") {
    const readyUploads = state.uploads.filter(
      (artifact) => artifact.status === "ready",
    );
    if (readyUploads.length === 0) {
      return "No files confirmed yet.";
    }

    return readyUploads
      .map((artifact) => artifact.file_name.trim())
      .filter(Boolean)
      .join(", ");
  }

  switch (field) {
    case "problem":
      return state.fields.problem.value?.trim() ?? "";
    case "winningCondition":
      return state.fields.winningCondition.value?.trim() ?? "";
    case "rewardTotal":
      return hasTextValue(state.fields.rewardTotal.value)
        ? `${state.fields.rewardTotal.value?.trim()} USDC`
        : "";
    case "distribution":
      switch (state.fields.distribution.value) {
        case "winner_take_all":
          return "Winner takes all";
        case "top_3":
          return "Top 3 split";
        case "proportional":
          return "Proportional";
        default:
          return "";
      }
    case "deadline":
      return state.fields.deadline.value?.trim() ?? "";
    case "solverInstructions":
      return hasTextValue(state.fields.solverInstructions.value)
        ? (state.fields.solverInstructions.value?.trim() ?? "")
        : "No extra solver instructions.";
  }
}

export function getLastVisitedPromptIndex(state: GuidedComposerState) {
  let index = state.activePromptId ? promptIndex(state.activePromptId) : -1;
  for (const promptId of GUIDED_PROMPT_ORDER) {
    const status = getPromptStatus(state, promptId);
    if (status !== "empty") {
      index = Math.max(index, promptIndex(promptId));
    }
  }
  return index;
}

function rebuildTranscript(
  state: GuidedComposerState,
): GuidedConversationMessage[] {
  const lastVisitedPromptIndex = getLastVisitedPromptIndex(state);
  const transcript: GuidedConversationMessage[] = [];

  for (const promptId of GUIDED_PROMPT_ORDER) {
    const currentPromptIndex = promptIndex(promptId);
    if (
      currentPromptIndex > lastVisitedPromptIndex &&
      state.activePromptId !== promptId
    ) {
      continue;
    }

    const prompt = GUIDED_PROMPTS[promptId];
    const status = getPromptStatus(state, promptId);
    const isActive = state.activePromptId === promptId;
    transcript.push({
      id: `assistant:${promptId}`,
      role: "assistant",
      content: prompt.prompt,
      targetFields: [promptId],
      inputKind: prompt.inputKind,
      inputOptions: "options" in prompt ? prompt.options : undefined,
      state: isActive ? "pending" : "answered",
    });

    if (
      status === "locked" ||
      status === "suggested" ||
      (isActive && answerSummaryForPrompt(state, promptId))
    ) {
      transcript.push({
        id: `user:${promptId}`,
        role: "user",
        content: answerSummaryForPrompt(state, promptId),
        targetFields: [promptId],
        state: isActive ? "editing" : "answered",
      });
    }
  }

  return transcript;
}

function nextIncompletePrompt(
  state: GuidedComposerState,
  startIndex = 0,
): Exclude<GuidedFieldKey, "title"> | null {
  for (const promptId of GUIDED_PROMPT_ORDER.slice(startIndex)) {
    if (getPromptStatus(state, promptId) !== "locked") {
      return promptId;
    }
  }
  return null;
}

function trimText(value: string | null | undefined) {
  return value?.trim() ?? "";
}

export function buildSuggestedTitle(problem: string) {
  const normalized = problem.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  const firstSentence = normalized.split(/(?<=[.!?])\s+/)[0] ?? normalized;
  const cleaned = firstSentence.replace(/[.!?]+$/, "").trim();
  return cleaned.slice(0, 160);
}

function cloneState(state: GuidedComposerState): GuidedComposerState {
  return {
    ...state,
    fields: {
      problem: { ...state.fields.problem },
      title: { ...state.fields.title },
      winningCondition: { ...state.fields.winningCondition },
      rewardTotal: { ...state.fields.rewardTotal },
      distribution: { ...state.fields.distribution },
      deadline: { ...state.fields.deadline },
      solverInstructions: { ...state.fields.solverInstructions },
    },
    uploads: state.uploads.map((artifact) => ({ ...artifact })),
    transcript: state.transcript.map((message) => ({
      ...message,
      targetFields: message.targetFields
        ? [...message.targetFields]
        : undefined,
      inputOptions: message.inputOptions
        ? message.inputOptions.map((option) => ({ ...option }))
        : undefined,
    })),
  };
}

function updateCompileReadiness(state: GuidedComposerState) {
  if (state.compileState === "compiling") {
    return;
  }

  state.compileState = isReadyToCompile(state) ? "ready_to_compile" : "idle";
}

function invalidateFromPrompt(
  state: GuidedComposerState,
  field: Exclude<GuidedFieldKey, "title">,
) {
  const currentIndex = promptIndex(field);
  state.activePromptId = field;
  setPromptStatus(state, field, "collecting");

  for (const downstreamField of GUIDED_PROMPT_ORDER.slice(currentIndex + 1)) {
    if (downstreamField === "uploads") {
      state.uploadsStatus = state.uploads.length > 0 ? "suggested" : "empty";
      continue;
    }

    const value = getFieldValue(state, downstreamField);
    setPromptStatus(
      state,
      downstreamField,
      hasTextValue(
        typeof value === "string" ? value : value ? String(value) : undefined,
      )
        ? "suggested"
        : "empty",
    );
  }

  updateCompileReadiness(state);
}

export function getFieldValue(
  state: GuidedComposerState,
  field: Exclude<GuidedFieldKey, "title" | "uploads">,
) {
  switch (field) {
    case "problem":
      return state.fields.problem.value;
    case "winningCondition":
      return state.fields.winningCondition.value;
    case "rewardTotal":
      return state.fields.rewardTotal.value;
    case "distribution":
      return state.fields.distribution.value;
    case "deadline":
      return state.fields.deadline.value;
    case "solverInstructions":
      return state.fields.solverInstructions.value;
  }
}

function setFieldValue(
  state: GuidedComposerState,
  field: GuidedNonUploadPromptKey,
  value: string | "winner_take_all" | "top_3" | "proportional",
  status: GuidedFieldStatus,
  source: "user" | "system" | "compile" = "user",
) {
  switch (field) {
    case "problem":
      state.fields.problem = {
        value: String(value),
        status,
        source,
      };
      if (state.fields.title.source !== "user") {
        const suggestion = buildSuggestedTitle(String(value));
        state.fields.title = {
          value: suggestion,
          status: suggestion ? "suggested" : "empty",
          source: suggestion ? "system" : undefined,
        };
      }
      return;
    case "winningCondition":
      state.fields.winningCondition = {
        value: String(value),
        status,
        source,
      };
      return;
    case "rewardTotal":
      state.fields.rewardTotal = {
        value: String(value),
        status,
        source,
      };
      return;
    case "distribution":
      state.fields.distribution = {
        value: value as "winner_take_all" | "top_3" | "proportional",
        status,
        source,
      };
      return;
    case "deadline":
      state.fields.deadline = {
        value: String(value),
        status,
        source,
      };
      return;
    case "solverInstructions":
      state.fields.solverInstructions = {
        value: String(value),
        status,
        source,
      };
      return;
  }
}

function finalizeState(state: GuidedComposerState) {
  state.transcript = rebuildTranscript(state);
  return state;
}

export function createInitialGuidedState(
  timezone = resolveBrowserTimezone(),
  now = Date.now(),
): GuidedComposerState {
  return finalizeState({
    fields: {
      problem: { value: null, status: "collecting" },
      title: { value: null, status: "empty" },
      winningCondition: { value: null, status: "empty" },
      rewardTotal: { value: "500", status: "suggested", source: "system" },
      distribution: {
        value: "winner_take_all",
        status: "suggested",
        source: "system",
      },
      deadline: {
        value: defaultDeadline(now),
        status: "suggested",
        source: "system",
      },
      solverInstructions: { value: null, status: "empty" },
    },
    uploads: [],
    uploadsStatus: "empty",
    transcript: [],
    activePromptId: "problem",
    compileState: "idle",
    sessionId: null,
    timezone,
  });
}

export function guidedComposerReducer(
  state: GuidedComposerState,
  action: GuidedAnswerAction,
) {
  if (action.type === "hydrate") {
    return finalizeState(cloneState(action.state));
  }

  if (action.type === "reset") {
    return createInitialGuidedState(action.timezone ?? state.timezone);
  }

  const nextState = cloneState(state);

  switch (action.type) {
    case "answer_prompt": {
      setFieldValue(nextState, action.field, action.value, "locked");
      const nextPrompt = nextIncompletePrompt(
        nextState,
        promptIndex(action.field) + 1,
      );
      nextState.activePromptId = nextPrompt;
      updateCompileReadiness(nextState);
      return finalizeState(nextState);
    }
    case "skip_optional_prompt": {
      setFieldValue(nextState, "solverInstructions", "", "locked");
      nextState.activePromptId = null;
      updateCompileReadiness(nextState);
      return finalizeState(nextState);
    }
    case "edit_prompt": {
      invalidateFromPrompt(nextState, action.field);
      return finalizeState(nextState);
    }
    case "set_title": {
      nextState.fields.title = {
        value: action.value,
        status: hasTextValue(action.value) ? "locked" : "empty",
        source: hasTextValue(action.value) ? "user" : undefined,
      };
      updateCompileReadiness(nextState);
      return finalizeState(nextState);
    }
    case "set_uploads": {
      nextState.uploads = action.uploads;
      if (nextState.activePromptId !== "uploads") {
        nextState.activePromptId = "uploads";
      }
      nextState.uploadsStatus =
        action.uploads.length > 0 ? "collecting" : "empty";
      updateCompileReadiness(nextState);
      return finalizeState(nextState);
    }
    case "confirm_uploads": {
      nextState.uploadsStatus =
        nextState.uploads.length > 0 ? "locked" : "empty";
      const nextPrompt = nextIncompletePrompt(
        nextState,
        promptIndex("uploads") + 1,
      );
      nextState.activePromptId = nextPrompt;
      updateCompileReadiness(nextState);
      return finalizeState(nextState);
    }
    case "set_compile_state": {
      nextState.compileState = action.compileState;
      return finalizeState(nextState);
    }
    case "set_session_id": {
      nextState.sessionId = action.sessionId;
      return finalizeState(nextState);
    }
    case "apply_clarification": {
      invalidateFromPrompt(nextState, action.field);
      nextState.compileState = "needs_clarification";
      return finalizeState(nextState);
    }
  }
}

export function buildManagedIntentFromGuidedState(
  state: GuidedComposerState,
): ManagedIntentState {
  return {
    title:
      trimText(state.fields.title.value) ||
      buildSuggestedTitle(trimText(state.fields.problem.value)),
    description: trimText(state.fields.problem.value),
    payoutCondition: trimText(state.fields.winningCondition.value),
    rewardTotal: trimText(state.fields.rewardTotal.value),
    distribution: state.fields.distribution.value ?? "winner_take_all",
    deadline: trimText(state.fields.deadline.value),
    domain: "other",
    tags: "",
    solverInstructions: trimText(state.fields.solverInstructions.value),
    timezone: state.timezone || "UTC",
  };
}

export function buildPostingArtifactsFromGuidedState(
  uploads: UploadedArtifact[],
) {
  return uploads
    .filter(
      (artifact): artifact is UploadedArtifact & { uri: string } =>
        artifact.status === "ready" && typeof artifact.uri === "string",
    )
    .map((artifact) => ({
      id: artifact.id,
      uri: artifact.uri,
      file_name: artifact.file_name,
      mime_type: artifact.mime_type,
      size_bytes: artifact.size_bytes,
      detected_columns: artifact.detected_columns,
    }));
}

export function isReadyToCompile(state: GuidedComposerState) {
  const readyUploads = state.uploads.filter(
    (artifact) => artifact.status === "ready",
  );
  const reward = Number(state.fields.rewardTotal.value);
  const deadline = Date.parse(state.fields.deadline.value ?? "");

  return (
    trimText(state.fields.title.value).length > 0 &&
    REQUIRED_PROMPTS.every(
      (promptId) => getPromptStatus(state, promptId) === "locked",
    ) &&
    readyUploads.length > 0 &&
    !state.uploads.some((artifact) => artifact.status === "uploading") &&
    Number.isFinite(reward) &&
    reward > 0 &&
    !Number.isNaN(deadline)
  );
}

export function listReadinessIssues(state: GuidedComposerState) {
  const issues: string[] = [];

  if (!trimText(state.fields.problem.value)) {
    issues.push("Answer the scientific problem question.");
  }
  if (state.uploads.length === 0) {
    issues.push("Upload at least one data file.");
  }
  if (state.uploads.some((artifact) => artifact.status === "uploading")) {
    issues.push("Wait for uploads to finish before continuing.");
  }
  if (state.uploads.length > 0 && state.uploadsStatus !== "locked") {
    issues.push("Confirm the uploaded files and their aliases.");
  }
  if (!trimText(state.fields.winningCondition.value)) {
    issues.push("Describe what should count as a winning result.");
  }
  const reward = Number(state.fields.rewardTotal.value);
  if (!Number.isFinite(reward) || reward <= 0) {
    issues.push("Confirm a positive USDC reward.");
  } else if (state.fields.rewardTotal.status !== "locked") {
    issues.push("Confirm the USDC reward.");
  }
  if (state.fields.distribution.status !== "locked") {
    issues.push("Confirm how the payout should split.");
  }
  if (
    !trimText(state.fields.deadline.value) ||
    Number.isNaN(Date.parse(state.fields.deadline.value ?? ""))
  ) {
    issues.push("Choose a valid submission deadline.");
  } else if (state.fields.deadline.status !== "locked") {
    issues.push("Confirm the submission deadline.");
  }
  if (!trimText(state.fields.title.value)) {
    issues.push("Set the bounty title in the summary rail.");
  }

  return issues;
}

export function saveGuidedDraft(
  state: GuidedComposerState,
  storage = window.sessionStorage,
) {
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      ...state,
      uploads: state.uploads.map((artifact) =>
        artifact.status === "uploading"
          ? {
              ...artifact,
              status: "error",
              error: "This upload did not finish. Remove it and upload again.",
            }
          : artifact,
      ),
    }),
  );
}

export function loadGuidedDraft(storage = window.sessionStorage) {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as GuidedComposerState;
    if (!parsed || typeof parsed !== "object" || !parsed.fields) {
      return null;
    }
    return finalizeState(parsed);
  } catch {
    return null;
  }
}

export function clearGuidedDraft(storage = window.sessionStorage) {
  storage.removeItem(STORAGE_KEY);
}

export function clarificationTargetFromQuestions(
  questions: ClarificationQuestionOutput[],
) {
  const reasonCodes = new Set(
    questions.map((question) => question.reason_code),
  );
  if (reasonCodes.has("MANAGED_THRESHOLD_UNSUPPORTED")) {
    return "winningCondition" as const;
  }
  if (reasonCodes.has("MANAGED_ARTIFACTS_INCOMPLETE")) {
    return "uploads" as const;
  }
  if (
    reasonCodes.has("MANAGED_ARTIFACTS_AMBIGUOUS") ||
    reasonCodes.has("MANAGED_ARTIFACT_ASSIGNMENTS_INVALID")
  ) {
    return "uploads" as const;
  }
  return "problem" as const;
}

export function clarificationHelperText(
  target: ReturnType<typeof clarificationTargetFromQuestions>,
) {
  switch (target) {
    case "winningCondition":
      return "Update the winning condition, then reconfirm the later answers below it.";
    case "uploads":
      return "Review the uploaded files, rename any ambiguous aliases, and make sure the problem statement still matches them.";
    case "problem":
      return "Tighten the problem statement so Agora can map the files and scoring rules safely.";
  }
}

export function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function buildUploadHintCopy() {
  return UPLOAD_HINTS.map((hint, index) => ({
    hint,
    trailing: index < UPLOAD_HINTS.length - 1 ? ", " : ".",
  }));
}

export function readyUploadCount(state: GuidedComposerState) {
  return state.uploads.filter((artifact) => artifact.status === "ready").length;
}
