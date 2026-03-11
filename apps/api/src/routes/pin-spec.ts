import { getPublicClient } from "@agora/chain";
import {
  canonicalizeChallengeSpec,
  computeSpecHash,
  getPinSpecAuthorizationTypedData,
  readApiServerRuntimeConfig,
  validateChallengeSpec,
} from "@agora/common";
import { pinJSON } from "@agora/ipfs";
import { Hono } from "hono";
import { consumeNonce, createNonce } from "../lib/auth-store.js";
import type { ApiEnv } from "../types.js";

const MAX_BODY_BYTES = 128 * 1024;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const requestBuckets = new Map<string, { count: number; resetAt: number }>();
const authBuckets = new Map<string, { count: number; resetAt: number }>();

const router = new Hono<ApiEnv>();

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

router.get("/", async (c) => {
  if (isRateLimited(getRateLimitKey(c.req.raw))) {
    return c.json({ error: "Rate limit exceeded. Try again later." }, 429);
  }

  return c.json({ nonce: await createNonce("pin_spec") });
});

router.post("/", async (c) => {
  try {
    const contentLength = Number(c.req.header("content-length") ?? "0");
    if (!Number.isFinite(contentLength) || contentLength > MAX_BODY_BYTES) {
      return c.json({ error: "Request body too large." }, 413);
    }
    if (isRateLimited(getRateLimitKey(c.req.raw))) {
      return c.json({ error: "Rate limit exceeded. Try again later." }, 429);
    }

    const body = (await c.req.json()) as { spec?: unknown };
    const auth = (body as Record<string, unknown>).auth as
      | {
          address?: string;
          nonce?: string;
          signature?: string;
          specHash?: string;
        }
      | undefined;

    if (
      !auth ||
      typeof auth.address !== "string" ||
      typeof auth.nonce !== "string" ||
      typeof auth.signature !== "string" ||
      typeof auth.specHash !== "string"
    ) {
      return c.json({ error: "Missing pin authorization signature." }, 401);
    }

    if (!/^0x[a-fA-F0-9]{40}$/.test(auth.address)) {
      return c.json({ error: "Invalid signer address." }, 401);
    }
    if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(auth.signature)) {
      return c.json({ error: "Invalid signature format." }, 401);
    }
    if (auth.nonce.length < 8 || auth.nonce.length > 128) {
      return c.json({ error: "Invalid authorization nonce." }, 401);
    }
    if (isAuthRateLimited(auth.address)) {
      return c.json(
        { error: "Signer rate limit exceeded. Try again later." },
        429,
      );
    }

    const expectedSpecHash = computeSpecHash(body.spec);
    if (auth.specHash !== expectedSpecHash) {
      return c.json({ error: "Spec hash mismatch." }, 401);
    }

    const { chainId } = readApiServerRuntimeConfig();
    const parsed = validateChallengeSpec(body.spec, chainId);
    if (!parsed.success) {
      return c.json(
        {
          error: "Invalid challenge spec",
          issues: parsed.error.issues,
        },
        400,
      );
    }

    const publicClient = getPublicClient();
    const typedData = getPinSpecAuthorizationTypedData({
      chainId,
      wallet: auth.address.toLowerCase() as `0x${string}`,
      specHash: expectedSpecHash,
      nonce: auth.nonce,
    });
    const isValidSignature = await publicClient.verifyTypedData({
      address: auth.address.toLowerCase() as `0x${string}`,
      ...typedData,
      signature: auth.signature as `0x${string}`,
    });
    if (!isValidSignature) {
      return c.json({ error: "Invalid signature." }, 401);
    }

    const nonceAccepted = await consumeNonce(
      "pin_spec",
      auth.nonce,
      auth.address.toLowerCase() as `0x${string}`,
    );
    if (!nonceAccepted) {
      return c.json(
        { error: "Authorization expired or already used. Please sign again." },
        409,
      );
    }

    const canonicalSpec = await canonicalizeChallengeSpec(parsed.data);
    const specCid = await pinJSON(`challenge-${Date.now()}`, canonicalSpec);
    return c.json({ specCid });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Failed to pin spec" },
      500,
    );
  }
});

export default router;
