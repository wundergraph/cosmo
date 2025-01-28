FROM --platform=${BUILDPLATFORM} node:lts AS builder

WORKDIR /app

# Ensure we have pnpm available to us
RUN npm install --global pnpm@9

# Files required by pnpm install.
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Files required by pnpm install for each package. Tried pnpm fetch but errors.
COPY cdn-server/package.json cdn-server/
COPY cdn-server/cdn/package.json cdn-server/cdn/

RUN pnpm install --filter=./cdn-server/cdn --filter=./cdn-server --frozen-lockfile

COPY . /app/
RUN pnpm run --filter=./cdn-server/cdn --filter=./cdn-server build

# Deploy
RUN pnpm --filter=./cdn-server --prod deploy pruned

FROM --platform=${BUILDPLATFORM} node:lts-slim

WORKDIR /app

ENV NODE_ENV=production

# Fetch built artifacts
COPY --from=builder /app/pruned .

CMD ["node", "dist", "index.js"]

EXPOSE 8787
