dev:
	go run cmd/router/main.go

update-snapshot:
	cd ./pkg/config && go test -update -race ./...

test:
	go test -race ./...

lint:
	go vet ./...
	staticcheck ./...

bump-engine:
	go get github.com/wundergraph/graphql-go-tools/v2@upgrade
	go mod tidy
	cd .. && go work sync

VERSION?=dev
build:
	CGO_ENABLED=0 go build -trimpath -ldflags "-extldflags -static -X github.com/wundergraph/cosmo/router/core.Version=$(VERSION)" -a -o router cmd/router/main.go

.PHONY: dev test build lint bump-engine update-snapshot


