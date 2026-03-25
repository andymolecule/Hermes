import {
  extractX402PaymentHeader,
  readX402RuntimeConfig,
  verifyAndSettleX402Payment,
} from "@agora/common";
import * as x402Core from "@x402/core/server";
import * as x402Evm from "@x402/evm/exact/server";
import * as x402Hono from "@x402/hono";
import type { Context, MiddlewareHandler, Next } from "hono";
import { jsonError } from "../lib/api-error.js";
import { apiLogger, getRequestLogger } from "../lib/observability.js";
import type { ApiEnv } from "../types.js";

type PaidRoute = {
  id: string;
  method: string;
  canonicalPath: string;
  paths: {
    path: string;
    pattern: RegExp;
  }[];
  priceUsd: number;
  description: string;
};

const API_PAID_ROUTES: PaidRoute[] = [
  {
    id: "challenge-list",
    method: "GET",
    canonicalPath: "/api/challenges",
    paths: [
      {
        path: "/api/challenges",
        pattern: /^\/api\/challenges$/,
      },
    ],
    priceUsd: 0.001,
    description: "Challenge discovery list",
  },
  {
    id: "challenge-detail",
    method: "GET",
    canonicalPath: "/api/challenges/:id",
    paths: [
      {
        path: "/api/challenges/:id",
        pattern: /^\/api\/challenges\/[^/]+$/,
      },
      {
        path: "/api/challenges/by-address/:address",
        pattern: /^\/api\/challenges\/by-address\/0x[a-fA-F0-9]{40}$/,
      },
    ],
    priceUsd: 0.002,
    description: "Challenge detail",
  },
  {
    id: "challenge-leaderboard",
    method: "GET",
    canonicalPath: "/api/challenges/:id/leaderboard",
    paths: [
      {
        path: "/api/challenges/:id/leaderboard",
        pattern: /^\/api\/challenges\/[^/]+\/leaderboard$/,
      },
      {
        path: "/api/challenges/by-address/:address/leaderboard",
        pattern:
          /^\/api\/challenges\/by-address\/0x[a-fA-F0-9]{40}\/leaderboard$/,
      },
    ],
    priceUsd: 0.002,
    description: "Challenge leaderboard query",
  },
  {
    id: "verify-write",
    method: "POST",
    canonicalPath: "/api/verify",
    paths: [
      {
        path: "/api/verify",
        pattern: /^\/api\/verify$/,
      },
    ],
    priceUsd: 0.02,
    description: "Verification write endpoint",
  },
];
let x402ResolutionLogged = false;

export function matchPaidRoute(method: string, pathname: string) {
  for (const route of API_PAID_ROUTES) {
    if (route.method !== method) {
      continue;
    }
    for (const routePath of route.paths) {
      if (routePath.pattern.test(pathname)) {
        return { route, routePath };
      }
    }
  }
  return undefined;
}

function routeCatalog(network: string) {
  return Object.fromEntries(
    API_PAID_ROUTES.flatMap((route) =>
      route.paths.map((routePath) => [
        `${route.method} ${routePath.path}`,
        {
          price: `$${route.priceUsd.toFixed(3)}`,
          network,
          config: {
            description: route.description,
            canonicalPath: route.canonicalPath,
            legacyAlias: routePath.path !== route.canonicalPath,
          },
        },
      ]),
    ),
  );
}

function toPaymentRequired(
  matched: NonNullable<ReturnType<typeof matchPaidRoute>>,
  network: string,
  payTo: string,
) {
  return {
    protocol: "x402",
    network,
    payTo,
    route: matched.routePath.path,
    canonicalPath: matched.route.canonicalPath,
    method: matched.route.method,
    priceUsd: matched.route.priceUsd,
    description: matched.route.description,
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

function loadX402Middleware(
  enforce: boolean,
): MiddlewareHandler<ApiEnv> | null {
  if (!enforce) return null;

  const config = readX402RuntimeConfig();
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
    | (new (
        ...args: unknown[]
      ) => unknown)
    | undefined;
  const facilitatorClient = facilitatorResolved.value as
    | (new (
        ...args: unknown[]
      ) => unknown)
    | undefined;
  const exactEvmScheme = schemeResolved.value as
    | (new (
        ...args: unknown[]
      ) => unknown)
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
    apiLogger.info(
      {
        event: "x402.exports.resolved",
        paymentExport: paymentResolved.name,
        serverExport: serverResolved.name,
        facilitatorExport: facilitatorResolved.name,
        schemeExport: schemeResolved.name,
      },
      "Resolved x402 library exports",
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
  const config = readX402RuntimeConfig();
  return {
    enabled: config.enabled,
    reportOnly: config.reportOnly,
    network: config.network,
    facilitatorUrl: config.facilitatorUrl,
    payTo: config.payTo,
    routes: API_PAID_ROUTES.map((route) => ({
      id: route.id,
      method: route.method,
      path: route.canonicalPath,
      canonicalPath: route.canonicalPath,
      aliasPaths: route.paths
        .map((routePath) => routePath.path)
        .filter((path) => path !== route.canonicalPath),
      priceUsd: route.priceUsd,
      description: route.description,
    })),
  };
}

export function createX402Middleware(): MiddlewareHandler<ApiEnv> {
  const config = readX402RuntimeConfig();
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
      getRequestLogger(c).info(
        {
          event: "x402.report_only",
          routeId: matched.route.id,
          method: c.req.method,
          path: c.req.path,
          priceUsd: matched.route.priceUsd,
        },
        "x402 report-only charge evaluated",
      );
      c.res.headers.set("X-Agora-X402-Report", "would-charge");
      await next();
      return;
    }

    if (libraryMiddleware) {
      await libraryMiddleware(c, next);
      return;
    }

    const paymentHeader = extractX402PaymentHeader((name) =>
      c.req.header(name),
    );
    if (!paymentHeader) {
      return jsonError(c, {
        status: 402,
        code: "PAYMENT_REQUIRED",
        message: "Payment Required",
        retriable: true,
        extras: {
          payment: toPaymentRequired(
            matched,
            metadata.network,
            metadata.payTo as string,
          ),
        },
      });
    }

    const paid = await verifyAndSettleX402Payment({
      facilitatorUrl: metadata.facilitatorUrl,
      paymentHeader,
      network: metadata.network,
      resource: {
        method: c.req.method,
        path: c.req.path,
        payTo: metadata.payTo as string,
        priceUsd: matched.route.priceUsd,
      },
    });
    if (paid) {
      await next();
      return;
    }

    return jsonError(c, {
      status: 402,
      code: "PAYMENT_VERIFICATION_FAILED",
      message: "Payment verification failed.",
      retriable: true,
    });
  };
}
