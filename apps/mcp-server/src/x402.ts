import * as x402Core from "@x402/core/server";
import * as x402Evm from "@x402/evm/exact/server";
import type { IncomingMessage, ServerResponse } from "node:http";

const MCP_SESSION_PRICE_USD = 0.01;
let x402ResolutionLogged = false;

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

type Verifier = {
  verifyAndSettle: (input: {
    paymentHeader: string;
    method: string;
    path: string;
    network: string;
    payTo: string;
    priceUsd: number;
  }) => Promise<boolean>;
};

let cachedVerifier: Verifier | null | undefined;

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

function resolveNamedExport(
  moduleRef: Record<string, unknown>,
  names: string[],
) {
  for (const name of names) {
    if (name in moduleRef && moduleRef[name] !== undefined) {
      return { value: moduleRef[name], name };
    }
  }
  return { value: undefined, name: null };
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

function loadVerifier(): Verifier | null {
  if (cachedVerifier !== undefined) {
    return cachedVerifier;
  }

  const serverResolved = resolveNamedExport(
    x402Core as Record<string, unknown>,
    ["x402ResourceServer", "X402ResourceServer"],
  );
  const facilitatorResolved = resolveNamedExport(
    x402Core as Record<string, unknown>,
    ["HTTPFacilitatorClient", "FacilitatorClient"],
  );
  const schemeResolved = resolveNamedExport(
    x402Evm as Record<string, unknown>,
    ["ExactEvmScheme", "ExactEvmServerScheme"],
  );

  const x402ResourceServer = serverResolved.value as
    | (new (...args: unknown[]) => unknown)
    | undefined;
  const facilitatorClient = facilitatorResolved.value as
    | (new (...args: unknown[]) => unknown)
    | undefined;
  const exactEvmScheme = schemeResolved.value as
    | (new (...args: unknown[]) => unknown)
    | undefined;

  if (!x402ResourceServer || !facilitatorClient || !exactEvmScheme) {
    cachedVerifier = null;
    return null;
  }

  if (!x402ResolutionLogged) {
    console.info(
      `[x402][mcp] exports server=${serverResolved.name} facilitator=${facilitatorResolved.name} scheme=${schemeResolved.name}`,
    );
    x402ResolutionLogged = true;
  }

  cachedVerifier = {
    verifyAndSettle: async (input) => {
      const config = readX402Config();
      const server = new x402ResourceServer(
        new facilitatorClient({ url: config.facilitatorUrl }),
      ) as { register?: (...args: unknown[]) => unknown };
      if (typeof server.register === "function") {
        server.register(config.network, new exactEvmScheme());
      }

      return verifyViaFacilitator(input);
    },
  };
  return cachedVerifier;
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
        description: "Fee per MCP HTTP request.",
      },
    ],
  };
}

export async function enforceMcpSessionPayment(
  req: IncomingMessage,
  res: ServerResponse,
) {
  const config = readX402Config();
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

  const verifier = loadVerifier();
  if (!verifier) {
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        error:
          "x402 verification is enabled for MCP but verifier dependencies are unavailable.",
      }),
    );
    return false;
  }

  const ok = await verifier.verifyAndSettle({
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
