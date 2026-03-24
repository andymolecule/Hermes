import type { SolverSigner } from "@agora/chain";
import { AGORA_ERROR_CODES, AgoraError, ensureAgoraError } from "@agora/common";
import type { TransactionReceipt } from "viem";

function normalizeSignerAddress(address: string) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new AgoraError("Configured signer returned an invalid wallet address.", {
      code: AGORA_ERROR_CODES.signerAddressUnavailable,
      nextAction:
        "Verify the configured wallet/account and signer adapter wiring, then retry.",
      details: { address },
    });
  }
  return address.toLowerCase() as `0x${string}`;
}

export async function resolveSignerAddress(
  signer: SolverSigner,
): Promise<`0x${string}`> {
  try {
    const address = await signer.getAddress();
    return normalizeSignerAddress(address);
  } catch (error) {
    throw ensureAgoraError(error, {
      code: AGORA_ERROR_CODES.signerAddressUnavailable,
      message: "Configured signer could not provide a stable solver address.",
      nextAction:
        "Verify the configured wallet/account and signer adapter wiring, then retry.",
      details: {
        failureClass: "signer_address_unavailable",
      },
    });
  }
}

export async function assertSignerAddressStable(input: {
  signer: SolverSigner;
  expectedAddress: `0x${string}`;
  operation: "submit" | "claim";
}) {
  const resolvedAddress = await resolveSignerAddress(input.signer);
  if (resolvedAddress === input.expectedAddress) {
    return resolvedAddress;
  }
  throw new AgoraError(
    `Configured signer address changed during ${input.operation}.`,
    {
      code: AGORA_ERROR_CODES.signerAddressMismatch,
      nextAction:
        "Check wallet rotation, changed credentials, or broken signer adapter wiring before retrying.",
      details: {
        failureClass: "signer_address_mismatch",
        expectedAddress: input.expectedAddress,
        resolvedAddress,
        operation: input.operation,
      },
    },
  );
}

export async function waitForSuccessfulWrite(input: {
  signer: SolverSigner;
  hash: `0x${string}`;
  label: "Submission transaction" | "Claim transaction";
  nextAction: string;
}): Promise<TransactionReceipt> {
  let receipt: TransactionReceipt;
  try {
    receipt = await input.signer.waitForFinality({ hash: input.hash });
  } catch (error) {
    throw ensureAgoraError(error, {
      code: AGORA_ERROR_CODES.writeNotConfirmed,
      message: `${input.label} did not confirm onchain: ${input.hash}.`,
      nextAction: input.nextAction,
      details: {
        failureClass: "write_not_confirmed",
        txHash: input.hash,
      },
    });
  }

  if (receipt.status !== "success") {
    throw new AgoraError(`${input.label} reverted: ${input.hash}.`, {
      code: AGORA_ERROR_CODES.writeNotConfirmed,
      nextAction: input.nextAction,
      details: {
        failureClass: "write_not_confirmed",
        txHash: input.hash,
      },
    });
  }

  return receipt;
}
