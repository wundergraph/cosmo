dev:
	go run cmd/router/main.go

test:
	go test -race ./...

test-norace:
	go test ./...

docker-test-linux/amd64: test
# Race detector fails on linux/arm64 with
#13 388.6 FATAL: ThreadSanitizer: unsupported VMA range
#13 388.6 FATAL: Found 39 - Supported 48
docker-test-linux/arm64: test-norace

lint:
	go vet ./...
	staticcheck ./...

VERSION?=dev
build:
	CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags "-extldflags -static -X github.com/wundergraph/cosmo/router/core.Version=$(VERSION)" -a -o router cmd/router/main.go

.PHONY: dev test build