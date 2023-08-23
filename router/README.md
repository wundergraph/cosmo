# Cosmo Router

The router is the component that understands the GraphQL Federation protocol. It is responsible for routing requests to the correct service and for aggregating the responses. It is in connection with the control plane to register itself and to send metrics.

## Getting Started

### Prerequisites

- [Go 1.20](https://golang.org/doc/install)
- [Connect for Go](https://connect.build/docs/go/getting-started)

Use the `.env.example` file to create a `.env` file with the required environment variables.

```shell
go run main.go
```

# Architecture

We use [Connect](https://connect.build/) to communicate with the controlplane. Connect is framework build on top of [gRPC](https://grpc.io/) and simplify code-generation and reuse between `Studio` -> `Controlplane` <- `Router`.