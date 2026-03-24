import type {
  AuthoringConversationLogEntryOutput,
  ChallengeAuthoringIrOutput,
  ChallengeIntentOutput,
  CompilationResultOutput,
  TrustedChallengeSpecOutput,
} from "@agora/common";
import type { AuthoringArtifactOutput } from "@agora/common";
import type { AgoraDbClient } from "../index";

export type AuthoringSessionState =
  | "created"
  | "awaiting_input"
  | "ready"
  | "published"
  | "rejected"
  | "expired";

export interface AuthoringSessionInsert {
  poster_address?: string | null;
  creator_type?: "web" | "agent" | null;
  creator_agent_id?: string | null;
  state: AuthoringSessionState;
  intent_json?: ChallengeIntentOutput | null;
  authoring_ir_json?: ChallengeAuthoringIrOutput | null;
  uploaded_artifacts_json?: AuthoringArtifactOutput[];
  compilation_json?: CompilationResultOutput | null;
  conversation_log_json?: AuthoringConversationLogEntryOutput[];
  published_challenge_id?: string | null;
  published_spec_json?: TrustedChallengeSpecOutput | null;
  published_spec_cid?: string | null;
  published_at?: string | null;
  failure_message?: string | null;
  expires_at: string;
}

export interface AuthoringSessionRow {
  id: string;
  poster_address: string | null;
  creator_type: "web" | "agent" | null;
  creator_agent_id: string | null;
  state: AuthoringSessionState;
  intent_json: ChallengeIntentOutput | null;
  authoring_ir_json: ChallengeAuthoringIrOutput | null;
  uploaded_artifacts_json: AuthoringArtifactOutput[];
  compilation_json: CompilationResultOutput | null;
  conversation_log_json: AuthoringConversationLogEntryOutput[];
  published_challenge_id: string | null;
  published_spec_json: TrustedChallengeSpecOutput | null;
  published_spec_cid: string | null;
  published_at: string | null;
  failure_message: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export class AuthoringSessionWriteConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthoringSessionWriteConflictError";
  }
}

function normalizeAddress(address?: string | null) {
  if (!address) {
    return null;
  }
  return address.toLowerCase();
}

export async function createAuthoringSession(
  db: AgoraDbClient,
  payload: AuthoringSessionInsert,
): Promise<AuthoringSessionRow> {
  const { data, error } = await db
    .from("authoring_sessions")
    .insert({
      poster_address: normalizeAddress(payload.poster_address),
      creator_type: payload.creator_type ?? null,
      creator_agent_id: payload.creator_agent_id ?? null,
      state: payload.state,
      intent_json: payload.intent_json ?? null,
      authoring_ir_json: payload.authoring_ir_json ?? null,
      uploaded_artifacts_json: payload.uploaded_artifacts_json ?? [],
      compilation_json: payload.compilation_json ?? null,
      conversation_log_json: payload.conversation_log_json ?? [],
      published_challenge_id: payload.published_challenge_id ?? null,
      published_spec_json: payload.published_spec_json ?? null,
      published_spec_cid: payload.published_spec_cid ?? null,
      published_at: payload.published_at ?? null,
      failure_message: payload.failure_message ?? null,
      expires_at: payload.expires_at,
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create authoring session: ${error.message}`);
  }

  return data as AuthoringSessionRow;
}

export async function getAuthoringSessionById(
  db: AgoraDbClient,
  id: string,
): Promise<AuthoringSessionRow | null> {
  const { data, error } = await db
    .from("authoring_sessions")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to read authoring session: ${error.message}`);
  }

  return (data as AuthoringSessionRow | null) ?? null;
}

