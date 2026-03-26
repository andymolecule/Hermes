# Runtime Release Architecture

> Status: LOCKED
> Scope: Release identity, deploy pipeline boundaries, hosted health contract,
> ingress split, and cutover plan for runtime operations.

Read after:

- [Architecture](../architecture.md)
- [Operations](../operations.md)
- [Deployment](../deployment.md)
- [Machine Contract Migration](machine-contract-migration.md)

---

## 0. Clarifying Scope

### 0.1 Why This Doc Exists

Recent release failures were not business-logic failures. They were boundary
failures caused by multiple systems trying to answer the same questions in
different ways:

- what revision is running
- what health route is canonical
- which origin agents should call
- which deploy system is authoritative
- when destructive reset is allowed

This document exists to stop release and ops drift before more implementation
work happens.

### 0.2 What This Doc Is Authoritative For

- the canonical identity of a deployed runtime release
- the required stages of the runtime release pipeline
- the boundary between runtime release and web release
- the canonical hosted health contract
- the caller split between browser traffic and agent/CLI traffic
- the cutover rule for destructive bootstrap vs steady-state releases
- which ops configuration must live in code or generated artifacts instead of
  dashboard-only tribal knowledge

### 0.3 What This Doc Is NOT For

- contract lifecycle or payout logic
- challenge authoring or submission business behavior
- UI design or copy
- low-level Railway or Vercel click-by-click instructions unless they define a
  lasting architectural boundary
- executor redesign beyond the release and health boundaries it touches

### 0.4 Authority Rule

If this doc conflicts with:

- bash scripts under `scripts/`
- GitHub workflows
- current dashboard operating habits
- older deployment or operations wording

this doc wins for the runtime release architecture.

### 0.5 Freeze Rule

No additional runtime release refactor should land until it can be explained as
an implementation of this spec.

Patch fixes for live incidents are allowed, but they must move toward this
contract rather than reintroduce alternative release, health, or identity
paths.

### 0.6 Migration Assumption

This redesign assumes:

- the migration cutover may be a hard cleanup with no backward-compatibility
  layer
- the migration cutover may be destructive with no data-preservation layer
- steady-state releases after cutover must be non-destructive by default

That means:

- bootstrap and steady-state must be separate commands and separate concepts
- destructive reset must not remain part of the default day-to-day release path
- compatibility shims should be temporary and explicit

---

## 1. Design Goals

1. A deployed service must be able to state exactly which release it is running
   without guessing from platform env fallbacks.
2. A release verifier must compare against one immutable release manifest, not
   recompute expectations from the local shell environment.
3. Build, deploy, verify, and smoke must be independent stages with explicit
   outputs and retry boundaries.
4. Hosted health checks must use one canonical public route.
5. Runtime services and web must have separate release domains.
6. Agents and CLI should take the shortest stable path to the API.
7. Manual dashboard state must stop being the hidden source of truth for normal
   releases.
8. Worker runtime fencing through `worker_runtime_state` and
   `worker_runtime_control` must remain in place.
9. Structured API error envelopes must remain in place, with fewer unclassified
   internal failures.

---

## 2. Non-Goals

- replacing Railway or Vercel immediately
- redesigning the worker/executor topology in this phase
- introducing preview-environment orchestration before the core runtime release
  path is stable
- preserving old `/healthz`-based hosted monitoring as a first-class contract
- preserving local laptop `railway up` as a canonical deploy path for shared
  environments

---

## 3. Locked Invariants

### 3.1 Release Identity

- Every runtime release has one immutable `releaseId`.
- Every runtime release records the source `gitSha`.
- `releaseId` is the canonical deploy identity for runtime coordination.
- `gitSha` is provenance, not the primary runtime fence.
- Hosted runtime services must never fall back to `"dev"`.
- Local development may still report `"dev"`.

### 3.2 Release Artifact

- The deployable unit is an immutable image per service, not a source upload.
- Runtime services in scope for this release architecture:
  - API
  - Indexer
  - Worker Orchestrator
- The executor remains an operational dependency, but it is not part of the
  first release-manifest cutover unless explicitly added later.

### 3.3 Release Manifest

- Every runtime release produces one manifest file.
- Deploy consumes the manifest.
- Verify consumes the manifest.
- Smoke consumes the deployed release selected by the manifest.
- No stage recomputes the intended release from `git rev-parse`, platform env
  heuristics, or operator memory.

### 3.4 Hosted Health Contract

- The canonical hosted API liveness/readiness route is `GET /api/health`.
- `/api/worker-health` and `/api/indexer-health` remain detail routes.
- `/healthz` is not a canonical hosted contract.
- During migration, `/healthz` may remain as an implementation alias for local
  or direct-process use, but hosted CI, monitors, docs, and operator playbooks
  must not rely on it.

