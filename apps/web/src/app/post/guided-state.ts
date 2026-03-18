"use client";

import type { ClarificationQuestionOutput } from "@agora/common";
import { z } from "zod";
import { formatSubmissionWindowLabel } from "../../lib/post-submission-window";
import { GUIDED_PROMPT_ORDER, GUIDED_SELECT_DEFAULTS } from "./guided-prompts";

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

export type InputKind = "textarea" | "file" | "currency" | "select" | "text";

export type GuidedFieldKey =
  | "problem"
  | "title"
  | "uploads"
  | "winningCondition"
  | "rewardTotal"
  | "distribution"
  | "deadline"
  | "disputeWindow"
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
    disputeWindow: GuidedDraftField<string>;
    solverInstructions: GuidedDraftField<string>;
  };
  uploads: UploadedArtifact[];
  uploadsStatus: GuidedFieldStatus;
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
  disputeWindowHours: string;
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
  "disputeWindow",
] as const satisfies readonly Exclude<
  GuidedFieldKey,
  "title" | "solverInstructions"
>[];

export const GUIDED_STORAGE_KEY = STORAGE_KEY;

const guidedFieldStatusSchema = z.enum([
  "empty",
  "collecting",
  "suggested",
  "locked",
]);
const guidedFieldSourceSchema = z.enum(["user", "system", "compile"]);
const uploadStatusSchema = z.enum(["uploading", "ready", "error"]);
const guidedCompileStateSchema = z.enum([
  "idle",
  "ready_to_compile",
  "compiling",
  "needs_clarification",
  "needs_review",
  "ready",
]);
const distributionValueSchema = z.enum([
  "winner_take_all",
  "top_3",
  "proportional",
]);

const textDraftFieldSchema = z.object({
  value: z.string().nullable().optional(),
  status: guidedFieldStatusSchema.optional(),
  source: guidedFieldSourceSchema.optional(),
});

const distributionDraftFieldSchema = z.object({
  value: distributionValueSchema.nullable().optional(),
  status: guidedFieldStatusSchema.optional(),
  source: guidedFieldSourceSchema.optional(),
});

const uploadedArtifactSchema = z.object({
  id: z.string(),
  uri: z.string().optional(),
  file_name: z.string(),
  mime_type: z.string().optional(),
  size_bytes: z.number().optional(),
  detected_columns: z.array(z.string()).optional(),
  status: uploadStatusSchema,
  error: z.string().optional(),
});

const storedGuidedStateSchema = z.object({
  fields: z
    .object({
      problem: textDraftFieldSchema.optional(),
      title: textDraftFieldSchema.optional(),
      winningCondition: textDraftFieldSchema.optional(),
      rewardTotal: textDraftFieldSchema.optional(),
      distribution: distributionDraftFieldSchema.optional(),
      deadline: textDraftFieldSchema.optional(),
      disputeWindow: textDraftFieldSchema.optional(),
      solverInstructions: textDraftFieldSchema.optional(),
    })
    .partial(),
  uploads: z.array(uploadedArtifactSchema).optional(),
  uploadsStatus: guidedFieldStatusSchema.optional(),
  activePromptId: z.enum(GUIDED_PROMPT_ORDER).nullable().optional(),
  compileState: guidedCompileStateSchema.optional(),
  sessionId: z.string().nullable().optional(),
  timezone: z.string().optional(),
});
type StoredGuidedState = z.infer<typeof storedGuidedStateSchema>;

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
    case "disputeWindow":
      return state.fields.disputeWindow.status;
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
    case "disputeWindow":
      state.fields.disputeWindow.status = status;
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
    case "deadline": {
      const v = state.fields.deadline.value;
      if (!v) return "";
      return formatSubmissionWindowLabel(v);
    }
    case "disputeWindow": {
      const v = state.fields.disputeWindow.value;
      if (!v) return "";
      const hours = Number(v);
      if (hours === 0) return "None (testnet)";
      return `${Math.round(hours / 24)} days`;
    }
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

