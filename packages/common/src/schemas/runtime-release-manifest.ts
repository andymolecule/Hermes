import { z } from "zod";

const sha256HexSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "must be a 64-character lowercase sha256 hex");

const gitShaSchema = z
  .string()
  .regex(/^[a-f0-9]{40}$/, "must be a 40-character lowercase git SHA");

const imageDigestSchema = z
  .string()
  .regex(
    /^[a-z0-9](?:[a-z0-9._/-]*[a-z0-9])?@sha256:[a-f0-9]{64}$/,
    "must be an OCI image reference pinned by digest",
  );

export const runtimeSchemaPlanTypeSchema = z.enum([
  "bootstrap",
  "forward_migration",
  "noop",
]);

export const runtimeSchemaPlanSchema = z
  .object({
    type: runtimeSchemaPlanTypeSchema,
    baselineId: z.string().min(1).optional(),
    baselineSha256: sha256HexSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.type !== "bootstrap") {
      return;
    }
    if (!value.baselineId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["baselineId"],
        message: "bootstrap schema plans require baselineId",
      });
    }
    if (!value.baselineSha256) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["baselineSha256"],
        message: "bootstrap schema plans require baselineSha256",
      });
    }
  });

export const runtimeReleaseManifestSchema = z.object({
  releaseId: z.string().min(1),
  gitSha: gitShaSchema,
  createdAt: z.string().datetime({ offset: true }),
  schemaPlan: runtimeSchemaPlanSchema,
  services: z.object({
    api: z.object({
      image: imageDigestSchema,
    }),
    indexer: z.object({
      image: imageDigestSchema,
    }),
    worker: z.object({
      image: imageDigestSchema,
    }),
  }),
  healthContractVersion: z.literal("runtime-health-v1"),
});

export type RuntimeReleaseManifest = z.infer<
  typeof runtimeReleaseManifestSchema
>;
