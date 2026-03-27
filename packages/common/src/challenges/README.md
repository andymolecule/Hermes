# Challenge Policy Modules

This directory is the shared policy layer for challenge creation and authoring defaults.

It does **not** own scorer runtime config. Official scorer catalog and runtime policy live in `packages/common/src/official-scorer-catalog.ts` and `packages/common/src/schemas/execution-contract.ts`.

## Files

- `templates.ts`
  - Default challenge-type labels, runtime families, metrics, and authoring defaults
  - Shared challenge spec candidate construction used by the agent authoring flow
  - Shared submission-contract builders for current challenge families

- `index.ts`
  - Public export surface for the rest of the repo

## Rule of thumb

If the question is:

- "Which official scorer template/metric should this challenge default to?"
- "How should a new challenge spec candidate be assembled?"

the answer belongs here.
