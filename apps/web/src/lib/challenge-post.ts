export type ChallengePostStatusTone = "info" | "success" | "warning" | "error";

export interface ChallengePostStatus {
  tone: ChallengePostStatusTone;
  message: string;
  postedOnChain: boolean;
}

export function createChallengePostStatus(
  message: string,
  options: {
    tone?: ChallengePostStatusTone;
    postedOnChain?: boolean;
  } = {},
): ChallengePostStatus {
  return {
    tone: options.tone ?? "info",
    message,
    postedOnChain: options.postedOnChain ?? false,
  };
}

export function getChallengePostSuccessStatus(
  txHash: `0x${string}`,
): ChallengePostStatus {
  return createChallengePostStatus(
    `Challenge posted on-chain and registered in Agora. tx=${txHash}.`,
    {
      tone: "success",
      postedOnChain: true,
    },
  );
}

export function getChallengePostIndexingFailureStatus(
  txHash: `0x${string}`,
  message: string,
): ChallengePostStatus {
  const detail =
    message.trim().length > 0 ? message : "Unknown registration error.";
  return createChallengePostStatus(
    `Challenge posted on-chain (tx=${txHash}), but Agora could not register it immediately: ${detail} Next step: retry in a few seconds and refresh the challenge list, or re-run the trusted publish/registration flow if you operate the API.`,
    {
      tone: "warning",
      postedOnChain: true,
    },
  );
}
