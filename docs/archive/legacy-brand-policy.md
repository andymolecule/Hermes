# Zero Legacy-Brand Policy

The target state is strict: the former protocol name must not remain in any active first-party code, runtime config, artifact name, repository identity, local project identity, published package or image namespace, deployment surface, or user-visible product surface.

Allowed exceptions are narrow:

- Unavoidable third-party upstream dependency names until those dependencies are replaced, forked, vendored, or removed.
- Off-repo immutable historical records retained outside the active repository, if the team chooses to keep them elsewhere for auditability.

Any occurrence in this repository outside those boundaries is a defect and must be removed or regenerated away.

## Current Repository State

- Active first-party repository content is expected to contain zero references to the former brand.
- No in-repo legacy archive is retained.
- Third-party upstream names are only tolerated if they are unavoidable and currently present in active dependency inputs.

## Remaining Ecosystem Blockers

These are not source-level rename misses, but they still block a full ecosystem-level cutover:

- External package registries, image registries, hosted project names, DNS, origin bindings, and similar deployment surfaces require operational cutover outside this repository.

## Enforcement

- Do not introduce new references to the former brand in active paths.
- If a new fixture, example, deployment record, or document models current behavior, it must use the current brand.
- Do not recreate an in-repo legacy archive for the retired brand.
- If historical material must be retained, store it outside the active repository or in a separate archival system.
