import { applyAgoraRuntimeEnv } from "./runtime-env.mjs";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);
const LOCAL_CHAIN_ID = 31337;

export async function assertLocalSmokeEnv(input = {}) {
  applyAgoraRuntimeEnv();

  const requireApi = input.requireApi === true;
  const requireSupabase = input.requireSupabase === true;
  const rpcUrl = process.env.AGORA_RPC_URL?.trim();

  if (!rpcUrl) {
    throw new Error(
      "Missing required env var: AGORA_RPC_URL. Next step: point AGORA_RPC_URL at local Anvil and retry.",
    );
  }

  const chainId = await readChainId(rpcUrl);
  if (chainId !== LOCAL_CHAIN_ID) {
    throw new Error(
      `Deterministic local smoke requires AGORA_RPC_URL to target local Anvil (chain id ${LOCAL_CHAIN_ID}), but the current RPC reports chain id ${chainId}. Next step: switch AGORA_RPC_URL to the local chain and retry.`,
    );
  }

  if (
    process.env.AGORA_CHAIN_ID?.trim() &&
    Number(process.env.AGORA_CHAIN_ID) !== LOCAL_CHAIN_ID
  ) {
    throw new Error(
      `AGORA_CHAIN_ID must be ${LOCAL_CHAIN_ID} for deterministic local smoke. Next step: update AGORA_CHAIN_ID to ${LOCAL_CHAIN_ID} and retry.`,
    );
  }

  if (requireApi) {
    assertLoopbackUrl("AGORA_API_URL", process.env.AGORA_API_URL);
  }

  if (requireSupabase) {
    assertLoopbackUrl("AGORA_SUPABASE_URL", process.env.AGORA_SUPABASE_URL);
  }
}

async function readChainId(rpcUrl) {
  let response;
  try {
    response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_chainId",
        params: [],
      }),
    });
  } catch (error) {
    throw new Error(
      `Unable to reach AGORA_RPC_URL. Next step: start local Anvil and retry. (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `AGORA_RPC_URL returned HTTP ${response.status} while checking the local chain id. Next step: start local Anvil and retry.`,
    );
  }

  const payload = await response.json().catch(() => null);
  const result =
    payload && typeof payload === "object" && "result" in payload
      ? payload.result
      : null;
  if (typeof result !== "string") {
    throw new Error(
      "AGORA_RPC_URL did not return a valid chain id. Next step: point AGORA_RPC_URL at local Anvil and retry.",
    );
  }

  return Number.parseInt(result, 16);
}

function assertLoopbackUrl(envKey, value) {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(
      `Missing required env var: ${envKey}. Next step: point ${envKey} at the local service and retry.`,
    );
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(
      `${envKey} must be a valid URL. Next step: point ${envKey} at the local service and retry.`,
    );
  }

  if (!LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error(
      `${envKey} must point at a loopback local service for deterministic local smoke. Current host: ${parsed.hostname}. Next step: switch ${envKey} to the local stack and retry.`,
    );
  }
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  const args = new Set(process.argv.slice(2));
  await assertLocalSmokeEnv({
    requireApi: args.has("--require-api"),
    requireSupabase: args.has("--require-supabase"),
  }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[FAIL] ${message}`);
    process.exit(1);
  });
}
