import assert from "node:assert/strict";
import {
  extractX402PaymentHeader,
  verifyAndSettleX402Payment,
} from "../x402-facilitator.js";

assert.equal(
  extractX402PaymentHeader((name) => {
    if (name === "x-payment") return "abc";
    return undefined;
  }),
  "abc",
);

assert.equal(
  extractX402PaymentHeader((name) => {
    if (name === "x-payment-response") return ["", "ignored"];
    if (name === "x-402-payment") return "fallback";
    return undefined;
  }),
  "fallback",
);

const callOrder: string[] = [];
const successFetch: typeof fetch = async (input) => {
  const url = String(input);
  if (url.endsWith("/verify")) {
    callOrder.push("verify");
    return new Response(JSON.stringify({ verified: true }), { status: 200 });
  }
  if (url.endsWith("/settle")) {
    callOrder.push("settle");
    return new Response(JSON.stringify({ settled: true }), { status: 200 });
  }
  return new Response("not found", { status: 404 });
};

const success = await verifyAndSettleX402Payment({
  facilitatorUrl: "https://x402.example/facilitator/",
  paymentHeader: "header-1",
  network: "eip155:84532",
  resource: {
    method: "POST",
    path: "/api/verify",
    payTo: "0x0000000000000000000000000000000000000001",
    priceUsd: 0.01,
  },
  fetchImpl: successFetch,
});
assert.equal(success, true);
assert.deepEqual(callOrder, ["verify", "settle"]);

const verifyFail = await verifyAndSettleX402Payment({
  facilitatorUrl: "https://x402.example/facilitator",
  paymentHeader: "header-2",
  network: "eip155:84532",
  resource: {
    method: "POST",
    path: "/api/verify",
    payTo: "0x0000000000000000000000000000000000000001",
    priceUsd: 0.01,
  },
  fetchImpl: async () =>
    new Response(JSON.stringify({ ok: false }), { status: 200 }),
});
assert.equal(verifyFail, false);

const settleFail = await verifyAndSettleX402Payment({
  facilitatorUrl: "https://x402.example/facilitator",
  paymentHeader: "header-3",
  network: "eip155:84532",
  resource: {
    method: "POST",
    path: "/api/verify",
    payTo: "0x0000000000000000000000000000000000000001",
    priceUsd: 0.01,
  },
  fetchImpl: async (input) => {
    const url = String(input);
    if (url.endsWith("/verify")) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: false }), { status: 200 });
  },
});
assert.equal(settleFail, false);

console.log("x402 facilitator helpers validation passed");
