import {
  type AuthoringArtifactOutput,
  type AuthoringValidationFieldOutput,
  type AuthoringValidationSnapshotOutput,
  type ChallengeAuthoringIrOutput,
  type ChallengeIntentInput,
  challengeAuthoringIrSchema,
} from "@agora/common";
import type { ExternalSourceMessageOutput } from "@agora/common";

type PartialIntent = Partial<ChallengeIntentInput> | null | undefined;

export const REQUIRED_AUTHORING_INTENT_FIELDS = [
  "title",
  "description",
  "payout_condition",
  "reward_total",
  "distribution",
  "domain",
  "deadline",
] as const satisfies readonly AuthoringValidationFieldOutput[];

function trimmed(value?: string | null) {
  if (typeof value !== "string") {
    return null;
  }
  const result = value.trim();
  return result.length > 0 ? result : null;
}

function summarizeTitle(description?: string | null) {
  const normalized = trimmed(description);
  if (!normalized) {
    return null;
  }
  const firstSentence = normalized.split(/(?<=[.!?])\s+/)[0] ?? normalized;
  const cleaned = firstSentence.replace(/[.!?]+$/, "").trim();
  return cleaned.slice(0, 160) || null;
}

export function deriveAuthoringIntentCandidate(input: {
  intent?: PartialIntent;
  sourceTitle?: string | null;
}) {
  const current = { ...(input.intent ?? {}) };
  if (!trimmed(current.title)) {
    const derivedTitle =
      trimmed(input.sourceTitle) ?? summarizeTitle(current.description);
    if (derivedTitle) {
      current.title = derivedTitle;
    }
  }
  return current;
}

export function extractMissingIntentFields(intent: PartialIntent) {
  return REQUIRED_AUTHORING_INTENT_FIELDS.filter((field) => {
    const value = intent?.[field];
    return typeof value !== "string" || value.trim().length === 0;
  });
}

function artifactId(artifact: AuthoringArtifactOutput, index: number) {
  return artifact.id?.trim() || `artifact-${index + 1}`;
}

export function buildAuthoringIr(input: {
  intent?: PartialIntent;
  uploadedArtifacts: AuthoringArtifactOutput[];
  sourceTitle?: string | null;
  sourceMessages?: ExternalSourceMessageOutput[];
  origin?: {
    provider: ChallengeAuthoringIrOutput["origin"]["provider"];
    external_id?: string | null;
    external_url?: string | null;
    ingested_at?: string;
    raw_context?: Record<string, unknown> | null;
  };
  template?: string | null;
  metric?: string | null;
  comparator?:
    | "maximize"
    | "minimize"
    | "closest_match"
    | "pass_fail"
    | "custom"
    | null;
  evaluationArtifactId?: string | null;
  visibleArtifactIds?: string[];
  evaluationIdColumn?: string | null;
  evaluationValueColumn?: string | null;
  submissionIdColumn?: string | null;
  submissionValueColumn?: string | null;
  compileError?: {
    code?: string | null;
    message?: string | null;
  } | null;
  rejectionReasons?: string[];
  assessmentInputHash?: string | null;
  assessmentOutcome?: "ready" | "awaiting_input" | "rejected" | null;
  assessmentReasonCodes?: string[];
  assessmentWarnings?: string[];
  missingFields?: AuthoringValidationFieldOutput[];
  validationSnapshot?: AuthoringValidationSnapshotOutput | null;
}) {
  const effectiveIntent = deriveAuthoringIntentCandidate({
    intent: input.intent,
    sourceTitle: input.sourceTitle,
  });
  const missingFields =
    input.missingFields ?? extractMissingIntentFields(effectiveIntent);

  return challengeAuthoringIrSchema.parse({
    version: 5,
    origin: {
      provider: input.origin?.provider ?? "direct",
      external_id: input.origin?.external_id ?? null,
      external_url: input.origin?.external_url ?? null,
      ingested_at: input.origin?.ingested_at ?? new Date().toISOString(),
      raw_context: input.origin?.raw_context ?? null,
    },
    source: {
      title:
        trimmed(input.sourceTitle) ?? trimmed(effectiveIntent.title) ?? null,
      poster_messages: (input.sourceMessages ?? []).map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        created_at: message.created_at ?? new Date().toISOString(),
      })),
      uploaded_artifact_ids: input.uploadedArtifacts.map(artifactId),
    },
    intent: {
      current: effectiveIntent,
      missing_fields: missingFields,
    },
    assessment: {
      input_hash: input.assessmentInputHash ?? null,
      outcome: input.assessmentOutcome ?? null,
      reason_codes: input.assessmentReasonCodes ?? [],
      warnings: input.assessmentWarnings ?? [],
      missing_fields: missingFields,
    },
    validation_snapshot: input.validationSnapshot ?? null,
    execution: {
      template: input.template ?? null,
      metric: input.metric ?? null,
      comparator: input.comparator ?? null,
      evaluation_artifact_id: input.evaluationArtifactId ?? null,
      visible_artifact_ids: input.visibleArtifactIds ?? [],
      evaluation_columns: {
        id: input.evaluationIdColumn ?? null,
        value: input.evaluationValueColumn ?? null,
      },
      submission_columns: {
        id: input.submissionIdColumn ?? null,
        value: input.submissionValueColumn ?? null,
      },
      rejection_reasons: input.rejectionReasons ?? [],
      compile_error_codes:
        input.compileError?.code != null ? [input.compileError.code] : [],
      compile_error_message: input.compileError?.message ?? null,
    },
  });
}
