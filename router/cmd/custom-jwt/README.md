# Custom module to re-sign JWT tokens

This program contains an example of using a custom module for signing JWT
with a private key before sending any requests upstream. For a full example
of a custom module, see [custom](../custom/).

## Run the Router

Before you can run the router, you need to copy the `.env.example` to `.env` and adjust the values.

```bash
go run ./cmd/custom-jwt/main.go
```

## Build your own Router

```bash
go build -o router ./cmd/custom-jwt/main.go
```

## Run tests

Tests for this module can be found within the [integration tests](../router-tests/module-jwt).

_All commands are run from the root of the router directory._

## Credits

The module system is inspired by [Caddy](https://github.com/caddyserver/caddy).
