import { ACTIVE_CONTRACT_VERSION } from "@agora/common";
import type { Abi, PublicClient } from "viem";

export async function assertSupportedContractVersion(input: {
  publicClient: PublicClient;
  address: `0x${string}`;
  abi: Abi;
  contractLabel: string;
}) {
  const rawVersion = (await input.publicClient.readContract({
    address: input.address,
    abi: input.abi,
    functionName: "contractVersion",
  })) as bigint;
  const contractVersion = Number(rawVersion);
  if (contractVersion !== ACTIVE_CONTRACT_VERSION) {
    throw new Error(
      `Unsupported ${input.contractLabel} contract version ${contractVersion}. Refresh against the active v${ACTIVE_CONTRACT_VERSION} deployment and retry.`,
    );
  }
}
