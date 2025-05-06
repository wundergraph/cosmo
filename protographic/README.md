# Protographic

A tool for converting GraphQL Schema Definition Language (SDL) to Protocol Buffers and mapping files.

## Overview

Protographic bridges GraphQL and Protocol Buffers (protobuf) ecosystems through two core functions:

1. **GraphQL SDL to Protocol Buffer (Proto) Compiler**: Transforms GraphQL schemas into Proto3 format, allowing developers to write gRPC services using GraphQL SDL and integrate them seamlessly into the Cosmo Router as standard subgraphs. This is used at build-time.

2. **GraphQL SDL to Mapping Compiler**: Creates mapping definitions that maintain the semantic relationships between GraphQL types while adapting them to Protocol Buffer's structural model. This is used by the Cosmo Router at runtime.

## Key Features

- Precise conversion of GraphQL types to Protocol Buffer messages
- Consistent naming conventions across GraphQL and Proto definitions
- Streamlined mapping of GraphQL operations to RPC methods
- Robust handling of complex GraphQL features (unions, interfaces, directives)
- First-class support for Federation entity mapping

## Installation

```bash
npm install @wundergraph/protographic
```

## Usage

### Converting GraphQL SDL to Protocol Buffer

```typescript
import { compileGraphQLToProto } from '@wundergraph/protographic';

const graphqlSchema = `
type User {
  id: ID!
  name: String!
}

type Query {
  user(id: ID!): User
}
`;

const protoOutput = compileGraphQLToProto(
  graphqlSchema, // String or GraphQLSchema object
  'UserService', // Service name
  'user.v1', // Package name
  'comso/pkg/my_package', // Go package name
);
```

### Generating Mapping Definitions

```typescript
import { compileGraphQLToMapping } from '@wundergraph/protographic';

const graphqlSchema = `
type Product @key(fields: "id") {
  id: ID!
  name: String!
  price: Float!
}

type Query {
  product(id: ID!): Product
}
`;

const mappingOutput = compileGraphQLToMapping(
  graphqlSchema, // String or GraphQLSchema object
  'ProductService', // Service name
);
```

## Conversion Rules

Protographic follows a set of conventions when converting GraphQL SDL to Protocol Buffers. Please take a look at the following rules:

1. GraphQL SDL to Mapping, see [SDL_MAPPING_RULES.md](SDL_MAPPING_RULES.md)
2. GraphQL SDL to Proto, see [SDL_PROTO_RULES.md](SDL_PROTO_RULES.md)

## Integration with graphql-go-tools

Protographic integrates with [graphql-go-tools](https://github.com/wundergraph/graphql-go-tools) to enable seamless GraphQL-to-gRPC translation. This integration allows you to:

- Convert GraphQL queries to Protocol Buffer messages automatically
- Transform Protocol Buffer responses back to GraphQL format
- Handle advanced GraphQL features (fragments, variables, aliases) within a Protocol Buffer context

This bidirectional translation preserves type safety while combining the benefits of both GraphQL and gRPC ecosystems.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the Apache-2.0 License.
