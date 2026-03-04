import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_CHAIN_ID, validateChallengeSpec } from "@hermes/common";
import { executeScoringPipeline } from "@hermes/scorer";
import { Command } from "commander";
import yaml from "yaml";
import { printSuccess, printWarning, printJson } from "../lib/output";
import { createSpinner } from "../lib/spinner";

export function buildValidateCommand() {
    const cmd = new Command("validate")
        .description(
            "Validate a challenge YAML and dry-run its scoring container",
        )
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
            const parsed = validateChallengeSpec(spec, DEFAULT_CHAIN_ID);
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
            const container = parsed.data.scoring?.container;
            if (!container) {
                printWarning(
                    "No scoring.container in spec — cannot run Docker dry-run.",
                );
                printSuccess("Schema validation passed.");
                return;
            }

            const dockerSpinner = createSpinner(
                `Pulling and testing scorer container: ${container}`,
            );
            try {
                const run = await executeScoringPipeline({
                    image: container,
                    groundTruth: { content: "id,value\n1,0.5\n" },
                    submission: { content: "id,value\n1,0.5\n" },
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
                printWarning(
                    "Ensure the image is pullable: docker pull " + container,
                );
                process.exit(1);
            }
        });

    return cmd;
}
