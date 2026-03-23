# Authoring Validity And Execution

> Status: Draft
> Scope: Core validity model and execution contract for authoring.
> Public session transport remains governed by `docs/specs/authoring-session-api.md`.

---

## 0. Purpose

This document locks the foundational rule for what makes an Agora challenge
valid.

This is intentionally separate from the session API spec.

- The session API spec defines how callers create, respond to, and publish
  sessions.
- This document defines what a session must converge to before it can become
  `ready`.

If this model is not explicit, the system drifts into:

- rigid hardcoded gates that reject business-valid challenges
- inconsistent routing between managed, semi-custom, and expert paths
- unclear reasoning about whether a challenge is invalid, incomplete, or just
  mapped to the wrong scorer lane

## 1. Core Principle

A challenge is valid only when it is:

1. objectively defined
2. deterministically scoreable
3. executable by Agora right now

There is no separate public notion of "valid in principle but not executable".

If Agora cannot execute the scorer contract now, the session is not valid and
cannot become `ready`.

## 2. Public Model

Agora should expose one public execution model, not multiple public authoring
"modes".

From the caller's perspective, every `ready` challenge resolves to one scoring
contract with:

- a scorer image
- one or more uploaded artifacts
- an explicit submission contract
- an explicit evaluation contract where relevant
- an explicit metric and comparator
- enough bindings and mappings for dry-run execution to pass

`managed`, `semi_custom`, and `expert` may still exist internally as authoring
or routing strategies, but they are not distinct public validity classes.

## 3. Ready Means Executable

`ready` means Agora has a fully resolved execution contract and a successful
dry-run.

That includes:

- all required artifacts bound
- all required hidden/public visibility decisions resolved
- all required column mappings resolved
- the scorer contract compiled successfully
- the dry-run executed successfully

Agora must not mark a session `ready` only because the problem appears
scoreable in theory.

## 4. Locked Decisions So Far

### 4.1 Validity Bar

The validity bar stays high.

Agora should widen execution capability, not lower the definition of validity.

### 4.2 Official Images Only

Only official Agora scorer images are allowed for the standard authoring flow.

The target direction is one broad official scorer template image that can adapt
to poster-defined contracts, instead of forcing most tasks through a small set
of rigid family-specific presets.

Current V1 candidate:

- `gems-tabular-scorer:v1`

`gems-generated-scorer:v1` is the generated-scorer runner and should remain
outside the primary V1 table-authoring path.

This does not yet require the repository to delete all other official images
immediately. It does lock the design direction: public authoring should converge
on broad official execution templates rather than a growing list of narrow hard
coded scorer families.

### 4.3 Explicit Mappings Always

For table-based challenges, the final execution contract must always carry
explicit mappings.

Examples:

- evaluation id column
- evaluation value column
- submission id column
- submission value column

These mappings may be inferred during authoring, but they must be explicit in
the resolved execution contract before `ready`.

The poster should use their own domain column names. Agora is responsible for
normalizing those names into the scorer contract.

### 4.4 Poster-Defined Artifact Visibility

The poster decides:

- which files are solver-visible
- which files are hidden evaluation data
- which files are optional supporting material

Agora should not force an unnecessarily rigid artifact taxonomy beyond what is
needed for deterministic execution.

Hard rule:

- at least one hidden evaluation artifact must exist for a publishable scored
  challenge

Without hidden evaluation data, Agora has nothing to compare solver submissions
against.

### 4.5 Recoverable vs Terminal Failures

Agora should use a simple rule:

- if the poster can fix it, stay in `awaiting_input`
- if the challenge cannot become executable under the current official scorer
  framework, return `rejected`

Examples that stay in `awaiting_input`:

- wrong column mapping
- wrong hidden/public artifact choice
- missing metric
- malformed evaluation file
- incomplete scorer configuration
- any other issue the poster can correct by answering follow-up questions or
  replacing files

Examples that may become `rejected`:

- the winner must be chosen by subjective human judgment
- the task is not objectively scoreable
- the task cannot be expressed by the current official execution framework even
  after clarification

Operational test:

- can the poster fix it? -> `awaiting_input`
- can nobody fix it within the current official execution framework? ->
  `rejected`

