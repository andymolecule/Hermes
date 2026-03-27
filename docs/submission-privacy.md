# Submission Privacy and Sealing

## Purpose

How Agora hides solver answer bytes while a challenge is open, how sealed submissions are represented, what is and is not private, and how operators should manage sealing keys.

## Audience

Engineers working on submission flow, scoring, API, or verification. Operators enabling or rotating submission sealing.

## Read this after

- [Architecture](architecture.md) — system topology
- [Protocol](protocol.md) — lifecycle rules
- [Data and Indexing](data-and-indexing.md) — storage model

## Source of truth

This doc is authoritative for: sealed submission format, privacy boundary, trust assumptions, key management model, and the end-to-end submission sealing flow. It is not authoritative for: contract settlement logic, general database schema outside submission privacy fields, or frontend layout decisions.

## Summary

- The canonical sealed submission format is `sealed_submission_v2`.
- Solver-facing submission surfaces use the same sealing contract. Web, CLI,
  and agent surfaces that claim private-answer submission must use
  `sealed_submission_v2` while a challenge is `Open`.
- `sealed` is the default challenge privacy mode when sealing is configured.
  `public` is explicit opt-in.
- There is no active plaintext fallback for `sealed` challenges. If sealing is
  unavailable, the submission surface must block instead of silently switching
  formats.
- Privacy is enforced at Agora's first controlled write boundary too. Any API
  route that accepts solver submission bytes must require an explicit
  `resultFormat` and reject mismatches against the challenge privacy mode.
- The browser fetches Agora's active submission sealing public key only for
  `sealed` challenges, then seals locally and uploads the sealed envelope to
  IPFS.
- The on-chain contract stores only `keccak256(submission CID)`, not the plaintext answer.
- The worker resolves the matching private key by `kid`, decrypts only after `startScoring()` has persisted, and runs the Docker scorer.
- Public verification stays locked while the challenge is `Open`.
- Once scoring begins, replay artifacts may be published for reproducibility. This is anti-copy privacy during the open phase, not permanent secrecy.
- Hidden evaluation artifact privacy is a separate boundary from submission
  sealing. Public challenge specs and public challenge APIs must not expose
  dereferenceable URIs for private artifacts.

---

## Implementation Map

Key code paths:

- Web submit flow and UX gating: `apps/web/src/components/SubmitSolution.tsx`
- Web API types for sealing capability: `apps/web/src/lib/api.ts`
- API route serving the active sealing public key: `apps/api/src/routes/submissions.ts`
- Canonical sealing and unsealing primitives: `packages/common/src/submission-sealing.ts`
- Sealed envelope schema: `packages/common/src/schemas/submission.ts`
- Submission result format constants: `packages/common/src/types/submission.ts`
- Sealing key config and `kid` resolution: `packages/common/src/config.ts`
- Worker startup self-check for sealing: `apps/api/src/worker/index.ts`
- Worker scoring flow and replay publication: `apps/api/src/worker/scoring.ts`
- Scorer-side sealed envelope resolution and decrypt: `packages/scorer/src/sealed-submission.ts`
- Worker heartbeat/readiness queries: `packages/db/src/queries/worker-runtime.ts`
- Database baseline for sealed submissions, worker runtime state, and score-job fencing: `packages/db/supabase/migrations/001_baseline.sql`

---

## Privacy Goal

Agora's submission privacy goal is narrow and explicit:

- Hide answer bytes from the public and other solvers while the challenge is open.
- Allow Agora-operated scoring to decrypt automatically after the challenge enters scoring.
- Preserve reproducibility after scoring begins.

This model is designed to prevent copy/paste leakage during the live competition window. It is not designed to make submissions permanently secret from Agora, from the solver, or from the public after replay artifacts are intentionally published.

## Enforcement Rules

- Private-answer submission for an `Open` challenge is sealed-only.
- There is no compatibility mode, migration window, or server-side plaintext
  fallback for `sealed` submissions.
- Solver surfaces may prepare the envelope locally, but Agora must enforce the
  same rule again at the submission upload and registration boundary.
- `/api/submissions/upload` requires explicit `x-agora-result-format`.
- `sealed_submission_v2` uploads must contain a valid sealed envelope.
- `plain_v0` uploads are allowed only for challenges that explicitly opt into
  `public` mode.
- `/api/submissions/intent` and `/api/submissions` require explicit
  `resultCid` and `resultFormat`.
- Local scoring may use plaintext local files because nothing is being
  persisted as a live submission yet. That is a separate workflow.

## Non-Goals

The current model does not try to provide:

- Metadata opacity for wallet address or transaction activity.
- Permanent confidentiality after scoring begins.
- Operator-blind decryption. The worker still decrypts on Agora infrastructure.
- Hidden filenames or MIME types once someone already has the sealed envelope CID.

## Adjacent Boundary: Hidden Evaluation Artifacts

This document is about solver-answer privacy only.

It does not change the challenge-definition rule for hidden evaluation
artifacts:

