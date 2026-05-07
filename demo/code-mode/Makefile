SHELL := bash
GOCACHE ?= /tmp/cosmo-code-mode-go-build-cache
wgc_env_arg = $(if $(wildcard ../cli/.env),--env-file ../cli/.env,)
wgc_router = pnpm dlx tsx $(wgc_env_arg) ../cli/src/index.ts router

.PHONY: build-yoko build-stdio-proxy prepare-schemas compose start down run-subgraphs

build-yoko:
	mkdir -p $(GOCACHE)
	cd yoko-mock && GOCACHE=$(GOCACHE) go build -o yoko-mock .

build-stdio-proxy:
	mkdir -p $(GOCACHE)
	cd mcp-stdio-proxy && GOCACHE=$(GOCACHE) go build -o mcp-stdio-proxy .

# Generate code-mode-local copies of the demo subgraph schemas with auth
# directives stripped so the demo runs without authentication.
prepare-schemas:
	./prepare-schemas.sh

compose: prepare-schemas
	cd .. && if [ -f ../cli/dist/src/index.js ]; then \
		DISABLE_UPDATE_CHECK=true node ../cli/dist/src/index.js router compose -i ./code-mode/graph.yaml -o ./code-mode/config.json; \
	else \
		DISABLE_UPDATE_CHECK=true TMPDIR=/tmp $(wgc_router) compose -i ./code-mode/graph.yaml -o ./code-mode/config.json; \
	fi

start:
	./start.sh

down:
	./start.sh --down

run-subgraphs:
	./run_subgraphs_subset.sh
