FROM node:lts AS builder

ARG TARGETARCH

WORKDIR /app

# Ensure we have pnpm available to us
RUN npm install --global pnpm@9

# Files required by pnpm install.
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches patches

# Files required by pnpm install for each package. Tried pnpm fetch but errors.
COPY connect/package.json connect/
COPY shared/package.json shared/
COPY composition/package.json composition/
COPY controlplane/package.json controlplane/
COPY protographic/package.json protographic/

RUN pnpm install --filter=wundergraph-cosmo --filter=./connect --filter=./shared --filter=./controlplane --filter=./composition --filter=./protographic --frozen-lockfile

COPY . /app/

RUN pnpm buf generate --template buf.ts.gen.yaml

RUN pnpm run --filter=./connect --filter=./shared --filter=./controlplane --filter=./composition --filter=./protographic build

RUN curl -fsSL -o /usr/local/bin/dbmate https://github.com/amacneil/dbmate/releases/download/v2.6.0/dbmate-linux-${TARGETARCH} && \
    chmod +x /usr/local/bin/dbmate

# Deploy
RUN pnpm --filter=./controlplane --prod deploy pruned

FROM node:lts-alpine

WORKDIR /app

ENV NODE_ENV=production

# Fetch built artifacts
COPY --from=builder /app/pruned .

COPY --from=builder /usr/local/bin/dbmate /usr/local/bin/dbmate

CMD ["node", "dist", "index.js"]

EXPOSE 3001
