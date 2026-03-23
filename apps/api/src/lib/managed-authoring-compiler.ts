import {
  AgoraError,
  AUTHORING_QUESTION_FIELDS,
  type AuthoringArtifactOutput,
  type ChallengeIntentOutput,
  lookupManagedRuntimeFamily,
  readManagedAuthoringRuntimeConfig,
  validateRuntimeMetric,
} from "@agora/common";
import { z } from "zod";

export type SupportedRuntimeFamily =
  | "reproducibility"
  | "tabular_regression"
  | "tabular_classification"
  | "ranking"
  | "docking";

export interface CompilerArtifactAssignment {
  artifactIndex: number;
  role: string;
  visibility: "public" | "private";
}

export interface CompilerProposal {
  runtimeFamily: SupportedRuntimeFamily;
  metric: string;
  reasonCodes: string[];
  warnings: string[];
  artifactAssignments?: CompilerArtifactAssignment[];
}

const supportedRuntimeFamilyIds = [
  "reproducibility",
  "tabular_regression",
  "tabular_classification",
  "ranking",
  "docking",
] as const satisfies readonly SupportedRuntimeFamily[];

const compilerToolResultSchema = z.object({
  outcome: z.enum(["supported", "awaiting_input", "unsupported"]),
  runtime_family: z.enum(supportedRuntimeFamilyIds).nullable(),
  metric: z.string().trim().min(1).nullable(),
  reason_codes: z.array(z.string().trim().min(1)).default([]),
  warnings: z.array(z.string().trim().min(1)).default([]),
  missing_fields: z.array(z.enum(AUTHORING_QUESTION_FIELDS)).default([]),
  artifact_assignments: z
    .array(
      z.object({
        artifact_index: z.number().int().min(0),
        role: z.string().trim().min(1),
        visibility: z.enum(["public", "private"]),
      }),
    )
    .default([]),
});

const RECOVERABLE_UNSUPPORTED_REASON_CODES = new Set([
  "custom_rubric_scoring",
  "manual_judging_required",
  "multi_criteria_evaluation",
  "no_deterministic_metric",
  "missing_metric_definition",
]);

function inferLikelyRuntimeFamily(input: {
  intent: ChallengeIntentOutput;
  uploadedArtifacts: AuthoringArtifactOutput[];
}): SupportedRuntimeFamily | null {
  const textSignals = [
    input.intent.title,
    input.intent.description,
    input.intent.payout_condition,
    ...input.intent.tags,
    ...input.uploadedArtifacts.map((artifact) => artifact.file_name ?? ""),
    ...input.uploadedArtifacts.flatMap(
      (artifact) => artifact.detected_columns ?? [],
    ),
  ]
    .join(" ")
    .toLowerCase();

  if (
    /\b(dock|docking|ligand|ligands|pdb|pose|poses|target structure|protein structure|pocket)\b/.test(
      textSignals,
    )
  ) {
    return "docking";
  }

  return null;
}

function buildRecoverableUnsupportedDetails(input: {
  parsed: z.infer<typeof compilerToolResultSchema>;
  intent: ChallengeIntentOutput;
  uploadedArtifacts: AuthoringArtifactOutput[];
}) {
  if (input.parsed.outcome !== "unsupported") {
    return null;
  }
  if (
    !input.parsed.reason_codes.some((code) =>
      RECOVERABLE_UNSUPPORTED_REASON_CODES.has(code),
    )
  ) {
    return null;
  }

  const runtimeFamily =
    input.parsed.runtime_family ??
    inferLikelyRuntimeFamily({
      intent: input.intent,
      uploadedArtifacts: input.uploadedArtifacts,
    });
  if (!runtimeFamily) {
    return null;
  }

  const missingFields = new Set(input.parsed.missing_fields);
  const family = lookupManagedRuntimeFamily(runtimeFamily);
  if (
    input.parsed.reason_codes.some((code) =>
      [
        "custom_rubric_scoring",
        "manual_judging_required",
        "multi_criteria_evaluation",
        "no_deterministic_metric",
        "missing_metric_definition",
      ].includes(code),
    )
  ) {
    missingFields.add("payout_condition");
    missingFields.add("metric");
  }

  const missingRoles =
    family?.supportedArtifactRoles.filter(
      (role) =>
        !input.parsed.artifact_assignments.some(
          (assignment) => assignment.role === role,
        ),
    ) ?? [];
  if (missingRoles.length > 0) {
    missingFields.add("artifact_roles");
  }

  return {
    runtimeFamily,
    missingFields: [...missingFields],
    missingRoles,
  };
}

