# Authoring Validity And Execution

> Status: Draft
> Scope: Core validity model and execution contract for authoring.
> Public session transport remains governed by `docs/specs/authoring-session-api.md`.

---

## 0. Purpose

This document locks the foundational rule for what makes an Agora challenge
valid.

This is intentionally separate from the session API spec.

- The session API spec defines how callers create, patch, and publish
  sessions.
- This document defines what a session must converge to before it can become
  `ready`.

If this model is not explicit, the system drifts into:

- rigid hardcoded gates that reject business-valid challenges
- inconsistent routing between legacy preset selection, execution-template
  resolution, and expert fallbacks
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

Internal routing stages may still exist while Agora resolves missing fields or
determines that a custom evaluator is required, but they are not distinct
public validity classes.

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

## 3.1 Naming Contract

This spec also locks the canonical naming model for the authoring system.

### Public Terms

These are the terms callers and solver-facing surfaces should use:

- `authoring session`
- `execution template`
- `execution contract`
- `table scorer`
- `awaiting_input`
- `ready`
- `rejected`
- `published`

Public authoring should not expose family-era labels such as:

- `ranking`
- `docking`
- `tabular_regression`
- `tabular_classification`
- `managed`
- `semi_custom`
- `expert`

Those may exist as implementation history or future internal routing concepts,
but they are not part of the canonical public authoring vocabulary.

### Internal Layer Terms

The internal layer names are:

- `authoring assessor` = Layer 2
- `authoring compiler` = Layer 3

Layer responsibilities:

- the assessor interprets caller input, infers deterministic fields when
  possible, and identifies unresolved fields
- the compiler validates the resolved execution contract, binds artifacts,
  builds the challenge spec, and executes the dry-run

### Canonical Engine Terms

The active deterministic engine modules should use these names:

- `authoring-compiler`
- `authoring-ir`
- `authoring-dry-run`
- `authoring-artifact-resolution`
- `authoring-checklist`

If an explicit assist path is added later, it should be treated as a separate
assist surface, not part of the active deterministic engine.

### Deprecated Legacy Terms

The following terms are deprecated and should be removed from the active path:

- `managed authoring`
- `managed-authoring-*`
- `MANAGED_*` error codes where the error is part of the active session engine
- `managed compiler` when referring to Layer 2

If legacy names remain temporarily in archival docs or historical notes, they
should be treated as documentation debt, not canonical terminology.

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
- any other issue the poster can correct by submitting structured field patches or
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

- do not require extra caller input for anything Agora can derive deterministically itself
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

- `gems-tabular-scorer:v1`

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

## 5. Canonical V1 Model

The clean target is one canonical execution model from authoring through worker
runtime.

That means:

- one official scorer catalog as the only source of truth for official runtime
  capability
- one challenge-level execution object as the only source of truth for what the
  scorer runs
- one submission contract as the only source of truth for what solvers upload
- one DB execution plan cache derived from the challenge-level execution object
- zero mirrored copies of template, metric, comparator, or scorer image across
  nested objects

### 5.1 Standard V1 Scope

Standard authoring in V1 means:

- one broad official table scorer template
- one hidden evaluation table artifact
- one solver submission table contract
- one metric
- one derived comparator
- explicit column mappings

Current standard-authoring runtime:

- template id: `official_table_metric_v1`
- scorer image family: `ghcr.io/andymolecule/gems-tabular-scorer`

Other scorer containers may still exist in the repository as experiments or
future work, but they are not part of the active official authoring/runtime
model unless they have an entry in the official scorer catalog.

### 5.2 One Official Scorer Catalog

The split between:

- image whitelist
- execution-template registry
- semi-custom template-to-image maps

should be removed.

Agora should keep one catalog of official scorer templates. If a runtime is not
in that catalog, it is not part of the official scoring contract.

Target ownership:

- one file owns template id, image, supported metrics, mount, limits, and
  policy capability
- release verification, authoring validation, worker preflight, and digest
  resolution all read from that same file
- no separate "bouncer list" is allowed

### 5.3 Canonical Challenge Spec Shape

The challenge spec should stop storing execution identity twice.

The target active schema is:

```ts
type ChallengeSpecV4 = {
  schema_version: 4;
  id: string;
  title: string;
  domain: ChallengeDomain;
  type: ChallengeType;
  description: string;
  execution: {
    version: "v1";
    template: "official_table_metric_v1";
    scorer_image: string; // pinned digest
    metric: string;
    comparator: "maximize" | "minimize";
    evaluation_artifact_uri: string;
    evaluation_contract: {
      kind: "csv_table";
      columns: {
        required: string[];
        id: string;
        value: string;
        allow_extra: boolean;
      };
    };
    policies: {
      coverage_policy: "ignore" | "reject" | "penalize";
      duplicate_id_policy: "ignore" | "reject";
      invalid_value_policy: "ignore" | "reject";
    };
  };
  artifacts: ChallengeArtifact[];
  submission_contract: SubmissionContractV1;
  reward: ChallengeReward;
  deadline: string;
  minimum_score?: number;
  dispute_window_hours?: number;
  max_submissions_total?: number;
  max_submissions_per_solver?: number;
  tags?: string[];
  lab_tba?: string;
  source?: ChallengeSource;
};
```

