FROM --platform=${BUILDPLATFORM} node:22.23.4 AS builder

WORKDIR /app

# Ensure we have pnpm available to us, pinned to the version in package.json's packageManager field
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate

# The filtered install below is complete for these packages; without this, each later pnpm run reinstalls the whole workspace.
ENV pnpm_config_verify_deps_before_run=false

# Files required by pnpm install
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches patches

# Files required by pnpm install for each package. Tried pnpm fetch but errors.
COPY connect/package.json connect/
COPY shared/package.json shared/
COPY studio/package.json studio/
COPY composition/package.json composition/

COPY studio/entrypoint.sh studio/
COPY studio/.env.docker studio/.env.production

RUN --mount=type=cache,id=cosmo-pnpm,target=/pnpm/store --mount=type=cache,id=cosmo-pnpm-metadata,target=/root/.cache/pnpm pnpm install --store-dir /pnpm/store --filter=wundergraph-cosmo --filter=./connect --filter=./shared --filter=./studio --filter=./composition --frozen-lockfile

# enables building custom on premise images with sentry support.
ARG NEXT_PUBLIC_SENTRY_ENABLED
ARG NEXT_PUBLIC_SENTRY_REPLAY_ENABLED
ARG SENTRY_DEBUG
ARG SENTRY_AUTH_TOKEN
ARG SENTRY_ORG
ARG SENTRY_PROJECT
ARG SENTRY_SERVER_SAMPLE_RATE
ARG SENTRY_EDGE_SAMPLE_RATE

ENV NEXT_PUBLIC_SENTRY_ENABLED=$NEXT_PUBLIC_SENTRY_ENABLED
ENV NEXT_PUBLIC_SENTRY_REPLAY_ENABLED=$NEXT_PUBLIC_SENTRY_REPLAY_ENABLED
ENV SENTRY_DEBUG=$SENTRY_DEBUG
ENV SENTRY_AUTH_TOKEN=$SENTRY_AUTH_TOKEN
ENV SENTRY_ORG=$SENTRY_ORG
ENV SENTRY_PROJECT=$SENTRY_PROJECT
ENV SENTRY_SERVER_SAMPLE_RATE=$SENTRY_SERVER_SAMPLE_RATE
ENV SENTRY_EDGE_SAMPLE_RATE=$SENTRY_EDGE_SAMPLE_RATE

COPY . /app/

RUN pnpm buf generate --template buf.ts.gen.yaml

RUN pnpm run --filter=./connect --filter=./shared --filter=./studio --filter=./composition build

FROM node:22.23.4-alpine

RUN apk add --no-cache --upgrade bash

USER node

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Fetch built artifacts
COPY --from=builder --chown=node:node /app/studio/.next/standalone ./
COPY --from=builder --chown=node:node /app/studio/public/ ./studio/public
COPY --from=builder --chown=node:node /app/studio/.next/static ./studio/.next/static
COPY --from=builder --chown=node:node /app/studio/entrypoint.sh .
COPY --from=builder --chown=node:node /app/studio/.env.production .

RUN ["chmod", "+x", "./entrypoint.sh"]
ENTRYPOINT ["./entrypoint.sh"]

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME=localhost

CMD ["node", "./studio/server.js"]
