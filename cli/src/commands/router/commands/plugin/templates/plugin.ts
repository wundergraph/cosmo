/* eslint-disable no-tabs */

// We store the templates in code to avoid dealing with file system issues when
// building for bun and transpiling TypeScript.

const goMod = `
module {modulePath}

go 1.25.1

require (
  github.com/stretchr/testify v1.10.0
  github.com/wundergraph/cosmo/router-plugin v0.0.0-20250824152218-8eebc34c4995 // v0.4.1
  google.golang.org/grpc v1.68.1
  google.golang.org/protobuf v1.36.5
)
`;

const makefile = `
.PHONY: build test generate install-wgc

install-wgc:
\t@which wgc > /dev/null 2>&1 || npm install -g wgc@latest

make: build

test: install-wgc
\twgc router plugin test .

generate: install-wgc
\twgc router plugin generate .

publish: generate
\twgc router plugin publish .

build: install-wgc
\twgc router plugin build . --debug
`;

const gitignore = `# Ignore the binary files
bin/
`;



const readme = `# {name} Plugin - Cosmo gRPC Service Example

This repository contains a simple Cosmo gRPC service plugin that showcases how to design APIs with GraphQL Federation but implement them using gRPC methods instead of traditional resolvers.

## What is this demo about?

This demo illustrates a key pattern in Cosmo gRPC service development:
- **Design with GraphQL**: Define your API using GraphQL schema
- **Implement with gRPC**: Instead of writing GraphQL resolvers, implement gRPC service methods
- **Bridge the gap**: The Cosmo router connects GraphQL operations to your gRPC implementations
- **Test-Driven Development**: Test your gRPC service implementation with gRPC client and server without external dependencies

The plugin demonstrates:
- How GraphQL types and operations map to gRPC service methods
- Simple "Hello World" implementation
- Proper structure for a Cosmo gRPC service plugin
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

- Change the GraphQL schema in \`src/schema.graphql\` and regenerate the code with \`make generate\`.
- Implement the changes in \`src/main.go\` and test your implementation with \`make test\`.
- Build the plugin with \`make build\`.

## 📚 Learn More

For more information about Cosmo and building router plugins:
- [Cosmo Documentation](https://cosmo-docs.wundergraph.com/)
- [Cosmo Router Plugins Guide](https://cosmo-docs.wundergraph.com/connect/plugins)

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

const cursorRules = `---
description: {name} Plugin Guide
globs: src/**
alwaysApply: false
---

# {name} Plugin Development Guide

You are an expert in developing Cosmo Router plugins. You are given a GraphQL schema, and you need to implement the Go code for the plugin.
Your goal is to implement the plugin in a way that is easy to understand and maintain. You add tests to ensure the plugin works as expected.

All make commands need to be run from the plugin directory \`{pluginDir}\`.

## Plugin Structure

A plugin is structured as follows:

\`\`\`
plugins/{originalPluginName}/
├── Makefile                     # Build automation
├── go.mod                       # Go module definition
├── go.sum                       # Go module checksums
├── src/
│   ├── schema.graphql           # GraphQL schema (API contract)
│   ├── main.go                  # Plugin implementation
│   └── main_test.go             # Tests for the plugin
├── generated/                   # Auto-generated files (DO NOT EDIT)
│   ├── service.proto            # Generated Protocol Buffers
│   ├── service.pb.go            # Generated Go structures
│   ├── service.proto.lock.json  # Generated Protobuf lock file
│   └── service_grpc.pb.go       # Generated gRPC service
└── bin/                         # Compiled binaries
    └── plugin                   # The compiled plugin binary
\`\`\`

## Development Workflow

1. When modifying the GraphQL schema in \`src/schema.graphql\`, you need to regenerate the code with \`make generate\`.
2. Look into the generated code in \`generated/service.proto\` and \`generated/service.pb.go\` to understand the updated API contract and service methods.
3. Implement the new RPC methods in \`src/main.go\`.
4. Add tests to \`src/main_test.go\` to ensure the plugin works as expected. You need to run \`make test\` to ensure the tests pass.
5. Finally, build the plugin with \`make build\` to ensure the plugin is working as expected.
6. Your job is done after successfully building the plugin. Don't verify if the binary was created. The build command will take care of that.

**Important**: Never manipulate the files inside \`generated\` directory yourself. Don't touch the \`service.proto\`,  \`service.proto.lock.json\`, \`service.pb.go\` and \`service_grpc.pb.go\` files.

You can update the Go dependencies by running \`make test\` to ensure the dependencies are up to date. It runs \`go mod tidy\` under the hood.

## Implementation Pattern

### Service Integration

If you need to integrate with other HTTP services, you should prefer to use the \`github.com/wundergraph/cosmo/router-plugin/httpclient\` package.
Always prefer a real integration over mocking. In the tests, you can mock the external service by bootstrapping an http server that returns the expected response.
In tests, focus on a well-defined contract and the expected behavior of your service. Structure tests by endpoint, use-cases and use table-driven tests when possible.

Here is an example of how to use the \`httpclient\` package:

\`\`\`go
// Initialize HTTP client for external API calls
// The base URL is the URL of the external API
client := httpclient.New(
  httpclient.WithBaseURL("<replace_with_base_url>"),
  httpclient.WithTimeout(5*time.Second),
  httpclient.WithHeaders(map[string]string{}),
)
// A HTTP GET request to the external API
resp, err := client.Get(ctx, "/<replace_with_path>")
// A HTTP POST/PUT/DELETE request to the external API with a struct that is marshalled to JSON
resp, err := client.Post(ctx, "/<replace_with_path>", payload)
// Passing payload with custom request options
resp, err := client.Put(ctx, "/<replace_with_path>", payload,
  httpclient.WithHeaders(map[string]string{}),
)
// Unmarshal the JSON response into our data structure
data, err := httpclient.UnmarshalTo[[]ResponseType](resp)
// The response offers the following fields:
type Response struct {
	StatusCode int
	Headers    http.Header
	Body       []byte
}
// You can check for success (StatusCode >= 200 && StatusCode < 300)
resp.IsSuccess()
\`\`\`
`;

const cursorIgnore = `# Ignore the mapping and lock files
generated/mapping.json
generated/service.proto.lock.json
# Ignore the proto to avoid interpretation issues
generated/service.proto
# Ignore the plugin binary
bin/
`;

export default {
  goMod,
  readme,
  schema,
  gitignore,
  makefile,
  cursorRules,
  cursorIgnore,
};