function buildCompilerCatalog() {
  return supportedRuntimeFamilyIds.map((runtimeFamilyId) => {
    const family = lookupManagedRuntimeFamily(runtimeFamilyId);
    return {
      id: runtimeFamilyId,
      display_name: family?.displayName ?? runtimeFamilyId,
      description: family?.description ?? "",
      supported_metrics:
        family?.supportedMetrics.map((metric) => ({
          id: metric.id,
          direction: metric.direction,
          label: metric.label,
        })) ?? [],
      supported_artifact_roles: family?.supportedArtifactRoles ?? [],
      submission_kind: family?.submissionKind ?? null,
      requires_evaluation_bundle: family?.requiresEvaluationBundle ?? false,
      default_visibility: family?.defaultVisibility ?? null,
    };
  });
}

function buildSystemPrompt() {
  return [
    "You map poster intent and uploaded artifact metadata to one supported Agora Gems scoring family.",
    "Choose only from the supported runtime catalog.",
    "Do not invent runtime families, metrics, or artifact roles.",
    `If the task is still missing required information, return outcome=awaiting_input and choose missing_fields only from: ${AUTHORING_QUESTION_FIELDS.join(", ")}.`,
    "If the task does not fit any current Gems scorer cleanly, return outcome=unsupported with specific reason codes.",
    "Do not produce prose outside the tool result.",
    `Supported runtime catalog: ${JSON.stringify(buildCompilerCatalog())}`,
  ].join("\n");
}

function buildUserPayload(input: {
  intent: ChallengeIntentOutput;
  uploadedArtifacts: AuthoringArtifactOutput[];
}) {
  return {
    intent: input.intent,
    uploaded_artifacts: input.uploadedArtifacts.map((artifact, index) => ({
      index,
      file_name: artifact.file_name ?? null,
      uri: artifact.uri,
      mime_type: artifact.mime_type ?? null,
      detected_columns: artifact.detected_columns ?? [],
    })),
  };
}

function buildToolDefinition() {
  return {
    name: "return_managed_authoring_assessment",
    description:
      "Return a machine-readable mapping from challenge intent to a supported Agora Gems scorer.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        outcome: {
          type: "string",
          enum: ["supported", "awaiting_input", "unsupported"],
        },
        runtime_family: {
          anyOf: [
            { type: "string", enum: [...supportedRuntimeFamilyIds] },
            { type: "null" },
          ],
        },
        metric: {
          anyOf: [{ type: "string" }, { type: "null" }],
        },
        reason_codes: {
          type: "array",
          items: { type: "string" },
        },
        warnings: {
          type: "array",
          items: { type: "string" },
        },
        missing_fields: {
          type: "array",
          items: {
            type: "string",
            enum: [...AUTHORING_QUESTION_FIELDS],
          },
        },
        artifact_assignments: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              // Anthropic's custom tool schema rejects numeric bounds on integer.
              // Keep transport schema simple and enforce non-negative indexes after parse.
              artifact_index: { type: "integer" },
              role: { type: "string" },
              visibility: {
                type: "string",
                enum: ["public", "private"],
              },
            },
            required: ["artifact_index", "role", "visibility"],
          },
        },
      },
      required: [
        "outcome",
        "runtime_family",
        "metric",
        "reason_codes",
        "warnings",
        "missing_fields",
        "artifact_assignments",
      ],
    },
  };
}

function readToolResult(payload: {
  error?: { message?: string };
  content?: Array<{
    type?: string;
    input?: unknown;
    text?: string;
  }>;
}) {
  const toolUse = payload.content?.find((item) => item.type === "tool_use");
  if (toolUse?.input) {
    return toolUse.input;
  }

  const text = payload.content
    ?.map((item) => item.text ?? "")
    .join("")
    .trim();
  if (text) {
    return JSON.parse(text) as unknown;
  }

  throw new Error(
    payload.error?.message ??
      "Managed authoring assessor returned an empty response.",
  );
}