### 4.6 Comparator Derivation

The final execution contract should store comparator semantics, but Agora should
derive them automatically from the chosen metric whenever the direction is
unambiguous.

Examples:

- `spearman` -> `maximize`
- `ndcg` -> `maximize`
- `r2` -> `maximize`
- `accuracy` -> `maximize`
- `f1` -> `maximize`
- `rmse` -> `minimize`
- `mae` -> `minimize`

Agora should ask only when the metric does not imply a clear direction.

Design rule:

- do not ask the poster questions Agora can answer deterministically itself
- do not require the scorer to re-derive comparator semantics at execution time

Comparator is therefore:

- not a poster-authored field
- derived by Agora during authoring
- written explicitly into the compiled execution contract for that specific
  challenge

This is challenge-local configuration, not a global permanent setting.

### 4.7 First Cut Scope

The first cut of the redesigned execution model is table-based only.

V1 scope:

- CSV or equivalent structured table evaluation
- explicit id/value column mappings
- official Agora scorer image
- deterministic metric-based execution

Deferred:

- JSON record scoring
- bundle/code judging
- opaque file judging

Rationale:

- the flexible table scorer path covers the current benchmark-style science
  bounty needs
- one working execution path is better than several half-built paths
- expansion to other submission kinds can happen after the table path is proven
  end-to-end

### 4.8 One Hidden Evaluation Artifact In V1

V1 requires exactly one hidden evaluation artifact in the final execution
contract.

Rationale:

- the scorer container should take one hidden ground-truth table
- one hidden input keeps execution deterministic and easy to reason about
- multi-hidden-artifact scoring is a future scorer capability, not a V1
  authoring concern

Visible supporting artifacts may still exist, but they do not count as hidden
evaluation inputs.

### 4.9 One Broad Official Table Scorer Template

The public execution model should stop depending on user-facing concepts such as
`ranking`, `docking`, or `tabular_regression`.

Those may remain internal migration or compatibility concepts, but the target
public execution model is:

- one broad official table scorer template
- one hidden evaluation artifact
- one submission table contract
- one metric
- explicit column mappings

This broad official scorer template should be able to adapt to poster-defined
column names instead of forcing most challenges through a small set of rigid
predefined families.

Current direction:

- `gems-generated-scorer:v1`

### 4.10 Visible Artifacts Are Solver Context, Not Scorer Inputs

Visible artifacts are for solver context only.

Examples:

- candidate sets
- target structures
- descriptions
- public datasets
- submission guides

The scorer should not read visible artifacts in V1.

The scorer should only read:

- one hidden evaluation table
- the solver submission table
- metric semantics
- explicit column mappings

Design rule:

- visible artifacts help solvers work
- hidden evaluation artifact plus submission are the scorer inputs

### 4.11 One Hidden Evaluation Table Rule

The hidden evaluation artifact follows the same flexibility rule as the solver
submission table.

V1 requires:

- exactly one hidden evaluation table artifact
- one explicit `evaluation_id_column`
- one explicit primary `evaluation_value_column`
- any other required evaluation columns listed explicitly when needed

Agora must not force fake generic names like `id` and `label` on posters.

The poster should be able to declare domain-native names such as:

- `peptide_id`
- `reference_rank`
- `reference_score`

Extra columns are allowed by default and ignored by the scorer unless the
execution contract explicitly says otherwise.

### 4.12 Metric Support Comes From The Official Scorer, Not A Hardcoded Public Whitelist

Agora should not define challenge validity by a small hardcoded public metric
list.

The rule is:

- if the poster defines an objective deterministic metric
- and the chosen official scorer template version can execute it
- and the dry-run passes

then the challenge is valid.

If the scorer cannot execute the requested metric yet, the session stays in
`awaiting_input` unless the challenge is fundamentally non-scoreable. The poster
may:

- choose a different metric, or
- wait until Agora adds support for that metric later

Dry-run is the real validation gate, not a rigid legacy preset enum list.

V1 still needs one internal source of truth for scorer capabilities. That
source of truth should be the chosen official scorer template version, not the
old family-era registry.

### 4.13 Canonical Scorer Container Contract

