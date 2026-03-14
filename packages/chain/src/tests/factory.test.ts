import assert from "node:assert/strict";
import test from "node:test";
import { getFactoryContractVersion } from "../factory.js";
import type { getPublicClient } from "../client.js";

test("factory contractVersion falls back to latest when the pinned block header is unavailable", async () => {
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };

  try {
    const calls: Array<{ functionName: string; blockNumber?: bigint }> = [];
    const publicClient = {
      async readContract(input: { functionName: string; blockNumber?: bigint }) {
        calls.push(input);
        if (input.blockNumber !== undefined) {
          throw new Error("header not found");
        }
        return 2n;
      },
    } as unknown as ReturnType<typeof getPublicClient>;

    const version = await getFactoryContractVersion(
      "0x14e9f4d792cf613e5c33bb4deb51d5a0eb09e045",
      38_812_526n,
      publicClient,
    );

    assert.equal(version, 2);
    assert.deepEqual(
      calls.map((call) => ({
        functionName: call.functionName,
        blockNumber: call.blockNumber,
      })),
      [
        { functionName: "contractVersion", blockNumber: 38_812_526n },
        { functionName: "contractVersion", blockNumber: undefined },
      ],
    );
    assert.equal(warnings.length, 1);
  } finally {
    console.warn = originalWarn;
  }
});

test("factory contractVersion does not swallow non-transient RPC errors", async () => {
  const errors: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };

  try {
    const publicClient = {
      async readContract() {
        throw new Error("Missing or invalid parameters");
      },
    } as unknown as ReturnType<typeof getPublicClient>;

    await assert.rejects(
      () =>
        getFactoryContractVersion(
          "0x14e9f4d792cf613e5c33bb4deb51d5a0eb09e045",
          38_812_526n,
          publicClient,
        ),
      /Missing or invalid parameters/,
    );
    assert.equal(errors.length, 1);
  } finally {
    console.error = originalError;
  }
});
