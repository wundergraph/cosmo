# ConnectRPC Integration for Cosmo Router

This package provides ConnectRPC integration for the Cosmo Router, enabling gRPC, Connect, and gRPC-Web protocol support with automatic GraphQL translation.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [Naming Conventions](#naming-conventions)
- [Usage Examples](#usage-examples)
- [Protocol Support](#protocol-support)
- [Configuration](#configuration)
- [Testing](#testing)

## Overview

The ConnectRPC integration allows you to expose your GraphQL API through gRPC-compatible protocols. It uses [Vanguard](https://github.com/connectrpc/vanguard) for protocol transcoding and supports two modes:

1. **Dynamic Mode**: Automatically generates GraphQL operations from proto definitions
2. **Predefined Mode**: Uses pre-defined GraphQL operations mapped to RPC methods

## Features

- ✅ **Multi-Protocol Support**: gRPC, Connect, and gRPC-Web
- ✅ **Automatic Translation**: Proto messages ↔ GraphQL operations
- ✅ **Header Forwarding**: Transparent header propagation to GraphQL endpoint
- ✅ **Hot Reload**: Update proto files and operations without restart
- ✅ **Type Safety**: Full protobuf type checking
- ✅ **Naming Convention**: Query/Mutation prefixes for operation type detection

## Architecture

The ConnectRPC server converts RPC calls to GraphQL queries and supports two operational modes:

```mermaid
graph TB
    subgraph Startup["Startup Phase"]
        ProtoFiles["Proto Files<br/>(.proto)"]
        ProtoLoader["ProtoLoader<br/>(Parses .proto files)"]
        ServiceDefs["ServiceDefinitions<br/>(Methods + Message Descriptors)"]
        
        ProtoFiles --> ProtoLoader
        ProtoLoader --> ServiceDefs
        
        subgraph DynamicInit["Dynamic Mode Init"]
            OpBuilder["OperationBuilder"]
            OpRegistry1["OperationRegistry<br/>(Empty)"]
            PreGen["preGenerateOperations()<br/>1. Iterate all methods<br/>2. Build GraphQL for each<br/>3. Add to registry"]
            
            ServiceDefs --> PreGen
            OpBuilder -->|"Used by"| PreGen
            PreGen --> OpRegistry1
            OpRegistry1 -.->|"Cached operations"| OpRegistry1
        end
        
        subgraph PredefinedInit["Predefined Mode Init"]
            GraphQLFiles["GraphQL Files<br/>(.graphql)"]
            OpRegistry2["OperationRegistry<br/>(Loaded from files)"]
            GraphQLFiles --> OpRegistry2
            ServiceDefs -.->|"Validates against"| OpRegistry2
        end
    end
    
    subgraph Runtime["Request Flow (Runtime)"]
        Client["Client<br/>(gRPC/Connect/gRPC-Web)"]
        Vanguard["Vanguard Transcoder<br/>(Protocol → JSON)"]
        VanguardSvc["VanguardService<br/>(Routes to handler)"]
        RPCHandler["RPCHandler.HandleRPC()<br/>(Orchestrates request)"]
        
        Client -->|"RPC Request"| Vanguard
        Vanguard -->|"JSON + Method"| VanguardSvc
        VanguardSvc --> RPCHandler
        
        subgraph ModeSwitch["Mode-Specific Processing"]
            DynamicPath["handleDynamicMode()<br/>1. Lookup operation in registry<br/>2. Get pre-built query"]
            PredefinedPath["handlePredefinedMode()<br/>1. Lookup operation in registry<br/>2. Get pre-built query"]
        end
        
        RPCHandler -->|"Dynamic"| DynamicPath
        RPCHandler -->|"Predefined"| PredefinedPath
        
        GraphQLQuery["GraphQL Query<br/>+ Variables"]
        DynamicPath --> GraphQLQuery
        PredefinedPath --> GraphQLQuery
        
        ExecuteGQL["executeGraphQL()<br/>(HTTP POST)"]
        GraphQLRouter["GraphQL Router<br/>(Executes query)"]
        
        GraphQLQuery --> ExecuteGQL
        ExecuteGQL -->|"HTTP Request"| GraphQLRouter
        GraphQLRouter -->|"GraphQL Response"| ExecuteGQL
        ExecuteGQL --> RPCHandler
        RPCHandler --> VanguardSvc
        VanguardSvc --> Vanguard
        Vanguard -->|"RPC Response"| Client
    end
    
    OpRegistry1 -.->|"Used by"| DynamicPath
    OpRegistry2 -.->|"Used by"| PredefinedPath
    ServiceDefs -.->|"Used by"| VanguardSvc
    
    style DynamicInit fill:#e1f5ff
    style PredefinedInit fill:#fff4e1
    style DynamicPath fill:#e1f5ff
    style PredefinedPath fill:#fff4e1
```

**Key Points:**
- **ProtoLoader**: Parses `.proto` files at startup into `ServiceDefinitions` (methods + message descriptors)
- **Dynamic Mode**: Pre-generates ALL GraphQL operations **at startup** using `OperationBuilder` and caches them in `OperationRegistry`
- **Predefined Mode**: Loads pre-defined GraphQL operations from `.graphql` files into `OperationRegistry`
- **Both modes**: Normalize to using `OperationRegistry` for fast operation lookups at runtime
- **Runtime**: Both modes simply lookup operations from the registry - no generation happens per request
- **Vanguard**: Handles protocol translation (gRPC/Connect/gRPC-Web → JSON → gRPC/Connect/gRPC-Web)

## Getting Started

### 1. Define Your Proto Service

Create a `.proto` file following the naming convention:

```protobuf
syntax = "proto3";

package myapp.v1;

service UserService {
  // Query operations (read-only)
  // IMPORTANT: Each RPC must have its own Request and Response messages
  rpc QueryGetUser(QueryGetUserRequest) returns (QueryGetUserResponse) {}
  rpc QueryListUsers(QueryListUsersRequest) returns (QueryListUsersResponse) {}
  
  // Mutation operations (write)
  rpc MutationCreateUser(MutationCreateUserRequest) returns (MutationCreateUserResponse) {}
  rpc MutationUpdateUser(MutationUpdateUserRequest) returns (MutationUpdateUserResponse) {}
}

message QueryGetUserRequest {
  int32 id = 1;
}

message QueryGetUserResponse {
  User user = 1;
}

message User {
  int32 id = 1;
  string name = 2;
  string email = 3;
}

// ... other messages
```

### 2. Start the ConnectRPC Server

```go
package main

import (
    "github.com/wundergraph/cosmo/router/pkg/connectrpc"
    "go.uber.org/zap"
)

func main() {
    logger, _ := zap.NewProduction()
    
    server, err := connectrpc.NewServer(connectrpc.ServerConfig{
        ProtoDir:        "./proto",
        GraphQLEndpoint: "http://localhost:4000/graphql",
        ListenAddr:      "0.0.0.0:50051",
        Mode:            connectrpc.HandlerModeDynamic,
        Logger:          logger,
    })
    if err != nil {
        logger.Fatal("failed to create server", zap.Error(err))
    }
    
    if err := server.Start(); err != nil {
        logger.Fatal("failed to start server", zap.Error(err))
    }
    
    // Wait for shutdown signal
    // ...
}
```

### 3. Make Requests

See [Usage Examples](#usage-examples) below for detailed examples.

## Naming Conventions

### Method Naming

RPC methods **must** follow these naming conventions:

- **Query Operations**: Prefix with `Query`
  - `QueryGetUser` → GraphQL Query
  - `QueryListProducts` → GraphQL Query
  - `QuerySearchOrders` → GraphQL Query

- **Mutation Operations**: Prefix with `Mutation`
  - `MutationCreateUser` → GraphQL Mutation
  - `MutationUpdateProduct` → GraphQL Mutation
  - `MutationDeleteOrder` → GraphQL Mutation

### Examples

✅ **Correct:**
```protobuf
service UserService {
  // Each RPC has its own dedicated Request and Response messages
  rpc QueryGetUser(QueryGetUserRequest) returns (QueryGetUserResponse) {}
  rpc MutationCreateUser(MutationCreateUserRequest) returns (MutationCreateUserResponse) {}
}

message QueryGetUserRequest {
  int32 id = 1;
}

message QueryGetUserResponse {
  User user = 1;
}
```

❌ **Incorrect:**
```protobuf
service UserService {
  rpc GetUser(GetUserRequest) returns (User) {}  // Missing Query prefix
  rpc CreateUser(CreateUserRequest) returns (User) {}  // Missing Mutation prefix
  rpc QueryGetUser(GetUserRequest) returns (User) {}  // Shared message types - should be QueryGetUserRequest/Response
}
```

## Usage Examples

### Using gRPC Protocol

#### 1. Using grpcurl

```bash
# List available services
grpcurl -plaintext localhost:50051 list

# Describe a service
grpcurl -plaintext localhost:50051 describe myapp.v1.UserService

# Call QueryGetUser
grpcurl -plaintext \
  -d '{"id": 1}' \
  localhost:50051 \
  myapp.v1.UserService/QueryGetUser

# Call MutationCreateUser with headers
grpcurl -plaintext \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"name": "John Doe", "email": "john@example.com"}' \
  localhost:50051 \
  myapp.v1.UserService/MutationCreateUser
```

#### 2. Using Go Client

```go
package main

import (
    "context"
    "log"
    
    "google.golang.org/grpc"
    "google.golang.org/grpc/credentials/insecure"
    
    pb "myapp/gen/proto/myapp/v1"
)

func main() {
    conn, err := grpc.NewClient(
        "localhost:50051",
        grpc.WithTransportCredentials(insecure.NewCredentials()),
    )
    if err != nil {
        log.Fatal(err)
    }
    defer conn.Close()
    
    client := pb.NewUserServiceClient(conn)
    
    // Query operation
    user, err := client.QueryGetUser(context.Background(), &pb.GetUserRequest{
        Id: 1,
    })
    if err != nil {
        log.Fatal(err)
    }
    log.Printf("User: %+v", user)
    
    // Mutation operation
    newUser, err := client.MutationCreateUser(context.Background(), &pb.CreateUserRequest{
        Name:  "Jane Doe",
        Email: "jane@example.com",
    })
    if err != nil {
        log.Fatal(err)
    }
    log.Printf("Created user: %+v", newUser)
}
```

### Using Connect Protocol

#### 1. Using curl with Connect Protocol

```bash
# Query operation
curl -X POST http://localhost:50051/myapp.v1.UserService/QueryGetUser \
  -H "Content-Type: application/json" \
  -d '{"id": 1}'

# Mutation operation with authentication
curl -X POST http://localhost:50051/myapp.v1.UserService/MutationCreateUser \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com"
  }'

# List users with pagination
curl -X POST http://localhost:50051/myapp.v1.UserService/QueryListUsers \
  -H "Content-Type: application/json" \
  -d '{
    "page": 1,
    "pageSize": 10,
    "filter": "active"
  }'
```

#### 2. Using TypeScript/JavaScript Client

```typescript
import { createPromiseClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { UserService } from "./gen/myapp/v1/user_service_connect";

const transport = createConnectTransport({
  baseUrl: "http://localhost:50051",
});

const client = createPromiseClient(UserService, transport);

// Query operation
const user = await client.queryGetUser({ id: 1 });
console.log("User:", user);

// Mutation operation
const newUser = await client.mutationCreateUser({
  name: "Jane Doe",
  email: "jane@example.com",
});
console.log("Created user:", newUser);

// With custom headers
const userWithAuth = await client.queryGetUser(
  { id: 1 },
  {
    headers: {
      Authorization: "Bearer YOUR_TOKEN",
    },
  }
);
```

### Using gRPC-Web Protocol

#### 1. Using curl with gRPC-Web

```bash
# Query operation (base64 encoded protobuf)
curl -X POST http://localhost:50051/myapp.v1.UserService/QueryGetUser \
  -H "Content-Type: application/grpc-web+proto" \
  -H "X-Grpc-Web: 1" \
  --data-binary @request.bin

# For JSON format
curl -X POST http://localhost:50051/myapp.v1.UserService/QueryGetUser \
  -H "Content-Type: application/grpc-web-text+json" \
  -H "X-Grpc-Web: 1" \
  -d '{"id": 1}'
```

#### 2. Using grpcwebproxy

```bash
# Start grpcwebproxy
grpcwebproxy \
  --backend_addr=localhost:50051 \
  --run_tls_server=false \
  --allow_all_origins

# Make request through proxy
curl -X POST http://localhost:8080/myapp.v1.UserService/QueryGetUser \
  -H "Content-Type: application/json" \
  -d '{"id": 1}'
```

### Advanced Examples

#### Batch Operations

```bash
# Batch create users
curl -X POST http://localhost:50051/myapp.v1.UserService/MutationBatchCreateUsers \
  -H "Content-Type: application/json" \
  -d '{
    "users": [
      {"name": "User 1", "email": "user1@example.com"},
      {"name": "User 2", "email": "user2@example.com"},
      {"name": "User 3", "email": "user3@example.com"}
    ]
  }'
```

#### Complex Queries with Filtering

```bash
# Search products with filters
curl -X POST http://localhost:50051/myapp.v1.ProductService/QuerySearchProducts \
  -H "Content-Type: application/json" \
  -d '{
    "query": "laptop",
    "categories": ["electronics", "computers"],
    "priceRange": {
      "minPrice": 500,
      "maxPrice": 2000
    },
    "limit": 20
  }'
```

#### Error Handling

```bash
# Request with invalid data
curl -X POST http://localhost:50051/myapp.v1.UserService/QueryGetUser \
  -H "Content-Type: application/json" \
  -d '{"id": -1}' \
  -v

# Response will include error details:
# {
#   "code": "invalid_argument",
#   "message": "Invalid user ID",
#   "details": [...]
# }
```

## Protocol Support

### gRPC

- **Port**: Default 50051
- **Content-Type**: `application/grpc`
- **Features**: Full gRPC support including streaming (future)

### Connect

- **Port**: Same as gRPC (50051)
- **Content-Type**: `application/json` or `application/proto`
- **Features**: HTTP/1.1 and HTTP/2, JSON and binary formats

### gRPC-Web

- **Port**: Same as gRPC (50051)
- **Content-Type**: `application/grpc-web+proto` or `application/grpc-web-text`
- **Features**: Browser-compatible, works with standard HTTP

## Configuration

### ServerConfig Options

```go
type ServerConfig struct {
    // ProtoDir is the directory containing proto files (required)
    ProtoDir string
    
    // OperationsDir is the directory containing pre-defined GraphQL operations
    // (optional, only for predefined mode)
    OperationsDir string
    
    // ListenAddr is the address to listen on (default: "0.0.0.0:50051")
    ListenAddr string
    
    // GraphQLEndpoint is the router's GraphQL endpoint (required)
    GraphQLEndpoint string
    
    // Mode determines whether to use dynamic or predefined operations
    // (default: HandlerModeDynamic)
    Mode HandlerMode
    
    // Logger for structured logging (default: nop logger)
    Logger *zap.Logger
    
    // RequestTimeout for HTTP requests (default: 30s)
    RequestTimeout time.Duration
}
```

### Handler Modes

#### Dynamic Mode (Recommended)

Automatically generates GraphQL operations from proto definitions:

```go
server, err := connectrpc.NewServer(connectrpc.ServerConfig{
    ProtoDir:        "./proto",
    GraphQLEndpoint: "http://localhost:4000/graphql",
    Mode:            connectrpc.HandlerModeDynamic,
})
```

**Pros:**
- No manual operation definition needed
- Automatic schema synchronization
- Faster development
- Operations pre-generated at startup for optimal runtime performance

**Cons:**
- Less control over GraphQL queries
- May generate suboptimal queries for complex cases
- All operations generated at startup (small memory overhead)

#### Predefined Mode

Uses pre-defined GraphQL operations:

```go
server, err := connectrpc.NewServer(connectrpc.ServerConfig{
    ProtoDir:        "./proto",
    OperationsDir:   "./operations",
    GraphQLEndpoint: "http://localhost:4000/graphql",
    Mode:            connectrpc.HandlerModePredefined,
})
```

**Pros:**
- Full control over GraphQL queries
- Optimized queries for specific use cases
- Better for complex operations

**Cons:**
- Manual operation definition required
- Need to keep operations in sync with schema

## Testing

### Unit Tests

Run unit tests for the ConnectRPC package:

```bash
cd router/pkg/connectrpc
go test -v ./...
```

### Integration Tests

Run integration tests:

```bash
cd router-tests
go test -v -run TestConnectRPC
```

### Manual Testing

1. Start the router:
```bash
cd router
go run ./cmd/router/main.go
```

2. Start the ConnectRPC server:
```bash
go run ./examples/connectrpc/main.go
```

3. Test with grpcurl:
```bash
grpcurl -plaintext localhost:50051 list
```

## Troubleshooting

### Common Issues

#### 1. "service not found" Error

**Problem**: Service is not discovered from proto files.

**Solution**: 
- Verify proto files are in the correct directory
- Check proto syntax is valid
- Ensure service names follow conventions

#### 2. "method not found" Error

**Problem**: RPC method doesn't follow naming convention.

**Solution**:
- Ensure methods are prefixed with `Query` or `Mutation`
- Check method name spelling

#### 3. GraphQL Errors

**Problem**: GraphQL endpoint returns errors.

**Solution**:
- Verify GraphQL endpoint is accessible
- Check GraphQL schema matches proto definitions
- Review header forwarding configuration

#### 4. Connection Refused

**Problem**: Cannot connect to ConnectRPC server.

**Solution**:
- Verify server is running
- Check listen address and port
- Ensure firewall allows connections

### Debug Logging

Enable debug logging:

```go
logger, _ := zap.NewDevelopment()
server, err := connectrpc.NewServer(connectrpc.ServerConfig{
    // ... other config
    Logger: logger,
})
```

## Best Practices

1. **Use Descriptive Method Names**: `QueryGetUserById` is better than `QueryGet`
2. **Follow Naming Conventions**: Always prefix with `Query` or `Mutation`
3. **Version Your APIs**: Use package versioning (e.g., `myapp.v1`, `myapp.v2`)
4. **Document Your Proto Files**: Add comments to services and methods
5. **Handle Errors Gracefully**: Return meaningful error messages
6. **Use Pagination**: For list operations, always support pagination
7. **Validate Input**: Validate request data before processing
8. **Monitor Performance**: Track request latency and error rates

## Examples

See the `testdata/examples/` directory for complete examples:

- [`user_service.proto`](testdata/examples/user_service.proto) - Basic CRUD operations
- [`product_service.proto`](testdata/examples/product_service.proto) - Advanced patterns

## Contributing

Contributions are welcome! Please see the main Cosmo repository for contribution guidelines.

## License

See the main Cosmo repository for license information.