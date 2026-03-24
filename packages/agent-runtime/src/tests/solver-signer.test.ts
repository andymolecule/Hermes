import assert from "node:assert/strict";
import test from "node:test";
import { AgoraError } from "@agora/common";
import {
  assertSignerAddressStable,
  resolveSignerAddress,
  waitForSuccessfulWrite,
} from "../solver-signer.js";

const hash =
  "0x1111111111111111111111111111111111111111111111111111111111111111";

test("resolveSignerAddress normalizes valid addresses", async () => {
  const address = await resolveSignerAddress({
    getAddress: async () => "0x00000000000000000000000000000000000000AA",
    writeContract: async () => ({ hash }),
    waitForFinality: async () => ({ status: "success" } as never),
  });

  assert.equal(address, "0x00000000000000000000000000000000000000aa");
});

test("resolveSignerAddress wraps missing addresses with an AgoraError", async () => {
  await assert.rejects(
    () =>
      resolveSignerAddress({
        getAddress: async () => {
          throw new Error("boom");
        },
        writeContract: async () => ({ hash }),
        waitForFinality: async () => ({ status: "success" } as never),
      }),
    (error: unknown) => {
      assert.ok(error instanceof AgoraError);
      assert.equal(error.code, "SIGNER_ADDRESS_UNAVAILABLE");
      return true;
    },
  );
});

test("assertSignerAddressStable fails fast on mismatched addresses", async () => {
  await assert.rejects(
    () =>
      assertSignerAddressStable({
        signer: {
          getAddress: async () =>
            "0x00000000000000000000000000000000000000BB",
          writeContract: async () => ({ hash }),
          waitForFinality: async () => ({ status: "success" } as never),
        },
        expectedAddress: "0x00000000000000000000000000000000000000aa",
        operation: "submit",
      }),
    (error: unknown) => {
      assert.ok(error instanceof AgoraError);
      assert.equal(error.code, "SIGNER_ADDRESS_MISMATCH");
      return true;
    },
  );
});

test("waitForSuccessfulWrite returns confirmed receipts", async () => {
  const receipt = await waitForSuccessfulWrite({
    signer: {
      getAddress: async () => "0x00000000000000000000000000000000000000aa",
      writeContract: async () => ({ hash }),
      waitForFinality: async () =>
        ({
          status: "success",
          transactionHash: hash,
        }) as never,
    },
    hash,
    label: "Submission transaction",
    nextAction: "Inspect the write.",
  });

  assert.equal(receipt.transactionHash, hash);
});

test("waitForSuccessfulWrite maps reverted receipts to WRITE_NOT_CONFIRMED", async () => {
  await assert.rejects(
    () =>
      waitForSuccessfulWrite({
        signer: {
          getAddress: async () =>
            "0x00000000000000000000000000000000000000aa",
          writeContract: async () => ({ hash }),
          waitForFinality: async () =>
            ({
              status: "reverted",
              transactionHash: hash,
            }) as never,
        },
        hash,
        label: "Claim transaction",
        nextAction: "Inspect the write.",
      }),
    (error: unknown) => {
      assert.ok(error instanceof AgoraError);
      assert.equal(error.code, "WRITE_NOT_CONFIRMED");
      return true;
    },
  );
});
