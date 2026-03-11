import { NextResponse } from "next/server";
import { resolveApiProxyBase } from "../../../lib/api-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function proxy(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");
  const origin = request.headers.get("origin");
  const resolved = resolveApiProxyBase({
    requestUrl: request.url,
    serverApiUrl: process.env.AGORA_API_URL,
    publicApiUrl: process.env.NEXT_PUBLIC_AGORA_API_URL,
  });
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.message }, { status: 500 });
  }

  const upstream = await fetch(`${resolved.baseUrl}/api/pin-spec`, {
    method: request.method,
    headers: {
      "content-type": request.headers.get("content-type") ?? "application/json",
      ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
      ...(realIp ? { "x-real-ip": realIp } : {}),
      ...(origin ? { origin } : {}),
    },
    body: request.method === "GET" ? undefined : await request.text(),
    cache: "no-store",
  });

  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: {
      "content-type":
        upstream.headers.get("content-type") ?? "application/json",
    },
  });
}

export async function GET(request: Request) {
  return proxy(request);
}

export async function POST(request: Request) {
  return proxy(request);
}
