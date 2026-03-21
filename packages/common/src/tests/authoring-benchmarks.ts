import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const benchmarkRoot = path.resolve(
  process.cwd(),
  "challenges/test-data/authoring-benchmarks",
);

const compileStateSchema = z.enum([
  "ready",
  "needs_input",
  "failed",
]);

const benchmarkSchema = z.object({
  id: z.string().min(1),
  managed_support: z.enum(["supported", "custom_workflow_required"]),
  intent_family: z.string().min(1),
  artifacts_root: z.string().min(1),
  prompt_variants_root: z.string().min(1),
  solver_submissions_root: z.string().min(1),
  compile_invariants: z.object({
    runtime_family: z.string().min(1),
    metric: z.string().min(1),
    artifact_roles: z
      .array(
        z.object({
          file_name: z.string().min(1),
          role: z.string().min(1),
          visibility: z.enum(["public", "private"]),
        }),
      )
      .min(1),
    submission_contract: z.object({
      kind: z.enum(["csv_table", "opaque_file"]),
      required_columns: z.array(z.string().min(1)).optional(),
      id_column: z.string().min(1).optional(),
      value_column: z.string().min(1).optional(),
      extension: z.string().min(1).optional(),
      mime: z.string().min(1).optional(),
    }),
    challenge_type: z.string().min(1).optional(),
    evaluator_archetype: z.string().min(1).optional(),
  }),
  acceptable_compile_states: z.array(compileStateSchema).min(1),
  disallowed_outcomes: z.object({
    runtime_families: z.array(z.string().min(1)),
    recommended_actions: z.array(z.string().min(1)),
  }),
  prompt_variants: z
    .array(
      z.object({
        id: z.string().min(1),
        file: z.string().min(1),
        acceptable_compile_states: z.array(compileStateSchema).min(1),
        expected_follow_up_topics: z.array(z.string().min(1)).min(1),
      }),
    )
    .min(1),
});

async function assertExists(targetPath: string, label: string) {
  const stat = await fs.stat(targetPath).catch(() => null);
  assert.ok(stat, `${label} should exist at ${targetPath}`);
}

const benchmarkEntries = (
  await fs.readdir(benchmarkRoot, {
    withFileTypes: true,
  })
)
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

assert.ok(
  benchmarkEntries.length >= 3,
  "authoring benchmark corpus should cover more than one narrow benchmark family",
);

let sawSupported = false;
let sawCustomWorkflowRequired = false;

for (const benchmarkId of benchmarkEntries) {
  const benchmarkDir = path.join(benchmarkRoot, benchmarkId);
  const benchmarkJsonPath = path.join(benchmarkDir, "benchmark.json");
  const benchmark = benchmarkSchema.parse(
    JSON.parse(await fs.readFile(benchmarkJsonPath, "utf8")),
  );

  assert.equal(
    benchmark.id,
    benchmarkId,
    `benchmark id should match directory name for ${benchmarkId}`,
  );
  await assertExists(
    path.join(benchmarkDir, "README.md"),
    `${benchmarkId} README`,
  );
  await assertExists(
    path.join(benchmarkDir, "evaluation-guide.md"),
    `${benchmarkId} evaluation guide`,
  );

  const promptVariantsDir = path.join(
    benchmarkDir,
    benchmark.prompt_variants_root,
  );
  const uploadsDir = path.join(benchmarkDir, benchmark.artifacts_root);
  const solverSubmissionsDir = path.join(
    benchmarkDir,
    benchmark.solver_submissions_root,
  );

  await assertExists(promptVariantsDir, `${benchmarkId} prompt variants root`);
  await assertExists(uploadsDir, `${benchmarkId} uploads root`);
  await assertExists(
    solverSubmissionsDir,
    `${benchmarkId} solver submissions root`,
  );
  await assertExists(
    path.join(solverSubmissionsDir, "valid"),
    `${benchmarkId} valid solver submissions`,
  );
  await assertExists(
    path.join(solverSubmissionsDir, "invalid"),
    `${benchmarkId} invalid solver submissions`,
  );

  for (const variant of benchmark.prompt_variants) {
    await assertExists(
      path.join(benchmarkDir, variant.file),
      `${benchmarkId} prompt variant ${variant.id}`,
    );
  }

  for (const artifact of benchmark.compile_invariants.artifact_roles) {
    await assertExists(
      path.join(uploadsDir, artifact.file_name),
      `${benchmarkId} upload fixture ${artifact.file_name}`,
    );
  }

  sawSupported ||= benchmark.managed_support === "supported";
  sawCustomWorkflowRequired ||=
    benchmark.managed_support === "custom_workflow_required";
}

assert.ok(
  sawSupported,
  "authoring benchmark corpus should include at least one supported Gems benchmark",
);
assert.ok(
  sawCustomWorkflowRequired,
  "authoring benchmark corpus should include at least one explicit custom-workflow benchmark",
);

console.log("authoring benchmark corpus validation passed");
