# Custom Router

This entrypoint serve as an example about how to build your own custom Cosmo Router.
The main.go file is the entrypoint of the router and is responsible for starting the router.
You can see we will load the default Router and your custom module.

```go
package main

import (
	routercmd "github.com/wundergraph/cosmo/router/cmd"
	// Import your modules here
	_ "github.com/wundergraph/cosmo/router/cmd/custom-luna/module"
)

func main() {
	routercmd.Main()
}
```

## Run the Router

Before you can run the router, you need to copy the `.env.example` to `.env` and adjust the values.

```bash
go run ./cmd/custom-luna/main.go
```

## Build your own Router

```bash
go build -o router ./cmd/custom-luna/main.go
```

## Build your own Image

```bash
docker build -f custom.Dockerfile -t router-custom:latest .
```

## Run tests

Tests for this module can be found within the [integration tests](../router-tests/module).

_All commands are run from the root of the router directory._

## Credits

The module system is inspired by [Caddy](https://github.com/caddyserver/caddy).
