import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  SUBMISSION_SEAL_VERSION,
  type SealedSubmissionEnvelope,
  SubmissionOpenError,
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

type ConformanceFixture = {
  inputs: {
    challengeId: string;
    solverAddress: string;
    fileName: string;
    mimeType: string;
    keyId: string;
    plaintextUtf8: string;
  };
  authenticatedData: {
    json: string;
    utf8Hex: string;
  };
  negativeExamples: {
    alphabeticallySortedKeys: {
      json: string;
      utf8Hex: string;
    };
  };
  knownGoodEnvelope: {
    publicKeyPem: string;
    privateKeyPem: string;
    envelope: SealedSubmissionEnvelope;
  };
};

const conformanceFixture = JSON.parse(
  await readFile(
    new URL(
      "../../../../docs/fixtures/sealed-submission-v2-conformance.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as ConformanceFixture;
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
    kid: conformanceFixture.inputs.keyId,
    challengeId: conformanceFixture.inputs.challengeId,
    solverAddress: conformanceFixture.inputs.solverAddress,
    fileName: conformanceFixture.inputs.fileName,
    mimeType: conformanceFixture.inputs.mimeType,
  }),
  conformanceFixture.authenticatedData.json,
  "authenticated-data serialization should stay stable for external sealers",
);
assert.equal(
  Buffer.from(conformanceFixture.authenticatedData.json, "utf8").toString(
    "hex",
  ),
  conformanceFixture.authenticatedData.utf8Hex,
  "conformance fixture should publish the exact authenticated-data bytes",
);
assert.equal(
  Buffer.from(
    conformanceFixture.negativeExamples.alphabeticallySortedKeys.json,
    "utf8",
  ).toString("hex"),
  conformanceFixture.negativeExamples.alphabeticallySortedKeys.utf8Hex,
  "negative conformance example should publish the exact non-canonical bytes",
);
assert.notEqual(
  conformanceFixture.negativeExamples.alphabeticallySortedKeys.json,
  conformanceFixture.authenticatedData.json,
  "alphabetically sorted AAD must stay distinct from Agora's canonical order",
);
const serializedEnvelope = serializeSealedSubmissionEnvelope(generatedEnvelope);
assert.deepEqual(
  parseSealedSubmissionEnvelope(serializedEnvelope),
  generatedEnvelope,
  "sealed submission envelope serialization should round-trip canonically",
);
const fixturePrivateKey = await importSubmissionOpenPrivateKey(
  conformanceFixture.knownGoodEnvelope.privateKeyPem,
);
const openedFixture = await openSubmission({
  envelope: conformanceFixture.knownGoodEnvelope.envelope,
  privateKey: fixturePrivateKey,
});
assert.equal(
  new TextDecoder().decode(openedFixture.bytes),
  conformanceFixture.inputs.plaintextUtf8,
  "published conformance fixture should remain decryptable",
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
  (error: unknown) => {
    assert.ok(error instanceof SubmissionOpenError);
    assert.equal(error.code, "ciphertext_auth_failed");
    return true;
  },
  "tampering with authenticated envelope metadata should fail decryption",
);
const wrongPrivateKey = await importSubmissionOpenPrivateKey(
  generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  }).privateKey,
);
await assert.rejects(
  () =>
    openSubmission({
      envelope: generatedEnvelope,
      privateKey: wrongPrivateKey,
    }),
  (error: unknown) => {
    assert.ok(error instanceof SubmissionOpenError);
    assert.equal(error.code, "key_unwrap_failed");
    return true;
  },
  "using the wrong private key should fail unwrap before ciphertext decrypt",
);

console.log("submission sealing validation passed");
