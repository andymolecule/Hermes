import {
  AgoraError,
  AUTHORING_QUESTION_FIELDS,
  type AuthoringArtifactOutput,
  type ChallengeIntentOutput,
  deriveComparatorFromMetric,
  lookupExecutionTemplate,
  readManagedAuthoringRuntimeConfig,
  validateExecutionTemplateMetric,
} from "@agora/common";
import { z } from "zod";

export type SupportedExecutionTemplate = "official_table_metric_v1";

export interface CompilerProposal {
  template: SupportedExecutionTemplate;
  metric: string;
  comparator: "maximize" | "minimize";
  evaluationArtifactIndex: number;
  evaluationIdColumn: string;
  evaluationValueColumn: string;
  submissionIdColumn: string;
  submissionValueColumn: string;
  reasonCodes: string[];
  warnings: string[];
}

const compilerToolResultSchema = z.object({
  outcome: z.enum(["supported", "awaiting_input", "unsupported"]),
  metric: z.string().trim().min(1).nullable(),
  evaluation_artifact_index: z.number().int().min(0).nullable(),
  evaluation_id_column: z.string().trim().min(1).nullable(),
  evaluation_value_column: z.string().trim().min(1).nullable(),
  submission_id_column: z.string().trim().min(1).nullable(),
  submission_value_column: z.string().trim().min(1).nullable(),
  reason_codes: z.array(z.string().trim().min(1)).default([]),
  warnings: z.array(z.string().trim().min(1)).default([]),
  missing_fields: z.array(z.enum(AUTHORING_QUESTION_FIELDS)).default([]),
});

