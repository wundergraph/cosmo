FROM --platform=${BUILDPLATFORM} node:lts AS builder

WORKDIR /app

# Ensure we have pnpm available to us
RUN npm install --global pnpm@9

# Files required by pnpm install
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Files required by pnpm install for each package. Tried pnpm fetch but errors.
COPY connect/package.json connect/
COPY shared/package.json shared/
COPY studio/package.json studio/
COPY composition/package.json composition/

COPY studio/entrypoint.sh studio/
COPY studio/.env.docker studio/.env.production

RUN pnpm install --filter=wundergraph-cosmo --filter=./connect --filter=./shared --filter=./studio --filter=./composition --frozen-lockfile

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

FROM --platform=${BUILDPLATFORM} node:lts-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Fetch built artifacts
COPY --from=builder /app/studio/.next/standalone ./
COPY --from=builder /app/studio/public/ ./studio/public
COPY --from=builder /app/studio/.next/static ./studio/.next/static
COPY --from=builder /app/studio/entrypoint.sh .
COPY --from=builder /app/studio/.env.production .

RUN apk add --no-cache --upgrade bash
RUN ["chmod", "+x", "./entrypoint.sh"]
ENTRYPOINT ["./entrypoint.sh"]

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME=localhost

CMD ["node", "./studio/server.js"]