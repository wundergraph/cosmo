SHELL := bash
test_target := ./...
test_retry_count ?= 0
coverage_file := coverage.out

ifeq ($(CI),true)
 FORMAT := github-actions
else
 FORMAT := pkgname
endif

test-deps:
	$(MAKE) -C ../demo plugin-build-ci

test: test-deps
	gotestsum --rerun-fails="$(test_retry_count)" --packages="$(test_target)" -f $(FORMAT) -- -ldflags=-extldflags=-Wl,-ld_classic $(test_params) -race $(test_target)

test-coverage: test-deps
	gotestsum --rerun-fails="$(test_retry_count)" --packages="$(test_target)" -f $(FORMAT) -- \
		-ldflags=-extldflags=-Wl,-ld_classic $(test_params) -race \
		-coverprofile=$(coverage_file) \
		-coverpkg=github.com/wundergraph/cosmo/router/... \
		$(test_target)

update-snapshot:
	GOLDIE_UPDATE=1 go test -race $(test_target)

test-fresh: clean-testcache test

test-no-race:
	go test $(test_target)

test-no-race-fresh: clean-testcache
	go test $(test_target)

lint:
	go vet ./...
	staticcheck ./...

test-stability:
	@while $(MAKE) test-fresh; do :; done

test-stability-no-race:
	@while $(MAKE) test-no-race-fresh; do :; done

clean-testcache:
	go clean -testcache

update-test-config:
	./update-config-no-edg.sh

.PHONY: test test-no-race lint test-stability clean-testcache update-test-config test-fresh test-coverage

bump-deps:
	./bump-deps.sh
