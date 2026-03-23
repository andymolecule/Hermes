import {
  AgoraError,
  type ChallengeSpecOutput,
  type DryRunPreviewOutput,
  createCsvTableEvaluationContract,
  resolveChallengeEvaluation,
  resolveChallengeRunnerLimits,
} from "@agora/common";
import { getText } from "@agora/ipfs";
import { executeScoringPipeline } from "@agora/scorer";

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

async function buildSubmissionSource(input: {
  challengeSpec: ChallengeSpecOutput;
  getTextImpl: GetTextFn;
}) {
  const evalPlan = resolveChallengeEvaluation(input.challengeSpec);
  const evaluationUri = evalPlan.executionContract.evaluation_artifact_uri;
  if (!evaluationUri) {
    throw new AgoraError(
      "This challenge needs a hidden evaluation table before dry-run execution. Next step: attach the missing evaluation artifact and retry.",
      {
        code: "MANAGED_DRY_RUN_MISSING_EVALUATION_BUNDLE",
        status: 422,
      },
    );
  }

  if (input.challengeSpec.submission_contract.kind !== "csv_table") {
    throw new AgoraError(
      "V1 dry-run requires a csv_table submission contract. Next step: use a table submission format and retry.",
      {
        code: "MANAGED_DRY_RUN_UNSUPPORTED_CONTRACT",
        status: 500,
      },
    );
  }

  const bundleText = await input.getTextImpl(evaluationUri);
  const rows = parseCsv(bundleText);
  if (rows.length === 0) {
    throw new AgoraError(
      "Agora could not build a dry-run submission because the evaluation bundle is empty. Next step: upload a non-empty evaluation file and retry.",
      {
        code: "MANAGED_DRY_RUN_EMPTY_EVALUATION_BUNDLE",
        status: 422,
      },
    );
  }

  const submissionColumns = evalPlan.executionContract.submission_columns;
  const evaluationColumns = evalPlan.executionContract.evaluation_columns;
  const submissionRows = rows.map((row) => {
    const evaluationId = row[evaluationColumns.id];
    const evaluationValue = row[evaluationColumns.value];
    if (
      typeof evaluationId !== "string" ||
      evaluationId.length === 0 ||
      typeof evaluationValue !== "string" ||
      evaluationValue.length === 0
    ) {
      throw new AgoraError(
        `Agora could not derive dry-run predictions from the evaluation table. Next step: upload an evaluation file with ${evaluationColumns.id} and ${evaluationColumns.value} columns and retry.`,
        {
          code: "MANAGED_DRY_RUN_EVALUATION_FORMAT_UNSUPPORTED",
          status: 422,
        },
      );
    }
    return {
      [submissionColumns.id]: evaluationId,
      [submissionColumns.value]: evaluationValue,
    };
  });

  return {
    content: serializeCsv(submissionColumns.required, submissionRows),
  };
}

export async function executeManagedAuthoringDryRun(
  input: {
    challengeSpec: ChallengeSpecOutput;
    timeoutMs: number;
  },
  dependencies: {
    executeScoringPipelineImpl?: ExecuteScoringPipelineFn;
    getTextImpl?: GetTextFn;
  } = {},
): Promise<DryRunPreviewOutput> {
  return executeAuthoringDryRun(input, dependencies);
}

export async function executeAuthoringDryRun(
  input: {
    challengeSpec: ChallengeSpecOutput;
    timeoutMs: number;
  },
  dependencies: {
    executeScoringPipelineImpl?: ExecuteScoringPipelineFn;
    getTextImpl?: GetTextFn;
  } = {},
): Promise<DryRunPreviewOutput> {
  const executeScoringPipelineImpl =
    dependencies.executeScoringPipelineImpl ?? executeScoringPipeline;
  const getTextImpl = dependencies.getTextImpl ?? getText;
  const evalPlan = resolveChallengeEvaluation(input.challengeSpec);
  const runnerLimits = resolveChallengeRunnerLimits(evalPlan.template);
  const submission = await buildSubmissionSource({
    challengeSpec: input.challengeSpec,
    getTextImpl,
  });
  const evaluationContract = createCsvTableEvaluationContract({
    requiredColumns: evalPlan.executionContract.evaluation_columns.required,
    idColumn: evalPlan.executionContract.evaluation_columns.id,
    valueColumn: evalPlan.executionContract.evaluation_columns.value,
    allowExtraColumns: evalPlan.executionContract.evaluation_columns.allow_extra,
  });

  const run = await executeScoringPipelineImpl({
    image: evalPlan.image,
    evaluationBundle: evalPlan.evaluationBundleCid
      ? { cid: evalPlan.evaluationBundleCid }
      : undefined,
    mount: evalPlan.mount,
    submission,
    submissionContract: input.challengeSpec.submission_contract,
    evaluationContract,
    metric: evalPlan.metric,
    policies: evalPlan.executionContract.policies,
    timeoutMs: Math.min(
      input.timeoutMs,
      runnerLimits?.timeoutMs ?? input.timeoutMs,
    ),
    limits: runnerLimits
      ? {
          memory: runnerLimits.memory,
          cpus: runnerLimits.cpus,
          pids: runnerLimits.pids,
        }
      : undefined,
  });

  try {
    if (!run.result.ok) {
      throw new AgoraError(
        `Managed dry-run failed: ${run.result.error ?? "the scorer rejected the sample submission"}. Next step: fix the uploaded files and retry.`,
        {
          code: "MANAGED_DRY_RUN_REJECTED",
          status: 422,
          details: run.result.details,
        },
      );
    }

    const sampleScore = summarizeDryRunScore({
      metric: evalPlan.metric,
      score: run.result.score,
      details: run.result.details,
    });

    return {
      status: "validated",
      summary: `Agora executed the official scorer against a sample submission derived from the hidden evaluation table and got ${sampleScore}.`,
      sample_score: sampleScore,
    };
  } finally {
    await run.cleanup();
  }
}
