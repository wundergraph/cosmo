FROM node:22-alpine AS composer
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json .npmrc ./
COPY patches/ patches/
COPY cli/ cli/
COPY composition/ composition/
COPY connect/ connect/
COPY shared/ shared/
COPY protographic/ protographic/
RUN pnpm install --filter wgc... --frozen-lockfile --ignore-scripts \
    && pnpm --filter wgc... run build
ENTRYPOINT ["node", "/fixtures/generate.mjs"]

FROM golang:1.26 AS router-build
WORKDIR /src/router
COPY router/go.mod router/go.sum ./
RUN go mod download
COPY router/ ./
COPY router-tests/modules/execution-config-change/main.go /src/e2e/main.go
RUN CGO_ENABLED=0 go build -o /router /src/e2e/main.go

FROM alpine:3.22 AS router
COPY --from=router-build /router /router
ENTRYPOINT ["/bin/sh", "-c", "/router --config /fixtures/router.yaml 2>&1 | tee /data/router.log"]
