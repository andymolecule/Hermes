import {
  authoringDraftAssessmentSchema,
  authoringDraftSchema,
} from "@agora/common";
import type { AuthoringDraftRow } from "@agora/db";
import { getPendingAuthoringQuestions } from "./managed-authoring-ir.js";

export const EXTERNAL_DRAFT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

export function buildExpiry(offsetMs: number) {
  return new Date(Date.now() + offsetMs).toISOString();
}

export function isAuthoringDraftExpired(
  draft: Pick<AuthoringDraftRow, "expires_at">,
  nowMs = Date.now(),
) {
  const expiresAtMs = new Date(draft.expires_at).getTime();
  if (Number.isNaN(expiresAtMs)) {
    return false;
  }
  return expiresAtMs <= nowMs;
}

export function toAuthoringDraftPayload(
  authoringDraft: AuthoringDraftRow | null,
) {
  if (!authoringDraft) {
    return null;
  }

  const questions = getAuthoringDraftQuestions(authoringDraft);
  const approvedConfirmation =
    getAuthoringDraftApprovedConfirmation(authoringDraft);

  return authoringDraftSchema.parse({
    id: authoringDraft.id,
    poster_address: authoringDraft.poster_address ?? null,
    state: authoringDraft.state,
    intent: authoringDraft.intent_json ?? null,
    authoring_ir: authoringDraft.authoring_ir_json ?? null,
    uploaded_artifacts: authoringDraft.uploaded_artifacts_json ?? [],
    compilation: authoringDraft.compilation_json ?? null,
    questions,
    approved_confirmation: approvedConfirmation,
    published_challenge_id: authoringDraft.published_challenge_id ?? null,
    published_spec_cid: authoringDraft.published_spec_cid ?? null,
    published_spec: authoringDraft.published_spec_json ?? null,
    failure_message: authoringDraft.failure_message ?? null,
    expires_at: authoringDraft.expires_at,
    created_at: authoringDraft.created_at,
    updated_at: authoringDraft.updated_at,
  });
}

export function getAuthoringDraftQuestions(
  draft: Pick<AuthoringDraftRow, "authoring_ir_json">,
) {
  if (draft.authoring_ir_json) {
    return getPendingAuthoringQuestions(draft.authoring_ir_json);
  }
  return [];
}

export function getAuthoringDraftApprovedConfirmation(
  draft: Pick<AuthoringDraftRow, "compilation_json">,
) {
  return draft.compilation_json?.confirmation_contract ?? null;
}

export function buildAuthoringDraftAssessment(
  draft: Pick<
    AuthoringDraftRow,
    | "state"
    | "intent_json"
    | "authoring_ir_json"
    | "compilation_json"
    | "failure_message"
  >,
) {
  const questions = getAuthoringDraftQuestions(draft);
  const runtimeFamily =
    draft.compilation_json?.runtime_family ??
    draft.authoring_ir_json?.evaluation.runtime_family ??
    null;
  const metric =
    draft.compilation_json?.metric ??
    draft.authoring_ir_json?.evaluation.metric ??
    null;
  const evaluatorArchetype =
    draft.compilation_json?.challenge_spec.evaluation.evaluator_contract
      ?.archetype ?? null;
  const reasonCodes = [
    ...(draft.compilation_json?.reason_codes ?? []),
    ...(draft.authoring_ir_json?.evaluation.rejection_reasons ?? []),
    ...(draft.authoring_ir_json?.evaluation.compile_error_codes ?? []),
  ];

  const missing =
    draft.state === "needs_input"
      ? questions.map((question) => question.field)
      : draft.state === "failed"
          ? [draft.failure_message ?? "compile_failed"]
          : (draft.authoring_ir_json?.intent.missing_fields ?? []);

  const suggestions = [
    ...questions
      .map((question) => question.prompt)
      .filter((value): value is string => typeof value === "string"),
    ...(draft.compilation_json?.warnings ?? []),
  ];

  return authoringDraftAssessmentSchema.parse({
    feasible: draft.state === "ready",
    publishable: draft.state === "ready",
    runtime_family: runtimeFamily,
    metric,
    evaluator_archetype: evaluatorArchetype,
    reason_codes: [...new Set(reasonCodes)],
    missing: [...new Set(missing)],
    suggestions: [...new Set(suggestions)],
    proposed_reward:
      draft.intent_json?.reward_total ??
      draft.compilation_json?.challenge_spec.reward.total ??
      null,
    proposed_deadline:
      draft.intent_json?.deadline ??
      draft.compilation_json?.challenge_spec.deadline ??
      null,
  });
}
