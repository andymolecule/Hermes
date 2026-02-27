import { challengeSpecSchema } from "@hermes/common";
import { pinJSON } from "@hermes/ipfs";
import { NextResponse } from "next/server";
import { verifyMessage } from "viem";
import {
  PIN_SPEC_AUTH_MAX_AGE_MS,
  buildPinSpecMessage,
  computeSpecHash,
} from "../../../lib/pin-spec-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 128 * 1024;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const requestBuckets = new Map<string, { count: number; resetAt: number }>();
const authBuckets = new Map<string, { count: number; resetAt: number }>();

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

function isAuthRateLimited(address: string) {
  const now = Date.now();
  const normalized = address.toLowerCase();
  const bucket = authBuckets.get(normalized);
  if (!bucket || bucket.resetAt <= now) {
    authBuckets.set(normalized, {
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
    const auth = (body as Record<string, unknown>).auth as
      | {
          address?: string;
          timestamp?: number;
          signature?: string;
          specHash?: string;
        }
      | undefined;

    if (
      !auth ||
      typeof auth.address !== "string" ||
      typeof auth.timestamp !== "number" ||
      typeof auth.signature !== "string" ||
      typeof auth.specHash !== "string"
    ) {
      return NextResponse.json(
        { error: "Missing pin authorization signature." },
        { status: 401 },
      );
    }

    if (!/^0x[a-fA-F0-9]{40}$/.test(auth.address)) {
      return NextResponse.json(
        { error: "Invalid signer address." },
        { status: 401 },
      );
    }
    if (!/^0x[a-fA-F0-9]{130}$/.test(auth.signature)) {
      return NextResponse.json(
        { error: "Invalid signature format." },
        { status: 401 },
      );
    }

    const now = Date.now();
    if (
      auth.timestamp > now + 30_000 ||
      now - auth.timestamp > PIN_SPEC_AUTH_MAX_AGE_MS
    ) {
      return NextResponse.json(
        { error: "Authorization expired. Please sign again." },
        { status: 401 },
      );
    }

    const expectedSpecHash = computeSpecHash(body.spec);
    if (auth.specHash !== expectedSpecHash) {
      return NextResponse.json(
        { error: "Spec hash mismatch." },
        { status: 401 },
      );
    }

    const message = buildPinSpecMessage({
      address: auth.address as `0x${string}`,
      timestamp: auth.timestamp,
      specHash: expectedSpecHash,
    });
    const isValidSignature = await verifyMessage({
      address: auth.address as `0x${string}`,
      message,
      signature: auth.signature as `0x${string}`,
    });
    if (!isValidSignature) {
      return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
    }
    if (isAuthRateLimited(auth.address)) {
      return NextResponse.json(
        { error: "Signer rate limit exceeded. Try again later." },
        { status: 429 },
      );
    }

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
