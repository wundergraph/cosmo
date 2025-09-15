# Cosmo Router

The router is the component that understands the GraphQL Federation protocol. It is responsible for routing requests to the correct service and for aggregating the responses. It is in connection with the control plane to register itself and to send metrics.

## Getting Started

- [Profiling](./docs/Profiling.md)
- [Configuration](./docs/Configuration.md)

### Prerequisites

- [Go 1.25](https://golang.org/doc/install)

Use the `.env.example` file to create a `.env` file with the specified environment variables.

```shell
make dev
```

## Code Generation

Code is committed to the repository, but if you want to regenerate the code, you can run the command in the root of the repository:

```shell
make generate-go
```

## Develop with a local Engine version

You can uncomment te replace directive in the [`go.mod`](go.mod) file to use the local version of the `graphql-go-tools` package. You only need to ensure that you have checked out the `graphql-go-tools` repository in the same parent directory as the `router` repository.

```
replace github.com/wundergraph/graphql-go-tools/v2 => ../../graphql-go-tools/v2
```

## Build your own Router

See [Router Customizability](https://cosmo-docs.wundergraph.com/router/customizability) how to build your own router.

# Architecture

The router is a HTTP server that accepts GraphQL requests and forwards them to the correct service.
The core aka [`the Engine`](https://github.com/wundergraph/graphql-go-tools) implements the GraphQL Federation protocol and is responsible for parsing the request, resolving the query and aggregating the responses.
We use [Connect](https://connect.build/) to communicate with the controlplane. Connect is framework build on top of [gRPC](https://grpc.io/) and simplify code-generation and reuse between `Studio` -> `Controlplane` <- `Router`.
