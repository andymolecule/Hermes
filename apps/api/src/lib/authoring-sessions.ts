import { randomUUID } from "node:crypto";
import {
  AgoraError,
  type AuthoringArtifactOutput,
  type AuthoringBlockedByLayerOutput,
  type AuthoringInteractionArtifactAssignmentOutput,
  type AuthoringInteractionStateOutput,
  type AuthoringQuestionOutput,
  type AuthoringSessionAnswerOutput,
  type AuthoringSessionChecklistItemOutput,
  type AuthoringSessionOutput,
  authoringInteractionStateSchema,
  authoringSessionSchema,
  partialChallengeIntentSchema,
} from "@agora/common";
import type { ExternalSourceMessageOutput } from "@agora/common";
import type { AuthoringDraftRow } from "@agora/db";
import {
  buildAuthoringDraftAssessment,
  getAuthoringDraftQuestions,
} from "./authoring-draft-payloads.js";
import { buildAuthoringDraftCard } from "./authoring-drafts.js";

const REQUIRED_SESSION_FIELDS = [
  {
    id: "title",
    label: "Challenge title",
  },
  {
    id: "description",
    label: "Solver task",
  },
  {
    id: "payout_condition",
    label: "Winning condition",
  },
  {
    id: "reward_total",
    label: "Reward total",
  },
  {
    id: "deadline",
    label: "Submission deadline",
  },
] as const;

function toSessionState(
  draftState: AuthoringDraftRow["state"],
): AuthoringSessionOutput["state"] {
  switch (draftState) {
    case "ready":
      return "publishable";
    case "published":
      return "published";
    case "failed":
      return "rejected";
    default:
      return "awaiting_input";
  }
}

function resolveBlockedByLayer(
  draft: Pick<
    AuthoringDraftRow,
    "state" | "authoring_ir_json" | "failure_message" | "compilation_json"
  >,
): AuthoringBlockedByLayerOutput | null {
  if (draft.state === "ready" || draft.state === "published") {
    return null;
  }

  if (draft.state === "compiling") {
    return "layer3";
  }

  const assessmentOutcome = draft.authoring_ir_json?.assessment.outcome ?? null;
  if (assessmentOutcome === "failed") {
    return "layer3";
  }
  if (assessmentOutcome === "needs_input") {
    return "layer2";
  }

  const hasDeterministicCompileFailure =
    typeof draft.failure_message === "string" ||
    draft.compilation_json != null ||
    typeof draft.authoring_ir_json?.evaluation.compile_error_message ===
      "string" ||
    (draft.authoring_ir_json?.evaluation.rejection_reasons.length ?? 0) > 0 ||
    (draft.authoring_ir_json?.evaluation.compile_error_codes.length ?? 0) > 0;

  return hasDeterministicCompileFailure ? "layer3" : "layer2";
}

function isArtifactRoleAnswerValue(
  value: AuthoringSessionAnswerOutput["value"],
): value is AuthoringInteractionArtifactAssignmentOutput[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "object")
  );
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean))];
}

function currentStructuredFields(
  draft: Pick<AuthoringDraftRow, "intent_json" | "authoring_ir_json">,
) {
  return partialChallengeIntentSchema.parse(
    draft.intent_json ?? draft.authoring_ir_json?.intent.current ?? {},
  );
}

export function getAuthoringSessionInteraction(
  draft: Pick<AuthoringDraftRow, "authoring_ir_json">,
) {
  return authoringInteractionStateSchema.parse(
    draft.authoring_ir_json?.interaction ?? {
      answered_questions: [],
      latest_message: null,
      overrides: {
        metric: null,
        artifact_assignments: [],
      },
    },
  );
}

export function getAuthoringSessionSourceMessages(
  draft: Pick<AuthoringDraftRow, "authoring_ir_json">,
) {
  return (draft.authoring_ir_json?.source.poster_messages ??
    []) as ExternalSourceMessageOutput[];
}

function summarizeAnswerValue(value: AuthoringSessionAnswerOutput["value"]) {
  if (typeof value === "string") {
    return value.trim() || null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return null;
    }
    if (typeof value[0] === "string") {
      return value.join(", ");
    }
    if (!isArtifactRoleAnswerValue(value)) {
      return null;
    }
    return value.map((item) => `${item.role}:${item.artifact_id}`).join(", ");
  }
  return null;
}

