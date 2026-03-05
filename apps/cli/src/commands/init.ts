import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHALLENGE_LIMITS,
  lookupPreset,
  OFFICIAL_IMAGES,
  SUBMISSION_LIMITS,
} from "@hermes/common";
import { Command } from "commander";
import { printSuccess } from "../lib/output";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bundledTemplatesDir = path.resolve(
  __dirname,
  "../../../../challenges/templates",
);
const repoTemplatesDir = path.resolve(process.cwd(), "challenges/templates");
const reproducibilityPreset = lookupPreset("csv_comparison_v1");
const predictionPreset = lookupPreset("regression_v1");
if (!reproducibilityPreset || !predictionPreset) {
  throw new Error("Required presets are missing from PRESET_REGISTRY.");
}

const templateMap: Record<string, string> = {
  reproducibility: "reproducibility.yaml",
  prediction: "prediction.yaml",
  optimization: "optimization.yaml",
  docking: "docking.yaml",
  red_team: "red-team.yaml",
};

const embeddedTemplates: Record<string, string> = {
  reproducibility: `# Hermes challenge template: reproducibility
# Fill in the placeholders, then run: hm post challenge.yaml --deposit 10

id: ch-001
# Short, human-readable title
title: "Reproduce a published longevity score"

domain: longevity
# reproducibility | prediction | optimization | docking | red_team | custom
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
  container: "${reproducibilityPreset.container}"
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
minimum_score: ${reproducibilityPreset.defaultMinimumScore}
max_submissions_total: ${SUBMISSION_LIMITS.maxPerChallenge}
max_submissions_per_solver: ${SUBMISSION_LIMITS.maxPerSolverPerChallenge}
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
# reproducibility | prediction | optimization | docking | red_team | custom
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
  container: "${predictionPreset.container}"
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
minimum_score: ${predictionPreset.defaultMinimumScore}
max_submissions_total: ${SUBMISSION_LIMITS.maxPerChallenge}
max_submissions_per_solver: ${SUBMISSION_LIMITS.maxPerSolverPerChallenge}
# Dispute window in hours (${CHALLENGE_LIMITS.disputeWindowMinHours}-${CHALLENGE_LIMITS.disputeWindowMaxHours}, i.e. 7-90 days)
dispute_window_hours: ${CHALLENGE_LIMITS.defaultDisputeWindowHours}

# Optional lab TBA address
lab_tba: "0x0000000000000000000000000000000000000000"
`,
  optimization: `# Hermes challenge template: optimization
# The poster provides a custom scorer container that runs the simulation.
# Solvers submit parameters; the container evaluates them.
# Run: hm post challenge.yaml --deposit 10

id: ch-004
# Short, human-readable title
title: "Optimize binding affinity for target protein"

domain: drug_discovery
# reproducibility | prediction | optimization | docking | red_team | custom
type: optimization

description: |
  Submit parameters that maximize the objective function.
  The scorer container runs the simulation and returns the score.
  Higher scores are better.

dataset:
  # ipfs:// or https:// URL to any reference data the solver needs
  train: "https://example.com/reference_data.tar.gz"

scoring:
  # YOUR custom scorer container — must accept /input/submission.* and write /output/score.json
  container: "ghcr.io/your-org/your-scorer:v1"
  metric: custom

reward:
  total: 10
  distribution: winner_take_all

# Deadline in ISO-8601 with timezone offset
deadline: "2026-03-20T00:00:00Z"

tags:
  - optimization

# Optional settings
minimum_score: 0
max_submissions_total: ${SUBMISSION_LIMITS.maxPerChallenge}
max_submissions_per_solver: ${SUBMISSION_LIMITS.maxPerSolverPerChallenge}
# Dispute window in hours (${CHALLENGE_LIMITS.disputeWindowMinHours}-${CHALLENGE_LIMITS.disputeWindowMaxHours}, i.e. 7-90 days)
dispute_window_hours: ${CHALLENGE_LIMITS.defaultDisputeWindowHours}
`,
  docking: `# Hermes challenge template: docking
# Fill in the placeholders, then run: hm post challenge.yaml --deposit 10

id: ch-003
# Short, human-readable title
title: "Dock small molecules to a target protein"

domain: drug_discovery
# reproducibility | prediction | optimization | docking | red_team | custom
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
  container: "${OFFICIAL_IMAGES.docking}"
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
max_submissions_total: ${SUBMISSION_LIMITS.maxPerChallenge}
max_submissions_per_solver: ${SUBMISSION_LIMITS.maxPerSolverPerChallenge}
# Dispute window in hours (${CHALLENGE_LIMITS.disputeWindowMinHours}-${CHALLENGE_LIMITS.disputeWindowMaxHours}, i.e. 7-90 days)
dispute_window_hours: ${CHALLENGE_LIMITS.defaultDisputeWindowHours}
# Optional lab TBA address
lab_tba: "0x0000000000000000000000000000000000000000"
`,
  red_team: `# Hermes challenge template: red team
# Solvers find adversarial inputs that break your model.
# The poster provides a custom scorer that measures model degradation.
# Run: hm post challenge.yaml --deposit 10

id: ch-005
title: "Find adversarial inputs that degrade model performance"

domain: other
# reproducibility | prediction | optimization | docking | red_team | custom
type: red_team

description: |
  Submit adversarial test cases that cause the target model to fail.
  Your scorer runs the model on submitted inputs and measures degradation.
  Higher degradation = higher score.

dataset:
  train: "https://example.com/baseline_data.csv"
  test: "https://example.com/reference_outputs.csv"

scoring:
  # YOUR custom scorer — must accept /input/submission.* and write /output/score.json
  container: "ghcr.io/your-org/your-red-team-scorer@sha256:abc123..."
  metric: custom

reward:
  total: 10
  distribution: top_3

deadline: "2026-03-20T00:00:00Z"

tags:
  - red_team
  - adversarial

minimum_score: 0
max_submissions_total: ${SUBMISSION_LIMITS.maxPerChallenge}
max_submissions_per_solver: ${SUBMISSION_LIMITS.maxPerSolverPerChallenge}
dispute_window_hours: ${CHALLENGE_LIMITS.defaultDisputeWindowHours}
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
      "prediction | optimization | reproducibility | docking | red_team",
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