Rules:

- `execution` is the only execution source of truth in the spec
- `submission_contract` is the only solver-submission source of truth
- `artifacts` is the only artifact-visibility source of truth
- visible artifact URIs are derived from `artifacts`, not copied into
  `execution`
- `execution` must not contain a second nested contract that repeats the same
  fields

### 5.4 Canonical Execution Plan Cache Shape

The worker cache should stop mirroring the old spec shape.

The target DB field is:

- `execution_plan_json`

Target shape:

```ts
type ExecutionPlanCacheV1 = {
  version: "v1";
  template: "official_table_metric_v1";
  scorer_image: string; // pinned digest
  metric: string;
  comparator: "maximize" | "minimize";
  mount: {
    evaluation_bundle_name: string;
    submission_file_name: string;
  };
  limits: {
    memory: string;
    cpus: string;
    pids: number;
    timeout_ms: number;
  };
  evaluation_artifact_uri: string;
  evaluation_contract: {
    kind: "csv_table";
    columns: {
      required: string[];
      id: string;
      value: string;
      allow_extra: boolean;
    };
  };
  submission_contract: SubmissionContractV1;
  policies: {
    coverage_policy: "ignore" | "reject" | "penalize";
    duplicate_id_policy: "ignore" | "reject";
    invalid_value_policy: "ignore" | "reject";
  };
};
```

Rules:

- this is the single worker-facing cached runtime plan
- there is no separate `evaluation_template` or `execution_template` DB column
- this cache is derived from the challenge spec plus official scorer catalog
- the worker should not need to re-read IPFS challenge specs on the hot path

### 5.5 What Must Not Be Stored Twice

These values are canonical once and only once:

- `template` -> stored in `execution` and copied into `execution_plan_json`
- `scorer_image` -> stored in `execution` and copied into `execution_plan_json`
- `metric` -> stored in `execution` and copied into `execution_plan_json`
- `comparator` -> stored in `execution` and copied into `execution_plan_json`
- submission table columns -> stored in `submission_contract`, not inside
  `execution`
- visible artifact membership -> stored in `artifacts`, not inside `execution`

If a field is derivable from the official scorer catalog or from another
canonical object, do not store it twice inside the same layer.

### 5.6 Exact-Digest Rule

Standard authoring must resolve to an exact pinned official scorer digest before
publish.

Rules:

- same-repository matching is not sufficient for the canonical official path
- tagged image references are a temporary authoring convenience only
- canonical challenge specs and execution plans must persist the exact digest
- worker execution must refuse host-local builds that do not resolve to a
  registry-backed digest

### 5.6.1 Official Scorer Release Platforms

Official scorer release artifacts must be published as multi-arch OCI images.

Required platforms:

- `linux/amd64`
- `linux/arm64`

This is a release invariant, not a best-effort convenience.

Rationale:

- production executors commonly run on `linux/amd64`
- local developer and operator machines commonly run on `arm64`, especially
  Apple Silicon laptops
- local score verification and lifecycle E2E should not depend on x86
  emulation for the standard official scorer path

Rules:

- official scorer tags such as `:v1` must resolve to a manifest list that
  includes both required platforms
- CI scorer verification must fail if either platform is missing
- official scorer Dockerfiles must not hard-pin `linux/amd64` unless a scorer
  has a documented architecture-specific dependency that Agora has explicitly
  accepted

### 5.7 V1 Comparison Semantics

The V1 scorer contract is fixed and deterministic:

- join solver submission rows to hidden evaluation rows using the resolved id
  columns
- compare one primary submission value column against one primary evaluation
  value column
- compute one metric
- interpret the result using one comparator

The poster chooses only:

- which artifact is the hidden evaluation table
- what the submission contract is
- which columns are the id/value columns
- which metric to use

Everything else comes from the official scorer catalog and the resolved
execution object.

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

## 7. Concrete Refactor Plan

This redesign should be implemented as a real replacement, not as a
compatibility wrapper that preserves the split-registry model underneath.

### 7.1 File-Level Plan

#### `packages/common/src/scorer-images.ts`

Delete this file.

Replacement:

- move OCI image parsing, repository matching, and digest-resolution helpers
  into a small utility such as `packages/common/src/oci-image.ts`
- do not keep `OFFICIAL_SCORER_IMAGES`

Reason:

- the official runtime set should come from the official scorer catalog, not a
  second whitelist

#### `packages/common/src/schemas/execution-template.ts`

Replace this file with a single official scorer catalog module, ideally named:

- `packages/common/src/official-scorer-catalog.ts`

Responsibilities:

- template id schema derived from catalog keys
- official scorer image reference
- supported metrics and comparator semantics
- allowed runtime policy values
- mount names
- default runtime limits
- digest-resolution helper entry points

V1 catalog target:

- exactly one standard-authoring entry: `official_table_metric_v1`

#### `packages/common/src/schemas/evaluator-contract.ts`

Remove active-path template-to-image routing from this file.

Rules:

