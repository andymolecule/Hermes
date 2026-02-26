import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { getSession } from "../lib/session-store.js";
import type { ApiEnv } from "../types.js";

export async function requireSiweSession(c: Context<ApiEnv>, next: Next) {
  const token = getCookie(c, "hermes_session");
  const session = getSession(token);
  if (!session) {
    return c.json({ error: "Unauthorized." }, 401);
  }

  c.set("sessionAddress", session.address);
  await next();
}
