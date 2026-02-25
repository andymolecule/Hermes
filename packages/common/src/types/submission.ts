export interface SubmissionMetadata {
  challengeId: string;
  solverAddress: string;
  resultCid: string;
  resultHash: string;
  submittedAt: string;
}

export interface ProofBundle {
  inputHash: string;
  outputHash: string;
  containerImageHash: string;
  score: number;
  scorerLog?: string;
}

export interface VerificationRecord {
  proofBundleId: string;
  verifierAddress: string;
  computedScore: number;
  matchesOriginal: boolean;
  logCid?: string;
  verifiedAt: string;
}
