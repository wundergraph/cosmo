SHELL := bash

test:
	go test -race ./...

test-no-race:
	go test ./...

lint:
	go vet ./...
	staticcheck ./...

LOOPS=20
test-stability:
	for ((i=1; i <= ${LOOPS}; ++i)) do make test; done

clean-testcache:
	go clean -testcache

update-test-config:
	./update-config.sh

.PHONY: test test-no-race lint test-stability clean-testcache update-test-config
