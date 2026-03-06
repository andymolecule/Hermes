import { keccak256, toHex } from "viem";
import {
  sealedSubmissionEnvelopeSchema,
  type SealedSubmissionEnvelope,
  type SealedSubmissionEnvelopeInput,
} from "./schemas/submission.js";

const SUBMISSION_SEAL_VERSION = "sealed_submission_v1";
const SUBMISSION_SEAL_ALG = "aes-256-gcm+rsa-oaep-256";

type SupportedCryptoKey = CryptoKey;
const SELF_CHECK_CHALLENGE_ID = "00000000-0000-0000-0000-000000000001";
const SELF_CHECK_SOLVER_ADDRESS = "0x0000000000000000000000000000000000000001";
const SELF_CHECK_BYTES = new TextEncoder().encode("hermes-sealed-submission-self-check");

function normalizeSolverAddress(value: string) {
  return value.toLowerCase();
}

async function getWebCrypto() {
  if (globalThis.crypto?.subtle) {
    return globalThis.crypto;
  }
  const importNodeCrypto = new Function(
    'return import("node:crypto")',
  ) as () => Promise<{ webcrypto: Crypto }>;
  const { webcrypto } = await importNodeCrypto();
  return webcrypto as Crypto;
}

function bytesToBase64Url(bytes: Uint8Array) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");

  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(padded, "base64"));
  }

  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function pemToDerBytes(pem: string) {
  const normalized = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");

  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(normalized, "base64"));
  }

  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function buildEnvelopeAad(input: {
  version: typeof SUBMISSION_SEAL_VERSION;
  kid: string;
  challengeId: string;
  solverAddress: string;
}) {
  return new TextEncoder().encode(
    JSON.stringify({
      version: input.version,
      kid: input.kid,
      challengeId: input.challengeId,
      solverAddress: normalizeSolverAddress(input.solverAddress),
    }),
  );
}

export async function importSubmissionSealPublicKey(
  pem: string,
): Promise<SupportedCryptoKey> {
  const crypto = await getWebCrypto();
  return crypto.subtle.importKey(
    "spki",
    pemToDerBytes(pem),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"],
  );
}

export async function importSubmissionOpenPrivateKey(
  pem: string,
): Promise<SupportedCryptoKey> {
  const crypto = await getWebCrypto();
  return crypto.subtle.importKey(
    "pkcs8",
    pemToDerBytes(pem),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["decrypt"],
  );
}

export async function sealSubmission(input: {
  challengeId: string;
  solverAddress: string;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
  keyId: string;
  publicKey: SupportedCryptoKey;
}): Promise<SealedSubmissionEnvelope> {
  const crypto = await getWebCrypto();
  const solverAddress = normalizeSolverAddress(input.solverAddress);
  const plaintext = new Uint8Array(input.bytes);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  const aad = buildEnvelopeAad({
    version: SUBMISSION_SEAL_VERSION,
    kid: input.keyId,
    challengeId: input.challengeId,
    solverAddress,
  });
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: aad,
        tagLength: 128,
      },
      aesKey,
      plaintext,
    ),
  );
  const rawAesKey = await crypto.subtle.exportKey("raw", aesKey);
  const wrappedKey = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "RSA-OAEP" },
      input.publicKey,
      rawAesKey,
    ),
  );

  return sealedSubmissionEnvelopeSchema.parse({
    version: SUBMISSION_SEAL_VERSION,
    alg: SUBMISSION_SEAL_ALG,
    kid: input.keyId,
    challengeId: input.challengeId,
    solverAddress,
    fileName: input.fileName,
    mimeType: input.mimeType,
    iv: bytesToBase64Url(iv),
    wrappedKey: bytesToBase64Url(wrappedKey),
    ciphertext: bytesToBase64Url(ciphertext),
  });
}

export async function openSubmission(input: {
  envelope: SealedSubmissionEnvelopeInput;
  privateKey: SupportedCryptoKey;
}) {
  const envelope = sealedSubmissionEnvelopeSchema.parse(input.envelope);
  const crypto = await getWebCrypto();
  const aad = buildEnvelopeAad({
    version: envelope.version,
    kid: envelope.kid,
    challengeId: envelope.challengeId,
    solverAddress: envelope.solverAddress,
  });
  const rawAesKey = await crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    input.privateKey,
    base64UrlToBytes(envelope.wrappedKey),
  );
  const aesKey = await crypto.subtle.importKey(
    "raw",
    rawAesKey,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64UrlToBytes(envelope.iv),
        additionalData: aad,
        tagLength: 128,
      },
      aesKey,
      base64UrlToBytes(envelope.ciphertext),
    ),
  );

  return {
    envelope,
    bytes,
  };
}

export function serializeSealedSubmissionEnvelope(
  envelope: SealedSubmissionEnvelopeInput,
) {
  return JSON.stringify(sealedSubmissionEnvelopeSchema.parse(envelope));
}

export function parseSealedSubmissionEnvelope(raw: string) {
  return sealedSubmissionEnvelopeSchema.parse(
    JSON.parse(raw) as SealedSubmissionEnvelopeInput,
  );
}

export function computeSubmissionResultHash(cid: string): `0x${string}` {
  return keccak256(toHex(cid));
}

export function isSealedSubmissionEnvelope(value: unknown) {
  return sealedSubmissionEnvelopeSchema.safeParse(value).success;
}

export type SubmissionSealHealth =
  | {
      enabled: false;
      keyId: null;
      publicKeyLoaded: false;
      privateKeyLoaded: false;
    }
  | {
      enabled: true;
      keyId: string;
      publicKeyLoaded: boolean;
      privateKeyLoaded: boolean;
    };

export async function getSubmissionSealHealth(input: {
  keyId?: string;
  publicKeyPem?: string;
  privateKeyPem?: string;
}): Promise<SubmissionSealHealth> {
  if (!input.keyId && !input.publicKeyPem && !input.privateKeyPem) {
    return {
      enabled: false,
      keyId: null,
      publicKeyLoaded: false,
      privateKeyLoaded: false,
    };
  }

  return {
    enabled: true,
    keyId: input.keyId ?? "unknown",
    publicKeyLoaded: Boolean(input.publicKeyPem),
    privateKeyLoaded: Boolean(input.privateKeyPem),
  };
}

export async function runSubmissionSealSelfCheck(input: {
  keyId: string;
  publicKeyPem: string;
  privateKeyPem: string;
}) {
  const publicKey = await importSubmissionSealPublicKey(input.publicKeyPem);
  const privateKey = await importSubmissionOpenPrivateKey(input.privateKeyPem);
  const envelope = await sealSubmission({
    challengeId: SELF_CHECK_CHALLENGE_ID,
    solverAddress: SELF_CHECK_SOLVER_ADDRESS,
    fileName: "self-check.txt",
    mimeType: "text/plain",
    bytes: SELF_CHECK_BYTES,
    keyId: input.keyId,
    publicKey,
  });
  const opened = await openSubmission({
    envelope,
    privateKey,
  });

  const roundTrip = new Uint8Array(opened.bytes);
  if (roundTrip.byteLength !== SELF_CHECK_BYTES.byteLength) {
    throw new Error("Submission sealing self-check failed: plaintext size mismatch.");
  }
  for (let index = 0; index < SELF_CHECK_BYTES.byteLength; index += 1) {
    if (roundTrip[index] !== SELF_CHECK_BYTES[index]) {
      throw new Error("Submission sealing self-check failed: plaintext mismatch.");
    }
  }

  return {
    keyId: input.keyId,
    verified: true,
  };
}
