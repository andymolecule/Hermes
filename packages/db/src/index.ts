import { readDatabaseRuntimeConfig } from "@agora/common";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";

export type AgoraDbClient = SupabaseClient;

export function createSupabaseClient(useServiceKey = false): AgoraDbClient {
  const config = readDatabaseRuntimeConfig();
  const url = config.supabaseUrl;
  if (!url) {
    throw new Error("AGORA_SUPABASE_URL is required for database access.");
  }

  const key = useServiceKey
    ? config.supabaseServiceKey
    : config.supabaseAnonKey;
  if (!key) {
    throw new Error(
      `Supabase key missing. Provide ${useServiceKey ? "AGORA_SUPABASE_SERVICE_KEY" : "AGORA_SUPABASE_ANON_KEY"}.`,
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

export * from "./queries/challenges.js";
export * from "./queries/submissions.js";
export * from "./queries/scores.js";
export * from "./queries/indexed-events.js";
export * from "./queries/indexer-cursors.js";
export * from "./queries/proofs.js";
export * from "./queries/payouts.js";
export * from "./queries/score-jobs.js";
export * from "./queries/submission-intents.js";
export * from "./queries/unmatched-submissions.js";
export * from "./queries/worker-runtime.js";
export * from "./queries/analytics.js";
export * from "./queries/leaderboard.js";
export * from "./queries/auth.js";
export * from "./queries/agent-notifications.js";
export * from "./queries/authoring-sessions.js";
export * from "./queries/authoring-events.js";
export * from "./queries/submission-events.js";
export * from "./schema-compatibility.js";
