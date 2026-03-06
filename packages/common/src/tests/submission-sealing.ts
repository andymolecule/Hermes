import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  computeSubmissionResultHash,
  importSubmissionOpenPrivateKey,
  importSubmissionSealPublicKey,
  openSubmission,
  parseSealedSubmissionEnvelope,
  sealSubmission,
  serializeSealedSubmissionEnvelope,
} from "../index.js";

const vectorPrivateKeyPem = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQC/f80zlT+hptgl
7g2qpiok+6mTDI4Ni0qW+X6LJNGHv9ZQk99dhcr/e8KaHZQ9zT5g5z2wPeHsfnQf
Ao/YE3hu/Rh3h/WUs5KvRw5ywt3okqYqoYBGrdzynZ+0CPb7322MdfOSmwCJjfm7
n4QseP/ursGcLm+yDaEqzmp+aLfCV8FlL9HSJzrmHV87MKgoh4kE1brE2h3zE1al
X79IUk74jJLXUPrKLspnnqXN/0OtrQsGu+6p9yqnuyCmfvxK+TGUYHX1DmvXdJQ8
8lxHR5vc19SrwzidlfcxctICSRgp60Xa8om+0sALwfpDPkLOCl/Ytq2BnI1hJbrL
4H+whGH5AgMBAAECggEAAkuUWI1t5VCcH5xCUqzKLYZMqoQIgdYND1EvOJi44DEm
7vFOyI6td7FyjClVmQYIPN4Yqa+cMRr05lhABB17oIztCaW6Bk2+sNYfsLVwNnTn
g/RKls5HqyrDesNuvmcXp4rUYAn2kC+A8kQ/r87FdoVmsaoG0bIDIAG4WgqERVKF
oPWtyqyl+KBVLzBl9DzPoFVxw1DJGglJ3d94tBTHE+GhmqYZZW2fj4KX6W+etoOF
O9h+FpXu2d6dnkrf9IG1skFRa1dWHxo2ac+qviBT0+03oaOfeNRowYQ/BTdOax+/
S3hcN6P+J8W0n7LDcosYvd8jQlTfvskHtzl1+TmQ+QKBgQDorhtEfAwG/hl2PrPS
9VYvgzxxhnmOXWVp9QEq+IkNTelYGnEbrk2aDBI9x8NyiSIjvOn3VZjLC38/Fg2m
EPVwjgh+WXbpA87shfn//wFGtvoHMjz0z0XA7/V64KcRKHNV7jjumBbLVdXd0Gk6
AjEHUOzPuJ6b3p38rnDepVjM/QKBgQDSsR0bURMB8/mK9HnaXscl9zpqZsYbnq13
orvtRGK0/F9IVaidl7fNZr34OogH2f8r73hc/LFWYuKWJYwkujSS651UHQ56svKQ
Z5XrQoxq5qAv8gb2QWWxosWt/3gavu3xKFDEDWhtX3B2l9v+biLobcFZo8uQ05di
xy0UWq23rQKBgHj+KEG5e4ubUGQzgNDfMJzuUlz6P3VvTZAGjj/pE2NusztULKLn
RYUoZ8fme9SwSKdq0gMCaLyU0utcLWbAhNCtmu8Q2IucplpJ5NFgqio6ddOOJTJs
IeqNHQpzjYyXizoQ8VvojFnZ3adFe6Jlh1c1lp8BcsC8x0yg7SJpur6FAoGAYk9q
eXiXGe4xnnj88rwOyNRXWZajEfg0kQJKFig2tqScATCXARHuHdW3BsCpAKDjxCh1
TU5LoTd66vySLAEGzxdJzhnQy8f8Dw2GksP2qVr7m+OfBAD35q9A9jOiYzh75m8d
YJ2xAHfsDipF6K6Tc0jjU2RudCGHHfw6OKknLfECgYAuFPX6gdr2qKMGMNppOJQ/
tgxXO+oVGSkCu3FICTnvSS+9tB9Ih+PXVPw06CmBl04jqa+RV/ShZ2QaW74+5deO
zQrR3Rfl3icKH2VwuxLEZoFGrU7Hpl0mlGkpqCVMQGkYnG7/d5dPOpxQBy30uLX2
WrIr0xcblY6U4iftZNWQjw==
-----END PRIVATE KEY-----`;

const vectorEnvelopeJson = `{"version":"sealed_submission_v1","alg":"aes-256-gcm+rsa-oaep-256","kid":"test-kid","challengeId":"11111111-1111-1111-1111-111111111111","solverAddress":"0x123400000000000000000000000000000000abcd","fileName":"submission.csv","mimeType":"text/csv","iv":"SKnNYsym69bd5n4K","wrappedKey":"NcyBCeq9uXPHmX3mk5hm0_gUr_dg7lEQDMK1xBvdBTIMWrGoGJXKZGB08awJKCLsmKbaJwShkkc9CRpLvzjmXZmwHMW-mDiWYGKFfrdS6PEmJc_PV7nUZG7G2mn_nVvtxpmYjANQW7-45yrIWJIvJT7r8SOMVsMO7Sk22xrICl_EnJDm-BhS0KDRTGraOd56pgSxIjiMO-8gPoDcpd-E9J8T_YkwE9_RV2Nj0qRw8E-LOyXB8isePxtuUqWr1temEWQphqKSyKRvjCC5rR6DgAlr0GkzbJcESo8nChqxdOAjdrLVxr7I7wNPqIapHClyMbdk3YYFDqmdf07-7Vc1kg","ciphertext":"IjPQV05jhrT_ZPc7cGYUEpm7FHbJJnQAVONaJgCI"}`;

const vectorEnvelope = parseSealedSubmissionEnvelope(vectorEnvelopeJson);
const vectorPrivateKey = await importSubmissionOpenPrivateKey(vectorPrivateKeyPem);
const openedVector = await openSubmission({
  envelope: vectorEnvelope,
  privateKey: vectorPrivateKey,
});

assert.equal(
  new TextDecoder().decode(openedVector.bytes),
  "id,value\n1,42\n",
  "sealed submission test vector should decrypt to the canonical plaintext",
);
assert.equal(
  serializeSealedSubmissionEnvelope(vectorEnvelope),
  vectorEnvelopeJson,
  "sealed submission envelope serialization should stay canonical",
);
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
  new TextDecoder().decode(openedGenerated.bytes),
  "hello sealed world",
  "generated sealed submissions should round-trip",
);

console.log("submission sealing validation passed");
