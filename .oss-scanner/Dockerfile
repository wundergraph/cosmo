FROM golang:1.26.0-bookworm AS go-toolchain

FROM node:22.22.2-bookworm

COPY --from=go-toolchain /usr/local/go /usr/local/go
ENV PATH="/usr/local/go/bin:${PATH}"
ENV CI=1
ENV DO_NOT_TRACK=1
ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /src

RUN corepack enable && corepack prepare pnpm@11.25.0 --activate

COPY . .

RUN pnpm install --frozen-lockfile \
    && pnpm buf generate --template buf.ts.gen.yaml \
    && pnpm -r --filter '{./controlplane}...' --filter '{./cli}...' --filter '{./studio}...' --filter '{./cdn-server}...' --filter '{./admission-server}...' run build \
    && rm -rf /root/.local/share/pnpm/store /var/lib/apt/lists/*

RUN for module in router router-tests graphqlmetrics demo demo/pkg/subgraphs/projects aws-lambda-router router-plugin speedtrap connect-go; do \
      (cd "$module" && go mod download) || exit 1; \
    done

RUN cd router && go build -o /usr/local/bin/cosmo-router ./cmd/router
RUN cd graphqlmetrics && go build ./...

RUN (cd router && GOPROXY=off timeout 600 go test -run '^$' ./pkg/authentication ./pkg/health ./core) || echo 'WARNING: Router test compilation failed'
RUN (cd router && GOPROXY=off timeout 180 go test ./pkg/authentication ./pkg/health) || echo 'WARNING: Router unit tests failed'
RUN (cd composition && timeout 180 pnpm exec vitest run tests/v1/regexp.test.ts tests/v1/normalization-utils.test.ts) || echo 'WARNING: Composition unit tests failed'
RUN (cd controlplane && timeout -k 5 180 pnpm exec vitest run \
      --config /src/.oss-scanner/vitest.controlplane.config.ts \
      src/core/util.test.ts test/rbac-evaluator.test.ts test/timers.test.ts test/dual-blob-storage.test.ts) \
    || echo 'WARNING: Control plane unit tests failed'

CMD ["bash"]
