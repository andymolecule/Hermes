import {
  AUTHORING_DISTRIBUTION_VALUES,
  type AuthoringSessionValidationIssueOutput,
  type AuthoringSessionValidationOutput,
  type AuthoringValidationFieldOutput,
  CHALLENGE_DOMAINS,
  type ChallengeIntentOutput,
  type PartialChallengeIntentOutput,
  authoringSessionValidationSchema,
  challengeIntentSchema,
} from "@agora/common";
import type { z } from "zod";
import {
  deriveAuthoringIntentCandidate,
  extractMissingIntentFields,
} from "./authoring-ir.js";

const challengeIntentFieldSchemas = challengeIntentSchema.shape;
const challengeIntentFieldNames = Object.keys(
  challengeIntentFieldSchemas,
) as Array<keyof typeof challengeIntentFieldSchemas>;

export function classifyAuthoringBlockingLayer(
  code: string,
): AuthoringSessionValidationIssueOutput["blocking_layer"] {
  if (code.startsWith("AUTHORING_DRY_RUN_")) {
    return "dry_run";
  }
  if (code === "AUTHORING_PLATFORM_UNAVAILABLE") {
    return "platform";
  }
  return "input";
}

export function buildAuthoringValidationIssue(input: {
  field: string;
  code: string;
  message: string;
  nextAction: string;
  blockingLayer: AuthoringSessionValidationIssueOutput["blocking_layer"];
  candidateValues?: string[];
}): AuthoringSessionValidationIssueOutput {
  return {
    field: input.field,
    code: input.code,
    message: input.message,
    next_action: input.nextAction,
    blocking_layer: input.blockingLayer,
    candidate_values: input.candidateValues ?? [],
  };
}

export function emptyAuthoringValidation(): AuthoringSessionValidationOutput {
  return {
    missing_fields: [],
    invalid_fields: [],
    dry_run_failure: null,
    unsupported_reason: null,
  };
}

function buildMissingFieldPrompt(field: string) {
  switch (field) {
    case "title":
      return {
        message: "Agora still needs the challenge title.",
        nextAction: "Provide the title and retry.",
      };
    case "description":
      return {
        message: "Agora still needs the challenge description.",
        nextAction: "Provide the description and retry.",
      };
    case "payout_condition":
      return {
        message: "Agora still needs a deterministic winner rule.",
        nextAction: "Provide a deterministic payout condition and retry.",
      };
    case "reward_total":
      return {
        message: "Agora still needs the total reward amount.",
        nextAction: "Provide a valid reward_total and retry.",
      };
    case "deadline":
      return {
        message: "Agora still needs the challenge deadline.",
        nextAction: "Provide an exact deadline timestamp and retry.",
      };
    case "distribution":
      return {
        message: "Agora still needs the reward distribution.",
        nextAction: "Provide the distribution and retry.",
      };
    case "domain":
      return {
        message: "Agora still needs the challenge domain.",
        nextAction: "Provide the domain and retry.",
      };
    default:
      return {
        message: `Agora still needs ${field}.`,
        nextAction: `Provide ${field} and retry.`,
      };
  }
}

function getIntentCandidateValues(field: string) {
  switch (field) {
    case "domain":
      return [...CHALLENGE_DOMAINS];
    case "distribution":
      return [...AUTHORING_DISTRIBUTION_VALUES];
    default:
      return [];
  }
}

function buildInvalidFieldNextAction(field: string, candidateValues: string[]) {
  if (candidateValues.length > 0) {
    return `Provide one of the supported ${field} values and retry.`;
  }
  return `Provide a valid ${field} and retry.`;
}

function describeIssue(error: z.ZodError) {
  return error.issues[0]?.message ?? "Invalid value.";
}

export interface AssessedAuthoringIntent {
  acceptedIntent: PartialChallengeIntentOutput;
  parsedIntent: ChallengeIntentOutput | null;
  validation: AuthoringSessionValidationOutput;
  missingFields: AuthoringValidationFieldOutput[];
}

export function assessAuthoringIntentCandidate(input: {
  currentIntent?: PartialChallengeIntentOutput | null;
  intentCandidate?: Record<string, unknown> | null;
  sourceTitle?: string | null;
}): AssessedAuthoringIntent {
  const derivedCandidate = deriveAuthoringIntentCandidate({
    intent: {
      ...(input.currentIntent ?? {}),
      ...(input.intentCandidate ?? {}),
    },
    sourceTitle: input.sourceTitle,
  });
  const acceptedIntent: PartialChallengeIntentOutput = {
    ...(input.currentIntent ?? {}),
  };
  const acceptedIntentRecord = acceptedIntent as Record<string, unknown>;
  const invalidFields: AuthoringSessionValidationIssueOutput[] = [];
  const invalidFieldNames = new Set<string>();

  for (const field of challengeIntentFieldNames) {
    const rawValue = derivedCandidate[field];
    if (rawValue === undefined) {
      continue;
    }

    if (typeof rawValue === "string" && rawValue.trim().length === 0) {
      continue;
    }

    const parsedField = challengeIntentFieldSchemas[field].safeParse(rawValue);
    if (!parsedField.success) {
      invalidFieldNames.add(field);
      const candidateValues = getIntentCandidateValues(field);
      invalidFields.push(
        buildAuthoringValidationIssue({
          field,
          code: "AUTHORING_INVALID_FIELD",
          message: describeIssue(parsedField.error),
          nextAction: buildInvalidFieldNextAction(field, candidateValues),
          blockingLayer: "input",
          candidateValues,
        }),
      );
      continue;
    }

    acceptedIntentRecord[field] = parsedField.data;
  }

  const missingFields = extractMissingIntentFields(acceptedIntent).filter(
    (field) => !invalidFieldNames.has(field),
  );
  const validation = authoringSessionValidationSchema.parse({
    missing_fields: missingFields.map((field) => {
      const prompt = buildMissingFieldPrompt(field);
      return buildAuthoringValidationIssue({
        field,
        code: "AUTHORING_INPUT_REQUIRED",
        message: prompt.message,
        nextAction: prompt.nextAction,
        blockingLayer: "input",
        candidateValues: getIntentCandidateValues(field),
      });
    }),
    invalid_fields: invalidFields,
    dry_run_failure: null,
    unsupported_reason: null,
  });

  if (
    validation.missing_fields.length > 0 ||
    validation.invalid_fields.length > 0
  ) {
    return {
      acceptedIntent,
      parsedIntent: null,
      validation,
      missingFields,
    };
  }

  const parsedIntent = challengeIntentSchema.safeParse(acceptedIntent);
  if (!parsedIntent.success) {
    const firstField =
      typeof parsedIntent.error.issues[0]?.path[0] === "string"
        ? String(parsedIntent.error.issues[0]?.path[0])
        : "intent";
    const candidateValues = getIntentCandidateValues(firstField);
    return {
      acceptedIntent,
      parsedIntent: null,
      validation: authoringSessionValidationSchema.parse({
        missing_fields: [],
        invalid_fields: [
          buildAuthoringValidationIssue({
            field: firstField,
            code: "AUTHORING_INVALID_FIELD",
            message: describeIssue(parsedIntent.error),
            nextAction: buildInvalidFieldNextAction(
              firstField,
              candidateValues,
            ),
            blockingLayer: "input",
            candidateValues,
          }),
        ],
        dry_run_failure: null,
        unsupported_reason: null,
      }),
      missingFields: [],
    };
  }

  return {
    acceptedIntent,
    parsedIntent: parsedIntent.data,
    validation,
    missingFields,
  };
}
