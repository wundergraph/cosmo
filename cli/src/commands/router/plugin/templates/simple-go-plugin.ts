// We store the templates in code to avoid dealing with file system issues when
// building for bun and transpiling TypeScript.

const goMod = `
module {modulePath}

go 1.24.1

require (
  github.com/stretchr/testify v1.10.0
  github.com/wundergraph/cosmo/router-plugin v0.0.0-20250519204649-84818397f974 // v0.1.0
  google.golang.org/grpc v1.68.1
  google.golang.org/protobuf v1.36.5
)
`;

const mainGo = `package main

import (
  "context"
  "log"
  "strconv"

  service "github.com/wundergraph/cosmo/plugin/generated"

  routerplugin "github.com/wundergraph/cosmo/router-plugin"
  "google.golang.org/grpc"
)

func main() {
  pl, err := routerplugin.NewRouterPlugin(func(s *grpc.Server) {
    s.RegisterService(&service.{serviceName}_ServiceDesc, &{serviceName}{
      nextID: 1,
    })
  })

  if err != nil {
    log.Fatalf("failed to create router plugin: %v", err)
  }

  pl.Serve()
}

type {serviceName} struct {
  service.Unimplemented{serviceName}Server
  nextID int
}

func (s *{serviceName}) QueryHello(ctx context.Context, req *service.QueryHelloRequest) (*service.QueryHelloResponse, error) {
  response := &service.QueryHelloResponse{
    Hello: &service.World{
      Id:   strconv.Itoa(s.nextID),
      Name: req.Name,
    },
  }
  s.nextID++
  return response, nil
}
`;

const mainGoTest = `package main

import (
  "context"
  "net"
  "testing"

  "github.com/stretchr/testify/assert"
  "github.com/stretchr/testify/require"
  service "github.com/wundergraph/cosmo/plugin/generated"
  "google.golang.org/grpc"
  "google.golang.org/grpc/credentials/insecure"
  "google.golang.org/grpc/test/bufconn"
)

const bufSize = 1024 * 1024

// testService is a wrapper that holds the gRPC test components
type testService struct {
  grpcConn  *grpc.ClientConn
  client service.{serviceName}Client
  cleanup   func()
}

// setupTestService creates a local gRPC server for testing
func setupTestService(t *testing.T) *testService {
  // Create a buffer for gRPC connections
  lis := bufconn.Listen(bufSize)

  // Create a new gRPC server
  grpcServer := grpc.NewServer()

  // Register our service
  service.Register{serviceName}Server(grpcServer, &{serviceName}{
    nextID: 1,
  })

  // Start the server
  go func() {
    if err := grpcServer.Serve(lis); err != nil {
      t.Fatalf("failed to serve: %v", err)
    }
  }()

  // Create a client connection
  dialer := func(context.Context, string) (net.Conn, error) {
    return lis.Dial()
  }
  conn, err := grpc.Dial(
    "passthrough:///bufnet",
    grpc.WithContextDialer(dialer),
    grpc.WithTransportCredentials(insecure.NewCredentials()),
  )
  require.NoError(t, err)

  // Create the service client
  client := service.New{serviceName}Client(conn)

  // Return cleanup function
  cleanup := func() {
    conn.Close()
    grpcServer.Stop()
  }

  return &testService{
    grpcConn:  conn,
    client: client,
    cleanup:   cleanup,
  }
}

func TestQueryHello(t *testing.T) {
  // Set up basic service
  svc := setupTestService(t)
  defer svc.cleanup()

  tests := []struct {
    name     string
    userName string
    wantId   string
    wantName string
    wantErr  bool
  }{
    {
      name:     "valid hello",
      userName: "Alice",
      wantId:   "1",
      wantName: "Alice",
      wantErr:  false,
    },
    {
      name:     "empty name",
      userName: "",
      wantId:   "2",
      wantName: "", // Empty name should be preserved
      wantErr:  false,
    },
    {
      name:     "special characters",
      userName: "John & Jane",
      wantId:   "3",
      wantName: "John & Jane",
      wantErr:  false,
    },
  }

  for _, tt := range tests {
    t.Run(tt.name, func(t *testing.T) {
      req := &service.QueryHelloRequest{
        Name: tt.userName,
      }

      resp, err := svc.client.QueryHello(context.Background(), req)
      if tt.wantErr {
        assert.Error(t, err)
        return
      }

      assert.NoError(t, err)
      assert.NotNil(t, resp.Hello)
      assert.Equal(t, tt.wantId, resp.Hello.Id)
      assert.Equal(t, tt.wantName, resp.Hello.Name)
    })
  }
}

func TestSequentialIDs(t *testing.T) {
  // Set up basic service
  svc := setupTestService(t)
  defer svc.cleanup()

  // The first request should get ID "1"
  firstReq := &service.QueryHelloRequest{Name: "First"}
  firstResp, err := svc.client.QueryHello(context.Background(), firstReq)
  require.NoError(t, err)
  assert.Equal(t, "1", firstResp.Hello.Id)

  // The second request should get ID "2"
  secondReq := &service.QueryHelloRequest{Name: "Second"}
  secondResp, err := svc.client.QueryHello(context.Background(), secondReq)
  require.NoError(t, err)
  assert.Equal(t, "2", secondResp.Hello.Id)

  // The third request should get ID "3"
  thirdReq := &service.QueryHelloRequest{Name: "Third"}
  thirdResp, err := svc.client.QueryHello(context.Background(), thirdReq)
  require.NoError(t, err)
  assert.Equal(t, "3", thirdResp.Hello.Id)
}
`;

