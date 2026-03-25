import {
  AgoraError,
  type DryRunPreviewOutput,
  type TrustedChallengeSpecOutput,
  resolveChallengeExecutionFromTrustedSpec,
} from "@agora/common";
import { getText } from "@agora/ipfs";
import { executeScoringPipeline } from "@agora/scorer";
import {
  type AuthoringStepResult,
  stepFailure,
  stepOk,
} from "./authoring-step.js";

type ExecuteScoringPipelineFn = typeof executeScoringPipeline;
type GetTextFn = typeof getText;

interface CsvRow {
  [key: string]: string;
}

function parseCsv(text: string): CsvRow[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return [];
  }
  const lines = trimmed.split(/\r?\n/);
  const header = lines[0]?.split(",").map((value) => value.trim()) ?? [];
  if (header.length === 0) {
    return [];
  }
  return lines.slice(1).flatMap((line) => {
    if (!line.trim()) {
      return [];
    }
    const values = line.split(",").map((value) => value.trim());
    if (values.length !== header.length) {
      return [];
    }
    return [
      Object.fromEntries(
        header.map((column, index) => [column, values[index] ?? ""]),
      ),
    ];
  });
}

function serializeCsv(header: string[], rows: CsvRow[]) {
  return `${header.join(",")}\n${rows
    .map((row) => header.map((column) => row[column] ?? "").join(","))
    .join("\n")}\n`;
}

function summarizeDryRunScore(input: {
  metric: string;
  score: number;
  details: Record<string, unknown>;
}) {
  const normalizedScore = `normalized score ${input.score.toFixed(6)}`;
  const selectedMetricValue =
    typeof input.details.selected_metric_value === "number"
      ? input.details.selected_metric_value
      : typeof input.details[input.metric] === "number"
        ? input.details[input.metric]
        : undefined;

  if (typeof selectedMetricValue === "number") {
    return `${normalizedScore} (${input.metric} ${selectedMetricValue.toFixed(6)})`;
  }

  return normalizedScore;
}

async function buildSubmissionSourceResult(input: {
  challengeSpec: TrustedChallengeSpecOutput;
  getTextImpl: GetTextFn;
}): Promise<AuthoringStepResult<{ content: string }>> {
  const execution = resolveChallengeExecutionFromTrustedSpec(
    input.challengeSpec,
  );
  const evaluationUri = execution.execution.evaluation_artifact_uri;
  if (!evaluationUri) {
    return stepFailure({
      kind: "awaiting_input",
      code: "AUTHORING_DRY_RUN_MISSING_EVALUATION_BUNDLE",
      message:
        "This challenge needs a hidden evaluation table before dry-run execution. Next step: attach the missing evaluation artifact and retry.",
      nextAction: "attach the missing evaluation artifact and retry.",
      blockingLayer: "dry_run",
      field: "execution",
      missingFields: [],
      candidateValues: [],
      reasonCodes: ["dry_run_missing_evaluation_bundle"],
      warnings: [],
    });
  }

  if (input.challengeSpec.submission_contract.kind !== "csv_table") {
    return stepFailure({
      kind: "awaiting_input",
      code: "AUTHORING_DRY_RUN_UNSUPPORTED_CONTRACT",
      message:
        "V1 dry-run requires a csv_table submission contract. Next step: use a table submission format and retry.",
      nextAction: "use a table submission format and retry.",
      blockingLayer: "dry_run",
      field: "execution",
      missingFields: [],
      candidateValues: [],
      reasonCodes: ["dry_run_unsupported_contract"],
      warnings: [],
    });
  }

  const bundleText = await input.getTextImpl(evaluationUri);
  const rows = parseCsv(bundleText);
  if (rows.length === 0) {
    return stepFailure({
      kind: "awaiting_input",
      code: "AUTHORING_DRY_RUN_EMPTY_EVALUATION_BUNDLE",
      message:
        "Agora could not build a dry-run submission because the evaluation bundle is empty. Next step: upload a non-empty evaluation file and retry.",
      nextAction: "upload a non-empty evaluation file and retry.",
      blockingLayer: "dry_run",
      field: "execution",
      missingFields: [],
      candidateValues: [],
      reasonCodes: ["dry_run_empty_evaluation_bundle"],
      warnings: [],
    });
  }

  const submissionContract = input.challengeSpec.submission_contract;
  if (submissionContract.kind !== "csv_table") {
    return stepFailure({
      kind: "awaiting_input",
      code: "AUTHORING_DRY_RUN_UNSUPPORTED_CONTRACT",
      message:
        "V1 dry-run requires a csv_table submission contract. Next step: use a table submission format and retry.",
      nextAction: "use a table submission format and retry.",
      blockingLayer: "dry_run",
      field: "execution",
      missingFields: [],
      candidateValues: [],
      reasonCodes: ["dry_run_unsupported_contract"],
      warnings: [],
    });
  }

  const submissionColumns = submissionContract.columns;
  const submissionIdColumn = submissionColumns.id;
  const submissionValueColumn = submissionColumns.value;
  const evaluationColumns = execution.execution.evaluation_contract.columns;
  if (!submissionIdColumn || !submissionValueColumn) {
    return stepFailure({
      kind: "awaiting_input",
      code: "AUTHORING_DRY_RUN_UNSUPPORTED_CONTRACT",
      message:
        "The submission contract is missing required ID/value columns. Next step: define the solver submission columns and retry.",
      nextAction: "define the solver submission columns and retry.",
      blockingLayer: "dry_run",
      field: "execution",
      missingFields: [],
      candidateValues: [],
      reasonCodes: ["dry_run_unsupported_contract"],
      warnings: [],
    });
  }

  const submissionRows: CsvRow[] = [];
  for (const row of rows) {
    const evaluationId = row[evaluationColumns.id];
    const evaluationValue = row[evaluationColumns.value];
    if (
      typeof evaluationId !== "string" ||
      evaluationId.length === 0 ||
      typeof evaluationValue !== "string" ||
      evaluationValue.length === 0
    ) {
      return stepFailure({
        kind: "awaiting_input",
        code: "AUTHORING_DRY_RUN_EVALUATION_FORMAT_UNSUPPORTED",
        message: `Agora could not derive dry-run predictions from the evaluation table. Next step: upload an evaluation file with ${evaluationColumns.id} and ${evaluationColumns.value} columns and retry.`,
        nextAction: `upload an evaluation file with ${evaluationColumns.id} and ${evaluationColumns.value} columns and retry.`,
        blockingLayer: "dry_run",
        field: "execution",
        missingFields: [],
        candidateValues: [],
        reasonCodes: ["dry_run_evaluation_format_unsupported"],
        warnings: [],
      });
    }
    submissionRows.push({
      [submissionIdColumn]: evaluationId,
      [submissionValueColumn]: evaluationValue,
    });
  }

  return stepOk({
    content: serializeCsv(submissionColumns.required, submissionRows),
  });
}