function buildSuggestedTitleField(
  problem: string | null | undefined,
): GuidedDraftField<string> {
  const suggestion = buildSuggestedTitle(trimText(problem));
  if (!suggestion) {
    return { value: null, status: "empty" };
  }

  return {
    value: suggestion,
    status: "suggested",
    source: "system",
  };
}

function buildManualTitleField(
  problem: string | null | undefined,
  title: string,
): GuidedDraftField<string> {
  const trimmedTitle = trimText(title);
  if (!trimmedTitle) {
    return buildSuggestedTitleField(problem);
  }

  return {
    value: trimmedTitle,
    status: "locked",
    source: "user",
  };
}

function cloneDraftField<T>(
  field: Partial<GuidedDraftField<T>> | undefined,
  fallback: GuidedDraftField<T>,
): GuidedDraftField<T> {
  return {
    value: field?.value ?? fallback.value,
    status: field?.status ?? fallback.status,
    source: field?.source ?? fallback.source,
  };
}

function buildInitialFields() {
  return {
    problem: { value: null, status: "collecting" } as GuidedDraftField<string>,
    title: { value: null, status: "empty" } as GuidedDraftField<string>,
    winningCondition: {
      value: null,
      status: "empty",
    } as GuidedDraftField<string>,
    rewardTotal: {
      value: "500",
      status: "suggested",
      source: "system",
    } as GuidedDraftField<string>,
    distribution: {
      value: GUIDED_SELECT_DEFAULTS.distribution,
      status: "suggested",
      source: "system",
    } as GuidedDraftField<"winner_take_all" | "top_3" | "proportional">,
    deadline: {
      value: GUIDED_SELECT_DEFAULTS.deadline,
      status: "suggested",
      source: "system",
    } as GuidedDraftField<string>,
    disputeWindow: {
      value: GUIDED_SELECT_DEFAULTS.disputeWindow,
      status: "suggested",
      source: "system",
    } as GuidedDraftField<string>,
    solverInstructions: {
      value: null,
      status: "empty",
    } as GuidedDraftField<string>,
  };
}

