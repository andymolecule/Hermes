import { challengeSpecSchema } from "@hermes/common";
import { pinJSON } from "@hermes/ipfs";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 128 * 1024;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const requestBuckets = new Map<string, { count: number; resetAt: number }>();

function getRateLimitKey(req: Request) {
  const forwardedFor = req.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  const realIp = req.headers.get("x-real-ip");
  return forwardedFor || realIp || "unknown";
}

function isRateLimited(key: string) {
  const now = Date.now();
  const bucket = requestBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    requestBuckets.set(key, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT_MAX_REQUESTS;
}

function hasValidOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    return parsed.host === host;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  try {
    const contentLength = Number(req.headers.get("content-length") ?? "0");
    if (!Number.isFinite(contentLength) || contentLength > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: "Request body too large." },
        { status: 413 },
      );
    }
    if (!hasValidOrigin(req)) {
      return NextResponse.json({ error: "Forbidden origin." }, { status: 403 });
    }
    if (isRateLimited(getRateLimitKey(req))) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Try again later." },
        { status: 429 },
      );
    }

    const body = (await req.json()) as { spec?: unknown };
    const parsed = challengeSpecSchema.safeParse(body.spec);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid challenge spec",
          issues: parsed.error.issues,
        },
        { status: 400 },
      );
    }

    const specCid = await pinJSON(`challenge-${Date.now()}`, parsed.data);
    return NextResponse.json({ specCid });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to pin spec" },
      { status: 500 },
    );
  }
}
