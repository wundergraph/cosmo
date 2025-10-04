# Router Integration Tests

This directory contains integration tests for the router. It is a separate package
to prevent dependencies of the tests and demos from becoming dependencies of
github.com/wundergraph/cosmo/router.

## Updating the demo subgraphs

Regenerate the router execution config with `./update-config-no-edg.sh`.
This will propagate any changes from the SDLs.

## Running the tests

```bash
go test -race -v ./...
```

It can take a while until the tests finish.

## Updating fixtures

Some tests use the [goldie](https://github.com/sebdah/goldie) based snaphots.

In case you need to update all snapshots, run the following command:

```bash
GOLDIE_UPDATE=1 go test ./...
```

Be aware that this will overwrite all snapshots with the current output of the tests.
Use this command with caution.

Alternatively you can update a single snapshot by temporarily replacing call to `g.Assert` with `g.Update` in the test and running the test.