- solver submissions stay sealed as `sealed_submission_v2`
- public pinned challenge specs must not expose dereferenceable URIs for
  private evaluation artifacts
- trusted runtime surfaces may still hold the real private evaluation artifact
  URI for scoring

That challenge-definition boundary is locked in the protocol and authoring
execution specs. It is not a second submission workflow.

---

## End-to-End Flow

```mermaid
sequenceDiagram
    participant Solver as Solver Browser
    participant API as Agora API
    participant IPFS as IPFS
    participant Chain as AgoraChallenge
    participant DB as Supabase
    participant Worker as Scoring Worker

    Solver->>API: GET /api/submissions/public-key
    API-->>Solver: version + alg + kid + RSA public key
    Solver->>Solver: validate input locally
    Solver->>Solver: seal bytes as sealed_submission_v2
    Solver->>IPFS: upload sealed-submission.json
    IPFS-->>Solver: submission CID
    Solver->>API: POST /api/submissions/intent { challengeId, solverAddress, resultCid, resultFormat }
    API->>API: compute resultHash
    API->>DB: store submission_intent
    Solver->>Chain: submit(resultHash)
    Solver->>API: POST /api/submissions { challengeId, txHash, resultCid, resultFormat } (required confirmation)
    API->>DB: upsert on-chain submission linked to registered intent

    Note over Solver,Worker: While challenge is Open, public verification stays locked.

    Worker->>DB: claim score job after Scoring starts
    Worker->>IPFS: fetch sealed envelope by submission_cid
    Worker->>Worker: resolve private key by kid
    Worker->>Worker: decrypt and validate challengeId / solverAddress
    Worker->>Worker: run Docker scorer on plaintext bytes
    Worker->>IPFS: pin proof bundle and replay artifact
```

---

## What Gets Stored Where

### On chain

- Solver wallet address as the transaction sender.
- `result_hash = keccak256(submission CID)`.
- Posted score and proof hash after scoring.

The contract does not store the plaintext answer and does not store the IPFS CID directly.

### In Supabase

- `submission_intents` stores the pre-registered `(challenge_id, solver_address, result_hash) -> submission_cid` mapping before the on-chain submit is sent. This intent is the required registration record for a scoreable submission.
- `submissions.submission_cid` points to the IPFS object used for scoring.
- `submission_cid` points to the sealed envelope, not the replay artifact.
- `worker_runtime_state` tracks live scoring-worker heartbeats, Docker readiness, and sealing self-check state for the active `kid`.
- `AGORA_WORKER_RUNTIME_ID` can override the worker heartbeat row id when multiple scoring workers share one host.

### In IPFS

- During the open phase, the stored object is `sealed-submission.json`.
- After scoring begins, the worker may additionally publish a replay artifact containing the plaintext scorer input for public verification.

---

## Sealed Envelope Format

The canonical envelope version is `sealed_submission_v2`.

Fields:

- `version`: `sealed_submission_v2`
- `alg`: `aes-256-gcm+rsa-oaep-256`
- `kid`: identifier of the active Agora sealing keypair
- `challengeId`: challenge UUID
- `solverAddress`: normalized lowercase wallet address
- `fileName`: original staged file name
- `mimeType`: original staged MIME type
- `iv`: AES-GCM nonce
- `wrappedKey`: AES data key encrypted with Agora's RSA public key
- `ciphertext`: encrypted answer bytes

### Cryptographic construction

- The browser generates a fresh random AES-256-GCM key per submission.
- The answer bytes are encrypted with that AES key.
- The AES key is then wrapped with the active Agora RSA public key using RSA-OAEP with SHA-256.
- The envelope is serialized as JSON and uploaded to IPFS.

### Authenticated data

The following visible fields are included in AES-GCM additional authenticated data:

- `version`
- `alg`
- `kid`
- `challengeId`
- `solverAddress`
- `fileName`
- `mimeType`

That means these fields are not secret, but they cannot be modified without causing decryption failure.

### Encrypted data

Only the answer payload bytes are encrypted.

---

## What Is Private Versus Visible

### Hidden from the public while the challenge is open

- Plaintext answer bytes.
- Any replay artifact that would let others rerun the scorer on the plaintext answer.

### Visible or inferable

- The solver wallet address and transaction hash on-chain.
- The existence of a submission.
- The `result_hash` on-chain.
- The active submission sealing key id exposed by the API.

### Visible if someone already has the sealed envelope CID

- `challengeId`
- `solverAddress`
- `fileName`
- `mimeType`
- `version`
- `alg`
- `kid`

This is why the system should be described as public-hidden answer privacy during the open phase, not full opaque storage.

---

## Browser Submission Flow

