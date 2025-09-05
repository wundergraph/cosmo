FROM --platform=${BUILDPLATFORM} golang:1.25 AS builder

ARG TARGETOS
ARG TARGETARCH
ARG COMMIT
ARG DATE

ARG VERSION=dev
ENV VERSION=$VERSION

ENV COMMIT=$COMMIT

ENV DATE=$DATE

WORKDIR /app/

# Copy only the files required for go mod download
COPY go.* .

# Download dependencies
RUN go mod download

# Copy the rest of the files
COPY . .

# Build the binary with manual build info injection
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -trimpath -ldflags "-extldflags=-static \
    -X 'github.com/wundergraph/cosmo/router/core.Version=${VERSION}' \
    -X 'github.com/wundergraph/cosmo/router/core.Commit=${COMMIT}' \
    -X 'github.com/wundergraph/cosmo/router/core.Date=${DATE}'" \
    -a -o router cmd/router/main.go

FROM --platform=${BUILDPLATFORM} gcr.io/distroless/base-debian12:nonroot AS nonroot

# nonroot user uid
USER 65532

COPY --from=builder /app/router /router

# Configure workdir to be compatible with default image
WORKDIR /

CMD ["/router"]

EXPOSE 3002

FROM --platform=${BUILDPLATFORM} gcr.io/distroless/base-debian12

COPY --from=builder /app/router /router

CMD ["/router"]

EXPOSE 3002
