import { loadConfig } from "@hermes/common";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";

export type HermesDbClient = SupabaseClient;

export function createSupabaseClient(useServiceKey = false): HermesDbClient {
  const config = loadConfig();
  const url = config.HERMES_SUPABASE_URL;
  if (!url) {
    throw new Error("HERMES_SUPABASE_URL is required for database access.");
  }

  const key = useServiceKey
    ? config.HERMES_SUPABASE_SERVICE_KEY
    : config.HERMES_SUPABASE_ANON_KEY;
  if (!key) {
    throw new Error(
      `Supabase key missing. Provide ${useServiceKey ? "HERMES_SUPABASE_SERVICE_KEY" : "HERMES_SUPABASE_ANON_KEY"}.`,
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
export * from "./queries/proofs.js";
