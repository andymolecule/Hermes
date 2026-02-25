// Skip early if required env vars are missing — check raw process.env
// because loadConfig() will throw on missing required vars.
if (
  !process.env.HERMES_PINATA_JWT ||
  !process.env.HERMES_RPC_URL ||
  !process.env.HERMES_FACTORY_ADDRESS ||
  !process.env.HERMES_USDC_ADDRESS
) {
  console.log("SKIP: IPFS test requires HERMES_PINATA_JWT + core env vars");
  process.exit(0);
}

const { pinJSON } = await import("../pin");
const { getJSON } = await import("../fetch");

const payload = {
  hello: "world",
  timestamp: new Date().toISOString(),
};

const name = `hermes-test-${Date.now()}`;
const cid = await pinJSON(name, payload);
const fetched = await getJSON<typeof payload>(cid);

if (fetched.hello !== payload.hello) {
  throw new Error("IPFS round-trip failed: payload mismatch");
}

console.log("PASS: IPFS round-trip test");

export {};
