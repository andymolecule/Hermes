import { defineChain } from "viem";
import { base, baseSepolia } from "wagmi/chains";
import { CHAIN_ID, RPC_URL } from "../config";

function withConfiguredRpc(chain: typeof base | typeof baseSepolia) {
  return defineChain({
    id: chain.id,
    name: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: {
      default: { http: [RPC_URL] },
      public: { http: [RPC_URL] },
    },
    blockExplorers: chain.blockExplorers,
    contracts: chain.contracts,
    testnet: chain.testnet,
  });
}

function buildCustomChain() {
  return defineChain({
    id: CHAIN_ID,
    name: `Chain ${CHAIN_ID}`,
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    },
    rpcUrls: {
      default: { http: [RPC_URL] },
      public: { http: [RPC_URL] },
    },
  });
}

export const APP_CHAIN =
  CHAIN_ID === baseSepolia.id
    ? withConfiguredRpc(baseSepolia)
    : CHAIN_ID === base.id
      ? withConfiguredRpc(base)
      : buildCustomChain();

export const APP_CHAIN_ID = APP_CHAIN.id;
export const APP_CHAIN_NAME = APP_CHAIN.name;

export function isWrongWalletChain(chainId: number | undefined) {
  return typeof chainId === "number" && chainId !== APP_CHAIN_ID;
}

export function getExplorerBaseUrl() {
  return APP_CHAIN.blockExplorers?.default?.url ?? null;
}

export function getExplorerTxUrl(hash: string) {
  const baseUrl = getExplorerBaseUrl();
  return baseUrl ? `${baseUrl}/tx/${hash}` : null;
}

export function getExplorerAddressUrl(address: string) {
  const baseUrl = getExplorerBaseUrl();
  return baseUrl ? `${baseUrl}/address/${address}` : null;
}

export function getWrongChainMessage(chainId: number | undefined) {
  if (typeof chainId !== "number") {
    return `Switch to ${APP_CHAIN_NAME}.`;
  }
  return `Switch to ${APP_CHAIN_NAME} (chain ${APP_CHAIN_ID}) from chain ${chainId}.`;
}
