import {
  createPublicClient,
  createWalletClient,
  http,
  type Chain,
  type HttpTransport,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { loadConfig } from "@hermes/common";

function resolveChain(): Chain {
  const config = loadConfig();
  const chainId = config.HERMES_CHAIN_ID ?? baseSepolia.id;
  return chainId === base.id ? base : baseSepolia;
}

export function createHermesPublicClient() {
  const config = loadConfig();
  const chain = resolveChain();
  const transport = http(config.HERMES_RPC_URL);
  return createPublicClient({ chain, transport });
}

export function createHermesWalletClient() {
  const config = loadConfig();
  if (!config.HERMES_PRIVATE_KEY) {
    throw new Error("HERMES_PRIVATE_KEY is required for wallet operations.");
  }
  const chain = resolveChain();
  const transport = http(config.HERMES_RPC_URL);
  const account = privateKeyToAccount(config.HERMES_PRIVATE_KEY as `0x${string}`);
  return createWalletClient({ chain, transport, account });
}
