SHELL := bash

THIS_DIR := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
REPO_ROOT := $(abspath $(THIS_DIR)/../../..)
GRAPH ?= $(THIS_DIR)/example/graph.yaml
CONFIG ?= $(THIS_DIR)/generated/config.json
COMPOSE_FILE := $(THIS_DIR)/docker-compose.yml

.PHONY: help setup build-cli-deps subgraph-deps compose check-config up up-detached wait test logs down clean

help:
	@printf '%s\n' \
		'Entity caching pre-release testing targets:' \
		'' \
		'  make setup         Enable Corepack and install repo dependencies' \
		'  make build-cli-deps Build local workspace packages required by wgc router compose' \
		'  make subgraph-deps Install Bun dependencies for the bundled example subgraph' \
		'  make compose       Compose GRAPH into generated/config.json' \
		'  make check-config  Verify generated config contains cache metadata' \
		'  make up            Compose, then build and run router + Redis' \
		'  make up-detached   Compose, then build and run router + Redis in the background' \
		'  make test          Run the self-contained router + Redis + Bun subgraph smoke test' \
		'  make logs          Follow router logs' \
		'  make down          Stop router + Redis' \
		'  make clean         Remove generated/config.json' \
		'' \
		'Variables:' \
		'  GRAPH=/path/to/graph.yaml' \
		'  CONFIG=/path/to/config.json'

setup:
	cd "$(REPO_ROOT)" && corepack enable && pnpm install
	$(MAKE) build-cli-deps
	$(MAKE) subgraph-deps

build-cli-deps:
	cd "$(REPO_ROOT)" && pnpm --filter @wundergraph/cosmo-connect build
	cd "$(REPO_ROOT)" && pnpm --filter @wundergraph/composition build
	cd "$(REPO_ROOT)" && pnpm --filter @wundergraph/protographic build
	cd "$(REPO_ROOT)" && pnpm --filter @wundergraph/cosmo-shared build

subgraph-deps:
	@if command -v bun >/dev/null 2>&1; then \
		cd "$(THIS_DIR)" && bun install; \
	else \
		printf '%s\n' 'Bun is not installed locally; Docker Compose will install the example subgraph dependencies inside the products container.'; \
	fi

compose:
	"$(THIS_DIR)/scripts/compose.sh" "$(GRAPH)" "$(CONFIG)"

check-config:
	"$(THIS_DIR)/scripts/check-config.sh" "$(CONFIG)"

up: compose check-config
	docker compose -f "$(COMPOSE_FILE)" up --build

up-detached: compose check-config
	docker compose -f "$(COMPOSE_FILE)" up --build -d

wait:
	"$(THIS_DIR)/scripts/wait-router.sh"

test: up-detached wait
	"$(THIS_DIR)/scripts/smoke-test.sh"

logs:
	docker compose -f "$(COMPOSE_FILE)" logs -f router

down:
	docker compose -f "$(COMPOSE_FILE)" down

clean:
	rm -f "$(CONFIG)"
