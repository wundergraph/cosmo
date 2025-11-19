FROM --platform=$BUILDPLATFORM oven/bun:1.3.0-alpine AS builder

# Multi-platform build arguments
ARG TARGETOS
ARG TARGETARCH

WORKDIR /build

# Copy package files
COPY package.json tsconfig.json bun.lock* ./
COPY patches/ ./patches/
COPY src/ ./src/
COPY generated/ ./generated/

# Install dependencies
RUN bun install

RUN bun x tsc --noEmit

# Set BUN_TARGET based on OS and architecture
RUN BUN_TARGET="bun-$TARGETOS-$([ "$TARGETARCH" = "amd64" ] && echo "x64" || echo "$TARGETARCH")" && \
    echo "Building for $BUN_TARGET" && \
    bun build src/plugin.ts --compile --outfile bin/plugin --target=$BUN_TARGET

FROM --platform=$BUILDPLATFORM scratch

COPY --from=builder /build/bin/plugin ./awes17-plugin
COPY --from=builder /build/node_modules/grpc-health-check/proto/health/v1/health.proto /grpc-health-check/proto/health/v1/health.proto

ENTRYPOINT ["./awes17-plugin"]

