import assert from "node:assert/strict";
import test from "node:test";
import { AgoraError, erc20Abi } from "@agora/common";
import { encodeErrorResult } from "viem";
import {
  AmbiguousWriteResultError,
  classifyWriteError,
  isRetryableWriteError,
  sendWriteWithRetry,
} from "../tx-write.js";

const accountAddress = "0x0000000000000000000000000000000000000001";

function createCustomRevertError(errorName: string) {
  const error = new Error("execution reverted");
  return Object.assign(error, {
    shortMessage: `The contract function "createChallenge" reverted with the following error:\n${errorName}()`,
    walk(visitor: (candidate: unknown) => unknown) {
      return visitor({
        name: "ContractFunctionRevertedError",
        shortMessage: `The contract function "createChallenge" reverted with the following error:\n${errorName}()`,
        data: {
          errorName,
          args: [],
        },
      });
    },
  });
}

function createRawSignatureRevertError(raw: `0x${string}`) {
  const signature = raw.slice(0, 10) as `0x${string}`;
  const error = new Error("execution reverted");
  return Object.assign(error, {
    shortMessage: `The contract function "createChallenge" reverted with the following signature:\n${signature}`,
    walk(visitor: (candidate: unknown) => unknown) {
      return visitor({
        name: "ContractFunctionRevertedError",
        shortMessage: `The contract function "createChallenge" reverted with the following signature:\n${signature}`,
        raw,
        signature,
      });
    },
  });
}

test("sendWriteWithRetry retries transient transport errors", async () => {
  let attempts = 0;
  const txHash = await sendWriteWithRetry({
    accountAddress,
    label: "Submission transaction",
    maxAttempts: 3,
    publicClient: {
      getTransactionCount: async () => 7,
    } as never,
    write: async () => {
      attempts += 1;
      if (attempts < 2) {
        throw new Error("fetch failed");
      }
      return "0x1111111111111111111111111111111111111111111111111111111111111111";
    },
  });

  assert.equal(attempts, 2);
  assert.equal(
    txHash,
    "0x1111111111111111111111111111111111111111111111111111111111111111",
  );
});

test("sendWriteWithRetry stops when the pending nonce moved", async () => {
  let nonceReads = 0;
  await assert.rejects(
    () =>
      sendWriteWithRetry({
        accountAddress,
        label: "Submission transaction",
        maxAttempts: 3,
        publicClient: {
          getTransactionCount: async () => {
            nonceReads += 1;
            return nonceReads === 1 ? 3 : 4;
          },
        } as never,
        write: async () => {
          throw new Error("network timeout");
        },
      }),
    AmbiguousWriteResultError,
  );
});

test("sendWriteWithRetry returns a machine-readable retry exhaustion error", async () => {
  await assert.rejects(
    () =>
      sendWriteWithRetry({
        accountAddress,
        label: "Submission transaction",
        maxAttempts: 2,
        publicClient: {
          getTransactionCount: async () => 3,
        } as never,
        write: async () => {
          throw new Error("fetch failed");
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof AgoraError);
      assert.equal(error.code, "CHAIN_WRITE_RETRY_EXHAUSTED");
      assert.equal(error.retriable, true);
      assert.equal(error.details?.lastError, "fetch failed");
      return true;
    },
  );
});

test("retryable write detection excludes deterministic reverts", () => {
  assert.equal(isRetryableWriteError(new Error("fetch failed")), true);
  assert.equal(
    isRetryableWriteError(new Error("execution reverted: ChallengeClosed")),
    false,
  );
  assert.equal(
    isRetryableWriteError(
      new Error("insufficient funds for gas * price + value"),
    ),
    false,
  );
});

test("classifyWriteError surfaces decoded custom revert details", () => {
  const error = classifyWriteError(
    createCustomRevertError("InvalidSubmissionLimits"),
    {
      label: "Authoring sponsor challenge creation",
      phase: "simulate",
      revertNextAction:
        "Confirm the compiled reward, deadline, dispute window, minimum score, and submission limits fit the active factory constraints, then inspect the Agora sponsor wallet's USDC funding and allowance before retrying.",
      details: {
        funding: "sponsor",
        phase: "simulate",
        operation: "createChallenge",
      },
    },
  );

  assert.ok(error instanceof AgoraError);
  assert.equal(error.code, "TX_REVERTED");
  assert.equal(error.retriable, false);
  assert.match(error.message, /InvalidSubmissionLimits/);
  assert.equal(
    error.nextAction,
    "Confirm the compiled reward, deadline, dispute window, minimum score, and submission limits fit the active factory constraints, then inspect the Agora sponsor wallet's USDC funding and allowance before retrying.",
  );
  assert.equal(error.details?.revertErrorName, "InvalidSubmissionLimits");
  assert.equal(error.details?.phase, "simulate");
  assert.equal(error.details?.operation, "createChallenge");
});

test("classifyWriteError decodes raw ERC20 custom errors", () => {
  const raw = encodeErrorResult({
    abi: erc20Abi,
    errorName: "ERC20InsufficientAllowance",
    args: ["0x00000000000000000000000000000000000000aa", 5n, 10n],
  });
  const error = classifyWriteError(createRawSignatureRevertError(raw), {
    label: "Authoring sponsor challenge creation",
    phase: "simulate",
    details: {
      funding: "sponsor",
      phase: "simulate",
      operation: "createChallenge",
    },
  });

  assert.ok(error instanceof AgoraError);
  assert.equal(error.code, "TX_REVERTED");
  assert.match(error.message, /ERC20InsufficientAllowance/);
  assert.equal(error.details?.revertErrorName, "ERC20InsufficientAllowance");
  assert.equal(error.details?.revertSignature, raw.slice(0, 10));
  assert.equal(
    (error.details?.revertErrorArgs as unknown[] | undefined)?.[0],
    "0x00000000000000000000000000000000000000AA",
  );
  assert.deepEqual(
    (error.details?.revertErrorArgs as unknown[] | undefined)?.slice(1),
    [5n, 10n],
  );
});
