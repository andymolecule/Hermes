# Runtime Release Architecture

> Status: LOCKED
> Scope: Runtime deploy ownership, release identity, hosted health, ingress
> defaults, and the destructive bootstrap boundary.

Read after:

- [Architecture](../architecture.md)
- [Operations](../operations.md)
- [Deployment](../deployment.md)
- [Machine Contract Migration](machine-contract-migration.md)

---

## 0. Clarifying Scope

### 0.1 Why This Doc Exists

Recent release failures were mostly boundary failures, not business-logic
failures. The repo had multiple systems trying to answer the same questions in
different ways:

- what revision is actually running
- who owns runtime deployment
- which health route is canonical
- when destructive reset is allowed
- which parts of the system require immutable artifacts

This document locks the simpler model so runtime operations stop drifting.

### 0.2 What This Doc Is Authoritative For

- the canonical identity of a hosted runtime release
- the boundary between Railway-native runtime deploys and GitHub verification
- the destructive bootstrap boundary
- the canonical hosted API health contract
- the ingress split between browser traffic and agent/CLI traffic
- which artifact discipline remains mandatory for scorer containers

### 0.3 What This Doc Is Not For

- contract lifecycle or payout logic
- challenge authoring or submission business behavior
- UI design or copy
- step-by-step Railway dashboard usage, unless it defines a lasting boundary
- executor redesign beyond the runtime boundaries it touches

### 0.4 Authority Rule

If this doc conflicts with:

- bash scripts under `scripts/`
- GitHub workflows
- older deployment or operations wording
- current dashboard habits

this doc wins for the runtime release architecture.

### 0.5 Migration Assumption

This design assumes:

- Railway remains the deploy owner for API, indexer, and worker orchestrator
- GitHub Actions verifies deployments; it does not deploy runtime services
- destructive reset remains explicit and separate from normal runtime release
- official scorer images remain immutable OCI artifacts

---

## 1. Design Goals

1. Hosted runtime services must report stable release metadata, with exact git
   provenance when the host platform can surface it cleanly.
2. Runtime deployment ownership must be obvious: Railway deploys, GitHub
   verifies, operators bootstrap explicitly when needed.
3. Runtime release and web release must remain separate domains.
4. `GET /api/health` must be the canonical hosted health surface.
5. The worker runtime fence through `worker_runtime_state` and
   `worker_runtime_control` must remain in place.
6. Destructive schema reset must require an admin-only DB connection that
   runtime services do not need.
7. Official scorer images must keep digest-pinned artifact discipline.
8. The release path must stay understandable without a custom release control
   plane layered on top of Railway.

---

## 2. Non-Goals

- building or promoting GHCR runtime-service images for API, indexer, or worker
- manifest-driven Railway deployment for runtime services
- replacing Railway or Vercel immediately
- hiding every platform-specific setting behind repo automation
- redesigning the worker/executor topology in this phase

---

## 3. Locked Invariants

### 3.1 Runtime Identity

- Hosted runtime services must surface:
  - `releaseId`
  - `gitSha`
  - `runtimeVersion`
- `releaseId` and `runtimeVersion` should stay aligned.
- When Railway or the build environment exposes git metadata cleanly,
  `releaseId` and `runtimeVersion` should align to the short commit SHA.
- `gitSha` is best-effort provenance. When present, it should be the full
  40-character SHA.
- Hosted Railway deploys may still report `"dev"` when no build or platform
  metadata is available. That does not block runtime readiness by itself.
- Explicit overrides are optional and should be introduced only when the team
  deliberately accepts provider-specific metadata sync complexity.

### 3.2 Deploy Ownership

- Railway is the canonical deploy owner for API, indexer, and worker
  orchestrator.
- Shared environments deploy from Railway-native repo builds or Railway-managed
  build config.
- GitHub Actions may build, test, verify, and smoke, but must not mutate
  Railway service config or promote runtime-service images.
- Local operator laptops are not the canonical deploy source for shared
  environments.

### 3.3 Hosted Health Contract

- The canonical hosted API liveness/readiness route is `GET /api/health`.
- `/api/worker-health` and `/api/indexer-health` remain detail routes.
- `/healthz` may remain as a local or direct-process alias, but hosted docs,
  monitors, and verification must use `/api/health`.

### 3.4 Release Domains

