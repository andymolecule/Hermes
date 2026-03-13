import type { PublicClient } from "viem";

const DEFAULT_RECEIPT_TIMEOUT_MS = 180_000;
type SimulatedContractRequest = Awaited<
  ReturnType<PublicClient["simulateContract"]>
>["request"];

export async function waitForTransactionReceiptWithTimeout(input: {
  publicClient: PublicClient;
  hash: `0x${string}`;
  timeoutMs?: number;
}) {
  const timeoutMs = input.timeoutMs ?? DEFAULT_RECEIPT_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      input.publicClient.waitForTransactionReceipt({ hash: input.hash }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              "Transaction confirmation is taking longer than expected. Next step: inspect the transaction in your wallet or block explorer, then retry once it is confirmed.",
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function simulateAndWriteContract(
  input: Parameters<PublicClient["simulateContract"]>[0] & {
    publicClient: PublicClient;
    writeContractAsync: (
      request: SimulatedContractRequest,
    ) => Promise<`0x${string}`>;
  },
) {
  const { publicClient, writeContractAsync, ...simulation } = input;
  const { request } = await publicClient.simulateContract(simulation);
  return writeContractAsync(request);
}
