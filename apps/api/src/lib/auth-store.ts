import { createHash, randomBytes } from "node:crypto";
import { PIN_SPEC_AUTH_MAX_AGE_MS } from "@agora/common";
import {
  type AuthNoncePurpose,
  consumeAuthNonce,
  createAuthNonce,
  createAuthSession,
  createSupabaseClient,
  getAuthSession,
  purgeExpiredAuthNonces,
  purgeExpiredAuthSessions,
  revokeAuthSession,
} from "@agora/db";

interface SessionRecord {
  address: `0x${string}`;
  expiresAt: number;
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SIWE_NONCE_TTL_MS = 10 * 60 * 1000;
const AUTH_GC_INTERVAL_MS = 15 * 60 * 1000;
let lastAuthGcAt = 0;

function getDb() {
  return createSupabaseClient(true);
}

function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function maybeGcAuthState() {
  if (Date.now() - lastAuthGcAt < AUTH_GC_INTERVAL_MS) {
    return;
  }
  lastAuthGcAt = Date.now();
  try {
    const db = getDb();
    await Promise.all([
      purgeExpiredAuthNonces(db),
      purgeExpiredAuthSessions(db),
    ]);
  } catch {
    // Best-effort cleanup only. Request paths should still succeed.
  }
}

export async function createNonce(purpose: AuthNoncePurpose) {
  void maybeGcAuthState();
  const nonce = randomBytes(16).toString("hex");
  const ttlMs =
    purpose === "pin_spec" ? PIN_SPEC_AUTH_MAX_AGE_MS : SIWE_NONCE_TTL_MS;
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  await createAuthNonce(getDb(), {
    nonce,
    purpose,
    expiresAt,
  });
  return nonce;
}

export async function consumeNonce(
  purpose: AuthNoncePurpose,
  nonce: string,
  address?: `0x${string}`,
) {
  const record = await consumeAuthNonce(getDb(), {
    nonce,
    purpose,
    address,
  });
  return Boolean(record);
}

export async function createSession(address: `0x${string}`) {
  void maybeGcAuthState();
  const token = randomBytes(24).toString("hex");
  const expiresAt = Date.now() + SESSION_TTL_MS;
  await createAuthSession(getDb(), {
    tokenHash: hashSessionToken(token),
    address,
    expiresAt: new Date(expiresAt).toISOString(),
  });
  return { token, expiresAt };
}

export async function getSession(
  token: string | undefined,
): Promise<SessionRecord | null> {
  void maybeGcAuthState();
  if (!token) return null;
  const session = await getAuthSession(getDb(), hashSessionToken(token));
  if (!session) return null;

  return {
    address: session.address.toLowerCase() as `0x${string}`,
    expiresAt: new Date(session.expires_at).getTime(),
  };
}

export async function deleteSession(token: string | undefined) {
  void maybeGcAuthState();
  if (!token) return;
  await revokeAuthSession(getDb(), hashSessionToken(token));
}
