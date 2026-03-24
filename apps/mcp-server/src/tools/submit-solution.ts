import type { SolverSigner } from "@agora/chain";
import { submitSolution } from "./shared.js";

export interface SubmitSolutionInput {
  challengeId: string;
  filePath: string;
  privateKey?: string;
}

export async function agoraSubmitSolution(
  input: SubmitSolutionInput,
  options?: {
    allowRemotePrivateKey?: boolean;
    configuredSigner?: SolverSigner | null;
  },
) {
  return submitSolution({
    ...input,
    allowRemotePrivateKey: options?.allowRemotePrivateKey ?? false,
    configuredSigner: options?.configuredSigner ?? null,
  });
}