function normalizeSelectAnswer(input: {
  answer: AuthoringSessionAnswerOutput["value"];
  question: AuthoringQuestionOutput;
  invalidCode: string;
}) {
  if (typeof input.answer !== "string") {
    throw new AgoraError(
      `Answer for ${input.question.field} must be a string option id. Next step: send one of the canonical option ids and retry.`,
      {
        status: 400,
        code: input.invalidCode,
      },
    );
  }

  const normalized = input.answer.trim().toLowerCase();
  const matched = input.question.options.find((option) => {
    const optionId = option.id.trim().toLowerCase();
    const optionLabel = option.label.trim().toLowerCase();
    return normalized === optionId || normalized === optionLabel;
  });
  if (!matched) {
    throw new AgoraError(
      `Answer for ${input.question.field} did not match a supported option. Next step: send one of the canonical option ids returned by Agora and retry.`,
      {
        status: 400,
        code: input.invalidCode,
      },
    );
  }
  return matched.id;
}

function normalizeTextAnswer(input: {
  answer: AuthoringSessionAnswerOutput["value"];
  field: string;
}) {
  if (
    typeof input.answer !== "string" &&
    typeof input.answer !== "number" &&
    typeof input.answer !== "boolean"
  ) {
    throw new AgoraError(
      `Answer for ${input.field} must be a scalar value. Next step: send a string or number and retry.`,
      {
        status: 400,
        code: "AUTHORING_SESSION_INVALID_ANSWER",
      },
    );
  }

  const normalized = String(input.answer).trim();
  if (normalized.length === 0) {
    throw new AgoraError(
      `Answer for ${input.field} cannot be empty. Next step: send a non-empty value and retry.`,
      {
        status: 400,
        code: "AUTHORING_SESSION_INVALID_ANSWER",
      },
    );
  }
  return normalized;
}

function normalizeArtifactRoleAnswer(input: {
  answer: AuthoringSessionAnswerOutput["value"];
  question: AuthoringQuestionOutput;
  uploadedArtifacts: AuthoringArtifactOutput[];
}) {
  if (!Array.isArray(input.answer) || input.answer.length === 0) {
    throw new AgoraError(
      "Artifact role answers must be a non-empty array. Next step: send an array of { role, artifact_id } objects and retry.",
      {
        status: 400,
        code: "AUTHORING_SESSION_INVALID_ARTIFACT_ROLES",
      },
    );
  }

  if (typeof input.answer[0] === "string") {
    throw new AgoraError(
      "Artifact role answers must use { role, artifact_id } objects. Next step: send a structured role mapping and retry.",
      {
        status: 400,
        code: "AUTHORING_SESSION_INVALID_ARTIFACT_ROLES",
      },
    );
  }
  if (!isArtifactRoleAnswerValue(input.answer)) {
    throw new AgoraError(
      "Artifact role answers must use structured { role, artifact_id } objects. Next step: send a structured role mapping and retry.",
      {
        status: 400,
        code: "AUTHORING_SESSION_INVALID_ARTIFACT_ROLES",
      },
    );
  }

  const knownRoles = new Set(
    input.question.artifact_roles.map((role) => role.role),
  );
  const knownArtifactIds = new Set(
    input.uploadedArtifacts.flatMap((artifact) =>
      [artifact.id, artifact.uri].filter(
        (value): value is string =>
          typeof value === "string" && value.length > 0,
      ),
    ),
  );

  return input.answer.map((assignment) => {
    if (!knownRoles.has(assignment.role)) {
      throw new AgoraError(
        `Artifact role ${assignment.role} is not valid for this question. Next step: use one of the returned role ids and retry.`,
        {
          status: 400,
          code: "AUTHORING_SESSION_INVALID_ARTIFACT_ROLE",
        },
      );
    }
    if (!knownArtifactIds.has(assignment.artifact_id)) {
      throw new AgoraError(
        `Artifact ${assignment.artifact_id} is not attached to this session. Next step: upload the file first or use a valid artifact id and retry.`,
        {
          status: 400,
          code: "AUTHORING_SESSION_UNKNOWN_ARTIFACT",
        },
      );
    }
    return {
      role: assignment.role,
      artifact_id: assignment.artifact_id,
      visibility: assignment.visibility ?? null,
    };
  });
}

