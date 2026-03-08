import {
  ACTIVE_CONTRACT_VERSION,
  isValidPinnedSpecCid,
  validateChallengeSpec,
  type ChallengeSpecOutput,
} from "@agora/common";
import AgoraChallengeAbiJson from "@agora/common/abi/AgoraChallenge.json" with {
  type: "json",
};
import { getText } from "@agora/ipfs";
import { type Abi } from "viem";
import yaml from "yaml";
import { getPublicClient } from "./client.js";
import { getChallengeContractVersion } from "./challenge.js";

const AgoraChallengeAbi = AgoraChallengeAbiJson as unknown as Abi;

export async function fetchValidatedChallengeSpec(
  specCid: string,
  chainId: number,
): Promise<ChallengeSpecOutput> {
  if (!isValidPinnedSpecCid(specCid)) {
    throw new Error(`Invalid or placeholder spec CID: ${specCid}`);
  }

  const rawSpec = await getText(specCid);
  const parsedSpec = yaml.parse(rawSpec) as Record<string, unknown>;
  if (parsedSpec.deadline instanceof Date) {
    parsedSpec.deadline = parsedSpec.deadline.toISOString();
  }

  const specResult = validateChallengeSpec(parsedSpec, chainId);
  if (!specResult.success) {
    throw new Error(
      `Invalid challenge spec: ${specResult.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
    );
  }

  return specResult.data;
}

export async function loadChallengeDefinitionFromChain(input: {
  publicClient?: ReturnType<typeof getPublicClient>;
  challengeAddress: `0x${string}`;
  chainId: number;
}) {
  const publicClient = input.publicClient ?? getPublicClient();

  const [specCid, onChainDeadline, contractVersion] = await Promise.all([
    publicClient.readContract({
      address: input.challengeAddress,
      abi: AgoraChallengeAbi,
      functionName: "specCid",
    }) as Promise<string>,
    publicClient.readContract({
      address: input.challengeAddress,
      abi: AgoraChallengeAbi,
      functionName: "deadline",
    }) as Promise<bigint>,
    getChallengeContractVersion(input.challengeAddress),
  ]);

  const spec = await fetchValidatedChallengeSpec(specCid, input.chainId);
  if (contractVersion !== ACTIVE_CONTRACT_VERSION) {
    throw new Error(
      `Unsupported challenge contract version ${contractVersion}. Point the runtime at the active v${ACTIVE_CONTRACT_VERSION} deployment and retry.`,
    );
  }

  return {
    specCid,
    spec,
    contractVersion,
    onChainDeadline,
    onChainDeadlineIso: new Date(Number(onChainDeadline) * 1000).toISOString(),
  };
}
