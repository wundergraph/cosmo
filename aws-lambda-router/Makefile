.PHONY: build

build:
	sam build && cp adapter/router.json .aws-sam/build/Api/router.json

dev: build
	sam local start-api --shutdown

deploy: build
	sam deploy

test:
	go test -v ./...

fetch-router-config:
	wgc router fetch production -o adapter/router.json

sync:
	sam sync --watch