generate:
	go generate ./...

bump-deps:
	./bump-deps.sh

PHONY: plugin-build plugin-generate plugin-build-binary plugin-build-integration

plugin-build:
	$(wgc_router) plugin build ./pkg/subgraphs/projects --debug --go-module-path github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects
	$(wgc_router) plugin build ./pkg/subgraphs/student --debug

plugin-generate:
	$(wgc_router) plugin build ./pkg/subgraphs/projects --generate-only --go-module-path github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects
	$(wgc_router) plugin build ./pkg/subgraphs/student --generate-only

plugin-build-binary:
	cd pkg/subgraphs/projects/ && go build -o ./bin/$(shell go env GOOS)_$(shell go env GOARCH) ./src

plugin-compose:
	$(wgc_router) compose -i ./graph-with-plugin.yaml -o ./configWithPlugins.json
	pnpx prettier ./configWithPlugins.json -w

plugin-build-integration: plugin-build plugin-compose
	rm -rf ../router/plugins/*
	cp -a pkg/subgraphs/projects ../router/plugins/
	cp -a pkg/subgraphs/student ../router/plugins/
	mv configWithPlugins.json ../router-tests/testenv/testdata/configWithPlugins.json
	
plugin-build-ci: plugin-build-binary
	rm -rf ../router/plugins/*
	mkdir -p ../router/plugins/projects/bin
	cp -a pkg/subgraphs/projects/bin/* ../router/plugins/projects/bin/

standalone-compose:
	$(wgc_router) compose -i ./graph-with-standalone.yaml -o ./configWithStandalone.json
	pnpx prettier ./configWithStandalone.json -w

standalone-integration: standalone-compose
	mv ./configWithStandalone.json ../router-tests/testenv/testdata/configWithGRPC.json
