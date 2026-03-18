---
name: architecture-review
description: "Reviews code for clean system design: code simplicity, low structural entropy, modularity, extensibility, high cohesion, low coupling, low blast radius, leaky abstractions, no over-engineering, no over-complexity. Use when the user asks to review code quality, simplify architecture, check for over-engineering, find redundant layers, optimize system design, or assess whether code is simple, modular, and extensible."
allowed-tools: Read, Grep, Glob
context: fork
agent: Explore
---

# Architecture Review

Review code for clean, simple system design. The core philosophy: **prefer simplicity over cleverness, modularity over monoliths, extensibility over rigidity, and directness over abstraction.**

## Design Principles

These are the principles to evaluate against, in priority order:

1. **Code simplicity** — Is the code simple, clear, and direct? Does it do what it says with no hidden intent, no unnecessary indirection, no clever tricks? Simple code is not dumbed-down code — it's code where the complexity matches the problem, nothing more.

2. **Low structural entropy** — Are there too many moving parts for what this accomplishes? Count the files, types, functions, and layers involved relative to the complexity of the task. If a simple feature touches 8 files across 4 packages, the structure has too much entropy.

3. **Modularity** — Can you add, change, or remove a feature without touching unrelated code? Each module should be independently understandable and replaceable. If adding a new field requires edits in 5 files, the boundaries are wrong.

4. **Extensibility** — Can new behavior be added by composing existing pieces, or does it require cracking open internals? The system should grow by addition, not modification.

5. **High cohesion** — Does each module do one thing well? If you can't describe it in one sentence without "and", it's doing too much.

6. **Low coupling** — Does changing module A force changes in modules B, C, D? Count the cross-boundary imports and shared mutable state.

7. **Low blast radius** — If this code breaks, how far does the damage spread? A bug in a shared utility is worse than a bug in a leaf component. Changes should be containable.

8. **No over-engineering** — Is this built for hypothetical future requirements? Three similar lines of code are better than a premature abstraction. Every layer of indirection must earn its keep.

9. **No leaky abstractions** — Does a consumer need to know implementation details to use this correctly? Can you change the internals without breaking callers?

10. **No unnecessary redundancy** — Are there duplicate code paths, redundant layers, or abstractions that just pass through to another abstraction?

## How to Review

1. Read the target files thoroughly before making any judgments.
2. Trace the dependency chain — what imports what, what calls what.
3. For each finding, state:
   - **What:** the specific issue
   - **Where:** file and line number
   - **Why it matters:** concrete consequence, not abstract principle
   - **Suggested fix:** the simplest change that resolves it
4. Rank findings by severity (critical > warning > nitpick).
5. If everything looks clean, say so. Don't invent findings.

## Severity Guide

- **Critical:** Leaky abstractions, high coupling, high blast radius — these cause cascading failures and make the system fragile.
- **Warning:** Low modularity, poor extensibility, over-engineering, high structural entropy — these slow down development and make changes risky.
- **Nitpick:** Dead code, inconsistent naming, pattern drift from neighboring code.

## Agora-Specific Context

These patterns are intentional — do NOT flag them:

- `managed-post-flow.ts` has a multi-step wallet signing chain (publish → permit → create). The indirection is required by the on-chain protocol.
- `guided-state.ts` uses a reducer with many switch cases for each field. This is the standard pattern for the guided interview flow.
- `@agora/common` is a shared foundation package. Many packages importing from it is expected, not high coupling.
- The indexer polls events and writes projections to Supabase. The DB is a cache, not truth — this dual-source pattern is by design.
- `simulateAndWriteContract` wraps viem simulate+write. This abstraction earns its keep for error handling.

## Output Format

```
## Architecture Review: [target description]

### Critical
- (findings or "None")

### Warning
- (findings or "None")

### Nitpick
- (findings or "None")

### Verdict
[One sentence: is this code simple, modular, and extensible — or does it need work?]
```
