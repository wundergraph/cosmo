# Router Integration Tests

This directory contains integration tests for the router. It is a separate package
to prevent dependencies of the tests and demos from becoming dependencies of
github.com/wundergraph/cosmo/router.

## Running the tests

```bash
go test -race -v ./...
```

It can take a while until the tests finish.

## Updating fixtures

Some of the tests uses the [goldie](https://github.com/sebdah/goldie) based snaphots

In case you need to update all snaphots, you can run the following command:

```bash
go test -update ./...
```

Be aware that this will overwrite all snaphots with the current output of the tests.
Use this command with caution.

Alternatively you can update a single snaphot by temporarily replacing call to `g.Assert` with `g.Update` in the test and running the test.
