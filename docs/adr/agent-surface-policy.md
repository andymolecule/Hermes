# ADR: Agent Surface Policy

## Status

Superseded by the API-only machine surface cutover

## Decision

- The API is the canonical remote agent surface for discovery, detail reads, status reads, and submission-prep endpoints.
- The CLI is the canonical local execution surface for Docker scoring and on-chain writes.
- Agora does not carry a separate MCP app in the active repo.

## Why

- Remote discovery should be zero-config or near-zero-config.
- Local scoring and local file submission require a machine-local execution surface.
- Shared submit/score/verify/claim workflows live in `@agora/agent-runtime` to avoid CLI/API duplication.

## Consequences

- Machine-readable API discovery is available at `/.well-known/openapi.json`.
- CLI read commands should require only `AGORA_API_URL`.
- New remote agent capabilities should be added to the API first, then exposed via local tooling only if needed.
