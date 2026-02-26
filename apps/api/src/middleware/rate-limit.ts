import type { Context, Next } from "hono";
import { consumeWriteQuota } from "../lib/rate-limit.js";
import type { ApiEnv } from "../types.js";

export function requireWriteQuota(routeKey: string) {
  return async (c: Context<ApiEnv>, next: Next) => {
    const address = c.get("sessionAddress");
    const quota = consumeWriteQuota(address, routeKey);
    if (!quota.allowed) {
      return c.json({ error: quota.message }, 429);
    }

    await next();
  };
}