The broad official table scorer should execute against one simple contract:

- one hidden evaluation table
- one solver submission table
- one config object describing how to score them
- one score output

Conceptually:

```text
/input/ground_truth.csv
/input/submission.csv
/input/config.json
  {
    "metric": "...",
    "comparator": "...",
    "evaluation_id_column": "...",
    "evaluation_value_column": "...",
    "submission_id_column": "...",
    "submission_value_column": "..."
  }

/output/score.json
  { "score": 0.92 }
```

The scorer does not need to know whether the challenge was previously called
`ranking`, `docking`, or `tabular_regression`.

It only needs:

- the two input tables
- the resolved metric/comparator
- the resolved column mappings

### 4.14 Legacy Runtime Family Labels Are Replaced In The New Path

The redesigned public authoring path should fully replace old user-facing family
labels such as:

- `ranking`
- `docking`
- `tabular_regression`
- `tabular_classification`
- `reproducibility`

These are internal historical concepts, not the target public execution model.

The new path should converge on:

- one broad official table scorer template
- one execution contract
- one dry-run validation rule

There is no data-preservation or backward-compatibility requirement forcing the
new path to preserve those labels as public concepts.

## 5. Execution Contract Shape

The resolved execution contract must be capable of expressing:

- scorer image
- metric
- comparator
- submission kind
- exactly one hidden evaluation artifact binding in V1
- zero or more visible supporting artifacts
- explicit submission column mapping
- explicit evaluation column mapping
- any required deterministic evaluation policy

This contract is the thing Agora actually executes.

### 5.2 V1 Hidden Evaluation Table Rule

V1 should require one hidden evaluation table artifact.

That contract must declare:

- required columns
- one explicit `evaluation_id_column`
- one explicit primary `evaluation_value_column`

Extra columns are allowed by default and ignored by the scorer unless the
execution contract explicitly says otherwise.

Design rule:

- require only what deterministic scoring actually needs
- do not reject evaluation tables merely because they include extra columns
- do not force posters to rename domain-native columns into generic placeholder
  names

### 5.3 V1 Scorer Execution Contract

The V1 table scorer should execute one normalized contract with:

- `scorer_image`
- `metric`
- `comparator`
- `evaluation_artifact_uri`
- `submission_contract`
- `evaluation_id_column`
- `evaluation_value_column`
- `submission_id_column`
- `submission_value_column`

Optional future fields may exist later, but these are the V1 minimum.

### 5.3.1 V1 Comparison Semantics

The V1 scorer contract is not an open-ended poster-defined comparison model.

It is fixed and deterministic:

- join solver submission rows to hidden evaluation rows using the resolved id
  columns
- compare one primary submission value column against one primary evaluation
  value column
- compute one metric
- interpret the result using one comparator

So V1 scoring semantics are:

- one id join
- one value-to-value comparison
- one metric
- one comparator

The poster does not define comparison semantics beyond:

- which file is the hidden evaluation table
- which file is the solver submission table
- which columns are the id/value columns
- which metric to use

Everything else is defined by the official scorer image and the resolved
execution contract.

### 5.4 Execution Contract Transparency

The resolved execution contract should expose all first-class scoring fields to
the poster and agent caller.

That includes:

- `metric`
- `comparator`
- `scorer_image`
- `evaluation_id_column`
- `evaluation_value_column`
- `submission_id_column`
- `submission_value_column`
- `required_submission_columns`

The scorer image must remain visible.

Rationale:

- public official scorer images are part of Agora's trust model
- solvers should be able to inspect the exact scoring implementation before
  deciding to compete
- the poster should be able to verify the exact execution contract before
  publish

Design rule:

- do not hide the scoring contract from legitimate participants in the flow
- transparency beats implicit scorer behavior

### 5.1 V1 Submission Table Rule

V1 should require one solver submission table artifact.

That contract must declare:

- required columns
- one explicit `id_column`
- one explicit primary scored `value_column`

Agora must not impose a fake "two-column only" rule.

The poster may include additional columns when useful, such as:

- rank
- confidence
- annotations
- notes
- domain-specific metadata

Extra columns are allowed by default and ignored by the scorer unless the
execution contract explicitly says otherwise.

