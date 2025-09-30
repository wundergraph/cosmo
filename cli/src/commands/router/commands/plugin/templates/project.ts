/* eslint-disable no-tabs */

// We store the templates in code to avoid dealing with file system issues when
// building for bun and transpiling TypeScript.

const gitignore = `# Ignore the binary files
release/
`;

const makefile = `
.PHONY: build download start compose

make: download build compose start

start:
	./release/router

compose:
	npx wgc@latest router compose -i graph.yaml -o config.json

download:
	@if [ ! -f release/router ]; then \\
		rm -rf release && npx wgc@latest router download-binary -o release && chmod +x release/router; \\
	else \\
		echo "Router binary already exists, skipping download"; \\
	fi

build:
	cd plugins/{originalPluginName} && make build
`;

const graphConfig = `version: 1
subgraphs:
  # Add your other subgraphs here
  - plugin:
      version: 0.0.1
      path: plugins/{originalPluginName}
`;

const routerConfig = `# yaml-language-server: $schema=https://raw.githubusercontent.com/wundergraph/cosmo/main/router/pkg/config/config.schema.json

version: "1"

listen_addr: localhost:3010

dev_mode: true

execution_config:
  file:
    path: config.json

plugins:
  enabled: true
  path: plugins
`;

const projectReadme = `# {name} - Cosmo Router Plugin Project

Design your API with GraphQL Federation and implement with gRPC using Cosmo Router Plugins

## ✨ Features

- **GraphQL Schema + gRPC Implementation**: Design your API with GraphQL SDL and implement it using gRPC methods
- **Embedded Subgraphs**: Run subgraphs directly inside the Cosmo Router for improved performance
- **End-to-End Type Safety**: Auto-generated Go code from your GraphQL schema
- **Simplified Testing**: Unit test your gRPC implementation with no external dependencies

## 📝 Project Structure

This project sets up a complete environment for developing and testing Cosmo Router plugins:

\`\`\`
project-root/
├── plugins/          # Contains all the plugins
├── graph.yaml        # Supergraph configuration
├── config.json       # Composed supergraph (generated)
├── config.yaml       # Router configuration
├── release/          # Router binary location
│   └── router        # Router binary
└── Makefile          # Automation scripts
\`\`\`

## 🚀 Getting Started

### Setup

1. Clone this repository
2. Run the included Makefile commands

### Available Make Commands

The Makefile automates the entire workflow with these commands:

- \`make\`: Runs all commands in sequence (download, build, compose, start)
- \`make download\`: Downloads the Cosmo Router binary to the \`release\` directory
- \`make build\`: Builds the plugin from your source code with debug symbols enabled
- \`make generate\`: Generates Go code from your GraphQL schema without compilation
- \`make test\`: Validates your implementation with integration tests
- \`make compose\`: Composes your supergraph from the configuration in \`graph.yaml\`
- \`make start\`: Starts the Cosmo Router with your plugin

### Quick Start

To get everything running with a single command:

\`\`\`bash
make
\`\`\`

This will:
1. Download the Cosmo Router binary
2. Build your plugin from source
3. Compose your supergraph
4. Start the router on port 3010

## 🧪 Testing Your Plugin

Once running, open the GraphQL Playground at [http://localhost:3010](http://localhost:3010) and try this query:

\`\`\`graphql
query {
  hello(name: "World") {
    id
    name
  }
}
\`\`\`

## 🔧 Customizing Your Plugin

1. Modify \`src/schema.graphql\` to define your GraphQL types and operations
2. Edit \`src/main.go\` to implement the corresponding gRPC service methods
3. Run \`make generate\` to regenerate code from your updated schema
4. Run \`make build\` to compile your plugin
5. Run \`make test\` to validate your implementation with integration tests
6. Run \`make compose\` to update your supergraph
7. Run \`make start\` to restart the router with your changes

## 📚 Learn More

For more information about Cosmo and building router plugins:
- [Cosmo Documentation](https://cosmo-docs.wundergraph.com/)
- [Cosmo Router Plugins Guide](https://cosmo-docs.wundergraph.com/router/plugins)

---

<p align="center">Made with ❤️ by <a href="https://wundergraph.com">WunderGraph</a></p>
`;

const pluginReadme = `# {name} Plugin - Cosmo Router Example

This repository contains a simple Cosmo Router plugin that showcases how to design APIs with GraphQL Federation but implement them using gRPC methods instead of traditional resolvers.

## What is this demo about?

This demo illustrates a key pattern in Cosmo Router plugin development:
- **Design with GraphQL**: Define your API using GraphQL schema
- **Implement with gRPC**: Instead of writing GraphQL resolvers, implement gRPC service methods
- **Bridge the gap**: The Cosmo router connects GraphQL operations to your gRPC implementations
- **Test-Driven Development**: Test your gRPC service implementation with gRPC client and server without external dependencies

The plugin demonstrates:
- How GraphQL types and operations map to gRPC RPC methods
- Simple "Hello World" implementation
- Proper structure for a Cosmo Router plugin
- How to test your gRPC implementation with gRPC client and server without external dependencies

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
- Compose your supergraph with \`make compose\` and restart the router with \`make start\`.

## 📚 Learn More

For more information about Cosmo and building router plugins:
- [Cosmo Documentation](https://cosmo-docs.wundergraph.com/)
- [Cosmo Router Plugins Guide](https://cosmo-docs.wundergraph.com/router/plugins)

---

<p align="center">Made with ❤️ by <a href="https://wundergraph.com">WunderGraph</a></p>`;

export default {
  readme: pluginReadme,
  routerConfig,
  graphConfig,
  makefile,
  projectReadme,
  gitignore,
};