function normalizeGuidedState(state: StoredGuidedState): GuidedComposerState {
  const timezone =
    typeof state.timezone === "string" && state.timezone.trim().length > 0
      ? state.timezone
      : resolveBrowserTimezone();
  const initialFields = buildInitialFields();
  const uploads = Array.isArray(state.uploads)
    ? state.uploads.map((artifact) => ({ ...artifact }))
    : [];
  const activePromptId =
    state.activePromptId === null
      ? null
      : state.activePromptId != null &&
          GUIDED_PROMPT_ORDER.includes(state.activePromptId)
        ? state.activePromptId
        : "problem";
  const fields = {
    problem: cloneDraftField(state.fields?.problem, initialFields.problem),
    title: cloneDraftField(state.fields?.title, initialFields.title),
    winningCondition: cloneDraftField(
      state.fields?.winningCondition,
      initialFields.winningCondition,
    ),
    rewardTotal: cloneDraftField(
      state.fields?.rewardTotal,
      initialFields.rewardTotal,
    ),
    distribution: cloneDraftField(
      state.fields?.distribution,
      initialFields.distribution,
    ),
    deadline: cloneDraftField(state.fields?.deadline, initialFields.deadline),
    disputeWindow: cloneDraftField(
      state.fields?.disputeWindow,
      initialFields.disputeWindow,
    ),
    solverInstructions: cloneDraftField(
      state.fields?.solverInstructions,
      initialFields.solverInstructions,
    ),
  };

  if (!hasTextValue(fields.title.value)) {
    fields.title = buildSuggestedTitleField(fields.problem.value);
  }

  return {
    fields,
    uploads,
    uploadsStatus:
      state.uploadsStatus ?? (uploads.length > 0 ? "collecting" : "empty"),
    activePromptId,
    compileState: state.compileState ?? "idle",
    sessionId: typeof state.sessionId === "string" ? state.sessionId : null,
    timezone,
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
    case "disputeWindow":
      return state.fields.disputeWindow.value;
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
        state.fields.title = buildSuggestedTitleField(String(value));
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
    case "disputeWindow":
      state.fields.disputeWindow = {
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

export function createInitialGuidedState(
  timezone = resolveBrowserTimezone(),
): GuidedComposerState {
  return {
    fields: buildInitialFields(),
    uploads: [],
    uploadsStatus: "empty",
    activePromptId: "problem",
    compileState: "idle",
    sessionId: null,
    timezone,
  };
}

export function guidedComposerReducer(
  state: GuidedComposerState,
  action: GuidedAnswerAction,
) {
  if (action.type === "hydrate") {
    return normalizeGuidedState(action.state);
  }

  if (action.type === "reset") {
    return createInitialGuidedState(action.timezone ?? state.timezone);
  }

  const nextState = normalizeGuidedState(state);

  switch (action.type) {
    case "answer_prompt": {
      setFieldValue(nextState, action.field, action.value, "locked");
      const nextPrompt = nextIncompletePrompt(
        nextState,
        promptIndex(action.field) + 1,
      );
      nextState.activePromptId = nextPrompt;
      updateCompileReadiness(nextState);
      return nextState;
    }
    case "skip_optional_prompt": {
      setFieldValue(nextState, "solverInstructions", "", "locked");
      nextState.activePromptId = null;
      updateCompileReadiness(nextState);
      return nextState;
    }
    case "edit_prompt": {
      invalidateFromPrompt(nextState, action.field);
      return nextState;
    }
    case "set_title": {
      nextState.fields.title = buildManualTitleField(
        nextState.fields.problem.value,
        action.value,
      );
      updateCompileReadiness(nextState);
      return nextState;
    }
    case "set_uploads": {
      nextState.uploads = action.uploads;
      if (nextState.activePromptId !== "uploads") {
        nextState.activePromptId = "uploads";
      }
      nextState.uploadsStatus =
        action.uploads.length > 0 ? "collecting" : "empty";
      updateCompileReadiness(nextState);
      return nextState;
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
      return nextState;
    }
    case "set_compile_state": {
      nextState.compileState = action.compileState;
      return nextState;
    }
    case "set_session_id": {
      nextState.sessionId = action.sessionId;
      return nextState;
    }
    case "apply_clarification": {
      invalidateFromPrompt(nextState, action.field);
      nextState.compileState = "needs_clarification";
      return nextState;
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
    disputeWindowHours: trimText(state.fields.disputeWindow.value) || "168",
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
  return (
    trimText(state.fields.title.value).length > 0 &&
    REQUIRED_PROMPTS.every(
      (promptId) => getPromptStatus(state, promptId) === "locked",
    ) &&
    readyUploads.length > 0 &&
    !state.uploads.some((artifact) => artifact.status === "uploading") &&
    Number.isFinite(reward) &&
    reward > 0 &&
    hasTextValue(state.fields.deadline.value)
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
  if (!trimText(state.fields.deadline.value)) {
    issues.push("Choose a submission window.");
  } else if (state.fields.deadline.status !== "locked") {
    issues.push("Confirm the submission window.");
  }
  if (!trimText(state.fields.disputeWindow.value)) {
    issues.push("Choose a dispute window.");
  } else if (state.fields.disputeWindow.status !== "locked") {
    issues.push("Confirm the dispute window.");
  }
  if (!trimText(state.fields.title.value)) {
    issues.push("Edit the scientific problem to regenerate the bounty title.");
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
    const parsed = JSON.parse(raw) as unknown;
    const result = storedGuidedStateSchema.safeParse(parsed);
    if (!result.success) {
      return null;
    }
    return normalizeGuidedState(result.data);
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
