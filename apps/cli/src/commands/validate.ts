import fs from "node:fs/promises";
import path from "node:path";
import { challengeSpecSchema } from "@hermes/common";
import { runScorer } from "@hermes/scorer";
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
            const parsed = challengeSpecSchema.safeParse(spec);
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
            let tmpDir: string | null = null;
            try {
                // Create a minimal input dir with empty data files for the dry-run
                const os = await import("node:os");
                tmpDir = await fs.mkdtemp(
                    path.join(os.tmpdir(), "hermes-validate-"),
                );
                const inputDir = path.join(tmpDir, "input");
                await fs.mkdir(inputDir, { recursive: true });

                // Create minimal placeholder files so the container has something to work with
                await fs.writeFile(
                    path.join(inputDir, "ground_truth.csv"),
                    "id,value\n1,0.5\n",
                );
                await fs.writeFile(
                    path.join(inputDir, "submission.csv"),
                    "id,value\n1,0.5\n",
                );

                const result = await runScorer({
                    image: container,
                    inputDir,
                    timeoutMs: 5 * 60 * 1000, // 5 min for dry-run
                });

                dockerSpinner.succeed("Scorer container ran successfully");
                printSuccess(`Dry-run score: ${result.score}`);
                printJson({
                    score: result.score,
                    details: result.details,
                    containerDigest: result.containerImageDigest,
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
            } finally {
                if (tmpDir) {
                    await fs.rm(tmpDir, { recursive: true, force: true });
                }
            }
        });

    return cmd;
}
