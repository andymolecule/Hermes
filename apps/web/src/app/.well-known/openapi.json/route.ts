import { NextResponse } from "next/server";
import { resolveApiProxyBase } from "../../../lib/api-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function buildHeaders(request: Request) {
  const headers = new Headers();
  const requestUrl = new URL(request.url);
  headers.set("x-forwarded-host", requestUrl.host);
  headers.set("x-forwarded-proto", requestUrl.protocol.replace(":", ""));
  return headers;
}

export async function GET(request: Request) {
  const resolved = resolveApiProxyBase({
    requestUrl: request.url,
    serverApiUrl: process.env.AGORA_API_URL,
    publicApiUrl: process.env.NEXT_PUBLIC_AGORA_API_URL,
  });

  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.message }, { status: 500 });
  }

  try {
    const upstream = await fetch(
      `${resolved.baseUrl}/.well-known/openapi.json`,
      {
        method: "GET",
        headers: buildHeaders(request),
        cache: "no-store",
      },
    );

    return new Response(upstream.body, {
      status: upstream.status,
      headers: upstream.headers,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Upstream API request failed.";
    return NextResponse.json(
      {
        error: `OpenAPI proxy request failed. Next step: verify AGORA_API_URL points to the live backend and retry. (${message})`,
      },
      { status: 502 },
    );
  }
}
