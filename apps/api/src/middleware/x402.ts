import * as x402Core from "@x402/core/server";
import * as x402Evm from "@x402/evm/exact/server";
import * as x402Hono from "@x402/hono";
import type { Context, MiddlewareHandler, Next } from "hono";
import type { ApiEnv } from "../types.js";

type PaidRoute = {
  id: string;
  method: string;
  path: string;
  pattern: RegExp;
  priceUsd: number;
  description: string;
};

const API_PAID_ROUTES: PaidRoute[] = [
  {
    id: "agent-list-challenges",
    method: "GET",
    path: "/api/agent/challenges",
    pattern: /^\/api\/agent\/challenges$/,
    priceUsd: 0.001,
    description: "Agent challenge discovery list",
  },
  {
    id: "agent-get-challenge",
    method: "GET",
    path: "/api/agent/challenges/:id",
    pattern: /^\/api\/agent\/challenges\/[^/]+$/,
    priceUsd: 0.002,
    description: "Agent challenge detail",
  },
  {
    id: "agent-get-leaderboard",
    method: "GET",
    path: "/api/agent/challenges/:id/leaderboard",
    pattern: /^\/api\/agent\/challenges\/[^/]+\/leaderboard$/,
    priceUsd: 0.002,
    description: "Agent leaderboard query",
  },
  {
    id: "verify-write",
    method: "POST",
    path: "/api/verify",
    pattern: /^\/api\/verify$/,
    priceUsd: 0.02,
    description: "Verification write endpoint",
  },
  {
    id: "score-preview",
    method: "POST",
    path: "/api/score-preview",
    pattern: /^\/api\/score-preview$/,
    priceUsd: 0.1,
    description: "Dry-run scorer compute endpoint",
  },
];
let x402ResolutionLogged = false;

function matchPaidRoute(method: string, pathname: string) {
  return API_PAID_ROUTES.find(
    (route) => route.method === method && route.pattern.test(pathname),
  );
}

function routeCatalog(network: string) {
  return Object.fromEntries(
    API_PAID_ROUTES.map((route) => [
      `${route.method} ${route.path}`,
      {
        price: `$${route.priceUsd.toFixed(3)}`,
        network,
        config: { description: route.description },
      },
    ]),
  );
}

function toPaymentRequired(route: PaidRoute, network: string, payTo: string) {
  return {
    protocol: "x402",
    network,
    payTo,
    route: route.path,
    method: route.method,
    priceUsd: route.priceUsd,
    description: route.description,
  };
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

function loadX402Middleware(enforce: boolean): MiddlewareHandler<ApiEnv> | null {
  if (!enforce) return null;

  const config = readX402Config();
  const paymentResolved = resolveNamedExport(
    x402Hono as Record<string, unknown>,
    ["paymentMiddleware"],
  );
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

  const paymentMiddleware = paymentResolved.value as
    | ((...args: unknown[]) => unknown)
    | undefined;
  const x402ResourceServer = serverResolved.value as
    | (new (...args: unknown[]) => unknown)
    | undefined;
  const facilitatorClient = facilitatorResolved.value as
    | (new (...args: unknown[]) => unknown)
    | undefined;
  const exactEvmScheme = schemeResolved.value as
    | (new (...args: unknown[]) => unknown)
    | undefined;

  if (
    !paymentMiddleware ||
    !x402ResourceServer ||
    !facilitatorClient ||
    !exactEvmScheme
  ) {
    return null;
  }

  if (!x402ResolutionLogged) {
    console.info(
      `[x402][api] exports payment=${paymentResolved.name} server=${serverResolved.name} facilitator=${facilitatorResolved.name} scheme=${schemeResolved.name}`,
    );
    x402ResolutionLogged = true;
  }

  const network = config.network;
  const facilitatorUrl = config.facilitatorUrl;
  const routes = routeCatalog(network);
  const server = new x402ResourceServer(
    new facilitatorClient({ url: facilitatorUrl }),
  );
  const candidate = server as { register?: (...args: unknown[]) => unknown };
  if (typeof candidate.register === "function") {
    candidate.register(network, new exactEvmScheme());
  }

  try {
    const middleware = paymentMiddleware(routes, server);
    if (typeof middleware === "function") {
      return middleware as MiddlewareHandler<ApiEnv>;
    }
    return null;
  } catch {
    return null;
  }
}

export function buildX402Metadata() {
  const config = readX402Config();
  return {
    enabled: config.enabled,
    reportOnly: config.reportOnly,
    network: config.network,
    facilitatorUrl: config.facilitatorUrl,
    payTo: config.payTo,
    routes: API_PAID_ROUTES.map((route) => ({
      id: route.id,
      method: route.method,
      path: route.path,
      priceUsd: route.priceUsd,
      description: route.description,
    })),
  };
}

export function createX402Middleware(): MiddlewareHandler<ApiEnv> {
  const config = readX402Config();
  const metadata = buildX402Metadata();
  const reportOnly = config.reportOnly;
  const enabled = config.enabled;
  const libraryMiddleware = loadX402Middleware(enabled && !reportOnly);

  return async (c: Context<ApiEnv>, next: Next) => {
    const matched = matchPaidRoute(c.req.method, c.req.path);
    if (!matched) {
      await next();
      return;
    }

    if (!enabled) {
      await next();
      return;
    }

    if (reportOnly) {
      console.info(
        `[x402][report-only] would charge route=${matched.id} method=${c.req.method} path=${c.req.path} price=$${matched.priceUsd.toFixed(3)}`,
      );
      c.res.headers.set("X-Hermes-X402-Report", "would-charge");
      await next();
      return;
    }

    if (libraryMiddleware) {
      await libraryMiddleware(c, next);
      return;
    }

    return c.json(
      {
        error:
          "x402 middleware is enabled but runtime dependencies are unavailable.",
        payment: toPaymentRequired(
          matched,
          metadata.network,
          metadata.payTo as string,
        ),
      },
      503,
    );
  };
}
