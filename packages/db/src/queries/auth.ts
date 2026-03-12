import type { AgoraDbClient } from "../index";

export type AuthNoncePurpose = "siwe" | "pin_spec";

export interface AuthNonceInsert {
  nonce: string;
  purpose: AuthNoncePurpose;
  address?: string | null;
  expiresAt: string;
}

export interface AuthNonceRow {
  nonce: string;
  purpose: AuthNoncePurpose;
  address: string | null;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

export interface AuthSessionInsert {
  tokenHash: string;
  address: string;
  expiresAt: string;
}

export interface AuthSessionRow {
  token_hash: string;
  address: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

export async function createAuthNonce(
  db: AgoraDbClient,
  input: AuthNonceInsert,
) {
  const { error } = await db.from("auth_nonces").insert({
    nonce: input.nonce,
    purpose: input.purpose,
    address: input.address?.toLowerCase() ?? null,
    expires_at: input.expiresAt,
  });

  if (error) {
    throw new Error(`Failed to persist auth nonce: ${error.message}`);
  }
}

export async function consumeAuthNonce(
  db: AgoraDbClient,
  input: {
    nonce: string;
    purpose: AuthNoncePurpose;
    address?: string | null;
  },
): Promise<AuthNonceRow | null> {
  const query = db
    .from("auth_nonces")
    .update({
      consumed_at: new Date().toISOString(),
    })
    .eq("nonce", input.nonce)
    .eq("purpose", input.purpose)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString());

  const scopedQuery =
    input.address == null
      ? query
      : query.or(`address.is.null,address.eq.${input.address.toLowerCase()}`);

  const { data, error } = await scopedQuery.select("*").maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to consume auth nonce: ${error.message}`);
  }

  return (data as AuthNonceRow | null) ?? null;
}

export async function createAuthSession(
  db: AgoraDbClient,
  input: AuthSessionInsert,
) {
  const { error } = await db.from("auth_sessions").insert({
    token_hash: input.tokenHash,
    address: input.address.toLowerCase(),
    expires_at: input.expiresAt,
  });

  if (error) {
    throw new Error(`Failed to persist auth session: ${error.message}`);
  }
}

export async function getAuthSession(
  db: AgoraDbClient,
  tokenHash: string,
): Promise<AuthSessionRow | null> {
  const { data, error } = await db
    .from("auth_sessions")
    .select("*")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to read auth session: ${error.message}`);
  }

  return (data as AuthSessionRow | null) ?? null;
}

export async function revokeAuthSession(db: AgoraDbClient, tokenHash: string) {
  const { error } = await db
    .from("auth_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("token_hash", tokenHash)
    .is("revoked_at", null);

  if (error) {
    throw new Error(`Failed to revoke auth session: ${error.message}`);
  }
}
