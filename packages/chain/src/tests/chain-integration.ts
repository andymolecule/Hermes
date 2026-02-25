// Skip early if required env vars are missing — check raw process.env
// because loadConfig() will throw on missing required vars.
if (
  !process.env.HERMES_RPC_URL ||
  !process.env.HERMES_FACTORY_ADDRESS ||
  !process.env.HERMES_USDC_ADDRESS
) {
  console.log(
    "SKIP: Chain test requires HERMES_RPC_URL + HERMES_FACTORY_ADDRESS + HERMES_USDC_ADDRESS",
  );
  process.exit(0);
}

import type { Abi } from "viem";

const { loadConfig } = await import("@hermes/common");
const HermesFactoryAbiJson = (await import("@hermes/common/abi/HermesFactory.json")).default;
const { createHermesPublicClient } = await import("../client");

const config = loadConfig();
const HermesFactoryAbi = HermesFactoryAbiJson as unknown as Abi;
const publicClient = createHermesPublicClient();

const count = await publicClient.readContract({
  address: config.HERMES_FACTORY_ADDRESS as `0x${string}`,
  abi: HermesFactoryAbi,
  functionName: "challengeCount",
  args: [],
});

console.log(`PASS: Chain read ok (challengeCount=${count})`);
