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
