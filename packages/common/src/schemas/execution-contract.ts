import { z } from "zod";
import { safePublicHttpsUrlSchema } from "./authoring-source.js";
import {
  officialScorerComparatorSchema,
  officialScorerTemplateIdSchema,
} from "../official-scorer-catalog.js";
import {
  csvTableEvaluationContractSchema,
  scorerRuntimePoliciesSchema,
} from "./scorer-runtime.js";

const ipfsOrHttpsUriSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) =>
      value.startsWith("ipfs://") ||
      safePublicHttpsUrlSchema.safeParse(value).success,
    "value must start with ipfs:// or be a valid https:// URL",
  );

export const challengeExecutionSchema = z
  .object({
    version: z.literal("v1"),
    template: officialScorerTemplateIdSchema,
    scorer_image: z.string().trim().min(1),
    metric: z.string().trim().min(1),
    comparator: officialScorerComparatorSchema,
    evaluation_artifact_uri: ipfsOrHttpsUriSchema,
    evaluation_contract: csvTableEvaluationContractSchema,
    policies: scorerRuntimePoliciesSchema.default({
      coverage_policy: "ignore",
      duplicate_id_policy: "ignore",
      invalid_value_policy: "ignore",
    }),
  })
  .strict();

export type ChallengeExecutionOutput = z.output<typeof challengeExecutionSchema>;

export function createChallengeExecution(input: {
  template: z.input<typeof officialScorerTemplateIdSchema>;
  scorerImage: string;
  metric: string;
  comparator: z.input<typeof officialScorerComparatorSchema>;
  evaluationArtifactUri: string;
  evaluationContract: z.input<typeof csvTableEvaluationContractSchema>;
  policies?: z.input<typeof scorerRuntimePoliciesSchema>;
}): ChallengeExecutionOutput {
  return challengeExecutionSchema.parse({
    version: "v1",
    template: input.template,
    scorer_image: input.scorerImage,
    metric: input.metric,
    comparator: input.comparator,
    evaluation_artifact_uri: input.evaluationArtifactUri,
    evaluation_contract: input.evaluationContract,
    policies: input.policies,
  });
}