export class AnthropicCompilerProvider {
  constructor(
    private readonly config = readManagedAuthoringRuntimeConfig(),
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async compile(input: {
    intent: ChallengeIntentOutput;
    uploadedArtifacts: AuthoringArtifactOutput[];
  }): Promise<CompilerProposal> {
    if (!this.config.apiKey) {
      throw new Error(
        "Managed authoring Anthropic assessor requires AGORA_MANAGED_AUTHORING_API_KEY. Next step: set the API key and retry.",
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.fetchImpl(
        `${this.config.baseUrl.replace(/\/$/, "")}/messages`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": this.config.apiKey,
            "anthropic-version": "2023-06-01",
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: this.config.model,
            max_tokens: 1_200,
            temperature: 0,
            system: buildSystemPrompt(),
            messages: [
              {
                role: "user",
                content: JSON.stringify(buildUserPayload(input), null, 2),
              },
            ],
            tools: [buildToolDefinition()],
            tool_choice: {
              type: "tool",
              name: "return_managed_authoring_assessment",
            },
          }),
        },
      );

      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `Managed authoring assessor request failed with ${response.status}. Next step: verify AGORA_MANAGED_AUTHORING_MODEL/API_KEY and retry. ${body}`,
        );
      }

      const payload = (await response.json()) as {
        error?: { message?: string };
        content?: Array<{
          type?: string;
          input?: unknown;
          text?: string;
        }>;
      };
      const parsed = compilerToolResultSchema.parse(readToolResult(payload));
      const recoverableUnsupported = buildRecoverableUnsupportedDetails({
        parsed,
        intent: input.intent,
        uploadedArtifacts: input.uploadedArtifacts,
      });

      if (parsed.outcome === "awaiting_input") {
        throw new AgoraError(
          "Agora needs one or more missing details before it can choose a Gems scorer. Next step: answer the returned questions and resubmit.",
          {
            code: "MANAGED_COMPILER_NEEDS_INPUT",
            status: 422,
            details: {
              missingFields: parsed.missing_fields,
              reasonCodes: parsed.reason_codes,
              warnings: parsed.warnings,
              runtimeFamily: parsed.runtime_family,
            },
          },
        );
      }

      if (recoverableUnsupported) {
        throw new AgoraError(
          "Agora recognized a likely Gems scorer family, but it still needs a deterministic metric and the scorer-driving files before it can continue. Next step: answer the returned questions and resubmit.",
          {
            code: "MANAGED_COMPILER_NEEDS_INPUT",
            status: 422,
            details: {
              missingFields: recoverableUnsupported.missingFields,
              missingRoles: recoverableUnsupported.missingRoles,
              reasonCodes: parsed.reason_codes,
              warnings: parsed.warnings,
              runtimeFamily: recoverableUnsupported.runtimeFamily,
            },
          },
        );
      }

      if (parsed.outcome === "unsupported" || !parsed.runtime_family) {
        throw new AgoraError(
          "Agora could not map this challenge to a supported Gems scorer. Next step: make the scoring objective more explicit or switch to a custom scorer path.",
          {
            code: "MANAGED_COMPILER_UNSUPPORTED",
            status: 422,
            details: {
              reasonCodes: parsed.reason_codes,
            },
          },
        );
      }

      if (!parsed.metric) {
        throw new AgoraError(
          "Agora needs one or more missing details before it can choose the right metric. Next step: answer the returned questions and resubmit.",
          {
            code: "MANAGED_COMPILER_NEEDS_INPUT",
            status: 422,
            details: {
              missingFields:
                parsed.missing_fields.length > 0
                  ? parsed.missing_fields
                  : ["metric"],
              reasonCodes: parsed.reason_codes,
              warnings: parsed.warnings,
              runtimeFamily: parsed.runtime_family,
            },
          },
        );
      }

      const metricError = validateRuntimeMetric(
        parsed.runtime_family,
        parsed.metric,
      );
      if (metricError) {
        throw new Error(
          `${metricError} Next step: choose a supported metric and retry.`,
        );
      }

      const family = lookupManagedRuntimeFamily(parsed.runtime_family);
      for (const assignment of parsed.artifact_assignments) {
        if (
          assignment.artifact_index < 0 ||
          assignment.artifact_index >= input.uploadedArtifacts.length
        ) {
          throw new Error(
            `Managed authoring assessor referenced missing artifact index ${assignment.artifact_index}. Next step: retry the submit request.`,
          );
        }
        if (!family?.supportedArtifactRoles.includes(assignment.role)) {
          throw new Error(
            `Managed authoring assessor returned unsupported artifact role ${assignment.role} for ${parsed.runtime_family}. Next step: retry the submit request.`,
          );
        }
      }

      return {
        runtimeFamily: parsed.runtime_family,
        metric: parsed.metric,
        reasonCodes: parsed.reason_codes,
        warnings: parsed.warnings,
        artifactAssignments: parsed.artifact_assignments.map((assignment) => ({
          artifactIndex: assignment.artifact_index,
          role: assignment.role,
          visibility: assignment.visibility,
        })),
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export async function compileManagedAuthoringProposal(input: {
  intent: ChallengeIntentOutput;
  uploadedArtifacts: AuthoringArtifactOutput[];
  fetchImpl?: typeof fetch;
}): Promise<CompilerProposal> {
  try {
    return await new AnthropicCompilerProvider(
      readManagedAuthoringRuntimeConfig(),
      input.fetchImpl,
    ).compile({
      intent: input.intent,
      uploadedArtifacts: input.uploadedArtifacts,
    });
  } catch (error) {
    if (error instanceof AgoraError) {
      throw error;
    }
    throw new AgoraError(
      `Managed authoring assessor failed. Next step: retry the submit request. ${error instanceof Error ? error.message : String(error)}`,
      {
        code: "MANAGED_COMPILER_PROVIDER_FAILED",
        status: 502,
      },
    );
  }
}
