import assert from "node:assert/strict";
import test from "node:test";
import { readChallengeDefinitionMetadataFromChain } from "../challenge-definition.js";
import type { getPublicClient } from "../client.js";

test("challenge definition metadata falls back to latest when the pinned block header is unavailable", async () => {
  const calls: Array<{ functionName: string; blockNumber?: bigint }> = [];
  const publicClient = {
    async readContract(input: { functionName: string; blockNumber?: bigint }) {
      calls.push(input);

      if (input.blockNumber !== undefined) {
        throw new Error("header not found");
      }

      if (input.functionName === "specCid")
        return "bafybeigdyrzt5p3l7w4x6xqk2f4m7c5j2w2g7r3f2n3l5s6v7y8z9abcd";
      if (input.functionName === "deadline") return 1_700_000_000n;
      if (input.functionName === "contractVersion") return 2n;
      throw new Error(`Unexpected function ${input.functionName}`);
    },
  } as unknown as ReturnType<typeof getPublicClient>;

  const result = await readChallengeDefinitionMetadataFromChain({
    publicClient,
    challengeAddress: "0x217b97e7d1a8b878e1322fd191d88479a1f38c70",
    blockNumber: 38_812_516n,
  });

  assert.deepEqual(result, {
    specCid: "bafybeigdyrzt5p3l7w4x6xqk2f4m7c5j2w2g7r3f2n3l5s6v7y8z9abcd",
    onChainDeadline: 1_700_000_000n,
    contractVersion: 2,
  });
  assert.deepEqual(
    calls.map((call) => ({
      functionName: call.functionName,
      blockNumber: call.blockNumber,
    })),
    [
      { functionName: "specCid", blockNumber: 38_812_516n },
      { functionName: "deadline", blockNumber: 38_812_516n },
      { functionName: "contractVersion", blockNumber: 38_812_516n },
      { functionName: "specCid", blockNumber: undefined },
      { functionName: "deadline", blockNumber: undefined },
      { functionName: "contractVersion", blockNumber: undefined },
    ],
  );
});

test("challenge definition metadata does not swallow non-block RPC errors", async () => {
  const publicClient = {
    async readContract() {
      throw new Error("Missing or invalid parameters");
    },
  } as unknown as ReturnType<typeof getPublicClient>;

  await assert.rejects(
    () =>
      readChallengeDefinitionMetadataFromChain({
        publicClient,
        challengeAddress: "0x217b97e7d1a8b878e1322fd191d88479a1f38c70",
        blockNumber: 38_812_516n,
      }),
    /Missing or invalid parameters/,
  );
});
