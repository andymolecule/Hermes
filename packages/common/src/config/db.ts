import {
  configSchema,
  parseConfigSection,
  unsetBlankStringValues,
} from "./base.js";

const databaseRuntimeConfigSchema = configSchema.pick({
  AGORA_SUPABASE_URL: true,
  AGORA_SUPABASE_ANON_KEY: true,
  AGORA_SUPABASE_SERVICE_KEY: true,
});

export interface AgoraDatabaseRuntimeConfig {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  supabaseServiceKey?: string;
}

export function readDatabaseRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): AgoraDatabaseRuntimeConfig {
  const parsed = parseConfigSection(
    databaseRuntimeConfigSchema,
    unsetBlankStringValues(env, [
      "AGORA_SUPABASE_URL",
      "AGORA_SUPABASE_ANON_KEY",
      "AGORA_SUPABASE_SERVICE_KEY",
    ]),
  );

  return {
    supabaseUrl: parsed.AGORA_SUPABASE_URL,
    supabaseAnonKey: parsed.AGORA_SUPABASE_ANON_KEY,
    supabaseServiceKey: parsed.AGORA_SUPABASE_SERVICE_KEY,
  };
}
