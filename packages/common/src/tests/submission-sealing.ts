import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  SUBMISSION_SEAL_VERSION,
  computeSubmissionResultHash,
  computeSubmissionSealPublicKeyFingerprint,
  importSubmissionOpenPrivateKey,
  importSubmissionSealPublicKey,
  openSubmission,
  parseSealedSubmissionEnvelope,
  sealSubmission,
  serializeSealedSubmissionAuthenticatedData,
  serializeSealedSubmissionEnvelope,
} from "../index.js";
assert.equal(
  computeSubmissionResultHash("ipfs://bafy-test-cid"),
  "0xf99c605dfcb379e4a828ad979c6f1ba446997b9d070509e293bad312a13a4c7a",
  "submission result hash should remain stable for fixed CIDs",
);

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const importedPublicKey = await importSubmissionSealPublicKey(publicKey);
const generatedEnvelope = await sealSubmission({
  challengeId: "22222222-2222-2222-2222-222222222222",
  solverAddress: "0xABCDEF0000000000000000000000000000000001",
  fileName: "answer.txt",
  mimeType: "text/plain",
  bytes: new TextEncoder().encode("hello sealed world"),
  keyId: "generated-test-kid",
  publicKey: importedPublicKey,
});
const importedPrivateKey = await importSubmissionOpenPrivateKey(privateKey);
const openedGenerated = await openSubmission({
  envelope: generatedEnvelope,
  privateKey: importedPrivateKey,
});

assert.equal(
  generatedEnvelope.solverAddress,
  "0xabcdef0000000000000000000000000000000001",
  "solver address should be normalized into the sealed envelope",
);
assert.equal(
  generatedEnvelope.version,
  SUBMISSION_SEAL_VERSION,
  "new sealed submissions should use the current envelope version",
);
assert.equal(
  computeSubmissionSealPublicKeyFingerprint(publicKey),
  computeSubmissionSealPublicKeyFingerprint(publicKey),
  "submission seal key fingerprints should be deterministic for the same PEM",
);
assert.equal(
  serializeSealedSubmissionAuthenticatedData({
    version: "sealed_submission_v2",
    alg: "aes-256-gcm+rsa-oaep-256",
    kid: "generated-test-kid",
    challengeId: "22222222-2222-2222-2222-222222222222",
    solverAddress: "0xABCDEF0000000000000000000000000000000001",
    fileName: "answer.txt",
    mimeType: "text/plain",
  }),
  '{"version":"sealed_submission_v2","alg":"aes-256-gcm+rsa-oaep-256","kid":"generated-test-kid","challengeId":"22222222-2222-2222-2222-222222222222","solverAddress":"0xabcdef0000000000000000000000000000000001","fileName":"answer.txt","mimeType":"text/plain"}',
  "authenticated-data serialization should stay stable for external sealers",
);
const serializedEnvelope = serializeSealedSubmissionEnvelope(generatedEnvelope);
assert.deepEqual(
  parseSealedSubmissionEnvelope(serializedEnvelope),
  generatedEnvelope,
  "sealed submission envelope serialization should round-trip canonically",
);
assert.equal(
  new TextDecoder().decode(openedGenerated.bytes),
  "hello sealed world",
  "generated sealed submissions should round-trip",
);
await assert.rejects(
  () =>
    openSubmission({
      envelope: {
        ...generatedEnvelope,
        fileName: "tampered.txt",
      },
      privateKey: importedPrivateKey,
    }),
  "tampering with authenticated envelope metadata should fail decryption",
);

console.log("submission sealing validation passed");
