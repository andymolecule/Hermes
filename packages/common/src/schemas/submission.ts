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
export const submissionSolverAddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "solverAddress must be a 20-byte hex address.")
  .transform((value) => value.toLowerCase());

function base64UrlNoPaddingFieldSchema(fieldName: string) {
  return z
    .string()
    .regex(BASE64URL_RE, `${fieldName} must be base64url without '=' padding.`);
}

export const sealedSubmissionEnvelopeSchema = z.object({
  version: submissionSealVersionSchema,
  alg: submissionSealAlgSchema,
  kid: z.string().min(1),
  challengeId: z.string().uuid("challengeId must be a UUID."),
  solverAddress: submissionSolverAddressSchema,
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  iv: base64UrlNoPaddingFieldSchema("iv"),
  wrappedKey: base64UrlNoPaddingFieldSchema("wrappedKey"),
  ciphertext: base64UrlNoPaddingFieldSchema("ciphertext"),
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
export type SubmissionSolverAddress = z.output<
  typeof submissionSolverAddressSchema
>;

export const sealedSubmissionValidationRequestSchema = z.object({
  resultCid: z.string().min(1),
  challengeId: z.string().uuid(),
  solverAddress: submissionSolverAddressSchema,
});

export const sealedSubmissionValidationCodeSchema = z.enum([
  "invalid_request",
  "submission_sealing_unavailable",
  "ipfs_fetch_failed",
  "invalid_envelope_schema",
  "missing_decryption_key",
  "key_unwrap_failed",
  "ciphertext_auth_failed",
  "decrypt_failed",
  "challenge_id_mismatch",
  "solver_address_mismatch",
]);

const sealedSubmissionValidationFingerprintSchema = z
  .string()
  .min(1)
  .nullable();

export const sealedSubmissionValidationSuccessSchema = z.object({
  ok: z.literal(true),
  keyId: z.string().min(1),
  publicKeyFingerprint: sealedSubmissionValidationFingerprintSchema,
  derivedPublicKeyFingerprint: sealedSubmissionValidationFingerprintSchema,
});

export const sealedSubmissionValidationFailureSchema = z.object({
  ok: z.literal(false),
  code: sealedSubmissionValidationCodeSchema,
  message: z.string().min(1),
  retriable: z.boolean(),
  keyId: z.string().min(1).nullable(),
  publicKeyFingerprint: sealedSubmissionValidationFingerprintSchema,
  derivedPublicKeyFingerprint: sealedSubmissionValidationFingerprintSchema,
});

export const sealedSubmissionValidationResponseSchema = z.union([
  sealedSubmissionValidationSuccessSchema,
  sealedSubmissionValidationFailureSchema,
]);

export const submissionSealWorkerHealthResponseSchema = z.object({
  ok: z.boolean(),
  service: z.literal("submission-seal-worker"),
  checkedAt: z.string().datetime({ offset: true }),
  sealing: z.object({
    configured: z.boolean(),
    keyId: z.string().min(1).nullable(),
    publicKeyFingerprint: sealedSubmissionValidationFingerprintSchema,
    derivedPublicKeyFingerprint: sealedSubmissionValidationFingerprintSchema,
    selfCheckOk: z.boolean(),
  }),
});

export type SealedSubmissionValidationRequestInput = z.input<
  typeof sealedSubmissionValidationRequestSchema
>;
export type SealedSubmissionValidationRequest = z.output<
  typeof sealedSubmissionValidationRequestSchema
>;
export type SealedSubmissionValidationCode = z.output<
  typeof sealedSubmissionValidationCodeSchema
>;
export type SealedSubmissionValidationResponse = z.output<
  typeof sealedSubmissionValidationResponseSchema
>;
export type SubmissionSealWorkerHealthResponse = z.output<
  typeof submissionSealWorkerHealthResponseSchema
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
  return (
    input.resultFormat === getRequiredSubmissionResultFormat(input.privacyMode)
  );
}
