# Challenge Policy Modules

This directory is the shared policy layer for challenge creation and authoring defaults.

It does **not** own scorer runtime config. Official scorer image and template config lives in `packages/common/src/scorer-images.ts` and `packages/common/src/schemas/execution-template.ts`.

## Files

- `templates.ts`
  - Default challenge-type labels, runtime families, metrics, and authoring defaults
  - Shared challenge spec candidate construction used by the web posting flow
  - Shared submission-contract builders for current challenge families

- `index.ts`
  - Public export surface for the rest of the repo

## Rule of thumb

If the question is:

- "Which execution template/type should this challenge default to?"
- "How should a new challenge spec candidate be assembled?"

the answer belongs here.
