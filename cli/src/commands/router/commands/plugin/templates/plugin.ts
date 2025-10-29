// Templates for plugin (templating is done by pupa)
// This file is auto-generated. Do not edit manually.
/* eslint-disable no-template-curly-in-string */

const gitignore = '# Ignore the binary files\nbin/\n\n';

const makefile =
  '.PHONY: build test generate install-wgc\n\ninstall-wgc:\n\\t@which wgc > /dev/null 2>&1 || npm install -g wgc@latest\n\nmake: build\n\ntest: install-wgc\n\\twgc router plugin test .\n\ngenerate: install-wgc\n\\twgc router plugin generate .\n\npublish: generate\n\\twgc router plugin publish .\n\nbuild: install-wgc\n\\twgc router plugin build . --debug';

const cursorIgnore =
  '# Ignore the mapping and lock files\ngenerated/mapping.json\ngenerated/service.proto.lock.json\n# Ignore the proto to avoid interpretation issues\ngenerated/service.proto\n# Ignore the plugin binary\nbin/\n\n';

const readme =
  '# {name} Plugin - Cosmo gRPC Service Example\n\nThis repository contains a simple Cosmo gRPC service plugin that showcases how to design APIs with GraphQL Federation but implement them using gRPC methods instead of traditional resolvers.\n\n## What is this demo about?\n\nThis demo illustrates a key pattern in Cosmo gRPC service development:\n- **Design with GraphQL**: Define your API using GraphQL schema\n- **Implement with gRPC**: Instead of writing GraphQL resolvers, implement gRPC service methods\n- **Bridge the gap**: The Cosmo router connects GraphQL operations to your gRPC implementations\n- **Test-Driven Development**: Test your gRPC service implementation with gRPC client and server without external dependencies\n\nThe plugin demonstrates:\n- How GraphQL types and operations map to gRPC service methods\n- Simple "Hello World" implementation\n- Proper structure for a Cosmo gRPC service plugin\n- How to test your gRPC service implementation with gRPC client and server without external dependencies\n\n{readmeText}\n\n## 🔧 Customizing Your Plugin\n\n- Change the GraphQL schema in `src/schema.graphql` and regenerate the code with `make generate`.\n- Implement the changes in `src/{mainFile}` and test your implementation with `make test`.\n- Build the plugin with `make build`.\n\n## 📚 Learn More\n\nFor more information about Cosmo and building router plugins:\n- [Cosmo Documentation](https://cosmo-docs.wundergraph.com/)\n- [Cosmo Router Plugins Guide](https://cosmo-docs.wundergraph.com/connect/plugins)\n\n---\n\n<p align="center">Made with ❤️ by <a href="https://wundergraph.com">WunderGraph</a></p>\n';

const schema =
  'type World {\n  """\n  The ID of the world\n  """\n  id: ID!\n  """\n  The name of the world\n  """\n  name: String!\n}\n\ntype Query {\n  """\n  The hello query\n  """\n  hello(name: String!): World!\n}\n\n';

export default {
  gitignore,
  makefile,
  cursorIgnore,
  readme,
  schema,
};
