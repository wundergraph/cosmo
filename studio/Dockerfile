FROM --platform=${BUILDPLATFORM} node:lts as builder

WORKDIR /app

# Ensure we have pnpm available to us
RUN npm install --global pnpm@8

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

COPY . /app/

RUN pnpm buf generate --template buf.ts.gen.yaml

RUN pnpm run --filter=./connect --filter=./shared --filter=./studio --filter=./composition build

FROM --platform=${BUILDPLATFORM} node:lts-alpine
WORKDIR /app

ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

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

ENV PORT 3000
ENV HOSTNAME localhost

CMD ["node", "./studio/server.js"]