- no separate semi-custom execution-template image map
- no second metric-to-template routing table for the active path
- if non-table runtimes return later, they must register through the same
  official scorer catalog instead of creating another registry

If the entire semi-custom execution path is not part of the active V1 authoring
surface, retire it from the active path rather than preserving it as hidden
infrastructure.

#### `packages/common/src/schemas/execution-contract.ts`

Keep this file, but simplify it to the canonical execution object only.

Target responsibilities:

- `execution` schema
- evaluation contract schema
- policy schema reuse
- no nested copy of template/image/metric/comparator
- no submission-contract mirror

#### `packages/common/src/schemas/challenge-spec.ts`

Rewrite this file around `schema_version: 4`.

Changes:

- rename top-level `evaluation` to `execution`
- remove nested `execution_contract`
- remove all "field X must match nested field X" validation
- validate `execution` against the official scorer catalog
- validate `submission_contract` independently
- validate that `execution.evaluation_artifact_uri` points at one private
  artifact
- derive any worker/runtime cache from `execution` + `submission_contract`

#### `packages/common/src/challenges/templates.ts`

Reduce this file to authoring defaults only, or rename it to make that role
explicit.

Allowed responsibilities:

- default domain
- default metric
- label/description text used by authoring UX

Disallowed responsibilities:

- execution-template routing
- compatibility-type inference
- execution behavior branching

`challenge_type` remains a product/UX taxonomy, not a scorer-routing key.

#### `apps/api/src/lib/authoring-compiler.ts`

Refactor the compiler to resolve one canonical execution object.

Rules:

- resolve the standard template internally
- derive comparator from metric
- bind the hidden evaluation artifact
- build `submission_contract`
- build `execution`
- dry-run using that exact object
- stop compiling to duplicated `evaluation` + nested `execution_contract`

#### `apps/api/src/lib/authoring-checklist.ts`

Read from the canonical execution object and official scorer catalog only.

Do not infer execution semantics from challenge type or legacy family labels.

#### `apps/api/src/lib/authoring-session-payloads.ts`

Expose:

- execution metric
- objective/comparator
- exact pinned scorer image
- evaluation artifact URI
- evaluation columns
- submission contract
- resource limits derived from the official scorer catalog

Do not expose or depend on duplicate nested execution fields.

#### `packages/db/src/queries/challenges.ts`

Persist:

- `execution_plan_json`

Do not persist:

- `evaluation_template`
- `execution_template`
- any second execution identity field outside the plan

#### `apps/api/src/worker/scoring.ts`

Read only:

- `execution_plan_json`

Do not re-resolve execution behavior from challenge type, compatibility type,
or legacy preset labels.

#### `packages/scorer/src/pipeline.ts`

Take:

- pinned scorer image
- mount
- evaluation contract
- submission contract
- policies

The pipeline remains generic. It should not know challenge families.

#### Tests

Replace tests that assert duplicated execution fields with tests that assert:

- catalog is the only official runtime source of truth
- challenge specs contain one canonical execution object
- execution plans derive deterministically from challenge specs
- exact digest resolution is required for canonical official specs
- challenge type defaults do not control worker execution

### 7.2 Cutover Sequence

Use this order:

1. land the spec and file-boundary changes first
2. introduce the official scorer catalog
3. rewrite challenge spec + execution plan schemas
4. rewire authoring compiler and worker/runtime readers
5. delete split registries and dead compatibility helpers
6. update tests and release-verification scripts

## 8. No-Drift Rules

These rules should block future drift.

### 8.1 One Official Runtime Source Of Truth

Official scorer capability must live in exactly one module.

Do not add:

- a second official image whitelist
- a second template registry
- a metric-to-template table outside the official scorer catalog

### 8.2 One Execution Source Of Truth Per Layer

Per layer:

- challenge spec -> `execution`
- DB cache -> `execution_plan_json`
- runtime workspace -> `agora-runtime.json`

Do not create a nested mirror object inside the same layer.

### 8.3 Challenge Type Does Not Route Execution

`challenge_type` is for product UX, defaults, analytics, and browsing.

It must not:

- decide scorer image
- decide worker mount
- decide runtime limits
- decide comparator

### 8.4 Transparency Beats Derivation At The Edge

Public compilation and published challenge specs should expose:

- template
- metric
- comparator
- exact pinned scorer image
- evaluation contract
- submission contract

The system may derive these internally, but once resolved they should be
visible to posters, solvers, and verifiers.

### 8.5 Repository Artifacts Are Not Official Runtime Config

A scorer container existing under `containers/` does not make it an official
runtime.

Only the official scorer catalog defines official runtime support.

## 9. Supporting Docs That Must Stay Aligned

These docs should describe the same model:

- `docs/specs/authoring-validity-and-execution.md`
- `docs/specs/authoring-session-api.md`
- `docs/protocol.md`
- `docs/data-and-indexing.md`
- `docs/architecture.md`
- `docs/contributing/scoring-engines.md`

If one of these documents still describes:

- split image/template registries
- duplicated execution identity fields
- challenge-type-based scorer routing
- `evaluation_plan_json` as the canonical worker cache

that document is stale and must be updated before code changes land.
