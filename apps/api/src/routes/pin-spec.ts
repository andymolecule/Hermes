import { getPublicClient } from "@agora/chain";
import {
  canonicalizeChallengeSpec,
  computeSpecHash,
  getPinSpecAuthorizationTypedData,
  loadConfig,
  readApiServerRuntimeConfig,
  validateChallengeSpec,
} from "@agora/common";
import { pinJSON } from "@agora/ipfs";
import { Hono } from "hono";
import { jsonError } from "../lib/api-error.js";
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
    return jsonError(c, {
      status: 429,
      code: "RATE_LIMITED",
      message: "Rate limit exceeded. Try again later.",
      retriable: true,
    });
  }

  return c.json({ nonce: await createNonce("pin_spec") });
});

router.post("/", async (c) => {
  try {
    const contentLength = Number(c.req.header("content-length") ?? "0");
    if (!Number.isFinite(contentLength) || contentLength > MAX_BODY_BYTES) {
      return jsonError(c, {
        status: 413,
        code: "REQUEST_TOO_LARGE",
        message: "Request body too large.",
      });
    }
    if (isRateLimited(getRateLimitKey(c.req.raw))) {
      return jsonError(c, {
        status: 429,
        code: "RATE_LIMITED",
        message: "Rate limit exceeded. Try again later.",
        retriable: true,
      });
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
      return jsonError(c, {
        status: 401,
        code: "PIN_AUTH_MISSING",
        message: "Missing pin authorization signature.",
      });
    }

    if (!/^0x[a-fA-F0-9]{40}$/.test(auth.address)) {
      return jsonError(c, {
        status: 401,
        code: "PIN_SIGNER_INVALID",
        message: "Invalid signer address.",
      });
    }
    if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(auth.signature)) {
      return jsonError(c, {
        status: 401,
        code: "PIN_SIGNATURE_FORMAT_INVALID",
        message: "Invalid signature format.",
      });
    }
    if (auth.nonce.length < 8 || auth.nonce.length > 128) {
      return jsonError(c, {
        status: 401,
        code: "PIN_NONCE_INVALID",
        message: "Invalid authorization nonce.",
      });
    }
    if (isAuthRateLimited(auth.address)) {
      return jsonError(c, {
        status: 429,
        code: "RATE_LIMITED",
        message: "Signer rate limit exceeded. Try again later.",
        retriable: true,
      });
    }

    const expectedSpecHash = computeSpecHash(body.spec);
    if (auth.specHash !== expectedSpecHash) {
      return jsonError(c, {
        status: 401,
        code: "SPEC_HASH_MISMATCH",
        message: "Spec hash mismatch.",
      });
    }

    const { chainId } = readApiServerRuntimeConfig();
    const parsed = validateChallengeSpec(body.spec, chainId);
    if (!parsed.success) {
      return jsonError(c, {
        status: 400,
        code: "SPEC_INVALID",
        message: "Invalid challenge spec",
        extras: { issues: parsed.error.issues },
      });
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
      return jsonError(c, {
        status: 401,
        code: "PIN_SIGNATURE_INVALID",
        message: "Invalid signature.",
      });
    }

    const nonceAccepted = await consumeNonce(
      "pin_spec",
      auth.nonce,
      auth.address.toLowerCase() as `0x${string}`,
    );
    if (!nonceAccepted) {
      return jsonError(c, {
        status: 409,
        code: "PIN_AUTH_EXPIRED",
        message: "Authorization expired or already used. Please sign again.",
        retriable: true,
      });
    }

    const config = loadConfig();
    const canonicalSpec = await canonicalizeChallengeSpec(parsed.data, {
      resolveOfficialPresetDigests: config.AGORA_REQUIRE_PINNED_PRESET_DIGESTS,
    });
    const specCid = await pinJSON(`challenge-${Date.now()}`, canonicalSpec);
    return c.json({ specCid });
  } catch (error) {
    return jsonError(c, {
      status: 500,
      code: "SPEC_PIN_FAILED",
      message: error instanceof Error ? error.message : "Failed to pin spec",
    });
  }
});

export default router;
