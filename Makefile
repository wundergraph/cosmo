all: dev-setup

setup-build-tools:
	go install github.com/bufbuild/buf/cmd/buf@v1.32.2
	go install google.golang.org/protobuf/cmd/protoc-gen-go@v1.34.1
	go install connectrpc.com/connect/cmd/protoc-gen-connect-go@v1.16.2

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

edfs-infra-up:
	docker compose -f docker-compose.yml --profile edfs up --remove-orphans --detach

edfs-infra-down:
	docker compose -f docker-compose.yml --profile edfs down --remove-orphans

infra-down:
	docker compose -f docker-compose.yml --profile dev down --remove-orphans

infra-build:
	docker compose -f docker-compose.yml --profile dev build

infra-restart:
	docker compose -f docker-compose.yml --profile dev down && make infra-up

infra-down-v:
	docker compose -f docker-compose.yml --profile dev down --remove-orphans -v

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

DC_FLAGS=
dc-dev:
	docker compose --file docker-compose.yml --profile dev up --remove-orphans --detach $(DC_FLAGS)

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

DC_FLAGS=
dc-subgraphs-demo:
	OTEL_AUTH_TOKEN=$(OTEL_AUTH_TOKEN) docker compose -f docker-compose.full.yml --profile subgraphs up --remove-orphans --detach $(DC_FLAGS)

dc-subgraphs-demo-down:
	docker compose -f docker-compose.full.yml --profile subgraphs down --remove-orphans

docker-build-local:
	docker compose --file docker-compose.cosmo.yml build --no-cache

docker-push-local:
	docker compose --file docker-compose.cosmo.yml push --no-cache

docker-build-minikube: docker-build-local
	docker image save -o mk-studio.tar ghcr.io/wundergraph/cosmo/studio:latest && \
	docker image save -o mk-controlplane.tar ghcr.io/wundergraph/cosmo/controlplane:latest && \
	docker image save -o mk-otelcollector.tar ghcr.io/wundergraph/cosmo/otelcollector:latest && \
	docker image save -o mk-router.tar ghcr.io/wundergraph/cosmo/router:latest && \
	docker image save -o mk-graphqlmetrics.tar ghcr.io/wundergraph/cosmo/graphqlmetrics:latest && \
	docker image save -o mk-keycloak.tar ghcr.io/wundergraph/cosmo/keycloak:latest && \
	docker image save -o mk-cdn.tar ghcr.io/wundergraph/cosmo/cdn:latest

	minikube image load mk-studio.tar && \
	minikube image load mk-controlplane.tar && \
	minikube image load mk-otelcollector.tar && \
	minikube image load mk-router.tar && \
	minikube image load mk-graphqlmetrics.tar && \
	minikube image load mk-keycloak.tar && \
	minikube image load mk-cdn.tar
	minikube cache reload

	del mk-*.tar

run-subgraphs-local:
	cd demo && go run cmd/all/main.go

sync-go-workspace:
	cd router && go mod tidy
	cd demo && make bump-deps
	cd aws-lambda-router && make bump-deps
	cd composition-go && go mod tidy
	cd graphqlmetrics && go mod tidy
	cd router-tests && make bump-deps
	go work sync
