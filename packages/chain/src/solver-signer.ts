import type {
  Abi,
  PublicClient,
  TransactionReceipt,
  WalletClient,
} from "viem";
import { getPublicClient } from "./client.js";

type SolverWalletClient = Pick<WalletClient, "account" | "writeContract">;
type SolverPublicClient = Pick<PublicClient, "waitForTransactionReceipt">;

export interface SolverSigner {
  getAddress(): Promise<`0x${string}`>;
  writeContract(input: {
    address: `0x${string}`;
    abi: Abi;
    functionName: string;
    args: readonly unknown[];
  }): Promise<{
    hash: `0x${string}`;
  }>;
  waitForFinality(input: {
    hash: `0x${string}`;
  }): Promise<TransactionReceipt>;
}

export function createSolverSignerFromWalletClient(input: {
  walletClient: SolverWalletClient;
  publicClient?: SolverPublicClient;
}): SolverSigner {
  const publicClient = input.publicClient ?? getPublicClient();

  return {
    async getAddress() {
      const address = input.walletClient.account?.address;
      if (!address) {
        throw new Error(
          "Wallet client is missing an account address. Next step: configure a stable solver wallet and retry.",
        );
      }
      return address;
    },
    async writeContract(writeInput) {
      const hash = await input.walletClient.writeContract({
        address: writeInput.address,
        abi: writeInput.abi,
        functionName: writeInput.functionName,
        args: writeInput.args,
        chain: null,
      } as never);
      return { hash };
    },
    waitForFinality({ hash }) {
      return publicClient.waitForTransactionReceipt({ hash });
    },
  };
}
