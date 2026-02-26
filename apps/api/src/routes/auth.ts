import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { SiweMessage } from "siwe";
import { z } from "zod";
import {
  consumeNonce,
  createNonce,
  createSession,
  deleteSession,
  getSession,
} from "../lib/session-store.js";
import type { ApiEnv } from "../types.js";

const verifyBodySchema = z.object({
  message: z.string().min(1),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
});

const router = new Hono<ApiEnv>();

router.get("/nonce", (c) => c.json({ nonce: createNonce() }));

router.post("/verify", zValidator("json", verifyBodySchema), async (c) => {
  const { message, signature } = c.req.valid("json");

  let siweMessage: SiweMessage;
  try {
    siweMessage = new SiweMessage(message);
  } catch {
    return c.json({ error: "Invalid SIWE message." }, 401);
  }

  // Consume early to guarantee one-time nonce semantics under concurrent requests.
  if (!consumeNonce(siweMessage.nonce)) {
    return c.json({ error: "SIWE nonce is invalid or expired." }, 401);
  }

  const apiUrl = process.env.HERMES_API_URL;
  const forwardedProto = c.req.header("x-forwarded-proto");
  const requestProtocol =
    forwardedProto ?? new URL(c.req.url).protocol.replace(":", "");
  const requestHost = c.req.header("x-forwarded-host") ?? c.req.header("host");
  const expectedOrigin = apiUrl
    ? new URL(apiUrl).origin
    : requestHost
      ? `${requestProtocol}://${requestHost}`
      : undefined;
  const expectedDomain = apiUrl ? new URL(apiUrl).host : requestHost;
  const expectedChainId = Number(process.env.HERMES_CHAIN_ID ?? 84532);

  if (expectedDomain && siweMessage.domain !== expectedDomain) {
    return c.json({ error: "SIWE domain mismatch." }, 401);
  }
  if (siweMessage.chainId !== expectedChainId) {
    return c.json({ error: "SIWE chainId mismatch." }, 401);
  }
  if (expectedOrigin) {
    let messageOrigin = "";
    try {
      messageOrigin = new URL(siweMessage.uri).origin;
    } catch {
      return c.json({ error: "Invalid SIWE URI." }, 401);
    }
    if (messageOrigin !== expectedOrigin) {
      return c.json({ error: "SIWE URI mismatch." }, 401);
    }
  }

  const verified = await siweMessage.verify({
    signature,
    nonce: siweMessage.nonce,
    domain: expectedDomain,
  });

  if (!verified.success) {
    return c.json({ error: "SIWE signature verification failed." }, 401);
  }

  const address = verified.data.address.toLowerCase() as `0x${string}`;
  const { token, expiresAt } = createSession(address);
  const cookieSecure =
    process.env.NODE_ENV === "production" || requestProtocol === "https";

  setCookie(c, "hermes_session", token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: cookieSecure,
    path: "/",
    maxAge: Math.floor((expiresAt - Date.now()) / 1000),
  });

  return c.json({
    ok: true,
    address,
    expiresAt: new Date(expiresAt).toISOString(),
  });
});

router.post("/logout", (c) => {
  const token = getCookie(c, "hermes_session");
  deleteSession(token);
  deleteCookie(c, "hermes_session", { path: "/" });
  return c.json({ ok: true });
});

router.get("/session", (c) => {
  const session = getSession(getCookie(c, "hermes_session"));
  if (!session) {
    return c.json({ authenticated: false });
  }

  return c.json({
    authenticated: true,
    address: session.address,
    expiresAt: new Date(session.expiresAt).toISOString(),
  });
});

export default router;
