LABEL org.opencontainers.image.source="https://github.com/wundergraph/cosmo"
LABEL org.opencontainers.image.description="Cosmo Router"
LABEL org.opencontainers.image.licenses="Apache-2.0"

FROM --platform=${BUILDPLATFORM} golang:1.21 as builder

ARG TARGETOS
ARG TARGETARCH

ARG VERSION=dev
ENV VERSION=$VERSION

WORKDIR /app/

# Copy only the files required for go mod download
COPY go.* .

# Download dependencies
RUN go mod download

# Copy the rest of the files
COPY . .

# Run tests
RUN make test

# Build router
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath -ldflags "-extldflags -static -X github.com/wundergraph/cosmo/router/core.Version=${VERSION}" -a -o router cmd/router/main.go

FROM --platform=${BUILDPLATFORM} gcr.io/distroless/base-debian12

COPY --from=builder /app/router /router

CMD ["/router"]

EXPOSE 3002
