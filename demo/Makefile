generate:
	go generate ./...

bump-deps:
	./bump-deps.sh

PHONY: plugin-build plugin-generate plugin-build-binary plugin-build-integration

plugin-build:
	pnpx wgc@latest router plugin build ./pkg/subgraphs/projects --debug --go-module-path github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects

plugin-generate:
	pnpx wgc@latest router plugin build ./pkg/subgraphs/projects --generate-only --go-module-path github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects

plugin-build-binary:
	cd pkg/subgraphs/projects/ && go build -o ./bin/$(shell go env GOOS)_$(shell go env GOARCH) ./src/

plugin-build-integration: plugin-build
	rm -rf ../router/plugins/*
	cp -R pkg/subgraphs/projects ../router/plugins/
