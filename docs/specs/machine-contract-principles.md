# Machine Contract Principles

> Status: LOCKED
> Scope: Machine-facing contract rules, scorer-registry rules, and migration
> guardrails for the next Agora cut.

---

## 0. Purpose

This document locks the design principles for the next Agora machine contract.

It exists to stop drift across:

- authoring session design
- submission/auth design
- scorer registry design
- worker execution design
- migration sequencing

If a future spec or implementation conflicts with this document, this document
wins unless it is explicitly replaced.

This is a hard-cutover spec set.

- There is no backward-compatibility requirement.
- There is no data-preservation requirement.
- Transitional compatibility layers should be avoided unless they remove a real
  implementation risk.

Delete old shapes instead of carrying them forward in parallel.

---

## 1. Terms

### 1.1 Challenge semantics

Fields that describe the challenge the caller wants Agora to run.

Examples:

- metric
- reward
- deadline
- distribution
- submission contract
- evaluation artifact binding
- submission privacy mode

### 1.2 Runtime mechanics

Fields that describe how Agora executes scoring internally.

Examples:

- template id
- scorer image
- mount file names
- runner limits
- runtime config file layout

### 1.3 Template registry

The immutable catalog of official scoring templates Agora can execute.

### 1.4 Execution plan

The fully resolved internal scoring contract persisted on the challenge and used
by the worker hot path.

---

## 2. Locked Principles

### 2.1 Public APIs describe challenge semantics, never runtime mechanics

Agents tell Agora what they want scored.

Agents do not choose:

- template ids
- Docker images
- mount layouts
- runner limits
- runtime env details

Those are internal derivations.

Derived runtime details may appear only in explicit audit/debug outputs where
they are needed for reproducibility. They must never be caller-controlled input.

### 2.2 Immutable template registry

The template registry is the single source of truth for what Agora can score.

It is consulted only during:

- authoring validation
- compile
- publish-time execution-plan construction

After publish, the worker hot path must rely only on the persisted execution
plan. It must not re-read the live template registry.

### 2.3 Zero runtime network dependencies

Publish and scoring must not depend on live GHCR tag resolution or similar
registry lookups.

Official scorer images are pinned in code as immutable digests.

Digest discovery and rotation happen in CI or release tooling, not on request
paths.

### 2.4 Self-describing validation

Every validation failure must be machine-correctable without documentation
lookups.

Validation responses must include:

- a stable code
- the failing field or path
- a clear message
- a next action
- candidate values when Agora knows the valid options

### 2.4A One semantic authority from intake through readback

For machine-facing flows, Agora must not accept looser semantic values and
reinterpret them later during compile or readback.

Rules:

- if `@agora/common` already defines a closed semantic set, create/patch
  assessment must validate against that canonical source before final compile
- a well-formed request with caller-correctable semantic mistakes returns a
  structured resource-state validation result, not an unhandled exception and
  not a transport-level `400`
- create and patch produce one authoritative assessment snapshot
- subsequent reads return that persisted snapshot instead of rebuilding
  validation from generic compile error codes or fallback heuristics

Agent reliability comes from one stable semantic contract, not from additional
interpreters or late inference layers.

### 2.5 Agent declares intent, Agora resolves execution

Routing from semantic request to execution runtime is fully internal.

Broadening the scoring surface means:

- adding or updating template-registry entries

It does not mean:

- expanding the public API with template ids
- exposing mount layouts
- adding per-template request flows

### 2.6 Each template owns its runtime contract

Every template defines its own:

- pinned scorer image
- supported metrics
- supported policies
- mount layout
- runner limits
- required artifact roles
- supported submission/evaluation contract kinds

There are no global runtime fallbacks that silently apply when a template does
not define a field.

### 2.7 Explicit over union

Resolution helpers must accept one input type and return one output type.

Avoid helper signatures like:

- `spec | row`
- `session | challenge`
- `template | inferred-template`

Branching should happen at the call site, not hidden inside generic resolver
helpers.

### 2.8 One route family per concern

Agora should have one active public route family per concern.

Examples:

- one authoring session route family
- one submission route family
- one agent auth route family

Do not keep old and new public flows alive in parallel once the replacement
contract is ready.

### 2.9 One success envelope and one error envelope

Machine-facing JSON APIs use one envelope shape.

Success:

```json
{
  "data": {}
}
```

Failure:

```json
{
  "error": {
    "code": "string",
    "message": "string",
    "next_action": "string|null",
    "details": {},
    "retriable": false
  }
}
```

Endpoint-specific bare objects are not allowed.

### 2.10 External writes are idempotent

Any externally retried write must be idempotent.

This applies especially to:

- authoring publish
- submission intent creation
- submission finalize/confirm
- cleanup endpoints

Retries must return the canonical existing result, not create ambiguity.

### 2.11 Fail fast on schema and dependency drift

If the runtime database schema or required local/runtime dependencies are not
ready, the service should fail health/readiness checks before user traffic hits
the broken path.

Missing tables, missing columns, or broken scorer runtime dependencies must not
first surface as opaque mid-flow 500s.

### 2.12 Sealed submission is the default privacy mode

When sealed submission support is configured, sealed submission is the default
challenge behavior.

Plain public payload submission is explicit opt-in, not the fallback default.

### 2.13 Simplicity beats compatibility

Because this migration has no backward-compatibility or data-preservation
constraint:

- prefer hard replacement over adapters
- prefer schema reset over compatibility glue
- prefer deleting stale code over wrapping it

Do not preserve obsolete shapes "just in case".

---

## 3. Immediate Consequences

These principles imply the following near-term design decisions:

1. Public authoring inputs stay semantic-only.
2. The scorer registry becomes a real immutable registry, not a partial helper.
3. GHCR request-path resolution is removed.
4. The worker consumes only `execution_plan_json`.
5. Submission finalize becomes idempotent and cleanup failures become warnings,
   not terminal ambiguity.
6. Submission privacy defaults switch to sealed mode.
7. Agent auth gains explicit introspection and stops forcing brittle
   re-registration flows.
8. Authoring create/patch gain one authoritative assessment boundary.
9. Wallet-funded publish confirmation reuses the shared
   challenge-registration path.
10. Closed semantic enums in `@agora/common` are tightened before smaller
    endpoint-specific cleanup.
11. Client-side preflights remain advisory; API validation stays authoritative.

---

## 4. Supersession Rule

The new spec set consists of:

- `docs/specs/machine-contract-principles.md`
- `docs/specs/authoring-validity-and-execution.md`
- `docs/specs/authoring-session-api.md`
- `docs/specs/submission-api.md`
- `docs/specs/machine-contract-migration.md`

If older authoring/session cutover documents conflict with this set, the newer
set wins.
