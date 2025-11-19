SHELL := bash
wgc_router = pnpx tsx --env-file ../cli/.env ../cli/src/index.ts router

generate:
	go generate ./...

compose-integration:
	cd ../router-tests && ./update-config-no-edg.sh

bump-deps:
	./bump-deps.sh

.PHONY: plugin-build plugin-generate plugin-build-bun-binary plugin-build-go-binary plugin-build-integration

plugin-build:
	$(wgc_router) plugin build ./pkg/subgraphs/projects --debug --go-module-path github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects
	$(wgc_router) plugin build ./pkg/subgraphs/courses --debug

plugin-generate:
	$(wgc_router) plugin build ./pkg/subgraphs/projects --generate-only --go-module-path github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects
	$(wgc_router) plugin build ./pkg/subgraphs/courses --generate-only

plugin-build-bun-binary:
	cd pkg/subgraphs/courses/ && \
	bun install && bun build src/plugin.ts --compile --outfile bin/$(shell go env GOOS)_$(shell go env GOARCH) && \
	mkdir -p bin/grpc-health-check && \
	cp -r node_modules/grpc-health-check/proto bin/grpc-health-check

plugin-build-go-binary:
	cd pkg/subgraphs/projects/ && go build -o ./bin/$(shell go env GOOS)_$(shell go env GOARCH) ./src

plugin-compose:
	$(wgc_router) compose -i ./graph-with-plugin.yaml -o ./configWithPlugins.json
	pnpx prettier ./configWithPlugins.json -w

plugin-build-integration: plugin-build plugin-compose
	rm -rf ../router/plugins/*
	cp -a pkg/subgraphs/projects ../router/plugins/
	cp -a pkg/subgraphs/courses ../router/plugins/
	mv configWithPlugins.json ../router-tests/testenv/testdata/configWithPlugins.json
	
plugin-build-ci: plugin-build-go-binary plugin-build-bun-binary
	rm -rf ../router/plugins/*
	mkdir -p ../router/plugins/projects/bin
	mkdir -p ../router/plugins/courses/bin
	cp -a pkg/subgraphs/projects/bin/* ../router/plugins/projects/bin/
	cp -a pkg/subgraphs/courses/bin/* ../router/plugins/courses/bin/

standalone-compose:
	$(wgc_router) compose -i ./graph-with-standalone.yaml -o ./configWithStandalone.json
	pnpx prettier ./configWithStandalone.json -w

standalone-integration: standalone-compose
	mv ./configWithStandalone.json ../router-tests/testenv/testdata/configWithGRPC.json
