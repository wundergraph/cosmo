.PHONY: build

VERSION?=dev
build:
	CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags "-extldflags -static -X github.com/wundergraph/cosmo/aws-lambda-router/internal.Version=$(VERSION)" -a -o aws-lambda-router cmd/main.go

build-sam:
	rm -rf .aws-sam && sam build && cp router.json .aws-sam/build/Api/router.json

dev: build-sam
	sam local start-api -p 3003 --shutdown

deploy: build-sam
	sam deploy

lint:
	cd adapter && go vet ./...
	cd adapter && staticcheck ./...

test:
	go test -v ./...

fetch-router-config:
	wgc router fetch production -o router.json

sync:
	sam sync --watch