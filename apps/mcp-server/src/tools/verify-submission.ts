import { verifySubmission } from "./shared.js";

export interface VerifySubmissionInput {
  challengeId: string;
  submissionId: string;
  tolerance?: number;
}

export async function hermesVerifySubmission(input: VerifySubmissionInput) {
  return verifySubmission(input);
}
