export interface SubmissionMetadata {
  challengeId: string;
  solverAddress: string;
  submissionCid: string;
  resultHash: string;
  submittedAt: string;
}

export const SUBMISSION_CID_MISSING_ERROR =
  "missing_submission_cid_onchain_submission";

export interface ProofBundle {
  inputHash: string;
  outputHash: string;
  containerImageDigest: string;
  score: number;
  scorerLog?: string;
  challengeSpecCid?: string | null;
  evaluationBundleCid?: string | null;
  replaySubmissionCid?: string | null;
  meta?: {
    challengeId?: string;
    submissionId?: string;
    createdAt?: string;
  };
}

export interface PublicSubmissionVerification {
  challengeId: string;
  challengeAddress: string;
  challengeSpecCid: string | null;
  submissionId: string;
  onChainSubId: number;
  solverAddress: string;
  score: string | null;
  scored: boolean;
  submittedAt: string;
  scoredAt?: string | null;
  proofBundleCid: string | null;
  proofBundleHash: string | null;
  evaluationBundleCid: string | null;
  replaySubmissionCid: string | null;
  containerImageDigest: string | null;
  inputHash: string | null;
  outputHash: string | null;
  reproducible: boolean;
}

export interface VerificationRecord {
  proofBundleId: string;
  verifierAddress: string;
  computedScore: number;
  matchesOriginal: boolean;
  logCid?: string;
  verifiedAt: string;
}
