import { submitSolution } from "./shared.js";

export interface SubmitSolutionInput {
  challengeId: string;
  filePath: string;
}

export async function hermesSubmitSolution(input: SubmitSolutionInput) {
  return submitSolution(input);
}
