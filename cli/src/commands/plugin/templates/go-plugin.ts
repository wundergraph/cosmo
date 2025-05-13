// We store the templates in code to avoid dealing with file system issues when
// building for bun and transpiling TypeScript.

export const goMod = `
module {modulePath}

go 1.24.1

require (
	github.com/hashicorp/go-plugin v1.6.3
	google.golang.org/grpc v1.72.0
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
