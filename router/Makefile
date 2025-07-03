ifeq ($(CI),true)
 FORMAT := github-actions
else
 FORMAT := pkgname
endif

dev:
	go run cmd/router/main.go

compose-demo-config:
	pushd __schemas && ./compose.sh && popd

update-snapshot:
	cd ./pkg/config && go test -update -race ./...

test:
	gotestsum -f $(FORMAT) -- -race ./...

test-fresh: clean-testcache test

lint:
	go vet ./...
	staticcheck ./...

clean-testcache:
	go clean -testcache

bump-engine:
	go get github.com/wundergraph/graphql-go-tools/v2@upgrade
	go mod tidy
	cd ../router-tests && make bump-deps

VERSION?=dev
# RFC3339 format
DATE?=$(shell date -u +'%Y-%m-%dT%H:%M:%SZ')
COMMIT?=$(shell git rev-parse HEAD)
build:
	CGO_ENABLED=0 go build -trimpath -ldflags "-extldflags -static -X github.com/wundergraph/cosmo/router/core.Version=$(VERSION) -X github.com/wundergraph/cosmo/router/core.Date=$(DATE) -X github.com/wundergraph/cosmo/router/core.Commit=$(COMMIT)" -a -o router cmd/router/main.go

build-race:
	CGO_ENABLED=1 go build -trimpath -race -ldflags "-X github.com/wundergraph/cosmo/router/core.Version=$(VERSION) -X github.com/wundergraph/cosmo/router/core.Date=$(DATE) -X github.com/wundergraph/cosmo/router/core.Commit=$(COMMIT)" -a -o router cmd/router/main.go

build-custom:
	CGO_ENABLED=0 go build -trimpath -ldflags "-extldflags -static -X github.com/wundergraph/cosmo/router/core.Version=$(VERSION) -X github.com/wundergraph/cosmo/router/core.Date=$(DATE) -X github.com/wundergraph/cosmo/router/core.Commit=$(COMMIT)" -a -o router cmd/custom/main.go

generate-mocks:
	mockery

.PHONY: dev test build lint bump-engine update-snapshot
