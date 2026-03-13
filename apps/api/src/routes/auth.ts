import { getPublicClient } from "@agora/chain";
import { isProductionRuntime, readApiServerRuntimeConfig } from "@agora/common";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { SiweError, SiweErrorType, SiweMessage } from "siwe";
import { z } from "zod";
import {
  consumeNonce,
  createNonce,
  createSession,
  deleteSession,
  getSession,
} from "../lib/auth-store.js";
import { requireWriteQuota } from "../middleware/rate-limit.js";
import type { ApiEnv } from "../types.js";

const verifyBodySchema = z.object({
  message: z.string().min(1),
  signature: z.string().regex(/^0x(?:[0-9a-fA-F]{2})+$/),
});

const router = new Hono<ApiEnv>();

router.get("/nonce", requireWriteQuota("/api/auth/nonce"), async (c) =>
  c.json({ nonce: await createNonce("siwe") }),
);

router.post("/verify", zValidator("json", verifyBodySchema), async (c) => {
  const { message, signature } = c.req.valid("json");
  const publicClient = getPublicClient();

  let siweMessage: SiweMessage;
  try {
    siweMessage = new SiweMessage(message);
  } catch {
    return c.json({ error: "Invalid SIWE message." }, 401);
  }

  const runtimeConfig = readApiServerRuntimeConfig();
  const apiUrl = runtimeConfig.apiUrl;
  const forwardedProto = c.req.header("x-forwarded-proto");
  const requestProtocol =
    forwardedProto ?? new URL(c.req.url).protocol.replace(":", "");
  const requestHost = c.req.header("x-forwarded-host") ?? c.req.header("host");
  const expectedOrigin = requestHost
    ? `${requestProtocol}://${requestHost}`
    : apiUrl
      ? new URL(apiUrl).origin
      : undefined;
  const expectedDomain =
    requestHost ?? (apiUrl ? new URL(apiUrl).host : undefined);
  const expectedChainId = runtimeConfig.chainId;

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

  const verified = await siweMessage.verify(
    {
      signature,
      nonce: siweMessage.nonce,
      domain: expectedDomain,
    },
    {
      suppressExceptions: true,
      verificationFallback: async (
        _params,
        _opts,
        parsedMessage,
        _eip1271Promise,
      ) => {
        const isValid = await publicClient.verifyMessage({
          address: parsedMessage.address.toLowerCase() as `0x${string}`,
          message: parsedMessage.prepareMessage(),
          signature: signature as `0x${string}`,
        });

        return isValid
          ? { success: true, data: parsedMessage }
          : {
              success: false,
              data: parsedMessage,
              error: new SiweError(SiweErrorType.INVALID_SIGNATURE),
            };
      },
    },
  );

  if (!verified.success) {
    return c.json({ error: "SIWE signature verification failed." }, 401);
  }

  const address = verified.data.address.toLowerCase() as `0x${string}`;
  const nonceAccepted = await consumeNonce("siwe", siweMessage.nonce, address);
  if (!nonceAccepted) {
    return c.json({ error: "SIWE nonce is invalid or expired." }, 401);
  }

  const { token, expiresAt } = await createSession(address);
  const cookieSecure =
    isProductionRuntime(runtimeConfig) || requestProtocol === "https";

  setCookie(c, "agora_session", token, {
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

router.post("/logout", async (c) => {
  const token = getCookie(c, "agora_session");
  await deleteSession(token);
  deleteCookie(c, "agora_session", { path: "/" });
  return c.json({ ok: true });
});

router.get("/session", async (c) => {
  const session = await getSession(getCookie(c, "agora_session"));
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
