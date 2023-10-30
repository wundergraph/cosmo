dev:
	go run cmd/router/main.go

test:
	go test -race ./...

lint:
	go vet ./...
	staticcheck ./...

VERSION?=dev
build:
	CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags "-extldflags -static -X github.com/wundergraph/cosmo/router/core.Version=$(VERSION)" -a -o router cmd/router/main.go

.PHONY: dev test build