import { z } from "zod";

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

export const sealedSubmissionEnvelopeSchema = z.object({
  version: z.literal("sealed_submission_v1"),
  alg: z.literal("aes-256-gcm+rsa-oaep-256"),
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