### 3.5 Release Domains

- Runtime release and web release are separate domains.
- Runtime release verifies API, indexer, and worker only.
- Web release verifies the web app only.
- Runtime release must not fail because the web is on a different revision.
- Browser auth/session traffic continues to use the web-origin proxy.
- Agents and CLI default to the API origin directly.

### 3.6 Destructive vs Non-Destructive Operations

- `bootstrap-testnet` is destructive and rare.
- `release-runtime` is non-destructive and normal.
- A steady-state runtime release must not reset the database by default.
- A destructive bootstrap must be explicit, operator-invoked, and clearly named.

### 3.7 Error Contract

- Public API failures must resolve to structured JSON envelopes.
- Validation and domain failures should become classified `AgoraError`s.
- Platform 502/503 responses should represent actual upstream/platform failure,
  not routine validation or compiler mistakes escaping the app boundary.

---

## 4. Target Model

### 4.1 Runtime Release Metadata

Each runtime release produces build metadata with this logical shape:

```json
{
  "releaseId": "rt_2026_03_26_e7b2f4bfc0bd",
  "gitSha": "e7b2f4bfc0bd47a4d4fed9936ceb77ce4bb07030",
  "createdAt": "2026-03-26T06:14:32Z",
  "schemaPlan": {
    "type": "bootstrap",
    "baselineId": "001_baseline.sql",
    "baselineSha256": "<hash>"
  },
  "services": {
    "api": {
      "image": "ghcr.io/andymolecule/agora-api@sha256:..."
    },
    "indexer": {
      "image": "ghcr.io/andymolecule/agora-indexer@sha256:..."
    },
    "worker": {
      "image": "ghcr.io/andymolecule/agora-worker@sha256:..."
    }
  },
  "healthContractVersion": "runtime-health-v1"
}
```

Rules:

- `releaseId` must be baked into the artifact and surfaced by health endpoints.
- `gitSha` must be baked into the artifact and surfaced by health endpoints.
- `schemaPlan.type` is one of:
  - `bootstrap`
  - `forward_migration`
  - `noop`
- shared environments must reject a manifest whose schema plan is incompatible
  with the requested command.

### 4.2 Runtime Identity in the App

Hosted runtime services must read release metadata from build-generated files or
OCI labels materialized into the container at build time.

Target state:

- no hosted runtime identity derived from platform-specific env probing
- no hosted runtime identity derived from local git at process start
- no hosted runtime fallback to `"dev"`

Local development may still synthesize `"dev"` when no build metadata exists.

### 4.3 Pipeline Stages

The runtime release pipeline has four durable stages plus smoke:

1. `build`
   - builds images
   - writes release manifest
   - runs unit/integration/build checks required before promotion
   - publishes artifacts
2. `bootstrap` or `deploy`
   - `bootstrap-testnet`: destructive environment creation/reset
   - `release-runtime`: non-destructive rollout from a manifest
3. `verify`
   - read-only verification against the manifest
   - checks release identity, canonical health, and worker fence alignment
4. `smoke`
   - read-only functional smoke against the deployed runtime release

Rules:

- `build` does not mutate shared environments
- `deploy` does not rebuild
- `verify` does not deploy
- `smoke` does not deploy or mutate schema
- each stage must be rerunnable without replaying previous stages

### 4.4 Service Deployment Ownership

For canonical shared environments:

- runtime releases come from CI-produced artifacts
- CI promotes explicit image digests
- local operator laptops are not the canonical deploy source
- dashboard configuration must not be the only place where required service
  build/start/deploy intent is documented

Target state:

- service release inputs are defined in repo code or generated manifests
- platform config is declarative or mechanically synced
- dashboard-only instructions become operational reference, not primary truth

### 4.5 Canonical Health Surface

`GET /api/health` must return one canonical hosted shape for runtime release
verification.

Minimum logical fields:

```json
{
  "ok": true,
  "service": "api",
  "releaseId": "rt_2026_03_26_e7b2f4bfc0bd",
  "gitSha": "e7b2f4bfc0bd47a4d4fed9936ceb77ce4bb07030",
  "checkedAt": "2026-03-26T06:35:39.379Z",
  "components": {
    "databaseSchema": {
      "ok": true
    }
  }
}
```

Rules:

- hosted CI and monitoring use `/api/health`
- worker detail remains under `/api/worker-health`
- indexer detail remains under `/api/indexer-health`
- `/healthz` must not have a divergent schema if it remains present during
  migration

### 4.6 Ingress Contract

Caller defaults:

