FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS builder

# Multi-platform build arguments
ARG TARGETOS
ARG TARGETARCH

WORKDIR /build

# Copy go mod files
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

RUN --mount=type=cache,target="/root/.cache/go-build" CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -o dist/plugin ./src

FROM --platform=$BUILDPLATFORM scratch

COPY --from=builder /build/dist/plugin ./my-plugin

ENTRYPOINT ["./my-plugin"]
