FROM --platform=${BUILDPLATFORM} golang:1.25 AS builder

ARG TARGETOS
ARG TARGETARCH

ARG VERSION=dev
ENV VERSION=$VERSION

WORKDIR /app/

# Copy only the files required for go mod download
COPY ./go.* .

# Download dependencies
RUN go mod download

# Copy the rest of the files
COPY . .

# Run tests
RUN make test

# Build router
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath -ldflags "-extldflags -static -X github.com/wundergraph/cosmo/graphqlmetrics/core.Version=${VERSION}" -a -o graphqlmetrics cmd/main.go

FROM --platform=${BUILDPLATFORM} gcr.io/distroless/base-debian12

COPY --from=builder /app/graphqlmetrics /graphqlmetrics
COPY --from=builder /app/migrations /migrations

CMD ["/graphqlmetrics"]

EXPOSE 4005
