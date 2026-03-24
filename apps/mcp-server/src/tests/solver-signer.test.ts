import assert from "node:assert/strict";
import test from "node:test";
import { AgoraError, resetConfigCache } from "@agora/common";
import {
  createConfiguredSolverSigner,
  resolveToolSolverSigner,
} from "../solver-signer.js";

const originalEnv = { ...process.env };
const privateKey =
  "0x1111111111111111111111111111111111111111111111111111111111111111";

function setBaseEnv() {
  process.env.AGORA_RPC_URL = "https://example-rpc.invalid";
  process.env.AGORA_FACTORY_ADDRESS =
    "0x0000000000000000000000000000000000000001";
  process.env.AGORA_USDC_ADDRESS =
    "0x0000000000000000000000000000000000000002";
  delete process.env.AGORA_PRIVATE_KEY;
  delete process.env.AGORA_ORACLE_KEY;
  delete process.env.AGORA_CDP_API_KEY_ID;
  delete process.env.AGORA_CDP_API_KEY_SECRET;
  delete process.env.AGORA_CDP_WALLET_SECRET;
  delete process.env.AGORA_CDP_ACCOUNT_NAME;
  delete process.env.AGORA_CDP_ACCOUNT_ADDRESS;
}

test.afterEach(() => {
  process.env = { ...originalEnv };
  resetConfigCache();
});

test("createConfiguredSolverSigner allows local stdio mode without a configured private key", async () => {
  setBaseEnv();
  process.env.AGORA_SOLVER_WALLET_BACKEND = "private_key";

  const signer = await createConfiguredSolverSigner({
    allowUnconfiguredPrivateKey: true,
  });

  assert.equal(signer, null);
});

test("resolveToolSolverSigner returns the configured signer when present", async () => {
  const configuredSigner = {
    getAddress: async () =>
      "0x0000000000000000000000000000000000000003" as `0x${string}`,
    writeContract: async () => ({
      hash:
        "0x2222222222222222222222222222222222222222222222222222222222222222" as `0x${string}`,
    }),
    waitForFinality: async () => ({ status: "success" } as never),
  };

  const signer = await resolveToolSolverSigner({
    allowRemotePrivateKey: false,
    configuredSigner,
  });

  assert.equal(await signer.getAddress(), await configuredSigner.getAddress());
});

test("resolveToolSolverSigner builds a local signer from a trusted raw private key", async () => {
  setBaseEnv();

  const signer = await resolveToolSolverSigner({
    privateKey,
    allowRemotePrivateKey: true,
    configuredSigner: null,
  });

  assert.equal(
    (await signer.getAddress()).toLowerCase(),
    "0x19E7E376E7C213B7E7E7E46CC70A5DD086DAFF2A".toLowerCase(),
  );
});

test("resolveToolSolverSigner rejects missing wallet configuration", async () => {
  await assert.rejects(
    () =>
      resolveToolSolverSigner({
        allowRemotePrivateKey: false,
        configuredSigner: null,
      }),
    (error: unknown) => {
      assert.ok(error instanceof AgoraError);
      assert.equal(error.code, "BACKEND_CONFIG_INVALID");
      return true;
    },
  );
});

test("createConfiguredSolverSigner fails fast on incomplete CDP configuration", async () => {
  setBaseEnv();
  process.env.AGORA_SOLVER_WALLET_BACKEND = "cdp";
  process.env.AGORA_CDP_API_KEY_ID = "cdp-key-id";
  process.env.AGORA_CDP_WALLET_SECRET = "cdp-wallet-secret";
  process.env.AGORA_CDP_ACCOUNT_NAME = "telegram-agent";

  await assert.rejects(
    () => createConfiguredSolverSigner(),
    /AGORA_CDP_API_KEY_SECRET/,
  );
});
