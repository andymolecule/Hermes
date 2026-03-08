# Agora External Cutover Checklist

This checklist covers the remaining non-code work needed to complete the Agora rebrand across hosted systems, registries, deployments, and operator environments.

Use this together with [legacy-brand-policy.md](./legacy-brand-policy.md).

## 1. GitHub

- [ ] Confirm the canonical repository slug is `andymolecule/Agora`.
- [ ] Confirm local `origin` points to `https://github.com/andymolecule/Agora.git`.
- [ ] Update repository title, description, homepage URL, and social preview image in GitHub settings.
- [ ] Review branch protection rules, required status checks, environments, and deployment rules after the repo rename.
- [ ] Review GitHub Actions secrets and environment-scoped secrets for `AGORA_*` naming.
- [ ] Review GitHub Packages / GHCR visibility, package ownership, and README metadata.
- [ ] Review release names, milestones, and any pinned issue/PR templates that mention the former brand.

## 2. Vercel

- [ ] Rename the Vercel project to the Agora name.
- [ ] Confirm the linked local metadata matches the hosted project.
- [ ] Set production and preview env vars:
  - `NEXT_PUBLIC_AGORA_API_URL`
  - `NEXT_PUBLIC_AGORA_FACTORY_ADDRESS`
  - `NEXT_PUBLIC_AGORA_USDC_ADDRESS`
  - `NEXT_PUBLIC_AGORA_CHAIN_ID`
  - `NEXT_PUBLIC_AGORA_RPC_URL`
  - `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
  - any server-side `AGORA_*` vars used by Next.js routes
- [ ] Update the production domain and any preview aliases.
- [ ] Validate that Open Graph metadata, title, and favicon/app labels render as Agora.
- [ ] Verify explorer links in the UI point to the current Agora deployments.

Relevant files:

- [apps/web/vercel.json](/Users/changyuesin/Agora/apps/web/vercel.json)
- [apps/web/src/app/layout.tsx](/Users/changyuesin/Agora/apps/web/src/app/layout.tsx)
- [apps/web/src/lib/config.ts](/Users/changyuesin/Agora/apps/web/src/lib/config.ts)

## 3. API Runtime

- [ ] Set the API environment to `AGORA_*` names only.
- [ ] Ensure `AGORA_API_URL` matches the public API origin.
- [ ] Set `AGORA_CORS_ORIGINS` to the exact frontend origins.
- [ ] Verify SIWE origin and domain checks pass against the production API and web domains.
- [ ] Confirm the `agora_session` cookie is issued with the correct `secure` behavior in production.
- [ ] Verify any reverse proxy or gateway forwards `x-forwarded-host` and `x-forwarded-proto` correctly.

Relevant files:

- [apps/api/src/app.ts](/Users/changyuesin/Agora/apps/api/src/app.ts)
- [apps/api/src/routes/auth.ts](/Users/changyuesin/Agora/apps/api/src/routes/auth.ts)
- [.env.example](/Users/changyuesin/Agora/.env.example)

## 4. Contract And Chain Cutover

- [ ] Reset the active testnet Supabase DB and apply only [001_baseline.sql](/Users/changyuesin/Agora/packages/db/supabase/migrations/001_baseline.sql).
- [ ] Deploy a fresh `v2` factory for the active environment.
- [ ] Verify the deployments on the chain explorer under the Agora contract names.
- [ ] Update all runtime addresses together:
  - `AGORA_FACTORY_ADDRESS`
  - `AGORA_USDC_ADDRESS`
  - `AGORA_CHAIN_ID`
  - `AGORA_RPC_URL`
  - `AGORA_ORACLE_ADDRESS`
  - `AGORA_TREASURY_ADDRESS`
  - `NEXT_PUBLIC_AGORA_FACTORY_ADDRESS`
  - `NEXT_PUBLIC_AGORA_USDC_ADDRESS`
  - `NEXT_PUBLIC_AGORA_CHAIN_ID`
  - `NEXT_PUBLIC_AGORA_RPC_URL`
- [ ] Set or update the indexer start block for the new deployment generation.
- [ ] Reindex from the fresh `v2` factory only.
- [ ] Do not mix prior-generation factory addresses into active runtime envs.

Relevant files:

- [scripts/deploy.sh](/Users/changyuesin/Agora/scripts/deploy.sh)
- [packages/contracts/script/Deploy.s.sol](/Users/changyuesin/Agora/packages/contracts/script/Deploy.s.sol)
- [packages/common/src/config.ts](/Users/changyuesin/Agora/packages/common/src/config.ts)

## 5. Image Registry

- [ ] Publish scorer images under the Agora registry namespace expected by the codebase:
  - `ghcr.io/agora-science/repro-scorer`
  - `ghcr.io/agora-science/regression-scorer`
  - `ghcr.io/agora-science/docking-scorer`
- [ ] Verify the tags or digests referenced by presets are available.
- [ ] Update package descriptions and visibility in GHCR.
- [ ] Keep legacy images frozen if historical replay requires them.

Relevant files:

- [packages/common/src/presets.ts](/Users/changyuesin/Agora/packages/common/src/presets.ts)
- [docs/spec.md](/Users/changyuesin/Agora/docs/spec.md)

## 6. Package Publishing

- [ ] Decide the public package strategy:
  - publish public Agora packages
  - keep workspace-only packages private
  - deprecate or freeze prior public packages
- [ ] If publishing the CLI or MCP package, align docs and registry names.
- [ ] Confirm install instructions point to the real published package names.

Relevant files:

- [apps/cli/package.json](/Users/changyuesin/Agora/apps/cli/package.json)
- [apps/mcp-server/package.json](/Users/changyuesin/Agora/apps/mcp-server/package.json)
- [docs/agent-guide.md](/Users/changyuesin/Agora/docs/agent-guide.md)

## 7. Railway / Fly / PM2

- [ ] If you use Railway, rename services and update environment variables in the dashboard.
- [ ] If you use Fly, rename apps and update attached secrets.
- [ ] If you use PM2, restart the stack under the Agora process names:
  - `agora-api`
  - `agora-indexer`
  - `agora-worker`
  - `agora-mcp`
- [ ] Confirm logs, alerts, and dashboards use the current process names.

Relevant files:

- [scripts/deploy.sh](/Users/changyuesin/Agora/scripts/deploy.sh)
- [scripts/ops/ecosystem.config.cjs](/Users/changyuesin/Agora/scripts/ops/ecosystem.config.cjs)

## 8. Database And Storage

- [ ] Set `AGORA_SUPABASE_URL`, `AGORA_SUPABASE_ANON_KEY`, and `AGORA_SUPABASE_SERVICE_KEY` in all deployed runtimes.
- [ ] Confirm the Supabase project used for the active generation is the intended Agora environment.
- [ ] Optionally rename the Supabase project display name for operator clarity.
- [ ] Set `AGORA_PINATA_JWT` and `AGORA_IPFS_GATEWAY` in all deployed runtimes.
- [ ] Optionally rename Pinata project labels or gateway labels for operator clarity.

## 9. Wallet And Auth Integrations

- [ ] Confirm WalletConnect dashboard metadata reflects Agora.
- [ ] Verify wallet prompts display Agora as the app name.
- [ ] Verify the SIWE message domain and URI match the deployed frontend and API origins.
- [ ] Confirm browser cookies and local storage keys use Agora names only.

Relevant files:

- [apps/web/src/lib/wagmi.tsx](/Users/changyuesin/Agora/apps/web/src/lib/wagmi.tsx)
- [apps/api/src/routes/auth.ts](/Users/changyuesin/Agora/apps/api/src/routes/auth.ts)
- [apps/web/src/app/layout.tsx](/Users/changyuesin/Agora/apps/web/src/app/layout.tsx)

## 10. DNS And Domain Routing

- [ ] Point the production web domain to the Agora frontend deployment.
- [ ] Point the production API domain to the Agora API deployment.
- [ ] Update CORS allowlists, reverse-proxy configs, and TLS cert coverage for the final domains.
- [ ] Confirm any status pages, docs sites, or shortlinks use Agora branding.

## 11. Operator Machines

- [ ] Replace any local root `.env` files that still use legacy names.
- [ ] Replace local Claude / MCP client configs to the Agora server id and tool ids.
- [ ] Confirm CLI config directories and aliases use the Agora command name.
- [ ] Confirm cron jobs, shell aliases, launch agents, or systemd units do not reference retired names.

## 12. Final Verification

- [ ] `git remote -v` shows only the Agora repo URL.
- [ ] Hosted web app title and metadata display Agora.
- [ ] API auth flow sets `agora_session`.
- [ ] MCP server registers as `agora`.
- [ ] CLI help text shows `agora`.
- [ ] Runtime envs contain only `AGORA_*` and `NEXT_PUBLIC_AGORA_*` keys for first-party settings.
- [ ] All externally referenced scorer images resolve under the Agora registry namespace.
