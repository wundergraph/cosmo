dev:
	go run cmd/main.go

test:
	go test -race ./...

new-migration:
	dbmate -d "./migrations" new $(name)

migrate:
	dbmate -d "./migrations" up

lint:
	golangci-lint run --timeout 5m

lint-only-changed-files:
	golangci-lint run --timeout 5m --new-from-rev origin/main

VERSION?=dev
build:
	CGO_ENABLED=0 go build -trimpath -ldflags "-extldflags -static -X github.com/wundergraph/cosmo/graphqlmetrics/core.Version=$(VERSION)" -a -o graphqlmetrics cmd/main.go

.PHONY: dev test new-migration migrate build