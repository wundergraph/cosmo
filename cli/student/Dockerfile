FROM --platform=$BUILDPLATFORM oven/bun:1.3.0-alpine AS builder

# Multi-platform build arguments
ARG TARGETOS
ARG TARGETARCH

# Build router-plugin-ts first
WORKDIR /router-plugin-ts
COPY --from=router-plugin-ts package.json bun.lock* ./
RUN bun install
COPY --from=router-plugin-ts src ./src/
COPY --from=router-plugin-ts tsconfig.json ./
RUN bun run build

# Now build the student plugin
WORKDIR /build

# Copy built router-plugin-ts
RUN ln -s /router-plugin-ts /build/../../../router-plugin-ts

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install

# Copy source code and generated files
COPY src/ ./src/
COPY generated/ ./generated/

# Build the plugin - output to bin directory with platform-specific name
RUN bun build src/plugin.ts --compile --outfile bin/darwin_arm64 #${TARGETOS}_${TARGETARCH}

FROM --platform=$BUILDPLATFORM alpine:latest

ARG TARGETOS
ARG TARGETARCH

# Install minimal runtime dependencies
RUN apk add --no-cache libstdc++ libgcc

COPY --from=builder /build/bin/darwin_arm64 ./student-plugin

ENTRYPOINT ["./student-plugin"]
