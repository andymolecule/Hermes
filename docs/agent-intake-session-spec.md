# Agent Intake Session Spec

Status: implemented on `main` for the direct web flow and the Beach/OpenClaw integration. `authoring_drafts` remains internal storage, but the public contract is session-first. Current implementation details live in [Beach Integration Guide](beach-integration.md) and [System Anatomy](system-anatomy.md).

## Purpose

This spec defines the cleaner public contract Agora should expose for agent-mediated challenge authoring:

- Beach/OpenClaw or the web frontend can start from rough context, partial structured fields, and files
- Agora owns the intake session, question generation, validation loop, compile gate, and publish gate
- Layer 2 is a schema-guided LLM intake validator
- Layer 3 is the deterministic compiler and scoreability gate
- direct file upload exists for both web and Beach/OpenClaw
- every bounty attempt is a new backend session
- `draft` stops being the product concept for Beach/OpenClaw, even if existing storage is reused internally during migration

The goal is not to make Agora creative. The goal is to make Agora the simplest, clearest, deterministic infrastructure path from rough source context to a publishable on-chain challenge.

## Product Rules

- Agora does not decide what bounty should exist. The poster or Beach agent does.
- Agora may ask targeted follow-up questions only to make the bounty publishable against scorer/runtime requirements.
- Agora should ask a short batch of canonical questions to reduce turn count and API cost.
- If required information is missing, Agora should say exactly what is missing.
- If the poster or agent does not have the missing information, the session should end as rejected.
- `publishable` means Layer 3 deterministic validation has passed.
- Publish must require explicit confirmation from the caller.
- One Beach thread may produce multiple distinct bounty sessions and challenges.
- Beach/OpenClaw should not need to manage Base wallets, USDC approvals, or gas for the default MVP flow.

## Intended User Journey

1. The caller starts a session with rough summary, optional structured fields, optional source messages, and optional files.
2. Agora normalizes the input and runs Layer 2 intake validation.
3. Agora returns a short batch of canonical questions if anything required is missing or ambiguous.
4. The caller answers only those questions and may add more files or context.
5. Agora reruns Layer 2, then runs Layer 3 deterministic compile and dry-run validation when enough information exists.
6. If Layer 3 passes, Agora returns `publishable` with a final checklist summary.
7. The caller explicitly confirms publish.
8. Agora publishes, persists the outcome, and returns the challenge refs.

## Public State Model

The public contract should expose only these states:

- `awaiting_input`
- `publishable`
- `rejected`
- `published`

Internal storage may keep richer workflow metadata, but the public API should not expose draft-state machinery unless it is strictly necessary.

## Canonical Session Shape

```ts
type IntakeSession = {
  id: string
  state: "awaiting_input" | "publishable" | "rejected" | "published"
  origin: {
    provider: "web" | "beach" | string
    externalThreadId?: string
    externalMessageId?: string
    externalUrl?: string
  }
  summary: string | null
  messages: Array<{
    id: string
    role: "user" | "assistant" | "system"
    content: string
    createdAt: string
  }>
  artifacts: Array<{
    id: string
    name: string
    mimeType: string | null
    sizeBytes: number | null
    cid: string
    uri: string
    purpose: "reference" | "evaluation" | "input" | "other"
  }>
  structuredFields: Record<string, unknown>
  missing: string[]
  questions: CanonicalQuestion[]
  reasons: string[]
  checklist: Array<{
    id: string
    label: string
    status: "missing" | "satisfied" | "failed"
    detail?: string
  }>
  compilation: {
    runtimeFamily?: string
    metric?: string
    passed: boolean
    blockingReasons: string[]
  } | null
  published: {
    challengeId?: string
    txHash?: string
    sponsorAddress?: string
    publishedAt?: string
  } | null
  createdAt: string
  updatedAt: string
}
```

## Canonical Question Shape

Questions should be server-owned, stable, and answerable without inventing a separate client contract.

```ts
type CanonicalQuestion = {
  id: string
  field: string
  kind: "text" | "number" | "boolean" | "select" | "multi_select" | "date" | "artifact"
  prompt: string
  required: boolean
  options?: Array<{
    value: string
    label: string
  }>
  why?: string
  examples?: string[]
}
```

## Canonical Answer Shape

The caller should answer questions by question id. Agora may still merge those answers back into a larger internal session record.

```ts
type SessionAnswerPayload = {
  answers: Array<{
    questionId: string
    value: unknown
  }>
  message?: string
  artifacts?: Array<{
    uploadId?: string
    uri?: string
    purpose?: "reference" | "evaluation" | "input" | "other"
  }>
}
```

## API Surface

### Direct Web

- `POST /api/authoring/sessions`
- `GET /api/authoring/sessions/:id`
- `POST /api/authoring/sessions/:id/respond`
- `POST /api/authoring/sessions/:id/publish`
- `POST /api/authoring/uploads`

### Beach Partner Surface

- `POST /api/integrations/beach/sessions`
- `GET /api/integrations/beach/sessions/:id`
- `POST /api/integrations/beach/sessions/:id/respond`
- `POST /api/integrations/beach/sessions/:id/webhook`
- `POST /api/integrations/beach/sessions/:id/publish`
- `POST /api/integrations/beach/uploads`

The Beach wrapper should stay thin. Shared orchestration belongs in the shared session engine, but `main` should only expose the Beach partner surface until another real partner needs a public contract.

## Layer Responsibilities

### Layer 2: LLM Intake Validator

Layer 2 should:

- normalize rough summary, messages, and structured fields
- compare them against the required scorer/runtime schema
- identify missing, ambiguous, or conflicting requirements
- generate a short batch of canonical questions
- avoid creative ideation or product steering