- Runtime release and web release are separate domains.
- Runtime verification may skip web verification entirely.
- Browser auth/session traffic continues to use the web-origin proxy.
- Agents and CLI default to the API origin directly.

### 3.5 Bootstrap Boundary

- `bootstrap-testnet` is destructive and rare.
- Normal runtime release verification is non-destructive.
- Destructive bootstrap must use `AGORA_SUPABASE_ADMIN_DB_URL`.
- Runtime services must not require `AGORA_SUPABASE_ADMIN_DB_URL`.

### 3.6 Worker Fence Contract

- The API keeps the active scoring runtime version in
  `worker_runtime_control` while the runtime schema is healthy.
- Worker heartbeats publish runtime version through `worker_runtime_state`.
- Older workers may continue heartbeating but must not claim new jobs after the
  active runtime version changes.
- The fence value must align with the hosted API runtime version, even when
  that version is a best-effort value such as `"dev"`.

### 3.7 Scorer Artifact Discipline

- Official scorer images remain immutable OCI artifacts.
- Challenge persistence must keep scorer images digest-pinned.
- Hidden evaluation data must not be baked into scorer images.
- Runtime-service deployment simplicity does not relax scorer reproducibility
  rules.

### 3.8 Error Contract

- Public API failures must resolve to structured JSON envelopes.
- Validation and domain failures should become classified `AgoraError`s.
- Platform 502/503 responses should represent actual upstream failure, not
  routine validation or deployment drift.

---

## 4. Target Model

### 4.1 Runtime Release Metadata

Hosted runtime services expose this logical shape:

```json
{
  "releaseId": "dev",
  "gitSha": null,
  "runtimeVersion": "dev"
}
```

Rules:

- `releaseId` and `runtimeVersion` stay aligned in the normal hosted case.
- Build-generated `release-metadata.json` files may exist, but readiness must
  not depend on them carrying an exact git SHA.
- Platform git metadata may improve provenance when available, but hosted
  verification must still pass when `gitSha` is absent.

### 4.2 Runtime Release Pipeline

The runtime release path has four stages:

1. `build`
   - build the repo
   - run repo-native verification commands
2. `platform deploy`
   - Railway deploys API, indexer, and worker through its native deploy path
3. `verify`
   - wait for `/api/health` to return healthy release metadata
   - wait for `/api/worker-health` to show healthy workers on the active API
     runtime
4. `smoke`
   - run the external lifecycle smoke against the deployed runtime

Rules:

- Railway owns `platform deploy`.
- GitHub Actions and local operator commands own `build`, `verify`, and
  `smoke`.
- `verify` and `smoke` are read-only.
- `bootstrap-testnet` may reset shared state before `verify`, but it must not
  become the default day-to-day path.

### 4.3 Service Deployment Ownership

For canonical shared environments:

- keep Railway auto-deploy enabled for runtime services
- do not replace Railway-native deploys with a manifest promotion layer
- if Railway watch patterns or root directories are needed, use Railway-native
  settings and document them clearly
- treat dashboard config as operational configuration, not as a second custom
  deployment system

### 4.4 Canonical Hosted Health Surface

`GET /api/health` must return one canonical hosted shape for runtime release
verification.

Minimum logical fields:

```json
{
  "ok": true,
  "service": "api",
  "releaseId": "dev",
  "gitSha": null,
  "runtimeVersion": "dev",
  "checkedAt": "2026-03-26T11:35:39.379Z"
}
```

Rules:

- hosted CI and monitoring use `/api/health`
- worker detail remains under `/api/worker-health`
- indexer detail remains under `/api/indexer-health`
- `/healthz` must not diverge if it remains present as an alias

### 4.5 Ingress Contract

Caller defaults:

| Caller | Default origin | Why |
|--------|----------------|-----|
| Browser session/auth traffic | Web origin proxy | Same-origin cookie and SIWE constraints |
| Browser app traffic | Web origin proxy | Simpler browser-origin consistency |
| CLI | API origin direct | Fewer layers, fewer proxy-specific failures |
| Agents | API origin direct | Bearer-token traffic does not need the web proxy |

### 4.6 Bootstrap Flow

`bootstrap-testnet` exists for destructive environment reset only.

Flow:

