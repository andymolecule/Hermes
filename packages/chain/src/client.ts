import { CHAIN_IDS, loadConfig, resolveRuntimePrivateKey } from "@agora/common";
import {
  http,
  type Chain,
  type HttpTransport,
  createPublicClient,
  createWalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";

function resolveChain(): Chain {
  const config = loadConfig();
  const chainId = config.AGORA_CHAIN_ID;
  return chainId === CHAIN_IDS.baseMainnet ? base : baseSepolia;
}

export function createAgoraPublicClient() {
  const config = loadConfig();
  const chain = resolveChain();
  const transport = http(config.AGORA_RPC_URL);
  return createPublicClient({ chain, transport });
}

export function createAgoraWalletClient() {
  const config = loadConfig();
  const privateKey = resolveRuntimePrivateKey(config);
  if (!privateKey) {
    throw new Error(
      "AGORA_PRIVATE_KEY or AGORA_ORACLE_KEY is required for wallet operations.",
    );
  }
  const chain = resolveChain();
  const transport = http(config.AGORA_RPC_URL);
  const account = privateKeyToAccount(privateKey);
  return createWalletClient({ chain, transport, account });
}

let cachedPublicClient: ReturnType<typeof createAgoraPublicClient> | null =
  null;
let cachedWalletClient: ReturnType<typeof createAgoraWalletClient> | null =
  null;

export function getPublicClient() {
  if (!cachedPublicClient) {
    cachedPublicClient = createAgoraPublicClient();
  }
  return cachedPublicClient;
}

export function getWalletClient() {
  if (!cachedWalletClient) {
    cachedWalletClient = createAgoraWalletClient();
  }
  return cachedWalletClient;
}