function buildChecklist(
  draft: Pick<
    AuthoringDraftRow,
    "state" | "authoring_ir_json" | "failure_message" | "compilation_json"
  >,
  questions: AuthoringQuestionOutput[],
): AuthoringSessionChecklistItemOutput[] {
  const fields = currentStructuredFields({
    intent_json: null,
    authoring_ir_json: draft.authoring_ir_json,
  });
  const missing = new Set(draft.authoring_ir_json?.intent.missing_fields ?? []);
  const checklist: AuthoringSessionChecklistItemOutput[] =
    REQUIRED_SESSION_FIELDS.map((field) => {
      const rawValue = fields[field.id as keyof typeof fields];
      const satisfied =
        typeof rawValue === "string"
          ? rawValue.trim().length > 0
          : rawValue != null;
      return {
        id: field.id,
        label: field.label,
        status: missing.has(field.id) || !satisfied ? "missing" : "satisfied",
        detail: null,
      };
    });

  for (const question of questions) {
    if (checklist.some((item) => item.id === question.field)) {
      continue;
    }
    checklist.push({
      id: question.field,
      label: question.label,
      status: "missing",
      detail: question.prompt,
    });
  }

  checklist.push({
    id: "compile_gate",
    label: "Deterministic compile gate",
    status:
      draft.state === "ready" || draft.state === "published"
        ? "satisfied"
        : draft.state === "failed"
          ? "failed"
          : "missing",
    detail:
      draft.state === "failed"
        ? (draft.failure_message ??
          draft.authoring_ir_json?.evaluation.compile_error_message ??
          null)
        : draft.state === "ready" || draft.state === "published"
          ? "Layer 3 deterministic validation passed."
          : "Agora still needs enough information to pass deterministic compile validation.",
  });

  return checklist;
}

export function toAuthoringSessionPayload(
  draft: Pick<
    AuthoringDraftRow,
    | "id"
    | "state"
    | "intent_json"
    | "authoring_ir_json"
    | "uploaded_artifacts_json"
    | "compilation_json"
    | "published_challenge_id"
    | "published_spec_cid"
    | "published_at"
    | "failure_message"
    | "source_callback_url"
    | "created_at"
    | "updated_at"
  >,
) {
  const card = buildAuthoringDraftCard(draft as AuthoringDraftRow);
  const assessment = buildAuthoringDraftAssessment(draft as AuthoringDraftRow);
  const questions = getAuthoringDraftQuestions(draft as AuthoringDraftRow);

  return authoringSessionSchema.parse({
    id: draft.id,
    state: toSessionState(draft.state),
    blocked_by_layer: resolveBlockedByLayer(draft),
    origin: {
      provider: draft.authoring_ir_json?.origin.provider ?? "direct",
      external_id: draft.authoring_ir_json?.origin.external_id ?? null,
      external_url: draft.authoring_ir_json?.origin.external_url ?? null,
    },
    summary: card.summary ?? card.title ?? null,
    structured_fields: currentStructuredFields(draft),
    artifacts: draft.uploaded_artifacts_json ?? [],
    missing: assessment.missing,
    reasons: uniqueStrings([
      draft.failure_message,
      draft.authoring_ir_json?.evaluation.compile_error_message,
      ...(draft.authoring_ir_json?.evaluation.rejection_reasons ?? []),
      ...(draft.compilation_json?.reason_codes ?? []),
    ]),
    questions,
    checklist: buildChecklist(draft, questions),
    callback_registered:
      typeof draft.source_callback_url === "string" &&
      draft.source_callback_url.trim().length > 0,
    compilation: draft.compilation_json ?? null,
    published:
      draft.state === "published" || draft.published_spec_cid
        ? {
            challenge_id: draft.published_challenge_id ?? null,
            spec_cid: draft.published_spec_cid ?? null,
            published_at: draft.published_at ?? null,
          }
        : null,
    created_at: draft.created_at,
    updated_at: draft.updated_at,
  });
}