export async function updateAuthoringSession(
  db: AgoraDbClient,
  input: {
    id: string;
    expected_updated_at?: string;
    poster_address?: string | null;
    creator_type?: "web" | "agent" | null;
    creator_agent_id?: string | null;
    state?: AuthoringSessionState;
    intent_json?: ChallengeIntentOutput | null;
    authoring_ir_json?: ChallengeAuthoringIrOutput | null;
    uploaded_artifacts_json?: AuthoringArtifactOutput[];
    compilation_json?: CompilationResultOutput | null;
    conversation_log_json?: AuthoringConversationLogEntryOutput[];
    published_challenge_id?: string | null;
    published_spec_json?: TrustedChallengeSpecOutput | null;
    published_spec_cid?: string | null;
    published_at?: string | null;
    failure_message?: string | null;
    expires_at?: string;
  },
): Promise<AuthoringSessionRow> {
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (input.poster_address !== undefined) {
    patch.poster_address = normalizeAddress(input.poster_address);
  }
  if (input.creator_type !== undefined) {
    patch.creator_type = input.creator_type;
  }
  if (input.creator_agent_id !== undefined) {
    patch.creator_agent_id = input.creator_agent_id;
  }
  if (input.state !== undefined) {
    patch.state = input.state;
  }
  if (input.intent_json !== undefined) {
    patch.intent_json = input.intent_json;
  }
  if (input.authoring_ir_json !== undefined) {
    patch.authoring_ir_json = input.authoring_ir_json;
  }
  if (input.uploaded_artifacts_json !== undefined) {
    patch.uploaded_artifacts_json = input.uploaded_artifacts_json;
  }
  if (input.compilation_json !== undefined) {
    patch.compilation_json = input.compilation_json;
  }
  if (input.conversation_log_json !== undefined) {
    patch.conversation_log_json = input.conversation_log_json;
  }
  if (input.published_challenge_id !== undefined) {
    patch.published_challenge_id = input.published_challenge_id;
  }
  if (input.published_spec_json !== undefined) {
    patch.published_spec_json = input.published_spec_json;
  }
  if (input.published_spec_cid !== undefined) {
    patch.published_spec_cid = input.published_spec_cid;
  }
  if (input.published_at !== undefined) {
    patch.published_at = input.published_at;
  }
  if (input.failure_message !== undefined) {
    patch.failure_message = input.failure_message;
  }
  if (input.expires_at !== undefined) {
    patch.expires_at = input.expires_at;
  }

  let query = db.from("authoring_sessions").update(patch).eq("id", input.id);
  if (input.expected_updated_at !== undefined) {
    query = query.eq("updated_at", input.expected_updated_at);
  }

  const selection = query.select("*");
  const { data, error } =
    input.expected_updated_at !== undefined
      ? await selection.maybeSingle()
      : await selection.single();

  if (error) {
    throw new Error(`Failed to update authoring session: ${error.message}`);
  }
  if (!data) {
    throw new AuthoringSessionWriteConflictError(
      `Authoring session ${input.id} changed before the update could be applied. Next step: reload the latest session state and retry.`,
    );
  }

  return data as AuthoringSessionRow;
}

export async function appendAuthoringSessionConversationLog(
  db: AgoraDbClient,
  input: {
    id: string;
    entries: AuthoringConversationLogEntryOutput[];
    expected_updated_at?: string;
  },
): Promise<AuthoringSessionRow> {
  const { data, error } = await db.rpc(
    "append_authoring_session_conversation_log",
    {
      p_session_id: input.id,
      p_entries: input.entries,
      p_expected_updated_at: input.expected_updated_at ?? null,
    },
  );

  if (error) {
    if (error.message.includes("append_authoring_session_conversation_log")) {
      throw new Error(
        "Failed to append authoring session conversation log: runtime schema is missing the atomic conversation log append function. Next step: reset the Supabase schema or apply packages/db/supabase/migrations/001_baseline.sql, reload the PostgREST schema cache, and retry.",
      );
    }
    throw new Error(
      `Failed to append authoring session conversation log: ${error.message}`,
    );
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    if (input.expected_updated_at !== undefined) {
      throw new AuthoringSessionWriteConflictError(
        `Authoring session ${input.id} changed before the conversation log could be appended. Next step: reload the latest session state and retry.`,
      );
    }
    throw new Error(
      `Failed to append authoring session conversation log: session ${input.id} was not found.`,
    );
  }

  return row as AuthoringSessionRow;
}

export async function listAuthoringSessionsByCreator(
  db: AgoraDbClient,
  input:
    | { type: "web"; address: string }
    | { type: "agent"; agentId: string },
): Promise<AuthoringSessionRow[]> {
  let query = db
    .from("authoring_sessions")
    .select("*")
    .order("updated_at", { ascending: false });

  if (input.type === "web") {
    query = query
      .eq("creator_type", "web")
      .eq("poster_address", normalizeAddress(input.address));
  } else {
    query = query
      .eq("creator_type", "agent")
      .eq("creator_agent_id", input.agentId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to list authoring sessions: ${error.message}`);
  }

  return (data as AuthoringSessionRow[] | null) ?? [];
}
