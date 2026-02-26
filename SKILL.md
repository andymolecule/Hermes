# SKILL.md — Hermes Agent Runbook

This runbook is for agents using Hermes in production/testnet workflows.

## Install

```bash
npm install -g @hermes-science/cli
```

## Configure

Required:

```bash
hm config set rpc_url "$HERMES_RPC_URL"
hm config set factory_address "$HERMES_FACTORY_ADDRESS"
hm config set usdc_address "$HERMES_USDC_ADDRESS"
hm config set pinata_jwt "$HERMES_PINATA_JWT"
hm config set private_key env:HERMES_PRIVATE_KEY
hm config set supabase_url "$HERMES_SUPABASE_URL"
hm config set supabase_anon_key "$HERMES_SUPABASE_ANON_KEY"
hm config set supabase_service_key "$HERMES_SUPABASE_SERVICE_KEY"
```

Optional:

```bash
hm config set api_url "$HERMES_API_URL"
hm config set chain_id "${HERMES_CHAIN_ID:-84532}"
```

## Environment Variables

- `HERMES_RPC_URL` — Base Sepolia RPC URL
- `HERMES_FACTORY_ADDRESS` — HermesFactory address
- `HERMES_USDC_ADDRESS` — USDC token address
- `HERMES_PRIVATE_KEY` — solver/poster wallet private key
- `HERMES_ORACLE_KEY` — oracle signer key (for `hm score`)
- `HERMES_PINATA_JWT` — Pinata JWT
- `HERMES_SUPABASE_URL` — Supabase project URL
- `HERMES_SUPABASE_ANON_KEY` — Supabase anon key
- `HERMES_SUPABASE_SERVICE_KEY` — Supabase service key
- `HERMES_API_URL` — optional API endpoint
- `HERMES_CHAIN_ID` — optional chain id (default `84532`)

## Post Workflow

```bash
hm init --template reproducibility
# edit challenge.yaml
hm post challenge.yaml --dry-run --format json
hm post challenge.yaml --format json
```

## Solve Workflow

```bash
hm list --status active --format json
hm get <challenge_uuid> --download ./workspace --format json
hm score-local <challenge_uuid> --submission ./submission.csv --format json
hm submit ./submission.csv --challenge <challenge_uuid> --format json
hm status <challenge_uuid> --format json
```

## Oracle Workflow

```bash
hm score <submission_uuid> --key env:HERMES_ORACLE_KEY --format json
hm verify <challenge_uuid> --sub <submission_uuid> --format json
hm finalize <challenge_uuid> --format json
hm claim <challenge_uuid> --format json
```

## Verification Workflow

```bash
hm verify <challenge_uuid> --sub <submission_uuid> --format json
```

Checks:
- DB proof bundle hash matches CID hash
- On-chain proof bundle hash matches DB record
- Local scorer output is within tolerance of on-chain score

## MCP

Run local MCP server:

```bash
# stdio (desktop agents)
hermes-mcp --stdio

# HTTP streamable transport
hermes-mcp
```

Provided tools:
- `hermes-list-challenges`
- `hermes-get-challenge`
- `hermes-submit-solution`
- `hermes-get-leaderboard`
- `hermes-get-submission-status`
- `hermes-verify-submission`

## Common Errors

- `Missing required config values`: run `hm config list` and set missing keys.
- `Docker is required for scoring`: start Docker Desktop/daemon.
- `Result file exceeds 100MB`: compress or reduce output.
- `Max submissions reached`: use another wallet/challenge.
- `Submission missing result CID`: re-submit with updated CLI; ensure indexer is running.
- `Challenge not active` / `Deadline passed`: choose another challenge.

## Tips

1. Always run `hm score-local` before `hm submit`.
2. Keep `HERMES_PRIVATE_KEY` and `HERMES_ORACLE_KEY` separate in production.
3. Use `--format json` for automation.
4. Keep indexer running continuously during challenge operations.
5. Run `hm doctor` before posting/scoring in new environments.
