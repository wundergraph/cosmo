dev:
	go run cmd/main.go

test:
	go test -race ./...

new-migration:
	dbmate -d "./migrations" new $(name)

migrate:
	dbmate -d "./migrations" up

lint:
	staticcheck ./...

VERSION?=dev
build:
	CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags "-extldflags -static -X github.com/wundergraph/cosmo/graphqlmetrics.Version=$(VERSION)" -a -o graphqlmetrics cmd/main.go

.PHONY: dev test new-migration migrate build