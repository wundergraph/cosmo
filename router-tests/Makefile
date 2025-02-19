SHELL := bash

test:
	go test -ldflags=-extldflags=-Wl,-ld_classic $(test_params) -race ./...

update-snapshot:
	go test -update -race ./...

test-fresh: clean-testcache test

test-no-race:
	go test ./...

lint:
	go vet ./...
	staticcheck ./...

test-stability:
	@while $(MAKE) test-fresh; do :; done

clean-testcache:
	go clean -testcache

update-test-config:
	./update-config-no-edg.sh

.PHONY: test test-no-race lint test-stability clean-testcache update-test-config test-fresh

bump-deps:
	./bump-deps.sh
