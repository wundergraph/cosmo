FROM --platform=$BUILDPLATFORM oven/bun:1.3.0-alpine AS builder

# Multi-platform build arguments
ARG TARGETOS
ARG TARGETARCH

WORKDIR /build

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install

# Copy all source code
COPY src/ ./src/
COPY lib/ ./lib/
COPY generated/ ./generated/

# Set BUN_TARGET based on OS and architecture
ARG TARGETOS
ARG TARGETARCH

RUN BUN_TARGET="bun-${TARGETOS}-$([ "$TARGETARCH" = "amd64" ] && echo "x64" || echo "$TARGETARCH")" && \
    echo "Building for $BUN_TARGET" && \
    bun build src/plugin.ts --compile --outfile bin/plugin --target=$BUN_TARGET

FROM --platform=$BUILDPLATFORM scratch

COPY --from=builder /build/bin/plugin ./student-plugin

ENTRYPOINT ["./student-plugin"]
