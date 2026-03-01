import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHALLENGE_LIMITS } from "@hermes/common";
import { Command } from "commander";
import { printSuccess } from "../lib/output";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bundledTemplatesDir = path.resolve(
  __dirname,
  "../../../../challenges/templates",
);
const repoTemplatesDir = path.resolve(process.cwd(), "challenges/templates");

const templateMap: Record<string, string> = {
  reproducibility: "reproducibility.yaml",
  prediction: "prediction.yaml",
  docking: "docking.yaml",
};

const embeddedTemplates: Record<string, string> = {
  reproducibility: `# Hermes challenge template: reproducibility
# Fill in the placeholders, then run: hm post challenge.yaml --deposit 10

id: ch-001
# Short, human-readable title
title: "Reproduce a published longevity score"

domain: longevity
# reproducibility | prediction | docking
type: reproducibility

description: |
  Reproduce the published score for the provided dataset.
  Include your methodology, preprocessing steps, and any assumptions.

dataset:
  # ipfs:// or https:// URL to training dataset
  train: "https://example.com/train.csv"
  # ipfs:// or https:// URL to test dataset
  test: "https://example.com/test.csv"

scoring:
  # OCI image reference for the scorer container
  container: "ghcr.io/hermes-science/repro-scorer:latest"
  # rmse | mae | r2 | pearson | spearman | custom
  metric: rmse

reward:
  # Total USDC reward for the challenge
  total: 10
  # winner_take_all | top_3 | proportional
  distribution: winner_take_all

# Deadline in ISO-8601 with timezone offset
deadline: "2026-03-15T00:00:00Z"

tags:
  - reproducibility
  - longevity

# Optional settings
minimum_score: 0.0
# Dispute window in hours (${CHALLENGE_LIMITS.disputeWindowMinHours}-${CHALLENGE_LIMITS.disputeWindowMaxHours}, i.e. 7-90 days)
dispute_window_hours: ${CHALLENGE_LIMITS.defaultDisputeWindowHours}

# Optional lab TBA address
lab_tba: "0x0000000000000000000000000000000000000000"
`,
  prediction: `# Hermes challenge template: prediction
# Fill in the placeholders, then run: hm post challenge.yaml --deposit 10

id: ch-002
# Short, human-readable title
title: "Predict gene expression from promoter sequences"

domain: omics
# reproducibility | prediction | docking
type: prediction

description: |
  Predict expression levels from promoter sequence inputs.
  Provide your model details and any preprocessing steps.

dataset:
  # ipfs:// or https:// URL to training dataset
  train: "https://example.com/train.csv"
  # ipfs:// or https:// URL to test dataset
  test: "https://example.com/test.csv"

scoring:
  # OCI image reference for the scorer container
  container: "ghcr.io/hermes-science/prediction-scorer:latest"
  # rmse | mae | r2 | pearson | spearman | custom
  metric: r2

reward:
  # Total USDC reward for the challenge
  total: 10
  # winner_take_all | top_3 | proportional
  distribution: top_3

# Deadline in ISO-8601 with timezone offset
deadline: "2026-03-20T00:00:00Z"

tags:
  - prediction
  - omics

# Optional settings
minimum_score: 0.1
# Dispute window in hours (${CHALLENGE_LIMITS.disputeWindowMinHours}-${CHALLENGE_LIMITS.disputeWindowMaxHours}, i.e. 7-90 days)
dispute_window_hours: ${CHALLENGE_LIMITS.defaultDisputeWindowHours}

# Optional lab TBA address
lab_tba: "0x0000000000000000000000000000000000000000"
`,
  docking: `# Hermes challenge template: docking
# Fill in the placeholders, then run: hm post challenge.yaml --deposit 10

id: ch-003
# Short, human-readable title
title: "Dock small molecules to a target protein"

domain: drug_discovery
# reproducibility | prediction | docking
type: docking

description: |
  Predict docking scores for the supplied ligand set.
  Include your docking protocol and scoring rationale.

dataset:
  # ipfs:// or https:// URL to training dataset
  train: "https://example.com/train.sdf"
  # ipfs:// or https:// URL to test dataset
  test: "https://example.com/test.sdf"

scoring:
  # OCI image reference for the scorer container
  container: "ghcr.io/hermes-science/docking-scorer:latest"
  # rmse | mae | r2 | pearson | spearman | custom
  metric: spearman

reward:
  # Total USDC reward for the challenge
  total: 10
  # winner_take_all | top_3 | proportional
  distribution: proportional

# Deadline in ISO-8601 with timezone offset
deadline: "2026-03-25T00:00:00Z"

tags:
  - docking
  - drug_discovery

# Optional settings
minimum_score: 0.0
# Dispute window in hours (${CHALLENGE_LIMITS.disputeWindowMinHours}-${CHALLENGE_LIMITS.disputeWindowMaxHours}, i.e. 7-90 days)
dispute_window_hours: ${CHALLENGE_LIMITS.defaultDisputeWindowHours}
# Optional lab TBA address
lab_tba: "0x0000000000000000000000000000000000000000"
`,
};

function resolveTemplatePath(templateFile: string) {
  const candidates = [
    path.join(bundledTemplatesDir, templateFile),
    path.join(repoTemplatesDir, templateFile),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function defaultTemplateDeadlineIso() {
  return new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
}

function refreshTemplateDeadline(content: string) {
  const deadline = defaultTemplateDeadlineIso();
  if (/^deadline:\s*".*"\s*$/m.test(content)) {
    return content.replace(/^deadline:\s*".*"\s*$/m, `deadline: "${deadline}"`);
  }
  return `${content.trimEnd()}\n\ndeadline: "${deadline}"\n`;
}

export function buildInitCommand() {
  const cmd = new Command("init")
    .description("Create a challenge.yaml template")
    .option(
      "-t, --template <template>",
      "reproducibility | prediction | docking",
      "reproducibility",
    )
    .option("-f, --force", "overwrite existing challenge.yaml", false)
    .action((opts: { template: string; force: boolean }) => {
      const templateKey = opts.template.toLowerCase();
      const templateFile = templateMap[templateKey];
      if (!templateFile) {
        throw new Error(`Unknown template: ${opts.template}`);
      }

      const outPath = path.resolve(process.cwd(), "challenge.yaml");
      if (fs.existsSync(outPath) && !opts.force) {
        throw new Error(
          "challenge.yaml already exists. Use --force to overwrite.",
        );
      }

      const templatePath = resolveTemplatePath(templateFile);
      let templateContent: string;
      if (templatePath) {
        templateContent = fs.readFileSync(templatePath, "utf8");
      } else {
        const fallback = embeddedTemplates[templateKey];
        if (!fallback) {
          throw new Error(`Template not available: ${templateKey}`);
        }
        templateContent = fallback;
      }
      fs.writeFileSync(outPath, refreshTemplateDeadline(templateContent));
      printSuccess(`Created ${outPath}`);
    });

  return cmd;
}
