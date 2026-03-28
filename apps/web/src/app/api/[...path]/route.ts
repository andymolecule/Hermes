import { NextResponse } from "next/server";
import {
  resolveApiProxyBase,
  sanitizeUpstreamResponseHeaders,
} from "../../../lib/api-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOP_BY_HOP_HEADERS = [
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
] as const;

function buildProxyHeaders(request: Request) {
  const headers = new Headers(request.headers);
  const requestUrl = new URL(request.url);
  for (const header of HOP_BY_HOP_HEADERS) {
    headers.delete(header);
  }
  headers.set("x-forwarded-host", requestUrl.host);
  headers.set("x-forwarded-proto", requestUrl.protocol.replace(":", ""));
  return headers;
}

async function proxy(
  request: Request,
  context: { params: { path?: string[] } },
) {
  const resolved = resolveApiProxyBase({
    requestUrl: request.url,
    serverApiUrl: process.env.AGORA_API_URL,
    publicApiUrl: process.env.NEXT_PUBLIC_AGORA_API_URL,
  });
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.message }, { status: 500 });
  }

  const url = new URL(request.url);
  const upstreamPath = (context.params.path ?? []).join("/");
  const upstreamRelativePath = `api/${upstreamPath}`;
  const upstreamUrl = new URL(
    `${upstreamRelativePath}${url.search}`,
    `${resolved.baseUrl}/`,
  );

  try {
    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers: buildProxyHeaders(request),
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : await request.arrayBuffer(),
      cache: "no-store",
      redirect: "manual",
    });

    const responseBody =
      request.method === "HEAD" ? null : await upstream.arrayBuffer();
    return new Response(responseBody, {
      status: upstream.status,
      headers: sanitizeUpstreamResponseHeaders(upstream.headers),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Upstream API request failed.";
    return NextResponse.json(
      {
        error: `API proxy request failed. Next step: verify AGORA_API_URL points to the live backend and retry. (${message})`,
      },
      { status: 502 },
    );
  }
}

export async function GET(
  request: Request,
  context: { params: { path?: string[] } },
) {
  return proxy(request, context);
}

export async function POST(
  request: Request,
  context: { params: { path?: string[] } },
) {
  return proxy(request, context);
}

export async function PUT(
  request: Request,
  context: { params: { path?: string[] } },
) {
  return proxy(request, context);
}

export async function PATCH(
  request: Request,
  context: { params: { path?: string[] } },
) {
  return proxy(request, context);
}

export async function DELETE(
  request: Request,
  context: { params: { path?: string[] } },
) {
  return proxy(request, context);
}

export async function OPTIONS(
  request: Request,
  context: { params: { path?: string[] } },
) {
  return proxy(request, context);
}

export async function HEAD(
  request: Request,
  context: { params: { path?: string[] } },
) {
  return proxy(request, context);
}
