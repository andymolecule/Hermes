"use client";

import type {
  AuthoringSessionOutput,
  CreateAuthoringSessionRequestInput,
} from "@agora/common";

export interface AuthoringFormState {
  title: string;
  description: string;
  payout_condition: string;
  reward_total: string;
  distribution: "winner_take_all" | "top_3" | "proportional";
  deadline: string;
  domain: string;
  timezone: string;
  metric: string;
  evaluation_artifact_id: string;
  evaluation_id_column: string;
  evaluation_value_column: string;
  submission_id_column: string;
  submission_value_column: string;
}

export interface UploadedArtifactDraft {
  local_id: string;
  artifact_id?: string;
  file_name: string;
  mime_type?: string;
  size_bytes?: number;
  uri?: string;
  source_url?: string | null;
  role?: string | null;
  detected_columns?: string[];
  status: "uploading" | "ready" | "error";
  synced?: boolean;
  error?: string;
}

function clean(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeDeadlineForSubmit(deadline: string) {
  const trimmed = deadline.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const parsed = new Date(trimmed);
  if (!Number.isFinite(parsed.getTime())) {
    return undefined;
  }
  return parsed.toISOString();
}

export function toDateTimeLocalInput(iso: string | null | undefined) {
  if (!iso) {
    return "";
  }

  const parsed = new Date(iso);
  if (!Number.isFinite(parsed.getTime())) {
    return "";
  }

  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function createEmptyAuthoringFormState(
  timezone: string,
): AuthoringFormState {
  return {
    title: "",
    description: "",
    payout_condition: "",
    reward_total: "",
    distribution: "winner_take_all",
    deadline: "",
    domain: "other",
    timezone,
    metric: "",
    evaluation_artifact_id: "",
    evaluation_id_column: "",
    evaluation_value_column: "",
    submission_id_column: "",
    submission_value_column: "",
  };
}

export function buildIntentPatch(
  state: AuthoringFormState,
): CreateAuthoringSessionRequestInput["intent"] | undefined {
  const intent: NonNullable<CreateAuthoringSessionRequestInput["intent"]> = {};

  const title = clean(state.title);
  if (title) {
    intent.title = title;
  }

  const description = clean(state.description);
  if (description) {
    intent.description = description;
  }

  const payoutCondition = clean(state.payout_condition);
  if (payoutCondition) {
    intent.payout_condition = payoutCondition;
  }

  const rewardTotal = clean(state.reward_total);
  if (rewardTotal) {
    intent.reward_total = rewardTotal;
  }

  const deadline = normalizeDeadlineForSubmit(state.deadline);
  if (deadline) {
    intent.deadline = deadline;
  }

  const domain = clean(state.domain);
  if (domain) {
    intent.domain = domain;
  }

  if (Object.keys(intent).length > 0) {
    intent.distribution = state.distribution;
    intent.timezone = state.timezone;
  }

  return Object.keys(intent).length > 0 ? intent : undefined;
}

export function buildExecutionPatch(
  state: AuthoringFormState,
): CreateAuthoringSessionRequestInput["execution"] | undefined {
  const execution: NonNullable<CreateAuthoringSessionRequestInput["execution"]> =
    {};

  const metric = clean(state.metric);
  if (metric) {
    execution.metric = metric;
  }

  const evaluationArtifactId = clean(state.evaluation_artifact_id);
  if (evaluationArtifactId) {
    execution.evaluation_artifact_id = evaluationArtifactId;
  }

  const evaluationIdColumn = clean(state.evaluation_id_column);
  if (evaluationIdColumn) {
    execution.evaluation_id_column = evaluationIdColumn;
  }

  const evaluationValueColumn = clean(state.evaluation_value_column);
  if (evaluationValueColumn) {
    execution.evaluation_value_column = evaluationValueColumn;
  }

  const submissionIdColumn = clean(state.submission_id_column);
  if (submissionIdColumn) {
    execution.submission_id_column = submissionIdColumn;
  }

  const submissionValueColumn = clean(state.submission_value_column);
  if (submissionValueColumn) {
    execution.submission_value_column = submissionValueColumn;
  }

  return Object.keys(execution).length > 0 ? execution : undefined;
}

export function applySessionToForm(
  session: AuthoringSessionOutput,
  current: AuthoringFormState,
): AuthoringFormState {
  const resolvedIntent = session.resolved.intent;
  const resolvedExecution = session.resolved.execution;
  const compilation = session.compilation;

  const distribution =
    resolvedIntent.distribution ??
    (compilation?.reward.distribution as AuthoringFormState["distribution"] | undefined) ??
    current.distribution;

  return {
    ...current,
    title: resolvedIntent.title ?? current.title,
    description: resolvedIntent.description ?? current.description,
    payout_condition:
      resolvedIntent.payout_condition ?? current.payout_condition,
    reward_total:
      resolvedIntent.reward_total ?? compilation?.reward.total ?? current.reward_total,
    distribution,
    deadline:
      toDateTimeLocalInput(resolvedIntent.deadline ?? compilation?.deadline) ||
      current.deadline,
    domain: resolvedIntent.domain ?? current.domain,
    timezone: resolvedIntent.timezone ?? current.timezone,
    metric:
      resolvedExecution.metric ?? compilation?.metric ?? current.metric,
    evaluation_artifact_id:
      resolvedExecution.evaluation_artifact_id ?? current.evaluation_artifact_id,
    evaluation_id_column:
      resolvedExecution.evaluation_id_column ??
      compilation?.evaluation_contract.columns.id ??
      current.evaluation_id_column,
    evaluation_value_column:
      resolvedExecution.evaluation_value_column ??
      compilation?.evaluation_contract.columns.value ??
      current.evaluation_value_column,
    submission_id_column:
      resolvedExecution.submission_id_column ??
      compilation?.submission_contract.columns.id ??
      current.submission_id_column,
    submission_value_column:
      resolvedExecution.submission_value_column ??
      compilation?.submission_contract.columns.value ??
      current.submission_value_column,
  };
}