Layer 2 should not mark a session `publishable` on its own.

### Layer 3: Deterministic Compiler

Layer 3 should:

- resolve the authoring IR into a deterministic challenge spec
- validate runtime family, metric, artifact roles, and required contracts
- run dry-run or equivalent scoreability checks
- return pass or fail with explicit blocking reasons

Only Layer 3 can move a session to `publishable`.

## Upload Contract

Direct file upload should be a first-class path for both web and Beach/OpenClaw.

- caller uploads bytes to Agora using multipart
- Agora validates file size, mime type, and policy limits
- Agora pins the file to IPFS
- Agora returns canonical artifact refs that can be attached to the session

Public URL ingest may remain as a convenience path, but it should not be the primary Beach/OpenClaw model.

## Publish Contract

Publish should only succeed when:

- session state is `publishable`
- the caller provides explicit publish confirmation
- the deterministic publish preconditions still hold

The publish request should look conceptually like:

```json
{
  "confirmPublish": true
}
```

If the session is not publishable, Agora should reject the publish request and return the blocking reasons.

## Session Identity and Lineage

- every bounty attempt is a new backend session
- Beach thread ids may be stored as provenance metadata
- Beach thread ids should not deduplicate or refresh an existing unpublished session
- one Beach thread may create multiple sessions and multiple published challenges

This is important because each published challenge is a distinct deterministic contract deployment.

## Current Concept Mapping

| Current concept | Target concept |
|---|---|
| `draft` | `session` |
| `needs_input` | `awaiting_input` |
| source lineage refresh | new session per bounty attempt |
| Beach URL ingest | direct partner upload |
| full intent on submit | rough context plus optional partial structured fields |
| full payload resubmit | answer canonical questions by id |
| duplicated publishability flags | one publishability model driven by Layer 3 |

## Migration Strategy

### Phase 1: Change Public Behavior First

- add the new session-shaped routes
- accept rough or partial intake for Beach/OpenClaw
- add direct partner upload
- expose canonical questions and question-id answers
- keep using current storage if needed under the hood

### Phase 2: Simplify Internals

- treat existing `authoring_drafts` rows as internal session storage only
- stop exposing `draft` as the Beach/OpenClaw product concept
- remove Beach source-lineage refresh behavior from the public contract
- collapse duplicated Beach-specific orchestration into shared services

### Phase 3: Unify Web and External Hosts

- move the direct web flow onto the same session/question contract
- keep the server as the only LLM caller
- keep question generation and upload handling shared

### Phase 4: Remove Old Debt

- deprecate old draft-oriented Beach endpoints
- remove stale public semantics that expose draft lineage where session semantics are intended
- update docs so current-state and target-state docs do not conflict

## File-by-File Implementation Plan

### Shared Schemas

- `packages/common/src/schemas/managed-authoring.ts`
- `packages/common/src/schemas/authoring-source.ts`

Add session, question, answer, upload, and publish-confirmation schemas there. Keep shared types in `@agora/common`.

### Upload Routes

- add `apps/api/src/routes/authoring-uploads.ts`
- add `apps/api/src/routes/integrations-beach-uploads.ts`
- adapt the existing web upload path so web and Beach end in the same artifact contract

### Session Engine

- `apps/api/src/lib/authoring-intake-workflow.ts`
- `apps/api/src/lib/authoring-external-workflow.ts`
- `apps/api/src/lib/authoring-questions.ts`
- `apps/api/src/lib/managed-authoring-compiler.ts`

Split Layer 2 and Layer 3 responsibilities clearly. Make the session response the canonical public contract.

### Beach Contract

- `apps/api/src/lib/source-adapters/beach-science.ts`
- `apps/api/src/routes/integrations-beach.ts`

Beach should become a thin adapter over the generic session engine. It should not require full intent up front.

### Direct Web Contract

- `apps/web/src/app/post/post-authoring-api.ts`
- `apps/web/src/app/post/use-chat-stream.ts`
- `apps/api/src/routes/authoring-drafts.ts`

The web path should converge on the same server-owned session and question contract. Client heuristics should remain optional helpers, not the canonical intake engine.

### Publish and Callback Cleanup

- `apps/api/src/routes/authoring-drafts.ts`
- `apps/api/src/lib/authoring-sponsored-publish.ts`
- `packages/chain/src/indexer/settlement.ts`

Align callbacks and publish responses with the session model and the cleaner public states.

### Doc Cleanup

- `docs/beach-integration.md`
- `docs/system-anatomy.md`
- `docs/architecture.md`
- `docs/authoring-callbacks.md`

Current-state docs should remain explicit about what ships today. Future-state docs should describe only the target redesign.

## Definition of Done

This redesign is done only when all of the following are true:

- Beach/OpenClaw can start with rough context and optional structured fields
- Beach/OpenClaw can upload files directly to Agora
- Agora returns canonical server-owned question batches
- Beach/OpenClaw answers those questions by question id
- Agora reruns Layer 2 and Layer 3 on the server
- `publishable` means Layer 3 deterministic validation passed
- publish requires explicit confirmation
- every bounty attempt creates a new backend session
- the direct web flow uses the same session/question model
- current docs no longer describe Beach as a draft-lineage refresh model
- old draft-oriented Beach routes are deprecated or removed

## Anti-Debt Rule

This redesign is not complete if any of these remain true in the public contract:

- Beach still must send full intent up front
- Beach still lacks a direct upload path
- the old and new public contracts coexist without deprecation
- `draft` remains the user-facing Beach/OpenClaw concept
- source-lineage refresh still defines Beach bounty identity
- `publishable` can be returned before deterministic compile validation passes
