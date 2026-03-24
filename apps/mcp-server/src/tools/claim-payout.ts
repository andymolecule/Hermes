import type { SolverSigner } from "@agora/chain";
import { claimChallengePayout } from "./shared.js";

export async function agoraClaimPayout(
  input: { challengeId: string; privateKey?: string },
  options: {
    allowRemotePrivateKey: boolean;
    configuredSigner?: SolverSigner | null;
  },
) {
  return claimChallengePayout({
    ...input,
    allowRemotePrivateKey: options.allowRemotePrivateKey,
    configuredSigner: options.configuredSigner ?? null,
  });
}
