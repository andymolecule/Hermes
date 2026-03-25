# Agora V0 Feature Policy

This repository runs in **v0 core mode** by default.

## Single Gate

All non-core features are disabled unless this is set:

```bash
AGORA_ENABLE_NON_CORE_FEATURES=true
```

## Non-Core Features

When the gate is enabled, these feature-specific flags apply:

- `AGORA_X402_ENABLED=true` enables x402 payment enforcement.
- `AGORA_X402_REPORT_ONLY=true` enables x402 report-only mode.

If `AGORA_ENABLE_NON_CORE_FEATURES=false`, all of the above are forced off regardless of their individual values.

## V0 Recommendation

For a lightweight, stable v0 deployment, keep:

```bash
AGORA_ENABLE_NON_CORE_FEATURES=false
```
