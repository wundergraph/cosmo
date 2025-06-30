FROM golang:1.23-alpine AS builder

WORKDIR /build

# Copy go mod files
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

RUN --mount=type=cache,target="/root/.cache/go-build" CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -o dist/plugin ./src

FROM scratch

COPY --from=builder /build/dist/plugin ./my-plugin

ENTRYPOINT ["./my-plugin"]
