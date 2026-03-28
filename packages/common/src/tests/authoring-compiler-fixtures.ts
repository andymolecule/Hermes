import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const fixtureRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../tests/fixtures/authoring-compiler",
);
const expectedFixtureIds = [
  "bundle-custom-workflow",
  "opaque-json-match",
  "supported-table-metric",
] as const;

const compileStateSchema = z.enum(["ready", "awaiting_input", "rejected"]);

const compilerFixtureSchema = z.object({
  id: z.string().min(1),
  table_scorer_support: z.enum(["supported", "custom_workflow_required"]),
  intent_family: z.string().min(1),
  artifacts_root: z.string().min(1),
  prompt_variants_root: z.string().min(1),
  compile_invariants: z.object({
    template: z.string().min(1).optional(),
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
    disallowed_templates: z.array(z.string().min(1)),
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

const fixtureEntries = (
  await fs.readdir(fixtureRoot, {
    withFileTypes: true,
  })
)
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

assert.deepEqual(
  fixtureEntries,
  [...expectedFixtureIds],
  "authoring compiler fixtures should stay intentionally small and curated",
);

let sawSupported = false;
let sawCustomWorkflowRequired = false;

for (const fixtureId of fixtureEntries) {
  const fixtureDir = path.join(fixtureRoot, fixtureId);
  const fixtureJsonPath = path.join(fixtureDir, "fixture.json");
  const fixture = compilerFixtureSchema.parse(
    JSON.parse(await fs.readFile(fixtureJsonPath, "utf8")),
  );

  assert.equal(
    fixture.id,
    fixtureId,
    `fixture id should match directory name for ${fixtureId}`,
  );
  const promptVariantsDir = path.join(fixtureDir, fixture.prompt_variants_root);
  const uploadsDir = path.join(fixtureDir, fixture.artifacts_root);

  await assertExists(promptVariantsDir, `${fixtureId} prompt variants root`);
  await assertExists(uploadsDir, `${fixtureId} uploads root`);

  for (const variant of fixture.prompt_variants) {
    await assertExists(
      path.join(fixtureDir, variant.file),
      `${fixtureId} prompt variant ${variant.id}`,
    );
  }

  for (const artifact of fixture.compile_invariants.artifact_roles) {
    await assertExists(
      path.join(uploadsDir, artifact.file_name),
      `${fixtureId} upload fixture ${artifact.file_name}`,
    );
  }

  sawSupported ||= fixture.table_scorer_support === "supported";
  sawCustomWorkflowRequired ||=
    fixture.table_scorer_support === "custom_workflow_required";
}

assert.ok(
  sawSupported,
  "authoring compiler fixtures should include at least one supported managed path",
);
assert.ok(
  sawCustomWorkflowRequired,
  "authoring compiler fixtures should include at least one explicit custom-workflow path",
);

console.log("authoring compiler fixture validation passed");