Design rule:

- require only what deterministic scoring actually needs
- do not reject solver submissions merely because they include extra columns

## 6. Reject vs Awaiting Input

Recoverable execution mismatches stay in `awaiting_input`.

Terminal `rejected` is reserved for problems that cannot become executable under
the current official scorer framework.

This is a hard rule, not a suggestion.

### 6.1 V1 Routing Boundary

In V1, Agora should keep asking while the challenge can still be reduced to:

- one solver submission table
- one hidden evaluation table
- one deterministic metric
- one concrete scoring comparison

Stay in `awaiting_input` when the poster still needs to provide or fix:

- metric choice
- column mapping
- hidden/public artifact decisions
- evaluation file format
- other scorer configuration details

Move to `rejected` only when the challenge fundamentally cannot be reduced to
deterministic table scoring under the current official framework.

Examples:

- subjective human judging
- "most creative" or "best written" evaluation
- workflows that require executing arbitrary solver code in V1

## 7. Relationship To Existing Systems

This spec locks the target direction for the new path:

- one public execution contract
- explicit mappings
- official scorer images
- `ready` only after real dry-run execution

The old public family-style authoring model should not survive as the primary
public abstraction.

Implementation may still need migration steps internally, but the design target
is consolidation into the single broad table-scorer path described here.

## 8. Target System Design

The cleanest target system is one explicit table-scoring contract from
authoring through execution.

Agora should stop treating authoring as "map this idea to one of several rigid
runtime families" and instead treat authoring as "fill one deterministic table
scoring contract until it is executable".

### 8.1 One Public Execution Contract

The public authoring target is one contract:

- one official scorer image
- one hidden evaluation table
- one solver submission table
- one metric
- one derived comparator
- one explicit set of column mappings
- optional visible supporting artifacts

That contract should be the public source of truth for what Agora will execute.

Internally, Agora may still keep a very small official scorer-template registry
so it knows which image digest and capability set correspond to the selected
execution template version.

That is not the same thing as reintroducing many public runtime families.

### 8.2 Canonical V1 Contract Shape

The resolved V1 execution contract should expose at least:

- `version`
- `template`
- `scorer_image`
- `metric`
- `comparator`
- `evaluation_artifact_uri`
- `evaluation_columns.required`
- `evaluation_columns.id`
- `evaluation_columns.value`
- `evaluation_columns.allow_extra`
- `submission_columns.required`
- `submission_columns.id`
- `submission_columns.value`
- `submission_columns.allow_extra`
- `visible_artifact_uris`
- `policies.coverage_policy`
- `policies.duplicate_id_policy`
- `policies.invalid_value_policy`

Conceptually:

```json
{
  "version": "v1",
  "template": "official_table_metric_v1",
  "scorer_image": "ghcr.io/.../gems-tabular-scorer:v1",
  "metric": "spearman",
  "comparator": "maximize",
  "evaluation_artifact_uri": "ipfs://...",
  "evaluation_columns": {
    "required": ["peptide_id", "reference_rank"],
    "id": "peptide_id",
    "value": "reference_rank",
    "allow_extra": true
  },
  "submission_columns": {
    "required": ["peptide_id", "predicted_score"],
    "id": "peptide_id",
    "value": "predicted_score",
    "allow_extra": true
  },
  "visible_artifact_uris": ["ipfs://..."],
  "policies": {
    "coverage_policy": "ignore",
    "duplicate_id_policy": "ignore",
    "invalid_value_policy": "ignore"
  }
}
```

This is the contract Layer 3 validates and the scorer image executes.

### 8.3 Authoring Pipeline

The clean target pipeline is:

1. caller sends rough challenge intent and files
2. Layer 2 infers any deterministic fields it can
3. Layer 2 asks only for unresolved execution-contract fields
4. Layer 3 resolves a concrete execution contract
5. Layer 3 dry-runs the official scorer image against that contract
6. if dry-run passes, session becomes `ready`
7. if the poster can fix any missing or malformed field, stay in
   `awaiting_input`
8. reject only when the challenge fundamentally cannot be expressed as
   deterministic table scoring under the current official framework

### 8.4 Layer Responsibilities

