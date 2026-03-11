import { loadConfig } from "@agora/common";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";

export type AgoraDbClient = SupabaseClient;

export function createSupabaseClient(useServiceKey = false): AgoraDbClient {
  const config = loadConfig();
  const url = config.AGORA_SUPABASE_URL;
  if (!url) {
    throw new Error("AGORA_SUPABASE_URL is required for database access.");
  }

  const key = useServiceKey
    ? config.AGORA_SUPABASE_SERVICE_KEY
    : config.AGORA_SUPABASE_ANON_KEY;
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
export * from "./queries/worker-runtime.js";
export * from "./queries/analytics.js";
export * from "./queries/leaderboard.js";
export * from "./queries/auth.js";
export * from "./schema-compatibility.js";
