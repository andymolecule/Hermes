import {
  isValidPinnedSpecCid,
  validateChallengeSpec,
  type ChallengeSpecOutput,
} from "@hermes/common";
import HermesChallengeAbiJson from "@hermes/common/abi/HermesChallenge.json" with {
  type: "json",
};
import { getText } from "@hermes/ipfs";
import { type Abi } from "viem";
import yaml from "yaml";
import { getPublicClient } from "./client.js";

const HermesChallengeAbi = HermesChallengeAbiJson as unknown as Abi;

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

  const [specCid, onChainDeadline] = await Promise.all([
    publicClient.readContract({
      address: input.challengeAddress,
      abi: HermesChallengeAbi,
      functionName: "specCid",
    }) as Promise<string>,
    publicClient.readContract({
      address: input.challengeAddress,
      abi: HermesChallengeAbi,
      functionName: "deadline",
    }) as Promise<bigint>,
  ]);

  const spec = await fetchValidatedChallengeSpec(specCid, input.chainId);

  return {
    specCid,
    spec,
    onChainDeadline,
    onChainDeadlineIso: new Date(Number(onChainDeadline) * 1000).toISOString(),
  };
}
