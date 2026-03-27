import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const AGENT_NOTIFICATION_SECRET_KEY_VERSION = "v1";
const AGENT_NOTIFICATION_CIPHERTEXT_PREFIX = "encv1";
const AGENT_NOTIFICATION_IV_BYTES = 12;

function deriveEncryptionKey(masterKey: string) {
  return createHash("sha256").update(masterKey).digest();
}

export function generateAgentNotificationSigningSecret() {
  return `whsec_${randomBytes(24).toString("hex")}`;
}

export function encryptAgentNotificationSigningSecret(
  signingSecret: string,
  masterKey: string,
) {
  const iv = randomBytes(AGENT_NOTIFICATION_IV_BYTES);
  const cipher = createCipheriv(
    "aes-256-gcm",
    deriveEncryptionKey(masterKey),
    iv,
  );
  const ciphertext = Buffer.concat([
    cipher.update(signingSecret, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    AGENT_NOTIFICATION_CIPHERTEXT_PREFIX,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

export function decryptAgentNotificationSigningSecret(
  ciphertext: string,
  masterKey: string,
) {
  const [prefix, ivBase64, tagBase64, payloadBase64] = ciphertext.split(":");
  if (
    prefix !== AGENT_NOTIFICATION_CIPHERTEXT_PREFIX ||
    !ivBase64 ||
    !tagBase64 ||
    !payloadBase64
  ) {
    throw new Error(
      "Invalid notification signing secret ciphertext. Next step: rotate the webhook signing secret and retry delivery.",
    );
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveEncryptionKey(masterKey),
    Buffer.from(ivBase64, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagBase64, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payloadBase64, "base64url")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

export function signAgentNotificationPayload(input: {
  signingSecret: string;
  timestamp: string;
  body: string;
}) {
  return createHmac("sha256", input.signingSecret)
    .update(`${input.timestamp}.${input.body}`)
    .digest("hex");
}

export function verifyAgentNotificationSignature(input: {
  signingSecret: string;
  timestamp: string;
  body: string;
  signature: string;
}) {
  const expected = Buffer.from(
    signAgentNotificationPayload({
      signingSecret: input.signingSecret,
      timestamp: input.timestamp,
      body: input.body,
    }),
    "hex",
  );
  const received = Buffer.from(input.signature, "hex");
  if (expected.length !== received.length) {
    return false;
  }
  return timingSafeEqual(expected, received);
}
