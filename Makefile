all: build-kc-theme dev-setup

setup-tools:
	go install github.com/amacneil/dbmate/v2@v2.5.0
	go install github.com/bufbuild/buf/cmd/buf@latest
	go install github.com/bufbuild/connect-go/cmd/protoc-gen-connect-go@latest
	go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
	go install github.com/yannh/kubeconform/cmd/kubeconform@latest
	go install github.com/maykonlf/semver-cli/cmd/semver@latest

prerequisites: setup-tools
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

create-docker-demo:
	cd scripts && ./create-docker-demo.sh

create-demo:
	cd scripts && ./create-local-demo.sh

dev-setup: prerequisites
	pnpm install
	pnpm generate
	make generate-go
	make infra-up
	pnpm -r run --filter '!studio' build

generate:
	pnpm generate
	make generate-go

generate-go:
	buf generate --template buf.go.gen.yaml

start-cp:
	pnpm -r run --filter './controlplane' dev

start-studio:
	pnpm -r run --filter './studio' dev

start-router:
	(cd router && make dev)

dc-dev:
	docker compose --file docker-compose.yml up --remove-orphans --detach

dc-stack:
	docker compose --file docker-compose.cosmo.yml up --remove-orphans --detach

dc-stack-build:
	docker compose --file docker-compose.cosmo.yml up --build --remove-orphans --detach

full-demo-up:
	docker compose -f docker-compose.full.yml --profile default up --build --remove-orphans --detach

full-demo-down:
	docker compose -f docker-compose.full.yml --profile default --profile router --profile subgraphs down --remove-orphans -v

dc-federation-demo:
	docker compose -f docker-compose.full.yml --profile default --profile router --profile subgraphs up --remove-orphans --detach

dc-subgraphs-demo:
	docker compose -f docker-compose.full.yml --profile subgraphs up --remove-orphans --detach

docker-build-local:
	docker compose --file docker-compose.cosmo.yml build --no-cache

docker-push-local:
	docker compose --file docker-compose.cosmo.yml push

docker-build-minikube: docker-build-local
	minikube image load ghcr.io/wundergraph/cosmo/studio:latest & \
	minikube image load ghcr.io/wundergraph/cosmo/controlplane:latest & \
	minikube image load ghcr.io/wundergraph/cosmo/otelcollector:latest & \
	minikube image load ghcr.io/wundergraph/cosmo/router:latest & \
	minikube image load ghcr.io/wundergraph/cosmo/keycloak:latest
	minikube cache reload

new-ch-migration:
	 dbmate -d "./controlplane/clickhouse/migrations" new $(name)

migrate-ch:
	 dbmate -d "./controlplane/clickhouse/migrations" -s "./controlplane/db/schema.sql" -e CLICKHOUSE_DSN up

migrate-ch-down:
	 dbmate -d "./controlplane/clickhouse/migrations" -s "./controlplane/db/schema.sql" -e CLICKHOUSE_DSN down

rollback-ch:
	 dbmate -d "./controlplane/clickhouse/migrations" -s "./controlplane/db/schema.sql" -e CLICKHOUSE_DSN rollback

migrate-ch-dump:
	dbmate -d "./controlplane/clickhouse/migrations" -s "./controlplane/db/schema.sql" -e CLICKHOUSE_DSN dump

build-kc-theme:
	(cd keycloak/theme && npm i && ./build.sh)
