# Challenge Policy Modules

This directory is the shared policy layer for challenge creation and authoring defaults.

It does **not** own scorer runtime config. Official scorer runtime config lives in `packages/common/src/presets.ts`.

## Files

- `templates.ts`
  - Default challenge-type labels, containers, metrics, and preset ids
  - Shared challenge draft construction used by the web posting flow
  - Shared submission-contract builders for current challenge families

- `index.ts`
  - Public export surface for the rest of the repo

## Rule of thumb

If the question is:

- "Which preset/type should this challenge default to?"
- "How should a new challenge draft be assembled?"

the answer belongs here.
