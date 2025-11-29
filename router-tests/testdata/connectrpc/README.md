# ConnectRPC Test Data

This directory contains Protocol Buffer definitions and GraphQL operations for ConnectRPC integration tests.

## Directory Structure

```
router-tests/testdata/connectrpc/
├── services/             # Proto service definitions and GraphQL operations
│   └── employee.v1/      # Employee service v1
│       ├── service.proto                              # Proto service definition
│       ├── QueryGetEmployeeById.graphql              # GraphQL query operation
│       ├── QueryGetEmployeeByPets.graphql            # GraphQL query operation
│       ├── QueryGetEmployees.graphql                 # GraphQL query operation
│       ├── QueryGetEmployeesByPetsInlineFragment.graphql
│       ├── QueryGetEmployeesByPetsNamedFragment.graphql
│       ├── QueryGetEmployeeWithMood.graphql          # GraphQL query operation
│       └── MutationUpdateEmployeeMood.graphql        # GraphQL mutation operation
├── client/                  # Generated client code (committed to repo)
│   └── employee/
│       └── v1/
│           ├── employeev1connect/  # Connect RPC client
│           └── service.pb.go       # Protobuf types
├── buf.yaml              # Buf configuration
├── buf.gen.yaml          # Buf code generation config
└── README.md             # This file
```

## Purpose

These proto files and GraphQL operations are used by the ConnectRPC server to:
1. **Discover services** - Parse proto files to identify RPC services and methods
2. **Load operations** - Read GraphQL operations that correspond to each RPC method
3. **Generate handlers** - Create HTTP handlers that translate RPC calls to GraphQL requests

## Testing

The integration tests verify:
- **Service discovery** (`router-tests/connectrpc_test.go`) - Proto files are correctly parsed and services are registered
- **Operation loading** - GraphQL operations are loaded and associated with RPC methods
- **Server lifecycle** - Server can start, reload, and stop correctly
- **Router integration** - ConnectRPC works with the main router testenv
- **E2E protocol tests** (`router-tests/connectrpc_client_test.go`) - All three RPC protocols (Connect, gRPC, gRPC-Web) work correctly
- **Error handling** - GraphQL errors and HTTP status codes are properly mapped to Connect error codes
- **Concurrency** - Multiple simultaneous requests are handled correctly

## Regenerating Client Code

The `client/` directory contains generated client code used by the E2E tests. This code is **committed to the repository** to ensure tests work without requiring buf to be installed.

### When to Regenerate

You need to regenerate the client code when:
- Proto service definitions are modified (`services/*/service.proto`)
- GraphQL operations are added, removed, or modified (`services/*/*.graphql`)
- Message types are changed in proto files

## Adding New Services

To add a new service for testing:

1. Create a new directory under `services/` (e.g., `services/myservice.v1/`)
2. Add corresponding `.graphql` files (GraphQL Executable Operations)
3. Add your `.proto` file with service definitions - or generate it with `wgc grpc-service generate`
4. The ConnectRPC server will automatically discover and load them if configured to do so
