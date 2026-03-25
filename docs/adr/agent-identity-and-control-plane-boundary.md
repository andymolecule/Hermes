# ADR: Agent Identity And Control-Plane Boundary

## Status

Accepted

## Context

Recent agent workflow audits exposed three recurring failure modes:

- agent-facing contracts drift from the API implementation
- workflow identifiers are fragmented across UUIDs, contract addresses, factory ids, and on-chain submission ids
- local agent workflows depend on internal control-plane state (Supabase, indexer freshness, metadata reconciliation) for actions that should primarily depend on the API and chain

These are boundary problems, not isolated route bugs. If they are not corrected now, future feature work will keep adding glue code across CLI, API, worker, and DB projections.

## Decision

- The API remains the canonical remote agent surface.
- The CLI remains the canonical local execution surface.
- `@agora/agent-runtime` may depend on API, chain, IPFS, and scorer packages, but must not depend on Supabase for solver-facing workflows.
- On-chain references are the protocol truth:
  - challenges: `challengeAddress` plus `factoryChallengeId`
  - submissions: `challengeAddress` plus `onChainSubmissionId`
- UUIDs remain useful, but only as projection aliases minted and served by the API.
- Agent-facing command and tool outputs must carry both:
  - the projection id when available (`challengeId`, `submissionId`)
  - the protocol id (`factoryChallengeId`, `onChainSubmissionId`, `challengeAddress`)
- Registration must be explicit and idempotent:
  - post: chain write first, then API registration
  - submit: API intent first, then chain write, then API confirmation
  - both flows return `registrationStatus: confirmed | confirmation_pending`
- Queue state is advisory for scheduling, not authoritative for settlement finality. Once the contract is finalizable, stale control-plane state must not block settle and claim forever.
- We will reduce boundary duplication before any package reshuffle. Do not split apps/packages until the API, CLI, and runtime seams are clean.

## Consequences

- Solver-facing submit no longer requires direct DB access or a service key.
- CLI post and submit become continuous lifecycle entrypoints instead of chain-only wrappers.
- API route schemas need direct contract tests so response drift fails in CI.
- Future work should consolidate duplicate remote read surfaces instead of expanding them.

## Implementation Plan

### Phase 0: Contract hardening

- Fix schema mismatches on agent-facing endpoints.
- Make submit outputs explicit about `submissionId` vs `onChainSubmissionId`.
- Make post outputs explicit about `challengeId` vs `factoryChallengeId`.
- Add parser tests for every shared agent-facing response contract.

### Phase 1: Boundary cleanup

- Route solver-facing `submit` through API challenge lookup instead of direct Supabase reads.
- Route CLI `post` through API registration after the chain receipt is confirmed.
- Remove startup checks that unnecessarily disable local preview or API-driven workflows.

### Phase 2: Identity continuity

- Add or formalize API lookups by protocol refs where needed.
- Ensure challenge and submission responses always include both projection ids and protocol ids.
- Make registration failure states and unmatched on-chain submissions explicit, documented, and operationally visible instead of relying on silent recovery paths.

### Phase 3: Settlement decoupling

- Change auto-finalize so protocol-finalizable challenges cannot be deadlocked forever by stale queued/running jobs.
- Treat stuck queue state as a recoverable worker concern, not a settlement gate.

### Phase 4: Surface consolidation and deduplication

- Converge duplicated remote read surfaces onto one canonical API namespace and policy model.
- Reuse `packages/scorer/src/oracle-score.ts` from the CLI instead of maintaining a second official scoring implementation.
- Only after the boundaries are stable, revisit package/app extraction candidates such as worker split, `scorer-runtime`, or `@agora/common` slimming.

## Guardrails

- Prefer explicit DTO mappers over passing raw DB rows through API responses.
- Prefer additive compatibility fields only when they buy a real migration path.
- Do not invent abstractions for future transport modes or identity schemes that do not exist yet.
- If a new feature needs DB access from `@agora/agent-runtime`, the default answer is no.
