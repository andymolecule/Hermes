import { submitSolution } from "./shared.js";

export interface SubmitSolutionInput {
  challengeId: string;
  filePath: string;
  privateKey?: string;
}

export async function hermesSubmitSolution(
  input: SubmitSolutionInput,
  options?: { allowRemotePrivateKey?: boolean },
) {
  return submitSolution({
    ...input,
    allowRemotePrivateKey: options?.allowRemotePrivateKey ?? false,
  });
}