export function mergeAuthoringSessionArtifacts(input: {
  current: AuthoringArtifactOutput[];
  incoming: AuthoringArtifactOutput[];
}) {
  const byKey = new Map<string, AuthoringArtifactOutput>();
  for (const artifact of [...input.current, ...input.incoming]) {
    const key = artifact.id?.trim() || artifact.uri;
    byKey.set(key, artifact);
  }
  return [...byKey.values()];
}

export function applyAuthoringSessionResponse(input: {
  draft: Pick<
    AuthoringDraftRow,
    "authoring_ir_json" | "intent_json" | "uploaded_artifacts_json"
  >;
  answers: AuthoringSessionAnswerOutput[];
  structuredFields?: Record<string, unknown> | null;
  message?: string | null;
  incomingArtifacts?: AuthoringArtifactOutput[];
}) {
  const questions = getAuthoringDraftQuestions(
    input.draft as AuthoringDraftRow,
  );
  const questionById = new Map(
    questions.map((question) => [question.id, question]),
  );
  const currentIntent = currentStructuredFields(input.draft);
  const currentInteraction = getAuthoringSessionInteraction(input.draft);
  const currentMessages = getAuthoringSessionSourceMessages(input.draft);

  const nextIntent: Record<string, unknown> = {
    ...currentIntent,
    ...(input.structuredFields ?? {}),
  };
  const nextInteraction: AuthoringInteractionStateOutput = {
    ...currentInteraction,
    latest_message: input.message?.trim() || currentInteraction.latest_message,
    answered_questions: [...currentInteraction.answered_questions],
    overrides: {
      metric: currentInteraction.overrides.metric,
      artifact_assignments: [
        ...currentInteraction.overrides.artifact_assignments,
      ],
    },
  };

  for (const answer of input.answers) {
    const question = questionById.get(answer.question_id);
    if (!question) {
      throw new AgoraError(
        `Question ${answer.question_id} is not pending on this session. Next step: reload the latest session state from Agora and retry.`,
        {
          status: 409,
          code: "AUTHORING_SESSION_UNKNOWN_QUESTION",
        },
      );
    }

    switch (question.field) {
      case "distribution":
        nextIntent.distribution = normalizeSelectAnswer({
          answer: answer.value,
          question,
          invalidCode: "AUTHORING_SESSION_INVALID_DISTRIBUTION",
        });
        break;
      case "metric":
        nextInteraction.overrides.metric = normalizeSelectAnswer({
          answer: answer.value,
          question,
          invalidCode: "AUTHORING_SESSION_INVALID_METRIC",
        });
        break;
      case "artifact_roles":
        nextInteraction.overrides.artifact_assignments =
          normalizeArtifactRoleAnswer({
            answer: answer.value,
            question,
            uploadedArtifacts: input.draft.uploaded_artifacts_json ?? [],
          });
        break;
      default:
        nextIntent[question.field] = normalizeTextAnswer({
          answer: answer.value,
          field: question.field,
        });
        break;
    }

    nextInteraction.answered_questions = [
      ...nextInteraction.answered_questions.filter(
        (entry) => entry.question_id !== answer.question_id,
      ),
      {
        question_id: answer.question_id,
        field: question.field,
        value_summary: summarizeAnswerValue(answer.value),
        answered_at: new Date().toISOString(),
      },
    ];
  }

  const trimmedMessage = input.message?.trim();
  const nextMessages =
    trimmedMessage && trimmedMessage.length > 0
      ? [
          ...currentMessages,
          {
            id: `session-msg-${randomUUID()}`,
            role: "poster" as const,
            content: trimmedMessage,
            created_at: new Date().toISOString(),
          },
        ]
      : currentMessages;

  return {
    intentCandidate: nextIntent,
    interaction: nextInteraction,
    sourceMessages: nextMessages,
    uploadedArtifacts: mergeAuthoringSessionArtifacts({
      current: input.draft.uploaded_artifacts_json ?? [],
      incoming: input.incomingArtifacts ?? [],
    }),
  };
}
