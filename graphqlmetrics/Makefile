dev:
	go run cmd/main.go

test:
	go test -race ./...

test-norace:
	go test ./...

ARCH := $(shell uname -m)
# Tests to run while building the docker image
# Race detector fails while building on docker for linux/arm64 with
#13 388.6 FATAL: ThreadSanitizer: unsupported VMA range
#13 388.6 FATAL: Found 39 - Supported 48
ifeq ($(ARCH),aarch64)
test-from-docker-build: test-norace
else
test-from-docker-build: test
endif

new-migration:
	dbmate -d "./migrations" new $(name)

migrate:
	dbmate -d "./migrations" up

lint:
	go vet ./...
	staticcheck ./...

VERSION?=dev
build:
	CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags "-extldflags -static -X github.com/wundergraph/cosmo/graphqlmetrics.Version=$(VERSION)" -a -o graphqlmetrics cmd/main.go

.PHONY: dev test new-migration migrate build
