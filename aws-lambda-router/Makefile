.PHONY: build

bump-router:
	go get github.com/wundergraph/cosmo/router@upgrade
	go mod tidy
	cd .. && go work sync

VERSION?=dev
build:
	CGO_ENABLED=0 go build -trimpath -ldflags "-extldflags -static -X github.com/wundergraph/cosmo/aws-lambda-router/internal.Version=$(VERSION)" -a -o bootstrap cmd/main.go

build-sam:
	rm -rf .aws-sam && sam build --parallel && cp router.json .aws-sam/build/Api/router.json && cp config.yaml .aws-sam/build/Api/config.yaml

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
	wgc router fetch mygraph --namespace default -o router.json

sync:
	sam sync --watch

create-lambda-zip: build fetch-router-config
	zip -r lambda.zip bootstrap router.json

bump-deps:
	go get github.com/wundergraph/cosmo/router@upgrade
	go mod tidy
	cd .. && go work sync
