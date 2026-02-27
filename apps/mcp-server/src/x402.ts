import type { IncomingMessage, ServerResponse } from "node:http";

const MCP_SESSION_PRICE_USD = 0.01;
let x402ConfigLogged = false;

function hasPaymentHeader(req: IncomingMessage) {
  return Boolean(
    req.headers["x-payment"] ??
      req.headers["x-payment-response"] ??
      req.headers["x-402-payment"],
  );
}

function paymentHeader(req: IncomingMessage) {
  const value =
    req.headers["x-payment"] ??
    req.headers["x-payment-response"] ??
    req.headers["x-402-payment"];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

type X402RuntimeConfig = {
  enabled: boolean;
  reportOnly: boolean;
  facilitatorUrl: string;
  network: string;
  payTo: string;
};

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function readX402Config(): X402RuntimeConfig {
  return {
    enabled: parseBoolean(process.env.HERMES_X402_ENABLED, false),
    reportOnly: parseBoolean(process.env.HERMES_X402_REPORT_ONLY, false),
    facilitatorUrl:
      process.env.HERMES_X402_FACILITATOR_URL ?? "https://x402.org/facilitator",
    network: process.env.HERMES_X402_NETWORK ?? "eip155:84532",
    payTo:
      process.env.HERMES_TREASURY_ADDRESS ??
      process.env.HERMES_USDC_ADDRESS ??
      "0x0000000000000000000000000000000000000000",
  };
}

async function verifyViaFacilitator(input: {
  paymentHeader: string;
  method: string;
  path: string;
  network: string;
  payTo: string;
  priceUsd: number;
}) {
  const config = readX402Config();
  const base = config.facilitatorUrl.replace(/\/$/, "");
  const verifyRes = await fetch(`${base}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      payment: input.paymentHeader,
      network: input.network,
      resource: {
        method: input.method,
        path: input.path,
        payTo: input.payTo,
        priceUsd: input.priceUsd,
      },
    }),
  });

  if (!verifyRes.ok) {
    return false;
  }

  let verifyJson: Record<string, unknown> = {};
  try {
    verifyJson = (await verifyRes.json()) as Record<string, unknown>;
  } catch {
    return false;
  }

  const verified =
    verifyJson.ok === true ||
    verifyJson.verified === true ||
    verifyJson.valid === true;
  if (!verified) {
    return false;
  }

  const settleRes = await fetch(`${base}/settle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      payment: input.paymentHeader,
      network: input.network,
      resource: {
        method: input.method,
        path: input.path,
        payTo: input.payTo,
        priceUsd: input.priceUsd,
      },
    }),
  });
  if (!settleRes.ok) {
    return false;
  }
  let settleJson: Record<string, unknown> = {};
  try {
    settleJson = (await settleRes.json()) as Record<string, unknown>;
  } catch {
    return false;
  }
  return (
    settleJson.ok === true ||
    settleJson.settled === true ||
    settleJson.success === true
  );
}

export function getMcpX402Metadata() {
  const config = readX402Config();
  return {
    enabled: config.enabled,
    reportOnly: config.reportOnly,
    network: config.network,
    facilitatorUrl: config.facilitatorUrl,
    payTo: config.payTo,
    routes: [
      {
        id: "mcp-session",
        method: "POST",
        path: "/mcp",
        priceUsd: MCP_SESSION_PRICE_USD,
        description: "Fee per MCP session bootstrap.",
      },
    ],
  };
}

export async function enforceMcpSessionPayment(
  req: IncomingMessage,
  res: ServerResponse,
) {
  const config = readX402Config();

  if (!x402ConfigLogged) {
    console.info(
      `[x402][mcp] enabled=${config.enabled} reportOnly=${config.reportOnly} facilitator=${config.facilitatorUrl} network=${config.network} payTo=${config.payTo}`,
    );
    x402ConfigLogged = true;
  }

  if (!config.enabled) return true;

  if (config.reportOnly) {
    console.info(
      `[x402][report-only] would charge route=mcp-session method=${req.method ?? "UNKNOWN"} path=/mcp price=$${MCP_SESSION_PRICE_USD.toFixed(2)}`,
    );
    return true;
  }

  if (!hasPaymentHeader(req)) {
    const metadata = getMcpX402Metadata();
    res.statusCode = 402;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        error: "Payment Required",
        payment: {
          protocol: "x402",
          network: metadata.network,
          payTo: metadata.payTo,
          route: "/mcp",
          method: req.method ?? "POST",
          priceUsd: MCP_SESSION_PRICE_USD,
        },
      }),
    );
    return false;
  }

  const ok = await verifyViaFacilitator({
    paymentHeader: paymentHeader(req) ?? "",
    method: req.method ?? "POST",
    path: "/mcp",
    network: config.network,
    payTo: config.payTo,
    priceUsd: MCP_SESSION_PRICE_USD,
  });

  if (ok) return true;

  res.statusCode = 402;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ error: "Payment verification failed." }));
  return false;
}
