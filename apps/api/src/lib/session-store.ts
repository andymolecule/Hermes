import { randomBytes } from "node:crypto";

interface SessionRecord {
  address: `0x${string}`;
  expiresAt: number;
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const NONCE_TTL_MS = 10 * 60 * 1000;

const sessions = new Map<string, SessionRecord>();
const nonces = new Map<string, number>();

export function createNonce() {
  const nonce = randomBytes(16).toString("hex");
  nonces.set(nonce, Date.now() + NONCE_TTL_MS);
  return nonce;
}

export function consumeNonce(nonce: string) {
  const expiresAt = nonces.get(nonce);
  if (!expiresAt) return false;
  nonces.delete(nonce);
  return expiresAt > Date.now();
}

export function createSession(address: `0x${string}`) {
  const token = randomBytes(24).toString("hex");
  sessions.set(token, { address, expiresAt: Date.now() + SESSION_TTL_MS });
  return { token, expiresAt: Date.now() + SESSION_TTL_MS };
}

export function getSession(token: string | undefined) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

export function deleteSession(token: string | undefined) {
  if (!token) return;
  sessions.delete(token);
}
