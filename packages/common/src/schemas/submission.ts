import { z } from "zod";

export const SEALED_SUBMISSION_RESULT_FORMAT = "sealed_submission_v2" as const;
export const PUBLIC_SUBMISSION_RESULT_FORMAT = "plain_v0" as const;
export const DEFAULT_SUBMISSION_PRIVACY_MODE = "sealed" as const;

export const submissionMetadataSchema = z.object({
  challengeId: z.string().min(1),
  solverAddress: z.string().min(1),
  resultCid: z.string().min(1),
  resultHash: z.string().min(1),
  submittedAt: z.string().datetime({ offset: true }),
});

export type SubmissionMetadataInput = z.input<typeof submissionMetadataSchema>;
export type SubmissionMetadataOutput = z.output<
  typeof submissionMetadataSchema
>;

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
export const submissionPrivacyModeSchema = z.enum(["sealed", "public"]);
export const submissionSealVersionSchema = z.literal(
  SEALED_SUBMISSION_RESULT_FORMAT,
);
export const submissionSealAlgSchema = z.literal("aes-256-gcm+rsa-oaep-256");
export const submissionResultFormatSchema = z.enum([
  SEALED_SUBMISSION_RESULT_FORMAT,
  PUBLIC_SUBMISSION_RESULT_FORMAT,
]);

export const sealedSubmissionEnvelopeSchema = z.object({
  version: submissionSealVersionSchema,
  alg: submissionSealAlgSchema,
  kid: z.string().min(1),
  challengeId: z.string().uuid(),
  solverAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .transform((value) => value.toLowerCase()),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  iv: z.string().regex(BASE64URL_RE),
  wrappedKey: z.string().regex(BASE64URL_RE),
  ciphertext: z.string().regex(BASE64URL_RE),
});

export type SealedSubmissionEnvelopeInput = z.input<
  typeof sealedSubmissionEnvelopeSchema
>;
export type SealedSubmissionEnvelope = z.output<
  typeof sealedSubmissionEnvelopeSchema
>;
export type SubmissionSealVersion = z.output<
  typeof submissionSealVersionSchema
>;
export type SubmissionSealAlg = z.output<typeof submissionSealAlgSchema>;
export type SubmissionPrivacyMode = z.output<
  typeof submissionPrivacyModeSchema
>;
export type SubmissionResultFormat = z.output<
  typeof submissionResultFormatSchema
>;

export function getRequiredSubmissionResultFormat(
  privacyMode: SubmissionPrivacyMode,
): SubmissionResultFormat {
  return privacyMode === "public"
    ? PUBLIC_SUBMISSION_RESULT_FORMAT
    : SEALED_SUBMISSION_RESULT_FORMAT;
}

export function resolveDefaultSubmissionPrivacyMode(input: {
  sealingConfigured: boolean;
}): SubmissionPrivacyMode {
  return input.sealingConfigured ? "sealed" : "public";
}

export function isSubmissionResultFormatCompatible(input: {
  privacyMode: SubmissionPrivacyMode;
  resultFormat: SubmissionResultFormat;
}) {
  return input.resultFormat === getRequiredSubmissionResultFormat(input.privacyMode);
}
