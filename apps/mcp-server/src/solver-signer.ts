import { CdpClient } from "@coinbase/cdp-sdk";
import {
  createAgoraWalletClientForAccount,
  createAgoraWalletClientForPrivateKey,
  createSolverSignerFromWalletClient,
  type SolverSigner,
} from "@agora/chain";
import {
  AGORA_ERROR_CODES,
  AgoraError,
  loadConfig,
  readSolverWalletRuntimeConfig,
  resolveRuntimePrivateKey,
} from "@agora/common";
import { toAccount } from "viem/accounts";

function normalizeRawPrivateKey(
  privateKey: string | undefined,
  allowRawPrivateKey: boolean,
) {
  const normalizedPrivateKey = privateKey?.trim();
  if (!normalizedPrivateKey) {
    return undefined;
  }
  if (!/^0x[a-fA-F0-9]{64}$/.test(normalizedPrivateKey)) {
    throw new AgoraError(
      "Invalid privateKey: expected a 0x-prefixed 32-byte hex string.",
      {
        code: AGORA_ERROR_CODES.invalidPrivateKeyReference,
        nextAction: "Provide a valid hex private key or remove the field.",
      },
    );
  }
  if (!allowRawPrivateKey) {
    throw new AgoraError(
      "Raw privateKey input is disabled for this workflow.",
      {
        code: AGORA_ERROR_CODES.invalidPrivateKeyReference,
        nextAction: "Use the configured wallet-backed runtime instead.",
      },
    );
  }
  return normalizedPrivateKey as `0x${string}`;
}

export function createPrivateKeySolverSigner(
  privateKey: `0x${string}`,
): SolverSigner {
  return createSolverSignerFromWalletClient({
    walletClient: createAgoraWalletClientForPrivateKey(privateKey),
  });
}

export async function createConfiguredSolverSigner(input?: {
  allowUnconfiguredPrivateKey?: boolean;
}): Promise<SolverSigner | null> {
  const runtimeConfig = readSolverWalletRuntimeConfig();
  if (runtimeConfig.backend === "private_key") {
    const privateKey = resolveRuntimePrivateKey(loadConfig());
    if (!privateKey) {
      if (input?.allowUnconfiguredPrivateKey) {
        return null;
      }
      throw new AgoraError(
        "Private-key solver wallet backend is missing a configured wallet key.",
        {
          code: AGORA_ERROR_CODES.backendConfigInvalid,
          nextAction:
            "Set AGORA_PRIVATE_KEY or AGORA_ORACLE_KEY, or switch AGORA_SOLVER_WALLET_BACKEND to cdp.",
          details: {
            failureClass: "backend_config_invalid",
            backend: runtimeConfig.backend,
          },
        },
      );
    }
    return createPrivateKeySolverSigner(privateKey);
  }

  try {
    const cdp = new CdpClient({
      apiKeyId: runtimeConfig.apiKeyId,
      apiKeySecret: runtimeConfig.apiKeySecret,
      walletSecret: runtimeConfig.walletSecret,
    });
    const account = runtimeConfig.accountAddress
      ? await cdp.evm.getAccount({
          address: runtimeConfig.accountAddress,
        })
      : await cdp.evm.getOrCreateAccount({
          name: runtimeConfig.accountName as string,
        });

    return createSolverSignerFromWalletClient({
      walletClient: createAgoraWalletClientForAccount(toAccount(account)),
    });
  } catch (error) {
    throw new AgoraError(
      "CDP solver wallet backend could not initialize the configured solver account.",
      {
        code: AGORA_ERROR_CODES.backendConfigInvalid,
        nextAction:
          "Verify the CDP API credentials, wallet secret, stable account identifier, and network access, then retry.",
        details: {
          failureClass: "backend_config_invalid",
          backend: runtimeConfig.backend,
        },
        cause: error,
      },
    );
  }
}

export async function resolveToolSolverSigner(input: {
  privateKey?: string;
  allowRemotePrivateKey: boolean;
  configuredSigner: SolverSigner | null;
}): Promise<SolverSigner> {
  const rawPrivateKey = normalizeRawPrivateKey(
    input.privateKey,
    input.allowRemotePrivateKey,
  );
  if (rawPrivateKey) {
    return createPrivateKeySolverSigner(rawPrivateKey);
  }

  if (input.configuredSigner) {
    return input.configuredSigner;
  }

  throw new AgoraError("No solver wallet is configured for this runtime.", {
    code: AGORA_ERROR_CODES.backendConfigInvalid,
    nextAction:
      "Configure AGORA_SOLVER_WALLET_BACKEND with a valid wallet, or provide a trusted local private key in stdio mode.",
    details: {
      failureClass: "backend_config_invalid",
    },
  });
}
