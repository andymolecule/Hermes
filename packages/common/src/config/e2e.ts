import { z } from "zod";
import { CHALLENGE_LIMITS } from "../constants.js";
import { parseConfigSection } from "./base.js";

const lifecycleE2ERuntimeConfigSchema = z.object({
  AGORA_E2E_DISPUTE_WINDOW_HOURS: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int().min(CHALLENGE_LIMITS.disputeWindowMinHours),
    )
    .default(CHALLENGE_LIMITS.disputeWindowMinHours),
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
