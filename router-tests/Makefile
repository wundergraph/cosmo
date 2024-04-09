SHELL := bash

test:
	go test -race ./...

test-fresh: clean-testcache test

test-no-race:
	go test ./...

lint:
	go vet ./...
	staticcheck ./...

LOOPS=20
test-stability:
	for ((i=1; i <= ${LOOPS}; ++i)) do make test-fresh; done

clean-testcache:
	go clean -testcache

update-test-config:
	./update-config.sh

.PHONY: test test-no-race lint test-stability clean-testcache update-test-config test-fresh

bump-deps:
	go get github.com/wundergraph/cosmo/router@upgrade
	go get github.com/wundergraph/cosmo/demo@upgrade
	go mod tidy
	cd .. && go work sync
