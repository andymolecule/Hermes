import assert from "node:assert/strict";
import test from "node:test";
import { createSolverSignerFromWalletClient } from "../solver-signer.js";

const address = "0x0000000000000000000000000000000000000001";
const hash =
  "0x1111111111111111111111111111111111111111111111111111111111111111";

test("createSolverSignerFromWalletClient proxies address, writes, and finality", async () => {
  let writeCalls = 0;
  let waitedHash: `0x${string}` | null = null;
  const signer = createSolverSignerFromWalletClient({
    walletClient: {
      account: { address } as never,
      writeContract: async () => {
        writeCalls += 1;
        return hash;
      },
    } as never,
    publicClient: {
      waitForTransactionReceipt: async ({ hash: inputHash }) => {
        waitedHash = inputHash;
        return {
          status: "success",
          transactionHash: inputHash,
        } as never;
      },
    },
  });

  assert.equal(await signer.getAddress(), address);
  assert.deepEqual(
    await signer.writeContract({
      address,
      abi: [],
      functionName: "claim",
      args: [],
    }),
    { hash },
  );
  const receipt = await signer.waitForFinality({ hash });

  assert.equal(writeCalls, 1);
  assert.equal(waitedHash, hash);
  assert.equal(receipt.transactionHash, hash);
});

test("createSolverSignerFromWalletClient rejects missing account addresses", async () => {
  const signer = createSolverSignerFromWalletClient({
    walletClient: {
      account: undefined,
      writeContract: async () => hash,
    } as never,
    publicClient: {
      waitForTransactionReceipt: async () => ({ status: "success" } as never),
    },
  });

  await assert.rejects(
    () => signer.getAddress(),
    /Wallet client is missing an account address/,
  );
});
