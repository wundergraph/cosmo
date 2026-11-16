FROM --platform=${BUILDPLATFORM} golang:1.26 AS builder

ARG TARGETOS
ARG TARGETARCH

WORKDIR /app/

# Copy only the files required for go mod download
COPY go.* .

# Download dependencies
RUN go mod download

# Copy the rest of the files
COPY . .

# Declare the build info only here. DATE changes on every build, so declaring it
# earlier would stop the layers above from being cached.
ARG VERSION=dev
ARG COMMIT
ARG DATE

# Build the binary with manual build info injection
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -trimpath -ldflags "-extldflags=-static \
    -X 'github.com/wundergraph/cosmo/router/core.Version=${VERSION}' \
    -X 'github.com/wundergraph/cosmo/router/core.Commit=${COMMIT}' \
    -X 'github.com/wundergraph/cosmo/router/core.Date=${DATE}'" \
    -a -o router cmd/router/main.go

FROM gcr.io/distroless/static-debian13:nonroot AS nonroot

# nonroot user uid
USER 65532

COPY --from=builder /app/router /router

# Configure workdir to be compatible with default image
WORKDIR /

CMD ["/router"]

EXPOSE 3002

FROM gcr.io/distroless/static-debian13

COPY --from=builder /app/router /router

CMD ["/router"]

EXPOSE 3002