| Caller | Default origin | Why |
|--------|----------------|-----|
| Browser session/auth traffic | Web origin proxy | Same-origin cookie and SIWE constraints |
| Browser app traffic | Web origin proxy | Simpler browser-origin consistency |
| CLI | API origin direct | Fewer layers, fewer proxy-specific failures |
| Agents | API origin direct | Bearer-token traffic does not need the web proxy |

Rules:

- the API remains the canonical remote machine surface
- the web proxy is a browser boundary, not a universal ingress boundary
- agent and CLI docs should stop treating the web origin as the primary API URL

### 4.7 Worker Fence Contract

Keep the current design direction:

- API declares the active runtime release fence
- worker heartbeats report their active runtime release
- stale workers may continue heartbeating but must not claim new jobs

Target refinement:

- the fence value should become the canonical `releaseId`
- `gitSha` remains diagnostic only

### 4.8 Error Boundary Contract

The API already has a top-level error boundary. The redesign keeps that model
and tightens classification.

Target rules:

- validation failures -> structured client-visible classified errors
- domain failures -> structured classified `AgoraError`s
- unexpected failures -> one consistent internal-error envelope with
  `x-request-id`
- platform rewrites must become rare instead of routine

---

## 5. Commands and Modes

Target command set:

- `pnpm runtime:build`
- `pnpm runtime:bootstrap:testnet`
- `pnpm runtime:deploy`
- `pnpm runtime:verify`
- `pnpm runtime:smoke`

Rules:

- there is no day-to-day `runtime vs clean` toggle
- destructive bootstrap is its own command
- steady-state deploy is its own command
- command behavior must match the manifest schema plan

Implementation note:

- replacing the current bash release controller with a typed TypeScript tool is
  the intended direction, because the release pipeline already behaves like a
  state machine and should be tested as one

---

## 6. Migration Plan

### 6.1 Phase 0: Spec Freeze

Objective:

- lock the architecture before more release-script drift

Actions:

1. lock this document
2. point `docs/README.md`, `docs/operations.md`, and `docs/deployment.md` at it
3. stop adding new hosted checks that rely on `/healthz`

Acceptance gates:

- one authoritative release-architecture doc exists
- deployment and operations docs defer to it for release boundaries

### 6.2 Phase 1: Health and Ingress Cleanup

Objective:

- remove split-truth boundaries without waiting for image-based deploy cutover

Actions:

1. standardize hosted monitoring and verification on `/api/health`
2. keep `/api/worker-health` and `/api/indexer-health` as detail routes
3. update CLI and agent docs to prefer the API origin directly
4. keep the web proxy only for browser-origin needs

Acceptance gates:

- hosted monitors and deploy verification no longer use `/healthz`
- agent-facing docs default to API origin direct

### 6.3 Phase 2: Artifact and Manifest Build

Objective:

- stop using source uploads as the canonical release unit

Actions:

1. build one immutable image per runtime service in CI
2. generate a release manifest
3. bake `releaseId` and `gitSha` into the artifact
4. remove hosted runtime fallback to `"dev"` for canonical releases

Acceptance gates:

- a runtime release can be redeployed from manifest without rebuilding source
- hosted API health reports `releaseId` and `gitSha` from baked metadata

### 6.4 Phase 3: Bootstrap Cutover

Objective:

- perform the one-time hard cleanup cutover for the redesigned runtime release
  path

Actions:

1. create the bootstrap command
2. reset the target testnet schema once
3. apply the baseline once
4. deploy the first manifest-driven runtime release
5. verify and smoke it end-to-end

Acceptance gates:

- the new shared testnet runs from manifest-driven artifacts
- the destructive path is no longer the default release path

### 6.5 Phase 4: Steady-State Runtime Releases

Objective:

- make normal fix iterations non-destructive and retriable

Actions:

1. promote manifest-driven deploy as the default path
2. remove the old runtime/clean toggle from day-to-day workflows
3. ensure verify and smoke are read-only and independently rerunnable
4. use forward migrations or no-op schema plans for steady-state changes

Acceptance gates:

- normal runtime releases do not reset the database
- deploy retries do not rebuild
- verify retries do not redeploy

### 6.6 Phase 5: Legacy Cleanup

Objective:

- delete compatibility paths that would otherwise reintroduce drift

Actions:

1. remove hosted `/healthz` dependencies from docs, workflows, and scripts
2. retire hosted runtime identity heuristics that are no longer needed
3. retire source-upload release scripts for shared environments
4. collapse duplicate release-verification logic

Acceptance gates:

- there is one normal release path
- there is one canonical hosted health contract
- there is one canonical runtime identity source

---

## 7. Explicit Keep List

Keep these concepts:

- `worker_runtime_state`
- `worker_runtime_control`
- explicit verify phase
- explicit smoke phase
- structured API error envelopes

These are not the source of the current flakiness and should be refined, not
removed.