Layer 2 should do only:

- infer likely metric/comparator when possible
- infer likely hidden versus visible file roles when obvious
- infer likely id/value columns when obvious
- ask for unresolved fields in machine-friendly questions
- explain blockers and minimum fixes clearly

Layer 2 should not decide challenge validity by old family-era labels.

Layer 3 should do only:

- normalize the resolved execution contract
- validate artifact bindings
- validate column mappings and required columns
- derive comparator from metric when deterministic
- build the compiled challenge spec
- run dry-run execution
- produce a concrete success or blocker result

### 8.5 Smallest Clean Cutover

The lowest-entropy implementation is not to invent a new execution system.

The repository already has a partial structured-table execution path in the
semi-custom evaluator contract and `official_table_metric_v1` execution
template.

So the smallest clean cutover is:

1. stop using old managed preset selection as the primary authoring
   target
2. make structured-table execution through the broad official scorer template
   the default authoring target
3. have Layer 2 fill the explicit table execution contract instead of choosing
   `ranking`, `docking`, or `tabular_regression`
4. have Layer 3 compile that contract into the existing executable structured
   table path
5. keep any legacy preset-handling only as temporary internal migration
   glue, not as the public or primary design

This reuses existing scorer-runtime and semi-custom machinery instead of
creating another abstraction layer.

For V1, the primary execution template should map to the existing tabular
scorer path, not the generated-scorer runner.

### 8.6 What Should Be Removed

The new path should remove these concepts from public authoring:

- user-facing family-era labels
- rigid family-specific artifact role taxonomies as the primary abstraction
- public dependence on fixed generic column names such as `id` and `label`
- rejection just because a challenge missed one legacy family preset

The new path should replace them with:

- one explicit execution contract
- explicit column mappings
- one hidden evaluation artifact binding
- one submission contract
- one official table scorer dry-run

## 9. Replacement Architecture

This redesign should be implemented as a real replacement of the old public
authoring model, not as a compatibility wrapper that keeps the old mental model
alive underneath.

Design rule:

- if a concept exists only to preserve the old family-based model, remove it
- if a concept directly serves the single table-execution contract, keep it

### 9.1 Target Modules

The clean target system should converge on five focused modules.

#### `execution-template.ts`

Defines the official scorer template used by standard authoring.

Responsibilities:

- template id
- pinned official scorer image
- supported metric capability set
- supported runtime policy set
- mount names
- default resource limits

V1 target:

- one template: `official_table_metric_v1`

This replaces the old multi-family runtime registry as the primary source of
truth.

#### `execution-contract.ts`

Defines the canonical resolved contract Agora executes.

Responsibilities:

- table scorer contract schema
- evaluation column mapping
- submission column mapping
- required columns
- policies
- scorer image reference
- comparator

This replaces public dependence on the old family-id field.

#### `authoring-assessor.ts`

Layer 2 field extraction and missing-field logic.

Responsibilities:

- infer deterministic fields from intent and uploaded file headers
- ask for only unresolved execution-contract fields
- never classify into legacy runtime families
- never expose family-style labels in public authoring responses

#### `authoring-compiler.ts`

Layer 3 normalization and validation.

Responsibilities:

- normalize resolved execution contract
- validate hidden/public artifact binding
- validate mapped columns
- derive comparator from metric
- build compiled challenge spec
- run dry-run
- return `ready`, `awaiting_input`, or `rejected`

#### `challenge-spec.ts`

Stores the resolved execution contract directly.

Responsibilities:

- validate the explicit execution contract
- validate scorer template/image
- validate reward/deadline/distribution
- expose the exact scorer configuration that will execute

### 9.2 Target Public Shape

The public compiled spec should stop centering the old family-id field.

The design target is:

- `evaluation.metric`
- `evaluation.comparator`
- `evaluation.scorer_image`
- `evaluation.template`
- `evaluation.execution_contract`

Where `evaluation.execution_contract` contains:

- hidden evaluation artifact binding
- evaluation columns
- submission columns
- policies

Public authoring should speak in terms of:

- metric
- hidden evaluation file
- submission table
- column mappings
- scorer image

Not:

