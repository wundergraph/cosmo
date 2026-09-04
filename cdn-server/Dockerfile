FROM --platform=${BUILDPLATFORM} node:22.22.2 AS builder

WORKDIR /app

# Ensure we have pnpm available to us, pinned to the version in package.json's packageManager field
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate

# Files required by pnpm install.
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches patches

# Files required by pnpm install for each package. Tried pnpm fetch but errors.
COPY cdn-server/package.json cdn-server/
COPY cdn-server/cdn/package.json cdn-server/cdn/

RUN pnpm install --filter=./cdn-server/cdn --filter=./cdn-server --frozen-lockfile

COPY . /app/
RUN pnpm run --filter=./cdn-server/cdn --filter=./cdn-server build

# Deploy
# pnpm v10+ defaults to only deploying workspaces with inject-workspace-packages=true;
# use --legacy to keep the previous (pnpm 9) deploy behavior we rely on here.
RUN pnpm --filter=./cdn-server --prod deploy --legacy pruned

FROM --platform=${TARGETPLATFORM} node:22.22.2-slim

WORKDIR /app

ENV NODE_ENV=production

# Fetch built artifacts
COPY --from=builder /app/pruned .

CMD ["node", "dist", "index.js"]

EXPOSE 8787
