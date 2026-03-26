# ADR: Authoring Session Assessment Boundary

## Status

Proposed

## Context

Agora already locked the public authoring contract as:

- one machine-first route family: `/api/authoring/sessions/*`
- structured create and patch payloads
- deterministic validation before publish
- session states: `awaiting_input`, `ready`, `published`, `rejected`, `expired`
- no assistive or conversational default path

Those rules are already established in:

- `docs/specs/machine-contract-principles.md`
- `docs/specs/authoring-session-api.md`
- `docs/challenge-authoring-ir.md`

The current reliability bug class is not a missing product decision. It is an
implementation-boundary mismatch.

Today, some semantic fields are accepted too loosely at session intake and only
validated later during compile against stricter canonical challenge-spec
schemas. Public validation is then partially reconstructed from lossy internal
IR fields such as:

- `assessment.missing_fields`
- `execution.compile_error_codes`
- `execution.compile_error_message`

That creates three failure modes:

1. a caller-correctable semantic value can pass session intake and fail later in
   compile
2. the failure can escape as an unhandled exception instead of a structured
   `awaiting_input` result
3. even when compile returns a structured failure, the public session payload
   can lose the original field-level classification when validation is rebuilt
   from generic error codes

The `domain = "biology"` incident is one example of this class. The public
contract did not fail. The write-path boundary did.

## Decision

### 1. Keep the public authoring contract unchanged

Do not add:

- a new route family
- a new public session state
- a new assistive authoring mode in the default path
- runtime-mechanics inputs such as template ids or scorer images

The current public machine contract remains authoritative.

### 2. Separate transport validation from semantic assessment

`POST /sessions` and `PATCH /sessions/:id` keep permissive transport parsing for
machine-supplied partial state.

Transport parsing is responsible only for:

- JSON shape
- field presence where the envelope requires it
- primitive formatting that is truly transport-level

Semantic authoring validation is not the job of the raw HTTP body parser.

Reason:

For session flows, a caller-correctable semantic value should become
`state = "awaiting_input"` with structured `validation.invalid_fields`, not a
top-level `400 invalid_request`, as long as the request envelope itself is well
formed.

### 3. Introduce one authoritative assessment step for create and patch

Create and patch must share one deterministic assessment boundary:

```text
transport parse
-> merge current structured state
-> assess authoring semantics
-> persist resulting session snapshot
-> return that same snapshot
```

This assessment step is authoritative for:

- `resolved`
- `validation`
- `readiness`
- `compilation` eligibility
- whether the session remains `awaiting_input`, becomes `ready`, or becomes
  `rejected`

No later layer in the create/patch path may reclassify a caller error into a
different field category.

### 4. Validate closed semantic sets at assessment time, not only at compile time

For any authoring field whose valid values are already canonical and finite in
`@agora/common`, the shared authoring assessment must validate against that
canonical source before final compile.

Current scope includes `domain`.

Rules:

- missing value -> `validation.missing_fields`
- present but unsupported value -> `validation.invalid_fields`
- known valid value -> continue through compile

Agora still does not choose the value on the caller's behalf.

### 5. Caller-derived assessment must not throw

In the create/patch assessment path:

- do not use `.parse()` on caller-derived or caller-influenced semantic state
- use `.safeParse()` or equivalent structured validation
- convert failures into deterministic field-level validation issues

Throws are reserved for true invariant breaks or platform faults that are not
caller-correctable.

### 6. Persist exact validation outcome, not only lossy compile hints

The session aggregate must durably retain the exact field-level validation
result produced during assessment.

It is not sufficient to store only:

- missing field names
- a generic compile error code
- a generic compile error message

The durable session state must retain enough structure to reproduce the public
session response without heuristic field remapping.

At minimum, the aggregate must preserve:

- invalid field issues
- missing field issues
- dry-run failure when present
- unsupported reason when present

This can live inside the existing session aggregate. It does not require a new
public contract.

### 7. Public reads return the persisted assessment result

`GET /sessions/:id` and other canonical session reads must use the persisted
assessment outcome as their source of truth for `validation`.

Do not reconstruct field classification from:

- generic compile error codes
- generic compile error messages
- fallback heuristics like "unknown compile error means field = execution"

Derived read helpers may still build human summaries, but not re-decide machine
validation categories.

### 8. Preserve the locked error-envelope boundary

Top-level error envelopes remain for:

- malformed request envelopes
- unauthorized access
- not found
- expired session mutation attempts
- publish-time revert handling
- real platform or internal failures

Caller-correctable authoring semantics belong in the session object, not the
top-level error envelope, whenever the request envelope itself is valid.

## Consequences

- Invalid semantic values such as unsupported domains become deterministic
  `awaiting_input` session results.
- The API stops collapsing caller-correctable issues into opaque `500` or edge
  `503` failures.
- Public validation stays stable across create, patch, and subsequent get
  calls.
- The route family, state machine, and machine-facing response envelope remain
  unchanged.

## Implementation Order

1. Fix authoring semantic authority first.
2. Unify sponsor publish with shared challenge registration.
3. Tighten canonical semantic schemas across `@agora/common`.
4. Finish smaller cleanup such as query-schema tightening and advisory client
   preflight alignment.

## Guardrails

- Do not add a second public authoring flow.
- Do not move template ids or scorer images into public authoring inputs.
- Do not reintroduce assistant-message or conversational turns into the default
  session contract.
- Do not rely on compile-time exceptions to classify caller input.
