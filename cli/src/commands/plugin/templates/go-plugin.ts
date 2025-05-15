// We store the templates in code to avoid dealing with file system issues when
// building for bun and transpiling TypeScript.

export const goMod = `
module {modulePath}

go 1.24.1

require (
  github.com/stretchr/testify v1.10.0
	github.com/hashicorp/go-plugin v1.6.3
	google.golang.org/grpc v1.68.1
	google.golang.org/protobuf v1.36.5
)

replace github.com/wundergraph/cosmo/router-plugin => ../../../router-plugin
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

This repository contains a simple Cosmo gRPC subgraph plugin that showcases how to design APIs with GraphQL but implement them using gRPC methods instead of traditional resolvers.

## What is this demo about?

This demo illustrates a key pattern in Cosmo subgraph development:
- **Design with GraphQL**: Define your API using GraphQL schema
- **Implement with gRPC**: Instead of writing GraphQL resolvers, implement gRPC service methods
- **Bridge the gap**: The Cosmo router connects GraphQL operations to your gRPC implementations

The plugin demonstrates:
- How GraphQL types and operations map to gRPC service methods
- Simple "Hello World" implementation
- Proper structure for a Cosmo gRPC subgraph plugin

## Plugin Structure

- \`src/\` - Contains the plugin source code
  - \`main.go\` - The gRPC service implementation with methods that replace GraphQL resolvers
  - \`schema.graphql\` - The GraphQL schema defining the API contract
- \`generated/\` - Contains generated code from the plugin schema
- \`bin/\` - Contains compiled binaries of the plugin

## GraphQL to gRPC Mapping

The plugin shows how GraphQL operations map to gRPC methods:

| GraphQL Operation | gRPC Method |
|-------------------|-------------|
| \`query { hello }\` | \`QueryHello()\` |

## GraphQL Schema

\`\`\`graphql
type World {
  id: ID!
  name: String!
}

type Query {
  hello(name: String!): World!
}
\`\`\`

## Getting Started

1. **Build the plugin**

   \`\`\`
   wgc plugin build <plugin-directory>
   \`\`\`

2. **Compose your supergraph with your gRPC subgraph**

   config.yaml
   \`\`\`yaml
   subgraphs:
     - name: <plugin-name>
       plugin:
         version: 0.0.1
         directory: <plugin-directory>/<plugin-name>
   \`\`\`

3. **Build the federated graph**

    \`\`\`bash
    wgc router compose config.yaml
    \`\`\`

4. **Start the router**

   \`\`\`yaml
   execution_config:
    file:
        path: ./config.yaml
   plugins:
    - <plugin-directory>
   \`\`\`

5. **Query the hello endpoint**

   Once running, you can perform GraphQL operations like:
   
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
- Change the GraphQL schema in \`src/schema.graphql\` and rebuild the plugin

## Learn More

For more information about Cosmo and building subgraph plugins, visit the [Cosmo documentation](https://cosmo-docs.wundergraph.com).`;

export const schema = `
type World {
  id: ID!
  name: String!
}

type Query {
  hello(name: String!): World!
}
`;
