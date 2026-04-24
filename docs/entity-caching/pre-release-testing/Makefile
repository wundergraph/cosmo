SHELL := bash

THIS_DIR := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
REPO_ROOT := $(abspath $(THIS_DIR)/../../..)
GRAPH ?= $(THIS_DIR)/example/graph.yaml
CONFIG ?= $(THIS_DIR)/generated/config.json
COMPOSE_FILE := $(THIS_DIR)/docker-compose.yml

.PHONY: help setup compose check-config up up-detached logs down clean

help:
	@printf '%s\n' \
		'Entity caching pre-release testing targets:' \
		'' \
		'  make setup         Enable Corepack and install repo dependencies' \
		'  make compose       Compose GRAPH into generated/config.json' \
		'  make check-config  Verify generated config contains cache metadata' \
		'  make up            Compose, then build and run router + Redis' \
		'  make up-detached   Compose, then build and run router + Redis in the background' \
		'  make logs          Follow router logs' \
		'  make down          Stop router + Redis' \
		'  make clean         Remove generated/config.json' \
		'' \
		'Variables:' \
		'  GRAPH=/path/to/graph.yaml' \
		'  CONFIG=/path/to/config.json'

setup:
	cd "$(REPO_ROOT)" && corepack enable && pnpm install

compose:
	"$(THIS_DIR)/scripts/compose.sh" "$(GRAPH)" "$(CONFIG)"

check-config:
	"$(THIS_DIR)/scripts/check-config.sh" "$(CONFIG)"

up: compose check-config
	docker compose -f "$(COMPOSE_FILE)" up --build

up-detached: compose check-config
	docker compose -f "$(COMPOSE_FILE)" up --build -d

logs:
	docker compose -f "$(COMPOSE_FILE)" logs -f router

down:
	docker compose -f "$(COMPOSE_FILE)" down

clean:
	rm -f "$(CONFIG)"
