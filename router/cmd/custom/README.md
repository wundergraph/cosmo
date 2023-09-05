# Custom Router

This entrypoint serve as an example about how to build your own custom Cosmo Router.
The main.go file is the entrypoint of the router and is responsible for starting the router.
You can see we will load the default Router and your custom module.

```go
package main

import (
	routercmd "github.com/wundergraph/cosmo/router/cmd"
	// Import your modules here
	_ "github.com/wundergraph/cosmo/router/cmd/custom/module"
)

func main() {
	routercmd.Main()
}
```

## Run the Router

Before you can run the router, you need to copy the `.env.example` to `.env` and adjust the values.

```bash
go run ./cmd/custom/main.go
```

## Build your own Router

```bash
go build -o router ./cmd/custom/main.go
```

## Build your own Image

```bash
docker build -f custom.Dockerfile -t router-custom:latest .
```

## Run tests

In order to run the tests, you need to run the example subgraph first. We use the demo subgraph for this.

```
make dc-subgraphs-demo
```

In practice, you would create a custom router config and mock the subgraph dependencies in your tests.

_All commands are run from the root of the router directory._

## Credits

The module system is inspired by [Caddy](https://github.com/caddyserver/caddy).