- family-era label
- evaluator archetype
- managed versus semi-custom mode

### 9.3 What Should Be Deleted

The clean end state should delete or fully retire these as primary public
authoring concepts:

- public family-era labels
- family-specific artifact-role taxonomies as the primary authoring abstraction
- family-based metric validation
- family-based dry-run branches
- family-based compile prompts
- family-based default submission contracts

Examples in the current codebase that should not survive as the primary model:

- the family-switch model in
  `/Users/changyuesin/Agora/apps/api/src/lib/managed-authoring-artifacts.ts`
- the family classifier contract in
  `/Users/changyuesin/Agora/apps/api/src/lib/managed-authoring-compiler.ts`
- public family validation as the primary path in legacy scorer registries

### 9.4 What Can Stay

These pieces can stay if repointed to the new model:

- the current official tabular scorer image
- scorer-runtime config schema
- dry-run execution machinery
- challenge canonicalization and digest resolution
- session transport contract
- reward/distribution/deadline/session lifecycle rules

The existing structured-table semi-custom execution path is useful only as an
implementation bridge into the new model. It should not remain a second public
concept once the new path is complete.

## 10. Refactor Blueprint

The implementation should proceed in a way that lands the intended system
directly, not by layering new abstractions on top of the old ones.

### 10.1 Step 1: Introduce The New Core Types

Create:

- `packages/common/src/schemas/execution-template.ts`
- `packages/common/src/schemas/execution-contract.ts`

Move into these files:

- official table template definition
- official image reference
- supported metric capability set
- supported policy capability set
- explicit resolved execution-contract schema

Do not carry over:

- `ranking`
- `docking`
- `tabular_regression`
- `tabular_classification`
- `reproducibility`

as first-class design inputs.

### 10.2 Step 2: Replace Layer 2 Family Classification

Replace the current family-mapping behavior with field extraction.

Layer 2 should return:

- `outcome`
- `metric`
- `evaluation_artifact`
- `evaluation_id_column`
- `evaluation_value_column`
- `submission_id_column`
- `submission_value_column`
- `visible_artifacts`
- `missing_fields`
- optional inferred policies

It should not return:

- `legacy_family_id`
- family-specific artifact roles

### 10.3 Step 3: Replace Family-Based Artifact Assignment

Replace family-role inference with direct execution-contract binding.

The compiler should resolve:

- which uploaded file is the one hidden evaluation table
- which files remain visible context
- which columns are mapped into scoring

If obvious, infer.
If ambiguous, ask.

No family-specific switch is needed.

### 10.4 Step 4: Replace Family-Based Dry-Run Construction

Dry-run should become one path:

1. read hidden evaluation table
2. read execution-contract mappings
3. build a sample submission table from the mapped columns
4. write one runtime config
5. run the official table scorer

This should replace per-family dry-run branching.

### 10.5 Step 5: Replace Challenge Spec Evaluation Shape

`challenge-spec.ts` should stop validating the primary public path through
legacy family-id fields.

The primary public path should validate:

- execution template id
- scorer image
- metric
- comparator
- execution contract

Legacy family-oriented fields should be removed from the new primary path, not
hidden behind adapters.

### 10.6 Step 6: Delete Old Public Family Concepts

After the new path is wired end-to-end:

- delete old family prompts
- delete old family artifact switches
- delete old family dry-run branches
- delete old public family references from docs and API examples

The only remaining family-era logic should be code that still serves another
non-authoring purpose. If it does not serve a live purpose, remove it.

## 11. Anti-Goals

The redesign should explicitly avoid:

- preserving family-based public abstractions for comfort
- adding a second new abstraction layer on top of semi-custom and managed
- keeping multiple public execution modes that mean the same thing
- treating transition convenience as a reason to keep conceptual debt
- broadening validity without executable dry-run proof

## 12. Final Design Principle

The target system is:

- one public execution model
- one official table scorer template in V1
- one explicit execution contract
- one Layer 2 field-completion loop
- one Layer 3 validation and dry-run path

This is cleaner than "managed families plus semi-custom fallback" and cleaner
than "three modes with hidden overlap".

The right replacement is not a better wrapper around the old model.

It is a smaller model.
