generate:
	go generate ./...

bump-deps:
	./bump-deps.sh

PHONY: plugin-build plugin-generate plugin-build-binary plugin-build-integration

plugin-build:
	pnpx tsx --env-file ../cli/.env ../cli/src/index.ts router plugin build ./pkg/subgraphs/projects --debug --go-module-path github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects

plugin-generate:
	pnpx tsx --env-file ../cli/.env ../cli/src/index.ts router plugin build ./pkg/subgraphs/projects --generate-only --go-module-path github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects

plugin-build-binary:
	cd pkg/subgraphs/projects/ && go build -o ./bin/$(shell go env GOOS)_$(shell go env GOARCH) ./src

plugin-compose:
	pnpx tsx --env-file ../cli/.env ../cli/src/index.ts router compose -i ./graph-with-plugin.yaml -o ./configWithPlugins.json

plugin-build-integration: plugin-build plugin-compose
	rm -rf ../router/plugins/*
	cp -a pkg/subgraphs/projects ../router/plugins/
	mv configWithPlugins.json ../router-tests/testenv/testdata/configWithPlugins.json
	
plugin-build-ci: plugin-build-binary
	rm -rf ../router/plugins/*
	mkdir -p ../router/plugins/projects/bin
	cp -a pkg/subgraphs/projects/bin/* ../router/plugins/projects/bin/

standalone-compose:
	pnpx tsx --env-file ../cli/.env ../cli/src/index.ts router compose -i ./graph-with-standalone.yaml -o ./configWithStandalone.json