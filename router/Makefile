ifeq ($(CI),true)
 FORMAT := github-actions
else
 FORMAT := pkgname
endif

GOBIN ?= $$(go env GOPATH)/bin

dev:
	go run cmd/router/main.go

compose-demo-config:
	pushd __schemas && ./compose.sh && popd

update-snapshot:
	cd ./pkg/config && GOLDIE_UPDATE=1 go test -race ./...

# Install go-test-coverage tool
install-go-test-coverage:
	@echo "Installing go-test-coverage..."
	go install github.com/vladopajic/go-test-coverage/v2@latest

# Run tests with coverage and check thresholds
check-coverage: install-go-test-coverage
	@echo "Running tests with coverage..."
	go test ./... -coverprofile=./cover.out -covermode=atomic -coverpkg=./...
	@echo "Checking coverage thresholds..."
	${GOBIN}/go-test-coverage --config=./.testcoverage.yml

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
