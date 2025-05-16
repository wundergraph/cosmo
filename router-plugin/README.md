# Cosmo Router Plugin

This package provides a simple framework for building gRPC-based plugins for the Cosmo router.

## Overview

The Router Plugin system allows you to extend the Cosmo router with custom gRPC services. This README focuses on how to build a server-side plugin.

## Creating a Router Plugin

To create a router plugin, you need to:

1. Define a Protocol Buffer (proto) file
2. Generate the server code from the proto file
3. Implement the service interface
4. Register the service with the router plugin

### Step 1: Define a Protocol Buffer File

Create a proto file that defines your service:

```protobuf
syntax = "proto3";

package myservice.v1;

option go_package = "github.com/myorg/myproject/myservice;myservicev1";

service MyService {
    rpc GetData(GetDataRequest) returns (GetDataResponse);
}

message GetDataRequest {
    string id = 1;
}

message GetDataResponse {
    string data = 1;
}
```

### Step 2: Generate Server Code

Use the protoc compiler with the Go plugins to generate the server code:

```bash
protoc --go_out=. --go_opt=paths=source_relative \
    --go-grpc_out=. --go-grpc_opt=paths=source_relative \
    path/to/your/proto/file.proto
```

### Step 3: Implement the Service

Implement the generated service interface:

```go
package main

import (
    "context"
    
    myservicev1 "github.com/myorg/myproject/myservice/v1"
)

type MyService struct {
    myservicev1.UnimplementedMyServiceServer
}

func (s *MyService) GetData(ctx context.Context, req *myservicev1.GetDataRequest) (*myservicev1.GetDataResponse, error) {
    // Implement your service logic here
    return &myservicev1.GetDataResponse{
        Data: "Data for ID: " + req.Id,
    }, nil
}
```

### Step 4: Register and Serve the Plugin

Create a main function that registers your service with the router plugin:

```go
package main

import (
    "log"

    routerplugin "github.com/wundergraph/cosmo/router-plugin"
    myservicev1 "github.com/myorg/myproject/myservice/v1"
    "google.golang.org/grpc"
)

func main() {
    // Create a new router plugin with a registration function
    pl, err := routerplugin.NewRouterPlugin(func(s *grpc.Server) {
        // Register your service with the gRPC server
        myservicev1.RegisterMyServiceServer(s, &MyService{})
    })
    if err != nil {
        log.Fatalf("failed to create router plugin: %v", err)
    }
    
    // Start serving the plugin
    pl.Serve()
}
```

### Step 5: Compile the Plugin

Compile your plugin to a binary:

```bash
go build -o my-plugin main.go
```

## Example

For a complete example, see the [simple example](./examples/simple) in this repository, which demonstrates:

1. Defining a User service in [user.proto](./examples/simple/user/v1/user.proto)
2. Generating the Go code using protoc
3. Implementing the service in [main.go](./examples/simple/cmd/server/main.go)
4. Compiling and serving the plugin

The example includes a Makefile with commands for code generation and compilation:

```
make generate-proto  # Generate code from proto file
make compile-plugin  # Compile the plugin binary
```

## API Reference

The router plugin package provides a simple API:

- `NewRouterPlugin(registrationFunc func(*grpc.Server)) (*RouterPlugin, error)`: Creates a new router plugin with a function to register services
- `(*RouterPlugin) Serve()`: Starts serving the plugin

## Requirements

- Go 1.16 or later
- Protocol Buffer compiler (protoc)
- Go plugins for Protocol Buffers
