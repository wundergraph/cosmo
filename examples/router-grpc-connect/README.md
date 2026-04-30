# Router gRPC Subgraph over ConnectRPC

This example demonstrates how to run the Cosmo Router against a gRPC
subgraph using the [ConnectRPC](https://connectrpc.com/) protocol over
plain HTTP/1.1, instead of native gRPC over HTTP/2. ConnectRPC is useful
when end-to-end HTTP/2 to the subgraph is not available, for example when
a proxy or load balancer in front of the subgraph does not forward gRPC.

The same subgraph implementation works for both transports because the
[`connect-go`](https://connectrpc.com/docs/go) runtime serves Connect,
gRPC, and gRPC-Web on the same HTTP endpoint.

## Prerequisites

- [Go 1.23+](https://go.dev/dl/) (for the demo subgraph)
- [Node.js & NPM (LTS)](https://nodejs.org/en/download/) (for `wgc`)
- The `cosmo` repository checked out alongside this example so that the
  `../../demo/pkg/subgraphs/projects` paths in [graph.yaml](graph.yaml)
  resolve.

## Getting started

```bash
./start.sh
```

`start.sh` will:

1. Install `wgc` and download the latest router binary.
2. Build and start the standalone projects subgraph from
   `cosmo/demo/pkg/subgraphs/projects` on `:4011` over H2C.
3. Compose the federated schema from [graph.yaml](graph.yaml) into
   `config.json`.
4. Start the router. The router reads [config.yaml](config.yaml), which
   sets `grpc_protocol.default_protocol: connectrpc`, so every gRPC
   subgraph is reached over plain HTTP/1.1.

Open the GraphQL Playground at
[http://localhost:3002](http://localhost:3002) and run:

```graphql
query {
  projects {
    id
    name
    description
    status
  }
}
```

## Configuration reference

```yaml
grpc_protocol:
  default_protocol: connectrpc   # or "grpc"
  default_encoding: proto        # or "json"
  subgraphs:
    projects:
      protocol: connectrpc
      encoding: json
    inventory:
      protocol: grpc
```

See
[gRPC Subgraph Protocol](https://cosmo-docs.wundergraph.com/router/configuration#grpc-subgraph-protocol)
in the router configuration reference for the full schema and
[gRPC Concepts](https://cosmo-docs.wundergraph.com/router/grpc/concepts#connectrpc-support)
for the conceptual overview.

## Registering a ConnectRPC subgraph in the control plane

When deploying through the Cosmo control plane, register the subgraph
with an `http://` or `https://` routing URL:

```bash
wgc grpc-service create projects \
  --routing-url http://projects.internal:4011 \
  --label team=projects
```

The control plane accepts both gRPC name resolver schemes
(`dns:///host:port`, `unix:/...`, etc.) and `http(s)://` URLs for
GRPC_SERVICE subgraphs. Pick whichever matches the protocol you intend
to use at runtime.
