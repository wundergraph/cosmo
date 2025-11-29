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
└── README.md             # This file
```

## Purpose

These proto files and GraphQL operations are used by the ConnectRPC server to:
1. **Discover services** - Parse proto files to identify RPC services and methods
2. **Load operations** - Read GraphQL operations that correspond to each RPC method
3. **Generate handlers** - Create HTTP handlers that translate RPC calls to GraphQL requests

## Testing

The integration tests in `router-tests/connectrpc_test.go` verify:
- **Service discovery** - Proto files are correctly parsed and services are registered
- **Operation loading** - GraphQL operations are loaded and associated with RPC methods
- **Server lifecycle** - Server can start, reload, and stop correctly
- **Router integration** - ConnectRPC works with the main router testenv

## Adding New Services

To add a new service for testing:

1. Create a new directory under `services/` (e.g., `services/myservice.v1/`)
2. Add corresponding `.graphql` files (GraphQL Executable Operations)
3. Add your `.proto` file with service definitions - or generate it with `wgc`
4. The ConnectRPC server will automatically discover and load them

Example proto file:
```protobuf
syntax = "proto3";

package myservice.v1;

service MyService {
  rpc GetData(GetDataRequest) returns (GetDataResponse) {
    option idempotency_level = NO_SIDE_EFFECTS;
  }
}

message GetDataRequest {
  int32 id = 1;
}

message GetDataResponse {
  string data = 1;
}
```

Example GraphQL operation (`QueryGetData.graphql`):
```graphql
query GetData($id: Int!) {
  data(id: $id) {
    value
  }
}
```
