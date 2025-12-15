# ConnectRPC Test Data

This directory contains Protocol Buffer definitions and GraphQL operations for ConnectRPC integration tests.

## Writing New Tests

To add a new service for testing:

1. Create a new directory under `services/` (e.g., `services/myservice.v1/`)
2. Add your `.proto` file with service definitions - or generate it with `wgc grpc-service generate`
3. Add corresponding `.graphql` files (GraphQL Executable Operations) for each RPC method
4. The ConnectRPC server will automatically discover and load them

### Example Structure

```text
services/
└── myservice.v1/
    ├── service.proto                   # Proto service definition
    ├── QueryGetItem.graphql            # GraphQL query operation
    └── MutationCreateItem.graphql      # GraphQL mutation operation
```

## Regenerating Client Code

The `client/` directory contains generated client code used by E2E tests. This code is **committed to the repository**.

### When to Regenerate

Regenerate when:
- Proto service definitions are modified (`services/*/service.proto`)
- GraphQL operations are added, removed, or modified (`services/*/*.graphql`)
- Message types are changed in proto files
