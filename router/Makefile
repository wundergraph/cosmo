dev:
	go run cmd/router/main.go

test:
	# Add -race once new test suite is in place
	go test ./...

lint:
	go vet ./...
	staticcheck ./...

bump-engine:
	go get github.com/wundergraph/graphql-go-tools/v2@master
	go mod tidy
	cd ../router-tests && go mod tidy

VERSION?=dev
build:
	CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags "-extldflags -static -X github.com/wundergraph/cosmo/router/core.Version=$(VERSION)" -a -o router cmd/router/main.go

.PHONY: dev test build lint bump-engine


