FROM node:20-bookworm-slim AS build

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json biome.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY containers ./containers

RUN pnpm install --frozen-lockfile
RUN pnpm turbo build --filter=@agora/api --filter=@agora/chain

FROM node:20-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /app /app

CMD ["node", "scripts/run-node-with-root-env.mjs", "apps/api/dist/index.js"]
