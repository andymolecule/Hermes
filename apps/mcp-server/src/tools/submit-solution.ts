import { submitSolution } from "./shared";

export interface SubmitSolutionInput {
  challengeId: string;
  filePath: string;
}

export async function hermesSubmitSolution(input: SubmitSolutionInput) {
  return submitSolution(input);
}