const readme = `# {name} Plugin - Cosmo gRPC Subgraph Example

This repository contains a simple Cosmo gRPC subgraph plugin that showcases how to design APIs with GraphQL Federation but implement them using gRPC methods instead of traditional resolvers.

## What is this demo about?

This demo illustrates a key pattern in Cosmo subgraph development:
- **Design with GraphQL**: Define your API using GraphQL schema
- **Implement with gRPC**: Instead of writing GraphQL resolvers, implement gRPC service methods
- **Bridge the gap**: The Cosmo router connects GraphQL operations to your gRPC implementations
- **Test-Driven Development**: Test your gRPC service implementation with gRPC client and server without external dependencies

The plugin demonstrates:
- How GraphQL types and operations map to gRPC service methods
- Simple "Hello World" implementation
- Proper structure for a Cosmo gRPC subgraph plugin
- How to test your gRPC service implementation with gRPC client and server without external dependencies

## Getting Started

Plugin structure:

   \`\`\`
    plugins/{originalPluginName}/
    ├── go.mod                # Go module file with dependencies
    ├── go.sum                # Go checksums file
    ├── src/
    │   ├── main.go           # Main plugin implementation
    │   ├── main_test.go      # Tests for the plugin
    │   └── schema.graphql    # GraphQL schema defining the API
    ├── generated/            # Generated code (created during build)
    └── bin/                  # Compiled binaries (created during build)
        └── plugin            # The compiled plugin binary
   \`\`\`

## 🔧 Customizing Your Plugin

- Change the GraphQL schema in \`src/schema.graphql\` and regenerate the code.
- Implement the changes in \`src/main.go\` and test your implementation.
- Compose your supergraph with [wgc router compose](https://cosmo-docs.wundergraph.com/router/cli/compose)
- Start the router!

## 📚 Learn More

For more information about Cosmo and building router plugins:
- [Cosmo Documentation](https://cosmo-docs.wundergraph.com/)
- [Cosmo Router Plugins Guide](https://cosmo-docs.wundergraph.com/router/plugins)

---

<p align="center">Made with ❤️ by <a href="https://wundergraph.com">WunderGraph</a></p>`;

const schema = `type World {
  """
  The ID of the world
  """
  id: ID!
  """
  The name of the world
  """
  name: String!
}

type Query {
  """
  The hello query
  """
  hello(name: String!): World!
}
`;

export default {
  goMod,
  mainGo,
  mainGoTest,
  readme,
  schema,
};
