SHELL := bash
wgc_router = pnpm dlx tsx --env-file ../cli/.env ../cli/src/index.ts router
wgc_router_ci = pnpm dlx tsx ../cli/src/index.ts router

generate:
	go generate ./...

compose-integration:
	cd ../router-tests && ./update-config-no-edg.sh

bump-deps:
	./bump-deps.sh

.PHONY: plugin-build plugin-generate plugin-build-ci-bun-binary plugin-build-ci-go-binary plugin-build-integration

plugin-build:
	$(wgc_router) plugin build ./pkg/subgraphs/projects --debug --go-module-path github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects
	$(wgc_router) plugin build ./pkg/subgraphs/courses --debug

plugin-generate:
	$(wgc_router) plugin build ./pkg/subgraphs/projects --generate-only --go-module-path github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects
	$(wgc_router) plugin build ./pkg/subgraphs/courses --generate-only

plugin-build-ci-bun-binary:
	$(wgc_router_ci) plugin build ./pkg/subgraphs/courses --yes

plugin-build-ci-go-binary:
	$(wgc_router_ci) plugin build ./pkg/subgraphs/projects --yes

plugin-compose:
	$(wgc_router) compose -i ./graph-with-plugin.yaml -o ./configWithPlugins.json
	pnpx prettier ./configWithPlugins.json -w

plugin-build-integration: plugin-build plugin-compose
	rm -rf ../router/plugins/*
	cp -a pkg/subgraphs/projects ../router/plugins/
	cp -a pkg/subgraphs/courses ../router/plugins/
	mv configWithPlugins.json ../router-tests/testenv/testdata/configWithPlugins.json
	
plugin-build-ci: plugin-build-ci-go-binary plugin-build-ci-bun-binary
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
