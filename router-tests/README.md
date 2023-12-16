# Router Integration Tests

This directory contains integration tests for the router. It is a separate package
to prevent dependencies of the tests and demos from becoming dependencies of
github.com/wundergraph/cosmo/router.

## Running the tests

```bash
go test -race -v ./...
```

It can take a while until the tests finish.
