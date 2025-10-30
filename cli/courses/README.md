# Courses Plugin - Cosmo gRPC Service Example

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

   ```
    plugins/{originalPluginName}/
    ├── package.json                # Package.json file with dependencies
    ├── src/
    │   ├── plugin.ts         # Main plugin implementation
    │   ├── plugin.test.ts    # Main plugin implementation tests
    │   ├── fs-polyfill.ts    # Polyfill to help bundling into a binary
    │   ├── plugin-server.ts  # Used to initialize the plugin as a server
    │   └── schema.graphql    # GraphQL schema defining the API
    ├── generated/            # Generated code (created during build)
    └── bin/                  # Compiled binaries (created during build)
        └── plugin            # The compiled plugin binary
   ```


## 🔧 Customizing Your Plugin

- Change the GraphQL schema in `src/schema.graphql` and regenerate the code with `make generate`.
- Implement the changes in `src/plugin.ts` and test your implementation with `make test`.
- Build the plugin with `make build`.

## 📚 Learn More

For more information about Cosmo and building router plugins:
- [Cosmo Documentation](https://cosmo-docs.wundergraph.com/)
- [Cosmo Router Plugins Guide](https://cosmo-docs.wundergraph.com/connect/plugins)

---

<p align="center">Made with ❤️ by <a href="https://wundergraph.com">WunderGraph</a></p>
