import { z } from "zod";
import { parseConfigSection } from "./base.js";

const lifecycleE2ERuntimeConfigSchema = z.object({
  AGORA_E2E_DISPUTE_WINDOW_HOURS: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int().min(168),
    )
    .default(168),
});

export interface AgoraLifecycleE2ERuntimeConfig {
  disputeWindowHours: number;
}

export function readLifecycleE2ERuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): AgoraLifecycleE2ERuntimeConfig {
  const parsed = parseConfigSection(lifecycleE2ERuntimeConfigSchema, env);
  return {
    disputeWindowHours: parsed.AGORA_E2E_DISPUTE_WINDOW_HOURS,
  };
}