function buildSystemPrompt() {
  const template = lookupExecutionTemplate("official_table_metric_v1");
  return [
    "You convert poster intent and uploaded artifact metadata into one explicit Agora table-scoring contract.",
    "Do not classify the task into legacy runtime families.",
    "The only standard execution target is the official table scorer template official_table_metric_v1.",
    `Supported metrics for this template: ${template?.supportedMetrics
      .map((metric) => `${metric.id} (${metric.comparator})`)
      .join(", ")}`,
    `If the task is missing required information, return outcome=awaiting_input and choose missing_fields only from: ${AUTHORING_QUESTION_FIELDS.join(", ")}.`,
    "Use evaluation_artifact_index for the one hidden ground-truth table if it is obvious.",
    "Choose evaluation_id_column and evaluation_value_column from the selected evaluation file's detected columns when possible.",
    "submission_id_column should usually match evaluation_id_column unless the poster clearly says otherwise.",
    "submission_value_column is the solver-predicted value column name. If unclear, ask for it.",
    "Return unsupported only when the challenge fundamentally cannot be reduced to deterministic table scoring under the official table scorer.",
    "Do not produce prose outside the tool result.",
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
    name: "return_table_execution_assessment",
    description:
      "Return a machine-readable assessment for the official Agora table scorer path.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        outcome: {
          type: "string",
          enum: ["supported", "awaiting_input", "unsupported"],
        },
        metric: {
          anyOf: [{ type: "string" }, { type: "null" }],
        },
        evaluation_artifact_index: {
          anyOf: [{ type: "integer" }, { type: "null" }],
        },
        evaluation_id_column: {
          anyOf: [{ type: "string" }, { type: "null" }],
        },
        evaluation_value_column: {
          anyOf: [{ type: "string" }, { type: "null" }],
        },
        submission_id_column: {
          anyOf: [{ type: "string" }, { type: "null" }],
        },
        submission_value_column: {
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
      },
      required: [
        "outcome",
        "metric",
        "evaluation_artifact_index",
        "evaluation_id_column",
        "evaluation_value_column",
        "submission_id_column",
        "submission_value_column",
        "reason_codes",
        "warnings",
        "missing_fields",
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

function defaultEvaluationArtifactIndex(uploadedArtifacts: AuthoringArtifactOutput[]) {
  return uploadedArtifacts.length === 1 ? 0 : null;
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
              name: "return_table_execution_assessment",
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

      if (parsed.outcome === "awaiting_input") {
        throw new AgoraError(
          "Agora needs one or more missing details before it can finish the table scoring contract. Next step: answer the returned questions and resubmit.",
          {
            code: "MANAGED_COMPILER_NEEDS_INPUT",
            status: 422,
            details: {
              missingFields: parsed.missing_fields,
              reasonCodes: parsed.reason_codes,
              warnings: parsed.warnings,
            },
          },
        );
      }

      if (parsed.outcome === "unsupported") {
        throw new AgoraError(
          "Agora could not reduce this challenge to deterministic table scoring with the official table scorer. Next step: make the scoring objective more explicit or switch to a custom scorer path.",
          {
            code: "MANAGED_COMPILER_UNSUPPORTED",
            status: 422,
            details: {
              reasonCodes: parsed.reason_codes,
            },
          },
        );
      }

      const metric = parsed.metric;
      if (!metric) {
        throw new AgoraError(
          "Agora still needs the scoring metric before it can continue. Next step: answer the metric question and resubmit.",
          {
            code: "MANAGED_COMPILER_NEEDS_INPUT",
            status: 422,
            details: {
              missingFields: ["metric"],
              reasonCodes: parsed.reason_codes,
              warnings: parsed.warnings,
            },
          },
        );
      }
      const metricError = validateExecutionTemplateMetric(
        "official_table_metric_v1",
        metric,
      );
      if (metricError) {
        throw new AgoraError(`${metricError} Next step: choose a supported metric and retry.`, {
          code: "MANAGED_COMPILER_NEEDS_INPUT",
          status: 422,
          details: {
            missingFields: ["metric"],
            reasonCodes: parsed.reason_codes,
            warnings: parsed.warnings,
          },
        });
      }

      const comparator = deriveComparatorFromMetric(
        "official_table_metric_v1",
        metric,
      );
      if (!comparator) {
        throw new AgoraError(
          "Agora could not derive the comparator for the selected metric. Next step: choose a supported metric and retry.",
          {
            code: "MANAGED_COMPILER_NEEDS_INPUT",
            status: 422,
            details: {
              missingFields: ["metric"],
              reasonCodes: parsed.reason_codes,
              warnings: parsed.warnings,
            },
          },
        );
      }

      const evaluationArtifactIndex =
        parsed.evaluation_artifact_index ??
        defaultEvaluationArtifactIndex(input.uploadedArtifacts);
      const evaluationIdColumn =
        parsed.evaluation_id_column ?? null;
      const evaluationValueColumn =
        parsed.evaluation_value_column ?? null;
      const submissionIdColumn =
        parsed.submission_id_column ?? evaluationIdColumn;
      const submissionValueColumn =
        parsed.submission_value_column ?? null;

      const missingFields = new Set<string>();
      if (evaluationArtifactIndex === null) {
        missingFields.add("evaluation_artifact");
      }
      if (!evaluationIdColumn) {
        missingFields.add("evaluation_id_column");
      }
      if (!evaluationValueColumn) {
        missingFields.add("evaluation_value_column");
      }
      if (!submissionIdColumn) {
        missingFields.add("submission_id_column");
      }
      if (!submissionValueColumn) {
        missingFields.add("submission_value_column");
      }

      if (missingFields.size > 0) {
        throw new AgoraError(
          "Agora needs a few more scoring-contract fields before it can continue. Next step: answer the returned questions and resubmit.",
          {
            code: "MANAGED_COMPILER_NEEDS_INPUT",
            status: 422,
            details: {
              missingFields: [...new Set([...parsed.missing_fields, ...missingFields])] as string[],
              reasonCodes: parsed.reason_codes,
              warnings: parsed.warnings,
            },
          },
        );
      }

      if (
        evaluationArtifactIndex === null ||
        !evaluationIdColumn ||
        !evaluationValueColumn ||
        !submissionIdColumn ||
        !submissionValueColumn
      ) {
        throw new Error(
          "Managed authoring assessor returned an incomplete scoring contract after missing-field validation. Next step: retry the submit request.",
        );
      }

      if (
        evaluationArtifactIndex < 0 ||
        evaluationArtifactIndex >= input.uploadedArtifacts.length
      ) {
        throw new Error(
          `Managed authoring assessor referenced missing artifact index ${evaluationArtifactIndex}. Next step: retry the submit request.`,
        );
      }

      return {
        template: "official_table_metric_v1",
        metric,
        comparator,
        evaluationArtifactIndex,
        evaluationIdColumn,
        evaluationValueColumn,
        submissionIdColumn,
        submissionValueColumn,
        reasonCodes: parsed.reason_codes,
        warnings: parsed.warnings,
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
