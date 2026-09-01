FROM --platform=${BUILDPLATFORM} node:22.22.2 AS builder

WORKDIR /app

# Ensure we have pnpm available to us, pinned to the version in package.json's packageManager field
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate

# Files required by pnpm install.
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches patches

# Files required by pnpm install for each package. Tried pnpm fetch but errors.
COPY admission-server/package.json admission-server/

RUN pnpm install --filter=./admission-server --frozen-lockfile

COPY . /app/
RUN pnpm run --filter=./admission-server build

# Deploy
RUN pnpm --filter=./admission-server --prod deploy pruned

FROM --platform=${TARGETPLATFORM} node:22.22.2-slim

WORKDIR /app

ENV NODE_ENV=production

# Fetch built artifacts
COPY --from=builder /app/pruned .

CMD ["node", "dist", "index.js"]

EXPOSE 8787
