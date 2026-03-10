// Templates for plugin (templating is done by pupa)
// This file is auto-generated. Do not edit manually.
/* eslint-disable no-template-curly-in-string */

const gitignore = '# Ignore the binary files\r\nbin/\r\n';

const makefile =
  '\r\n.PHONY: build test generate install-wgc\r\n\r\ninstall-wgc:\r\n\t@which wgc > /dev/null 2>&1 || npm install -g wgc@latest\r\n\r\nmake: build\r\n\r\ntest: install-wgc\r\n\twgc router plugin test .\r\n\r\ngenerate: install-wgc\r\n\twgc router plugin generate .\r\n\r\npublish: generate\r\n\twgc router plugin publish .\r\n\r\nbuild: install-wgc\r\n\twgc router plugin build . --debug\r\n';

const readmePluginMd =
  '# {name} Plugin - Cosmo gRPC Service Example\r\n\r\nThis repository contains a simple Cosmo gRPC service plugin that showcases how to design APIs with GraphQL Federation but implement them using gRPC methods instead of traditional resolvers.\r\n\r\n## What is this demo about?\r\n\r\nThis demo illustrates a key pattern in Cosmo gRPC service development:\r\n- **Design with GraphQL**: Define your API using GraphQL schema\r\n- **Implement with gRPC**: Instead of writing GraphQL resolvers, implement gRPC service methods\r\n- **Bridge the gap**: The Cosmo router connects GraphQL operations to your gRPC implementations\r\n- **Test-Driven Development**: Test your gRPC service implementation with gRPC client and server without external dependencies\r\n\r\nThe plugin demonstrates:\r\n- How GraphQL types and operations map to gRPC service methods\r\n- Simple "Hello World" implementation\r\n- Proper structure for a Cosmo gRPC service plugin\r\n- How to test your gRPC service implementation with gRPC client and server without external dependencies\r\n\r\n{readmeText}\r\n\r\n## 🔧 Customizing Your Plugin\r\n\r\n- Change the GraphQL schema in `src/schema.graphql` and regenerate the code with `make generate`.\r\n- Implement the changes in `src/{mainFile}` and test your implementation with `make test`.\r\n- Build the plugin with `make build`.\r\n\r\n## 📚 Learn More\r\n\r\nFor more information about Cosmo and building router plugins:\r\n- [Cosmo Documentation](https://cosmo-docs.wundergraph.com/)\r\n- [Cosmo Router Plugins Guide](https://cosmo-docs.wundergraph.com/connect/plugins)\r\n\r\n---\r\n\r\n<p align="center">Made with ❤️ by <a href="https://wundergraph.com">WunderGraph</a></p>';

const cursorignore =
  '# Ignore the mapping and lock files\r\ngenerated/mapping.json\r\ngenerated/service.proto.lock.json\r\n# Ignore the proto to avoid interpretation issues\r\ngenerated/service.proto\r\n# Ignore the plugin binary\r\nbin/\r\n';

const schemaGraphql =
  'type World {\r\n  """\r\n  The ID of the world\r\n  """\r\n  id: ID!\r\n  """\r\n  The name of the world\r\n  """\r\n  name: String!\r\n}\r\n\r\ntype Query {\r\n  """\r\n  The hello query\r\n  """\r\n  hello(name: String!): World!\r\n}\r\n';

export default {
  gitignore,
  makefile,
  readmePluginMd,
  cursorignore,
  schemaGraphql,
};
