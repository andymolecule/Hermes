FROM node:20-bookworm-slim AS build

ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"

RUN corepack enable
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

COPY . .

ARG AGORA_RELEASE_ID
ARG AGORA_RELEASE_GIT_SHA
ARG AGORA_RELEASE_CREATED_AT
ARG RUNTIME_BUILD_FILTER

ENV AGORA_RELEASE_ID="${AGORA_RELEASE_ID}"
ENV AGORA_RELEASE_GIT_SHA="${AGORA_RELEASE_GIT_SHA}"
ENV AGORA_RELEASE_CREATED_AT="${AGORA_RELEASE_CREATED_AT}"

RUN rm -f packages/common/release-metadata.json
RUN pnpm install --frozen-lockfile
RUN pnpm turbo build --filter="${RUNTIME_BUILD_FILTER}"

FROM node:20-bookworm-slim AS runtime

WORKDIR /workspace

ENV NODE_ENV="production"
ENV AGORA_EXPECT_RELEASE_METADATA="1"

ARG AGORA_RUNTIME_ENTRY
ENV AGORA_RUNTIME_ENTRY="${AGORA_RUNTIME_ENTRY}"

COPY --from=build /workspace /workspace

CMD ["sh", "-lc", "exec node scripts/run-node-with-root-env.mjs \"$AGORA_RUNTIME_ENTRY\""]