1. operator confirms the target environment is ready for destructive reset
2. bootstrap uses `AGORA_SUPABASE_ADMIN_DB_URL`
3. bootstrap wipes the public schema
4. bootstrap reapplies `001_baseline.sql`
5. bootstrap reloads the PostgREST schema cache
6. bootstrap runs schema verification, deploy verification, and smoke

### 4.7 Verify-Only Runtime Flow

Normal runtime release verification works like this:

1. merge or push the intended runtime change to `main`
2. Railway deploys API, indexer, and worker through its native deploy path
3. `pnpm release:testnet` or the GitHub workflow waits for `/api/health` to be
   healthy and `/api/worker-health` to confirm healthy workers on the active
   API runtime
4. run smoke once deploy verification passes

### 4.8 Named Hotspots and Mitigations

1. Provider boundary drift
   - Symptom: runtime services need destructive DB credentials
   - Mitigation: `AGORA_SUPABASE_ADMIN_DB_URL` is bootstrap-only
2. Hidden deploy state
   - Symptom: operators guess what commit is live
   - Mitigation: `/api/health` must report runtime identity, and verification
     gates on health instead of exact provider git metadata
3. Over-engineered release control plane
   - Symptom: GitHub deploys Railway by rewriting service config
   - Mitigation: Railway deploys natively; GitHub verifies only
4. Mixed web/runtime truth
   - Symptom: runtime release fails because web is on a different revision
   - Mitigation: runtime verification may skip web verification
5. Collapsing scorer rigor into runtime-service ops
   - Symptom: runtime-service simplicity weakens reproducibility guarantees
   - Mitigation: keep strict artifact discipline only where determinism matters:
     official scorer images

---

## 5. Commands and Modes

Target command set:

- `pnpm release:testnet`
- `pnpm bootstrap:testnet`
- `pnpm schema:verify`
- `pnpm scorers:verify`
- `pnpm deploy:verify`
- `pnpm smoke:lifecycle:testnet`

Rules:

- `pnpm release:testnet` is verify-only
- `pnpm bootstrap:testnet` is destructive
- runtime verification defaults to API + worker, not web
- bootstrap uses the admin DB URL and then runs the same verification gate

---

## 6. Migration Plan

### 6.1 Phase 0: Spec Freeze

Objective:

- lock the simplified runtime-release model before more docs or workflow drift

Actions:

1. lock this document
2. point `docs/README.md`, `docs/operations.md`, and `docs/deployment.md` at it
3. remove repo guidance that treats manifest-driven runtime deployment as the
   target state

### 6.2 Phase 1: Health and Ingress Cleanup

Objective:

- standardize hosted runtime verification on `/api/health`

Actions:

1. move hosted docs and checks to `/api/health`
2. keep `/healthz` as an implementation alias only
3. keep API-origin direct as the CLI/agent default

### 6.3 Phase 2: Runtime Identity Cleanup

Objective:

- keep hosted runtime identity observable without forcing provider-specific git
  metadata plumbing

Actions:

1. keep `releaseId` and `runtimeVersion` aligned
2. treat `gitSha` as best-effort provenance
3. remove hosted dependence on runtime-only image metadata

### 6.4 Phase 3: Remove Runtime Artifact Promotion

Objective:

- stop treating API, indexer, and worker as custom promoted OCI artifacts

Actions:

1. delete runtime manifest/image promotion workflows
2. stop rewriting Railway service config from GitHub Actions
3. keep Railway-native runtime deploys enabled

### 6.5 Phase 4: Split Bootstrap From Release Verification

Objective:

- keep destructive reset explicit and admin-only

Actions:

1. introduce `AGORA_SUPABASE_ADMIN_DB_URL`
2. move destructive SQL to `bootstrap-testnet`
3. make `release:testnet` read-only

### 6.6 Phase 5: Legacy Cleanup

Objective:

- remove compatibility language that would reintroduce drift

Actions:

1. remove hosted `/healthz` guidance from docs
2. remove runtime manifest references from scripts and docs
3. keep only scorer artifact publication under GHCR

---

## 7. Explicit Keep List

Keep these concepts:

- `worker_runtime_state`
- `worker_runtime_control`
- `GET /api/health`
- explicit `deploy:verify`
- explicit smoke
- structured API error envelopes
- official scorer digest pinning and GHCR publication

These remain the right long-term boundaries.
