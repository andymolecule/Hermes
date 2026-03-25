import fs from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_CHAIN_ID,
  type SubmissionContractOutput,
  createCsvTableEvaluationContract,
  resolveChallengeExecutionFromTrustedSpec,
  validateTrustedChallengeSpec,
} from "@agora/common";
import { executeScoringPipeline } from "@agora/scorer";
import { Command } from "commander";
import yaml from "yaml";
import { printJson, printSuccess, printWarning } from "../lib/output";
import { createSpinner } from "../lib/spinner";

function buildCsvDryRunRow(
  requiredColumns: string[],
  idColumn?: string,
  valueColumn?: string,
) {
  return requiredColumns
    .map((column) => {
      if (column === idColumn) return "row-1";
      if (column === valueColumn) return "1.0";
      return "1";
    })
    .join(",");
}

function buildDryRunInputs(input: {
  evaluationColumns: {
    required: string[];
    id: string;
    value: string;
  };
  submissionContract: SubmissionContractOutput;
}) {
  if (input.submissionContract.kind !== "csv_table") {
    return {
      submission: { content: "placeholder\n" },
      evaluationBundle: { content: "placeholder\n" },
      submissionContract: input.submissionContract,
    };
  }

  const submissionColumns = input.submissionContract.columns.required;
  const submissionContent = `${submissionColumns.join(",")}\n${buildCsvDryRunRow(
    submissionColumns,
    input.submissionContract.columns.id,
    input.submissionContract.columns.value,
  )}\n`;
  const evaluationContent = `${input.evaluationColumns.required.join(",")}\n${buildCsvDryRunRow(
    input.evaluationColumns.required,
    input.evaluationColumns.id,
    input.evaluationColumns.value,
  )}\n`;

  return {
    submission: { content: submissionContent },
    evaluationBundle: { content: evaluationContent },
    submissionContract: input.submissionContract,
  };
}

export function buildValidateCommand() {
  const cmd = new Command("validate")
    .description("Validate a challenge YAML and dry-run its scoring container")
    .argument("<specPath>", "Path to challenge YAML file")
    .option("--skip-docker", "Only validate schema, skip scorer dry-run")
    .action(async (specPath: string, opts: { skipDocker?: boolean }) => {
      const absPath = path.resolve(process.cwd(), specPath);
      const raw = await fs.readFile(absPath, "utf8");
      let spec: unknown;
      try {
        spec = yaml.parse(raw);
      } catch {
        throw new Error(`Failed to parse YAML file: ${absPath}`);
      }

      // 1. Schema validation
      const schemaSpinner = createSpinner("Validating schema...");
      const parsed = validateTrustedChallengeSpec(spec, DEFAULT_CHAIN_ID);
      if (!parsed.success) {
        schemaSpinner.fail("Schema validation failed");
        for (const issue of parsed.error.issues) {
          printWarning(`  ${issue.path.join(".")}: ${issue.message}`);
        }
        process.exit(1);
      }
      schemaSpinner.succeed("Schema valid");

      if (opts.skipDocker) {
        printSuccess("Schema validation passed (Docker dry-run skipped).");
        return;
      }

      // 2. Docker dry-run
      const container = parsed.data.execution.scorer_image;
      if (!container) {
        printWarning(
          "No execution.scorer_image in spec — cannot run Docker dry-run.",
        );
        printSuccess("Schema validation passed.");
        return;
      }

      const dockerSpinner = createSpinner(
        `Pulling and testing scorer container: ${container}`,
      );
      try {
        const execution = resolveChallengeExecutionFromTrustedSpec(parsed.data);
        const dryRunInputs = buildDryRunInputs({
          evaluationColumns: {
            required: execution.execution.evaluation_contract.columns.required,
            id: execution.execution.evaluation_contract.columns.id,
            value: execution.execution.evaluation_contract.columns.value,
          },
          submissionContract: parsed.data.submission_contract,
        });
        const run = await executeScoringPipeline({
          image: execution.image,
          evaluationBundle: dryRunInputs.evaluationBundle,
          mount: execution.mount,
          submission: dryRunInputs.submission,
          submissionContract: dryRunInputs.submissionContract,
          evaluationContract: createCsvTableEvaluationContract({
            requiredColumns:
              execution.execution.evaluation_contract.columns.required,
            idColumn: execution.execution.evaluation_contract.columns.id,
            valueColumn: execution.execution.evaluation_contract.columns.value,
            allowExtraColumns:
              execution.execution.evaluation_contract.columns.allow_extra,
          }),
          metric: execution.metric,
          policies: execution.execution.policies,
          timeoutMs: 5 * 60 * 1000, // 5 min for dry-run
        });

        dockerSpinner.succeed("Scorer container ran successfully");
        printSuccess(`Dry-run score: ${run.result.score}`);
        printJson({
          score: run.result.score,
          details: run.result.details,
          containerDigest: run.result.containerImageDigest,
        });
      } catch (err) {
        dockerSpinner.fail("Scorer container failed");
        printWarning(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
        printWarning(
          "The scoring container may require real data to produce valid output.",
        );
        printWarning(`Ensure the image is pullable: docker pull ${container}`);
        process.exit(1);
      }
    });

  return cmd;
}
