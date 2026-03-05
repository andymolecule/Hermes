import { claimChallengePayout } from "./shared.js";

export async function hermesClaimPayout(
  input: { challengeId: string; privateKey?: string },
  options: { allowRemotePrivateKey: boolean },
) {
  return claimChallengePayout({
    ...input,
    allowRemotePrivateKey: options.allowRemotePrivateKey,
  });
}