1. The challenge page checks `GET /api/submissions/public-key`.
2. The API returns that public key whenever public sealing config is present.
3. If sealing is unavailable because config is missing, the UI blocks submission instead of pretending privacy exists.
4. The browser validates the selected file or text answer locally.
5. The browser imports the API-provided RSA public key.
6. The browser seals the submission locally as `sealed_submission_v2`.
7. The browser uploads only `sealed-submission.json` to IPFS.
8. The browser pre-registers a `submission_intent` and receives the canonical `resultHash`.
9. The browser submits that `resultHash` on-chain.
10. The browser confirms the submission with the API.
11. Scoring requires the on-chain submission and the pre-registered `submission_intent` to be linked. If confirmation or indexing does not establish that link, the submission must be investigated instead of being treated as scoreable automatically later.

Important consequence:

- If sealing is enabled, the browser never intentionally uploads plaintext answer bytes as the official submission payload.

---

## Worker Decryption and Scoring Flow

1. The worker claims score jobs only after `startScoring()` has persisted on-chain and that transition has been projected into `challenges.status = scoring`.
2. On startup, the worker writes a heartbeat row into `worker_runtime_state` only after sealing self-check and Docker checks pass.
3. The worker refreshes that heartbeat periodically while it stays alive.
4. The worker fetches the sealed envelope from IPFS using `submissions.submission_cid`.
5. The worker parses the envelope and reads its `kid`.
6. The worker resolves the matching private key from its configured key set.
7. The worker decrypts the wrapped AES key and then decrypts the answer bytes.
8. The worker validates:
   - `envelope.challengeId === submission.challenge_id`
   - `envelope.solverAddress === submission.solver_address`
9. The worker stages the plaintext bytes into the scoring workspace and runs the Docker scorer.
10. If scoring succeeds, the worker pins the proof bundle and may pin a replay artifact for public verification.

If the worker cannot resolve the `kid`, or if the envelope metadata was tampered with, decryption fails and the submission is rejected as invalid.

---

## Public Verification Boundary

Public verification is intentionally gated by challenge status:

- While `Open`: no public verification route exposes the replay artifact.
- Once `Scoring` begins: proof bundles and replay artifacts may become public so anyone can rerun the scorer.

This is the key tradeoff:

- Anti-copy fairness while the challenge is live.
- Reproducibility and public auditability after scoring begins.

If the product ever needs secrecy all the way through final settlement, this model is not sufficient and would need a different design.

---

## Key Management Model

The API and worker split responsibilities:

- API serves exactly one active public key:
  - `AGORA_SUBMISSION_SEAL_KEY_ID`
  - `AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM`
- Worker holds the matching private key:
  - `AGORA_SUBMISSION_OPEN_PRIVATE_KEY_PEM`
  - or `AGORA_SUBMISSION_OPEN_PRIVATE_KEYS_JSON`

### `kid` rotation

- New submissions always use the active API `kid`.
- The worker may keep a small private key map keyed by `kid`.
- The active `kid` must exist in the worker key set, or the worker fails startup.
- Previous keys may remain in `AGORA_SUBMISSION_OPEN_PRIVATE_KEYS_JSON` so still-pending sealed submissions can still be scored.

This keeps rotation simple:

- one active public key for new submissions
- one worker key set containing the active private key and any temporary previous keys

---

## Trust Boundary

Current trust assumptions:

- The browser is trusted to seal locally before upload.
- Agora infrastructure is trusted to hold the worker private key.
- The worker is trusted to decrypt only for scoring and verification publication.
- The scorer container is deterministic, but not confidential.

This means the current model protects against solver-to-solver copying during the open phase, but not against a malicious Agora operator with access to worker infrastructure.

---

## Operational Checks

To confirm sealing is working:

```bash
curl -sS http://localhost:3000/api/health
curl -sS http://localhost:3000/api/worker-health
curl -sS http://localhost:3000/api/submissions/public-key
```

Expected signals:

- `/api/submissions/public-key` returns `version:"sealed_submission_v2"` and the active `kid` whenever sealing is configured successfully.
- `/api/health` reports API liveness plus `runtimeVersion`. It does not imply a scoring worker is ready.
- `/api/worker-health` reports `workers.healthy > 0`, `workers.healthyWorkersForActiveRuntimeVersion > 0`, `sealing.workerReady=true`, and the same active `keyId`. `healthyWorkersNotOnActiveRuntimeVersion` is diagnostic only unless active healthy workers drop to zero.
- File-backed key loading is supported through `AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM_FILE`, `AGORA_SUBMISSION_OPEN_PRIVATE_KEY_PEM_FILE`, and `AGORA_SUBMISSION_OPEN_PRIVATE_KEYS_JSON_FILE` when services are launched through the shared runtime loader.

If the public key endpoint returns `503`, the web UI should block private submissions rather than falling back to a fake privacy claim.

---

## Related Docs

- [Architecture](architecture.md) — topology and high-level flow
- [Protocol](protocol.md) — lifecycle rules around when privacy holds
- [Data and Indexing](data-and-indexing.md) — where sealed envelopes and replay artifacts are stored
- [Operations](operations.md) — env vars, startup checks, and key rotation handling
