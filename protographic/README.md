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
- Deterministic field ordering with proto.lock.json for backward compatibility
- Use of Protocol Buffer wrappers for nullable fields to distinguish between semantic nulls and zero values

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
  {
    serviceName: 'UserService', // Service name
    packageName: 'user.v1', // Package name
    goPackage: 'cosmo/pkg/my_package', // Go package name
    lockFilePath: './proto.lock.json', // Optional: Path to proto.lock.json for deterministic field ordering
  }
);
```

### Using proto.lock.json for Deterministic Field Ordering

Protographic supports deterministic field ordering for Protocol Buffer files through a lock file mechanism. This ensures backward compatibility across schema changes:

```typescript
import { compileGraphQLToProto } from '@wundergraph/protographic';

// First generation with a new lock file
const result1 = compileGraphQLToProto(initialSchema, {
  serviceName: 'MyService',
  lockFilePath: './proto.lock.json' // Creates lock file if it doesn't exist
});

// Later generation with schema changes but preserving field order
const result2 = compileGraphQLToProto(updatedSchema, {
  serviceName: 'MyService',
  lockFilePath: './proto.lock.json' // Uses existing lock file
});
```

When providing a `lockFilePath`, the function returns an object with both the proto definition and the lock data:

```typescript
const { proto, lockData } = compileGraphQLToProto(schema, { 
  lockFilePath: './proto.lock.json' 
});
```

If you prefer to manage the lock data directly without file I/O, you can use the lock data directly:

```typescript
import { compileGraphQLToProto, ProtoLock } from '@wundergraph/protographic';

// First generation - creates initial lock data
const result1 = compileGraphQLToProto(initialSchema, {
  serviceName: 'MyService'
});
const proto1 = result1.proto;
const lockData = result1.lockData;

// Store the lock data however you want (database, state management, etc.)
// ...

// Later generation with the saved lock data
const result2 = compileGraphQLToProto(updatedSchema, {
  serviceName: 'MyService',
  lockData: lockData // Use previously generated lock data
});
```

The lock data records the order of:
- Service methods
- Message fields
- Enum values
- Implementers of interfaces
- Members of unions

New fields are always added at the end, maintaining backward compatibility with existing proto messages.

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

Protographic generates a mapping file as well as a proto file that can be used with [graphql-go-tools](https://github.com/wundergraph/graphql-go-tools) to enable seamless GraphQL-to-gRPC translation. This integration allows you to:

- Translate GraphQL queries to gRPC requests
- Translate gRPC responses back to GraphQL format
- Handle advanced GraphQL features (fragments, variables, aliases) within a gRPC context

This bidirectional translation preserves type safety while combining the benefits of both GraphQL and gRPC ecosystems.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the Apache-2.0 License.
