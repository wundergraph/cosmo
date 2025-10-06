# Connect RPC Server

The Connect RPC server provides a Connect RPC interface to GraphQL operations, supporting Connect, gRPC, and gRPC-Web protocols. It uses Connect-Go's interceptor system for automatic protocol detection, encoding/decoding, and routing to GraphQL operations.

## Overview

The Connect RPC server:
- Reads GraphQL operations from a configured directory
- Maps Connect RPC method calls to GraphQL operations using Connect-Go interceptors
- Executes GraphQL queries against the router endpoint
- Returns responses in the appropriate protocol format (Connect/gRPC/gRPC-Web)

## Architecture

```
Connect/gRPC/gRPC-Web Client → Connect-Go Handler → Connect-Go Interceptor → Operations Manager → GraphQL Execution → Router
```

The server leverages Connect-Go's built-in capabilities:
- **Automatic Protocol Detection**: Connect-Go detects Connect, gRPC, and gRPC-Web protocols
- **Automatic Encoding/Decoding**: Handles JSON and Protobuf encoding transparently  
- **Dynamic Routing**: Uses interceptors to route to GraphQL operations dynamically

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

1. **Connect-Go Handler**: Connect-Go automatically detects protocol and decodes request
2. **Connect RPC Request**: Client sends request to `/service.v1.EmployeeService/GetEmployeeByID`
3. **Interceptor Processing**: Connect-Go interceptor extracts method name `GetEmployeeByID`
4. **Operation Lookup**: Server finds corresponding GraphQL operation file `GetEmployeeByID.graphql`
5. **Request Processing**: Connect-Go provides decoded request data automatically
6. **GraphQL Execution**: Operation executed against router GraphQL endpoint
7. **Response Transform**: GraphQL response converted and Connect-Go handles protocol encoding

## Example Requests

### Connect Protocol (JSON)
```bash
curl -X POST http://localhost:5026/service.v1.EmployeeService/GetEmployeeByID \
  -H "Content-Type: application/json" \
  -d '{"employee_id": 1}'
```

### Connect Protocol (Connect+JSON)
```bash
curl -X POST http://localhost:5026/service.v1.EmployeeService/GetEmployeeByID \
  -H "Content-Type: application/connect+json" \
  -d '{"employee_id": 1}'
```

### gRPC-Web Protocol
```bash
curl -X POST http://localhost:5026/service.v1.EmployeeService/GetEmployeeByID \
  -H "Content-Type: application/grpc-web+json" \
  -d '{"employee_id": 1}'
```

All requests:
- Map to the `GetEmployeeByID` GraphQL operation
- Pass `{"employee_id": 1}` as GraphQL variables
- Return the GraphQL response in the appropriate protocol format

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

## Protocol Support

The server leverages Connect-Go's automatic protocol support:

### Connect Protocol
- **Content-Type**: `application/json` or `application/connect+json`
- **Format**: JSON and binary Protobuf messages
- **Use Case**: Web browsers, REST-like clients
- **Handled by**: Connect-Go automatic detection and encoding

### gRPC Protocol  
- **Content-Type**: `application/grpc` and `application/grpc+json`
- **Format**: Binary Protobuf and JSON over HTTP/2
- **Use Case**: Standard gRPC clients
- **Handled by**: Connect-Go automatic detection and encoding

### gRPC-Web Protocol
- **Content-Type**: `application/grpc-web` and `application/grpc-web+json`  
- **Format**: Binary Protobuf and JSON messages for web browsers
- **Use Case**: Browser-based gRPC clients
- **Handled by**: Connect-Go automatic detection and encoding

**Key Benefits:**
- No manual protocol parsing required
- Automatic encoding/decoding between JSON and Protobuf
- Built-in compression support
- Proper error handling per protocol

## Error Handling

The server handles various error scenarios using Connect-Go's error system:
- **Method Not Found**: Returns `connect.CodeNotFound` if no matching GraphQL operation exists
- **Invalid Input**: Returns `connect.CodeInvalidArgument` for validation failures
- **GraphQL Errors**: Returns `connect.CodeInternal` for GraphQL execution errors
- **Server Errors**: Returns appropriate Connect error codes for internal failures

Connect-Go automatically formats errors according to the detected protocol.

## CORS Support

The server includes CORS middleware that:
- Allows all origins (`*`)
- Supports standard HTTP methods plus OPTIONS
- Includes Connect, gRPC, and gRPC-Web specific headers
- Handles preflight requests
- Works with Connect-Go's automatic protocol handling

## Testing

Run the tests:

```bash
go test ./router/pkg/connect_rpc/...
```

The test suite includes:
- Unit tests for all major components
- Integration tests with mock GraphQL servers
- Proto file parsing tests
- Connect-Go interceptor tests

## Integration with Router

The Connect RPC server is designed to work alongside the existing router infrastructure:
- Uses Connect RPC specific `OperationsManager` for dynamic operation loading
- Includes `ProtoManager` for dynamic service discovery
- Uses Connect-Go interceptors for automatic protocol handling
- Executes GraphQL queries against the same router endpoint
- Follows similar patterns to the existing graphqlmetrics Connect-Go service

## Comparison with MCP Server

| Feature | MCP Server | Connect RPC Server |
|---------|------------|-------------------|
| Protocol | MCP | Connect/gRPC/gRPC-Web |
| Transport | HTTP/SSE | HTTP |
| Request Format | MCP Tool Calls | Protocol-specific Messages |
| Response Format | MCP Tool Results | Protocol-specific Messages |
| Operation Loading | ✅ | ✅ |
| Dynamic Proto Loading | ❌ | ✅ |
| Protocol Detection | ❌ | ✅ (Connect-Go) |
| GraphQL Execution | ✅ | ✅ |
| CORS Support | ✅ | ✅ |

The Connect RPC server provides multi-protocol support with dynamic service discovery using Connect-Go's built-in capabilities, while the MCP server focuses on the MCP protocol specifically.

## Connect-Go Integration

The implementation leverages Connect-Go's powerful features:

### Interceptor System
```go
// Connect-Go interceptor handles all protocol detection automatically
func (s *ConnectRPCServer) createConnectInterceptor() connect.UnaryInterceptorFunc {
    return func(next connect.UnaryFunc) connect.UnaryFunc {
        return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
            // Protocol automatically detected: req.Peer().Protocol
            // Request automatically decoded: req.Any()
            // Response automatically encoded by Connect-Go
        }
    }
}
```

### Dynamic Handler Creation
```go
// Create handlers similar to existing graphqlmetrics service
handler := connect.NewUnaryHandler(
    methodPath,
    dummyHandler, // Real logic in interceptor
    connect.WithInterceptors(interceptor),
)
```

This approach provides the same benefits as your existing graphqlmetrics service but with dynamic proto loading capabilities.