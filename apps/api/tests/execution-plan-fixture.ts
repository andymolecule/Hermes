import {
  createChallengeExecution,
  createCsvTableEvaluationContract,
  createCsvTableSubmissionContract,
  resolveOfficialScorerImage,
  resolveOfficialScorerLimits,
  resolveOfficialScorerMount,
  type ChallengeExecutionPlanCacheRow,
  type OfficialScorerComparatorOutput,
} from "@agora/common";

export function createExecutionPlanFixture(input?: {
  metric?: string;
  comparator?: OfficialScorerComparatorOutput;
  scorerImage?: string;
  evaluationArtifactUri?: string;
}): ChallengeExecutionPlanCacheRow {
  const template = "official_table_metric_v1";
  const scorerImage =
    input?.scorerImage ?? resolveOfficialScorerImage(template);
  const mount = resolveOfficialScorerMount(template);
  const limits = resolveOfficialScorerLimits(template);

  if (!scorerImage || !mount || !limits) {
    throw new Error(
      "Missing official scorer fixture configuration. Next step: define the official scorer catalog entry and retry.",
    );
  }

  const execution = createChallengeExecution({
    template,
    scorerImage,
    metric: input?.metric ?? "r2",
    comparator: input?.comparator ?? "maximize",
    evaluationArtifactUri: input?.evaluationArtifactUri ?? "ipfs://bundle",
    evaluationContract: createCsvTableEvaluationContract({
      requiredColumns: ["id", "label"],
      idColumn: "id",
      valueColumn: "label",
      allowExtraColumns: false,
    }),
    policies: {
      coverage_policy: "ignore",
      duplicate_id_policy: "ignore",
      invalid_value_policy: "ignore",
    },
  });

  return {
    version: "v1",
    template,
    scorer_image: execution.scorer_image,
    metric: execution.metric,
    comparator: execution.comparator,
    mount: {
      evaluation_bundle_name: mount.evaluationBundleName,
      submission_file_name: mount.submissionFileName,
    },
    limits: {
      memory: limits.memory,
      cpus: limits.cpus,
      pids: limits.pids,
      timeout_ms: limits.timeoutMs,
    },
    evaluation_artifact_uri: execution.evaluation_artifact_uri,
    evaluation_contract: execution.evaluation_contract,
    submission_contract: createCsvTableSubmissionContract({
      requiredColumns: ["id", "prediction"],
      idColumn: "id",
      valueColumn: "prediction",
      allowExtraColumns: false,
    }),
    policies: execution.policies,
  };
}
