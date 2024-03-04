test:
	go test -race ./...

test-no-race:
	go test ./...

lint:
	go vet ./...
	staticcheck ./...

test-stability:
	for number in 1 2 3 4 5 6 7 8 9 10 ; do \
		make clean-testcache && make test ; \
	done

clean-testcache:
	go clean -testcache

update-test-config:
	./update-config.sh

.PHONY: test test-no-race
