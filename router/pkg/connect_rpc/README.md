# Connect RPC Server

The Connect RPC server provides a Connect RPC interface to GraphQL operations, similar to the MCP server but using the Connect RPC protocol. It wraps the [vanguard-go](https://github.com/connectrpc/vanguard-go) server to handle Connect RPC protocol details.

## Overview

The Connect RPC server:
- Reads GraphQL operations from a configured directory
- Maps Connect RPC method calls to GraphQL operations
- Executes GraphQL queries against the router endpoint
- Returns responses in Connect RPC format

## Architecture

```
Connect RPC Client → Vanguard Handler → Connect RPC Server → Operations Manager → GraphQL Execution → Router
```

## Usage

### Basic Setup

```go
package main

import (
    "context"
    "log"
    "time"
    
    "github.com/wundergraph/cosmo/router/pkg/connect_rpc"
    "go.uber.org/zap"
)

func main() {
    logger, _ := zap.NewProduction()
    
    server, err := connect_rpc.NewConnectRPCServer(
        "http://localhost:4000/graphql", // Router GraphQL endpoint
        connect_rpc.WithListenAddr("0.0.0.0:5026"),
        connect_rpc.WithOperationsDir("./operations"),
        connect_rpc.WithProtoDir("./proto"),
        connect_rpc.WithLogger(logger),
        connect_rpc.WithExcludeMutations(false),
    )
    if err != nil {
        log.Fatal(err)
    }
    
    // Load GraphQL schema and operations
    schema := loadYourGraphQLSchema() // Your schema loading logic
    if err := server.Reload(schema); err != nil {
        log.Fatal(err)
    }
    
    // Start the server
    if err := server.Start(); err != nil {
        log.Fatal(err)
    }
    
    // Graceful shutdown
    defer func() {
        ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
        defer cancel()
        server.Stop(ctx)
    }()
    
    // Keep the server running
    select {}
}
```

### Configuration Options

- `WithListenAddr(addr string)`: Set the server listen address (default: "0.0.0.0:5026")
- `WithOperationsDir(dir string)`: Set the GraphQL operations directory (default: "operations")
- `WithProtoDir(dir string)`: Set the proto files directory (default: "proto")
- `WithLogger(logger *zap.Logger)`: Set the logger instance
- `WithExcludeMutations(exclude bool)`: Exclude mutation operations (default: false)
- `WithRequestTimeout(timeout time.Duration)`: Set HTTP request timeout (default: 30s)
- `WithEnabled(enabled bool)`: Enable/disable the server (default: false)

## Request Flow

1. **Connect RPC Request**: Client sends request to `/service.v1.EmployeeService/GetEmployeeByID`
2. **Method Extraction**: Server extracts method name `GetEmployeeByID`
3. **Operation Lookup**: Server finds corresponding GraphQL operation file `GetEmployeeByID.graphql`
4. **Input Validation**: Request payload validated against JSON schema (if available)
5. **GraphQL Execution**: Operation executed against router GraphQL endpoint
6. **Response Transform**: GraphQL response converted to Connect RPC format

## Example Request

```bash
curl -X POST http://localhost:5026/service.v1.EmployeeService/GetEmployeeByID \
  -H "Content-Type: application/json" \
  -d '{"employee_id": 1}'
```

This request:
- Maps to the `GetEmployeeByID` GraphQL operation
- Passes `{"employee_id": 1}` as GraphQL variables
- Returns the GraphQL response in Connect RPC format

## Directory Structure

```
project/
├── operations/           # GraphQL operation files
│   ├── GetEmployeeByID.graphql
│   ├── CreateEmployee.graphql
│   └── ...
├── proto/               # Generated proto files (optional)
│   ├── employee.proto
│   └── ...
└── main.go
```

## GraphQL Operations

Each GraphQL operation should be in its own `.graphql` file:

**operations/GetEmployeeByID.graphql**:
```graphql
query GetEmployeeByID($employee_id: ID!) {
  employee(id: $employee_id) {
    id
    name
    email
  }
}
```

## Proto Files

Proto files are generated from GraphQL operations using `protographic/src/operations-to-proto-visitor.ts`. The server can optionally read these files for service discovery, but the primary mapping is based on method names matching operation names.

## Error Handling

The server handles various error scenarios:
- **Method Not Found**: Returns `connect.CodeNotFound` if no matching GraphQL operation exists
- **Invalid Input**: Returns `connect.CodeInvalidArgument` for validation failures
- **GraphQL Errors**: Returns `connect.CodeInternal` for GraphQL execution errors
- **Server Errors**: Returns appropriate Connect error codes for internal failures

## CORS Support

The server includes CORS middleware that:
- Allows all origins (`*`)
- Supports standard HTTP methods plus OPTIONS
- Includes Connect-specific headers
- Handles preflight requests

## Testing

Run the tests:

```bash
go test ./router/pkg/connect_rpc/...
```

The test suite includes:
- Unit tests for all major components
- Integration tests with mock GraphQL servers
- Proto file parsing tests
- CORS middleware tests

## Integration with Router

The Connect RPC server is designed to work alongside the existing router infrastructure:
- Reuses `OperationsManager` from the MCP server
- Uses the same `SchemaCompiler` for input validation
- Executes GraphQL queries against the same router endpoint
- Follows similar configuration patterns

## Comparison with MCP Server

| Feature | MCP Server | Connect RPC Server |
|---------|------------|-------------------|
| Protocol | MCP | Connect RPC |
| Transport | HTTP/SSE | HTTP |
| Request Format | MCP Tool Calls | Connect RPC Messages |
| Response Format | MCP Tool Results | Connect RPC Messages |
| Operation Loading | ✅ | ✅ |
| Schema Validation | ✅ | ✅ |
| GraphQL Execution | ✅ | ✅ |
| CORS Support | ✅ | ✅ |

Both servers provide different protocol interfaces to the same underlying GraphQL operations.