export async function executeAuthoringDryRunResult(
  input: {
    challengeSpec: TrustedChallengeSpecOutput;
    timeoutMs: number;
  },
  dependencies: {
    executeScoringPipelineImpl?: ExecuteScoringPipelineFn;
    getTextImpl?: GetTextFn;
  } = {},
): Promise<AuthoringStepResult<DryRunPreviewOutput>> {
  const executeScoringPipelineImpl =
    dependencies.executeScoringPipelineImpl ?? executeScoringPipeline;
  const getTextImpl = dependencies.getTextImpl ?? getText;
  const execution = resolveChallengeExecutionFromTrustedSpec(
    input.challengeSpec,
  );
  const submission = await buildSubmissionSourceResult({
    challengeSpec: input.challengeSpec,
    getTextImpl,
  });
  if (!submission.ok) {
    return submission;
  }

  const run = await executeScoringPipelineImpl({
    image: execution.image,
    evaluationBundle: execution.evaluationBundleCid
      ? { cid: execution.evaluationBundleCid }
      : undefined,
    mount: execution.mount,
    submission: submission.value,
    submissionContract: input.challengeSpec.submission_contract,
    evaluationContract: input.challengeSpec.execution.evaluation_contract,
    metric: execution.metric,
    policies: input.challengeSpec.execution.policies,
    timeoutMs: Math.min(input.timeoutMs, execution.limits.timeoutMs),
    limits: {
      memory: execution.limits.memory,
      cpus: execution.limits.cpus,
      pids: execution.limits.pids,
    },
  });

  try {
    if (!run.result.ok) {
      return stepFailure({
        kind: "awaiting_input",
        code: "AUTHORING_DRY_RUN_REJECTED",
        message: `Authoring dry-run failed: ${run.result.error ?? "the scorer rejected the sample submission"}. Next step: fix the uploaded files and retry.`,
        nextAction: "fix the uploaded files and retry.",
        blockingLayer: "dry_run",
        field: "execution",
        missingFields: [],
        candidateValues: [],
        reasonCodes: ["dry_run_rejected"],
        warnings: [],
      });
    }

    const sampleScore = summarizeDryRunScore({
      metric: execution.metric,
      score: run.result.score,
      details: run.result.details,
    });

    return stepOk({
      status: "validated",
      summary: `Agora executed the official scorer against a sample submission derived from the hidden evaluation table and got ${sampleScore}.`,
      sample_score: sampleScore,
    });
  } finally {
    await run.cleanup();
  }
}

export async function executeAuthoringDryRun(
  input: {
    challengeSpec: TrustedChallengeSpecOutput;
    timeoutMs: number;
  },
  dependencies: {
    executeScoringPipelineImpl?: ExecuteScoringPipelineFn;
    getTextImpl?: GetTextFn;
  } = {},
): Promise<DryRunPreviewOutput> {
  const result = await executeAuthoringDryRunResult(input, dependencies);
  if (result.ok) {
    return result.value;
  }
  throw new AgoraError(result.failure.message, {
    code: result.failure.code,
    status: result.failure.blockingLayer === "dry_run" ? 422 : 500,
  });
}
