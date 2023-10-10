dev:
	go run cmd/main.go

test:
	go test -race ./...

VERSION?=dev
build:
	CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags "-extldflags -static -X github.com/wundergraph/cosmo/graphqlmetrics.Version=$(VERSION)" -a -o graphqlmetrics cmd/main.go