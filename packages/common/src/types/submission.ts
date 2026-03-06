export interface SubmissionMetadata {
  challengeId: string;
  solverAddress: string;
  resultCid: string;
  resultHash: string;
  submittedAt: string;
}

export const SUBMISSION_RESULT_FORMAT = {
  plainV0: "plain_v0",
  sealedV1: "sealed_v1",
} as const;

export type SubmissionResultFormat =
  (typeof SUBMISSION_RESULT_FORMAT)[keyof typeof SUBMISSION_RESULT_FORMAT];

export interface ProofBundle {
  inputHash: string;
  outputHash: string;
  containerImageDigest: string;
  score: number;
  scorerLog?: string;
  meta?: {
    challengeId?: string;
    submissionId?: string;
    createdAt?: string;
  };
}

export interface VerificationRecord {
  proofBundleId: string;
  verifierAddress: string;
  computedScore: number;
  matchesOriginal: boolean;
  logCid?: string;
  verifiedAt: string;
}
