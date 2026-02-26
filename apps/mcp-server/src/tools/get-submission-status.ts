import { getSubmissionStatus } from "./shared.js";

export interface GetSubmissionStatusInput {
  submissionId: string;
}

export async function hermesGetSubmissionStatus(
  input: GetSubmissionStatusInput,
) {
  return getSubmissionStatus(input.submissionId);
}
