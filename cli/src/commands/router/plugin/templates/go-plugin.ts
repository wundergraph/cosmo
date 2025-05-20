// We store the templates in code to avoid dealing with file system issues when
// building for bun and transpiling TypeScript.

export const goMod = `
module {modulePath}

go 1.24.1

require (
  github.com/stretchr/testify v1.10.0
  github.com/wundergraph/cosmo/router-plugin v0.0.0-20250519204649-84818397f974 // v0.1.0
  google.golang.org/grpc v1.68.1
  google.golang.org/protobuf v1.36.5
)
`;

export const mainGo = `package main

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

export const mainGoTest = `package main

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

export const readme = `# {name} Plugin - Cosmo gRPC Subgraph Example

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

1. **Generate the plugin code**

   \`\`\`bash
   npx wgc@latest router plugin build .
   \`\`\`

2. **Compose your supergraph**

  Create a \`graph.yaml\` file with the following content in the project root directory:

  \`\`\`yaml
  version: 1
  subgraphs:
    # Add your other subgraphs here
    - plugin:
        version: 0.0.1
        path: plugins/{name}
   \`\`\`

   Then compose your supergraph to generate the \`config.json\` file:

   \`\`\`bash
   npx wgc@latest router compose -i graph.yaml -o config.json
   \`\`\`

3. **Configure the router**

  Create a \`config.yaml\` file with the following content in the project root directory:

   \`\`\`yaml
    version: "1"

    listen_addr: localhost:3010

    dev_mode: true

    execution_config:
      file:
        path: config.json

    plugins:
      enabled: true
      path: "plugins"
   \`\`\`

4. **Directory Structure**

   The plugin directory should have the following structure:

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

   Your project root directory would then typically contain:
   
   \`\`\`
   project-root/
   ├── config.yaml         # Router configuration file
   ├── config.json         # Composed supergraph configuration
   ├── graph.yaml          # Supergraph definition file
   ├── plugins/            # Directory containing all plugins
   │   └── {originalPluginName}/  # Your plugin directory (structure above)
   └── release/            # Router binary location
       └── router          # Router binary
   \`\`\`

5. **Start the router**

   Download the router binary in the project root directory:

   \`\`\`bash
   npx wgc@latest router download-binary -o release && chmod +x release/router
   \`\`\`

   Then start the router in the project root directory:

   \`\`\`bash
   ./release/router
   \`\`\`

## Open the GraphQL Playground

   Once running, you can open the GraphQL Playground at [http://localhost:3010](http://localhost:3010) and perform GraphQL operations like:
   
   \`\`\`graphql
   # Hello query
   query {
     hello(name: "World") {
       id
       name
     }
   }
   \`\`\`

## Further Steps

- Change the plugin code in \`src/main.go\` and rebuild the plugin
- Change the GraphQL schema in \`src/schema.graphql\` and rebuild the plugin. You can also skip compilation when passing the \`--generate-only\` flag to the \`wgc router plugin build\` command.

## Learn More

For more information about Cosmo and building subgraph plugins, visit the [Cosmo plugins documentation](https://cosmo-docs.wundergraph.com/router/plugins).`;

export const schema = `type World {
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
