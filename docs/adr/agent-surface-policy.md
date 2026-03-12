# ADR: Agent Surface Policy

## Status

Accepted

## Decision

- The API is the canonical remote agent surface for discovery, detail reads, status reads, and submission-prep endpoints.
- The CLI is the canonical local execution surface for Docker scoring and on-chain writes.
- MCP remains supported, but only as a thin adapter.
- MCP stdio keeps the full local tool surface.
- MCP HTTP is read-only by default and exposes discovery/status tools only.

## Why

- Remote discovery should be zero-config or near-zero-config.
- Local scoring and local file submission require a machine-local execution surface.
- A thin MCP adapter preserves interoperability with desktop agent tooling without making MCP the core application contract.
- Shared submit/score/verify/claim workflows now live in `@agora/agent-runtime` to avoid CLI/MCP duplication.

## Consequences

- Machine-readable API discovery is available at `/.well-known/openapi.json`.
- CLI read commands should require only `AGORA_API_URL`.
- HTTP MCP should not advertise file-path or private-key write tools.
- New remote agent capabilities should be added to the API first, then exposed via CLI or MCP if needed.
