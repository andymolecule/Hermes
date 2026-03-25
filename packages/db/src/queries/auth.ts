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

export interface AuthAgentInsert {
  telegramBotId: string;
  agentName?: string | null;
  description?: string | null;
}

export interface AuthAgentRow {
  id: string;
  telegram_bot_id: string;
  agent_name: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuthAgentKeyInsert {
  agentId: string;
  apiKeyHash: string;
  keyLabel?: string | null;
}

export interface AuthAgentKeyRow {
  id: string;
  agent_id: string;
  key_label: string | null;
  api_key_hash: string;
  revoked_at: string | null;
  created_at: string;
  last_used_at: string | null;
}

function normalizeOptionalText(value?: string | null) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

export async function purgeExpiredAuthNonces(db: AgoraDbClient) {
  const now = new Date().toISOString();
  const { error } = await db
    .from("auth_nonces")
    .delete()
    .or(`expires_at.lte.${now},consumed_at.not.is.null`);

  if (error) {
    throw new Error(`Failed to purge expired auth nonces: ${error.message}`);
  }
}

export async function purgeExpiredAuthSessions(db: AgoraDbClient) {
  const now = new Date().toISOString();
  const { error } = await db
    .from("auth_sessions")
    .delete()
    .or(`expires_at.lte.${now},revoked_at.not.is.null`);

  if (error) {
    throw new Error(`Failed to purge expired auth sessions: ${error.message}`);
  }
}

export async function createAuthAgent(
  db: AgoraDbClient,
  input: AuthAgentInsert,
): Promise<AuthAgentRow> {
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("auth_agents")
    .insert({
      telegram_bot_id: input.telegramBotId,
      agent_name: normalizeOptionalText(input.agentName),
      description: normalizeOptionalText(input.description),
      updated_at: now,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create auth agent: ${error.message}`);
  }

  return data as AuthAgentRow;
}

export async function updateAuthAgent(
  db: AgoraDbClient,
  input: {
    id: string;
    agentName?: string | null;
    description?: string | null;
  },
): Promise<AuthAgentRow> {
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (input.agentName !== undefined) {
    patch.agent_name = normalizeOptionalText(input.agentName);
  }
  if (input.description !== undefined) {
    patch.description = normalizeOptionalText(input.description);
  }

  const { data, error } = await db
    .from("auth_agents")
    .update(patch)
    .eq("id", input.id)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to update auth agent: ${error.message}`);
  }

  return data as AuthAgentRow;
}

export async function getAuthAgentByTelegramBotId(
  db: AgoraDbClient,
  telegramBotId: string,
): Promise<AuthAgentRow | null> {
  const { data, error } = await db
    .from("auth_agents")
    .select("*")
    .eq("telegram_bot_id", telegramBotId)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to read auth agent: ${error.message}`);
  }

  return (data as AuthAgentRow | null) ?? null;
}

export async function getAuthAgentById(
  db: AgoraDbClient,
  id: string,
): Promise<AuthAgentRow | null> {
  const { data, error } = await db
    .from("auth_agents")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to read auth agent by id: ${error.message}`);
  }

  return (data as AuthAgentRow | null) ?? null;
}

export async function createAuthAgentKey(
  db: AgoraDbClient,
  input: AuthAgentKeyInsert,
): Promise<AuthAgentKeyRow> {
  const { data, error } = await db
    .from("auth_agent_keys")
    .insert({
      agent_id: input.agentId,
      api_key_hash: input.apiKeyHash,
      key_label: normalizeOptionalText(input.keyLabel),
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create auth agent key: ${error.message}`);
  }

  return data as AuthAgentKeyRow;
}

export async function getAuthAgentKeyByApiKeyHash(
  db: AgoraDbClient,
  apiKeyHash: string,
): Promise<AuthAgentKeyRow | null> {
  const { data, error } = await db
    .from("auth_agent_keys")
    .select("*")
    .eq("api_key_hash", apiKeyHash)
    .is("revoked_at", null)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to read auth agent key by API key: ${error.message}`);
  }

  return (data as AuthAgentKeyRow | null) ?? null;
}

export async function getAuthAgentKeyById(
  db: AgoraDbClient,
  input: {
    agentId: string;
    keyId: string;
  },
): Promise<AuthAgentKeyRow | null> {
  const { data, error } = await db
    .from("auth_agent_keys")
    .select("*")
    .eq("agent_id", input.agentId)
    .eq("id", input.keyId)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to read auth agent key: ${error.message}`);
  }

  return (data as AuthAgentKeyRow | null) ?? null;
}

export async function revokeAuthAgentKey(
  db: AgoraDbClient,
  input: {
    agentId: string;
    keyId: string;
  },
): Promise<AuthAgentKeyRow | null> {
  const { data, error } = await db
    .from("auth_agent_keys")
    .update({
      revoked_at: new Date().toISOString(),
    })
    .eq("agent_id", input.agentId)
    .eq("id", input.keyId)
    .is("revoked_at", null)
    .select("*")
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to revoke auth agent key: ${error.message}`);
  }

  return (data as AuthAgentKeyRow | null) ?? null;
}

export async function touchAuthAgentKeyLastUsed(
  db: AgoraDbClient,
  keyId: string,
) {
  const { error } = await db
    .from("auth_agent_keys")
    .update({
      last_used_at: new Date().toISOString(),
    })
    .eq("id", keyId);

  if (error) {
    throw new Error(`Failed to update auth agent key last_used_at: ${error.message}`);
  }
}
