all: dev-setup

setup-build-tools:
	go install github.com/bufbuild/buf/cmd/buf@v1.28.1
	go install google.golang.org/protobuf/cmd/protoc-gen-go@v1.31.0
	go install connectrpc.com/connect/cmd/protoc-gen-connect-go@v1.12.0

setup-dev-tools: setup-build-tools
	go install github.com/amacneil/dbmate/v2@v2.6.0
	go install honnef.co/go/tools/cmd/staticcheck@2023.1.6
	go install github.com/yannh/kubeconform/cmd/kubeconform@v0.6.3
	go install github.com/norwoodj/helm-docs/cmd/helm-docs@v1.11.3

prerequisites: setup-dev-tools
	go version
	pnpm -v
	node -v
	docker -v
	dbmate -v

infra-up: dc-dev

infra-down:
	docker compose -f docker-compose.yml down --remove-orphans

infra-build:
	docker compose -f docker-compose.yml build

infra-restart:
	docker compose -f docker-compose.yml down && make infra-up

infra-down-v:
	docker compose -f docker-compose.yml down --remove-orphans -v

seed:
	pnpm -r run --filter './controlplane' seed

create-cli-demo:
	./scripts/create-cli-demo.sh

create-docker-demo:
	./scripts/create-docker-demo.sh

create-demo:
	./scripts/create-local-demo.sh

delete-demo:
	./scripts/delete-local-demo.sh

dev-setup: prerequisites
	pnpm install
	pnpm generate
	make generate-go
	make infra-up
	pnpm -r run --filter '!studio' build

dev-setup-no-infra: prerequisites
	pnpm install
	pnpm generate
	make generate-go
	pnpm -r run --filter '!studio' build

build-pnpm:
	pnpm install
	pnpm generate
	pnpm -r run --filter '!studio' build

migrate:
	pnpm -r run --filter './controlplane' migrate

generate:
	pnpm generate
	make generate-go

generate-go:
	rm -rf router/gen && buf generate --path proto/wg/cosmo/node --path proto/wg/cosmo/common --path proto/wg/cosmo/graphqlmetrics --template buf.router.go.gen.yaml
	rm -rf graphqlmetrics/gen && buf generate --path proto/wg/cosmo/graphqlmetrics --path proto/wg/cosmo/common --template buf.graphqlmetrics.go.gen.yaml

start-cp:
	pnpm -r run --filter './controlplane' dev

start-studio:
	pnpm -r run --filter './studio' dev

start-router:
	(cd router && make dev)

dc-dev:
	docker compose --file docker-compose.yml up --remove-orphans --detach --build

dc-stack:
	docker compose --file docker-compose.cosmo.yml up --remove-orphans --detach

dc-stack-build:
	docker compose --file docker-compose.cosmo.yml up --build --remove-orphans --detach

full-demo-up:
	docker compose -f docker-compose.full.yml --profile default up --build --remove-orphans --detach && ./scripts/setup-fulldemo.sh

full-demo-down:
	docker compose -f docker-compose.full.yml --profile default --profile router --profile subgraphs down --remove-orphans -v

dc-federation-demo:
	docker compose -f docker-compose.full.yml --profile default --profile router --profile subgraphs up --remove-orphans --detach

dc-subgraphs-demo:
	OTEL_AUTH_TOKEN=$(OTEL_AUTH_TOKEN) docker compose -f docker-compose.full.yml --profile subgraphs up --remove-orphans --detach --build

dc-subgraphs-demo-down:
	docker compose -f docker-compose.full.yml --profile subgraphs down --remove-orphans

docker-build-local:
	docker compose --file docker-compose.cosmo.yml build --no-cache

docker-push-local:
	docker compose --file docker-compose.cosmo.yml push --no-cache

docker-build-minikube: docker-build-local
	minikube image load ghcr.io/wundergraph/cosmo/studio:latest & \
	minikube image load ghcr.io/wundergraph/cosmo/controlplane:latest & \
	minikube image load ghcr.io/wundergraph/cosmo/otelcollector:latest & \
	minikube image load ghcr.io/wundergraph/cosmo/router:latest & \
	minikube image load ghcr.io/wundergraph/cosmo/graphqlmetrics:latest & \
	minikube image load ghcr.io/wundergraph/cosmo/keycloak:latest & \
	minikube image load ghcr.io/wundergraph/cosmo/cdn:latest
	minikube cache reload

run-subgraphs-local:
	cd demo && go run cmd/all/main.go
