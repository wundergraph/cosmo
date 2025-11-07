# GraphQL Operations to Protocol Buffer Compiler ⚠️ ALPHA

> **Note**: This feature is currently in alpha. The API may change in future releases.

## Overview

The operations-to-proto compiler generates Protocol Buffer service definitions directly from GraphQL operations, enabling an operation-first development approach where you define your API through GraphQL operations rather than schema types.

## Basic Usage

```typescript
import { compileOperationsToProto } from '@wundergraph/protographic';

const schema = `
type User {
  id: ID!
  name: String!
  email: String!
}

type Query {
  user(id: ID!): User
  users: [User!]!
}

type Mutation {
  createUser(name: String!, email: String!): User!
}
`;

const operation = `
query GetUser($userId: ID!) {
  user(id: $userId) {
    id
    name
    email
  }
}
`;

const result = compileOperationsToProto(
  operation,  // GraphQL operation
  schema,     // GraphQL schema
  {
    serviceName: 'UserService',
    packageName: 'user.v1',
    goPackage: 'github.com/example/user/v1',
    prefixOperationType: true,  // Prefix RPC names with Query/Mutation
    queryIdempotency: 'NO_SIDE_EFFECTS',  // Mark queries as idempotent
    maxDepth: 50,  // Maximum recursion depth for nested queries
    lockData: previousLockData  // For field number stability
  }
);

console.log(result.proto);
// Outputs proto with:
// - QueryGetUser RPC method (prefixed with operation type)
// - QueryGetUserRequest message (with userId field)
// - QueryGetUserResponse message (with user field containing id, name, email)
```

## Features

### Operation Type Prefixing

When `prefixOperationType: true`, RPC method names are prefixed with their operation type:
- Queries: `QueryGetUser`, `QueryListUsers`
- Mutations: `MutationCreateUser`, `MutationUpdateUser`
- Subscriptions: `SubscriptionOnMessageAdded`

Without this flag, RPC names match the operation names directly (e.g., `GetUser`, `CreateUser`, `OnMessageAdded`).

This helps distinguish operations in the generated proto service definition.

### Single Operation Per Document

For proto reversibility (ability to reconstruct the original GraphQL operation from the proto), each operation must be compiled separately:

```typescript
// ✅ Correct: Single operation
const operation1 = `query GetUser($id: ID!) { user(id: $id) { name } }`;
compileOperationsToProto(operation1, schema);

// ❌ Incorrect: Multiple operations
const operations = `
  query GetUser($id: ID!) { user(id: $id) { name } }
  query ListUsers { users { name } }
`;
// This will throw an error
```

### Fragment Support

Operations can include fragments, which are properly resolved during compilation:

```typescript
const operation = `
query GetUser($id: ID!) {
  user(id: $id) {
    ...UserFields
  }
}

fragment UserFields on User {
  id
  name
  email
}
`;

compileOperationsToProto(operation, schema);
```

### Custom Directives

Unknown directives are ignored during validation, allowing dev tools to use custom directives:

```typescript
const operation = `
query GetUser($id: ID!) @customDirective {
  user(id: $id) {
    id
    name
  }
}
`;

// Custom directives are ignored, operation compiles successfully
compileOperationsToProto(operation, schema);
```

### Recursion Protection

The `maxDepth` option prevents stack overflow from deeply nested queries:

```typescript
compileOperationsToProto(operation, schema, {
  maxDepth: 50  // Default: 50
});
```

### Query Idempotency

Mark query operations with idempotency levels for gRPC:

```typescript
compileOperationsToProto(operation, schema, {
  queryIdempotency: 'NO_SIDE_EFFECTS'  // or 'DEFAULT'
});
```

### Subscription Streaming

Subscription operations are automatically marked as server streaming in the proto:

```typescript
const subscription = `
subscription OnUserUpdate($userId: ID!) {
  userUpdated(id: $userId) {
    id
    name
  }
}
`;

// Generates: rpc SubscriptionOnUserUpdate(...) returns (stream ...)
compileOperationsToProto(subscription, schema);
```

## Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `serviceName` | `string` | Name of the generated proto service (default: `'DefaultService'`) |
| `packageName` | `string` | Proto package name (default: `'service.v1'`) |
| `goPackage` | `string` | Go package option for proto file |
| `javaPackage` | `string` | Java package option for proto file |
| `javaOuterClassname` | `string` | Java outer classname option |
| `javaMultipleFiles` | `boolean` | Java multiple files option |
| `csharpNamespace` | `string` | C# namespace option |
| `rubyPackage` | `string` | Ruby package option |
| `phpNamespace` | `string` | PHP namespace option |
| `phpMetadataNamespace` | `string` | PHP metadata namespace option |
| `objcClassPrefix` | `string` | Objective-C class prefix option |
| `swiftPrefix` | `string` | Swift prefix option |
| `includeComments` | `boolean` | Include GraphQL descriptions as proto comments (default: `true`) |
| `queryIdempotency` | `'NO_SIDE_EFFECTS' \| 'DEFAULT'` | Idempotency level for query operations |
| `lockData` | `ProtoLock` | Lock data from previous compilation for field number stability |
| `maxDepth` | `number` | Maximum recursion depth to prevent stack overflow (default: `50`) |
| `prefixOperationType` | `boolean` | Prefix RPC method names with operation type (default: `false`) |

## Field Number Stability

Like SDL-to-Proto, operations-to-proto supports field number stability through lock data:

```typescript
// First generation
const result1 = compileOperationsToProto(operation1, schema);
const lockData = result1.lockData;

// Later generation with the same lock data
const result2 = compileOperationsToProto(operation2, schema, {
  lockData: lockData
});
```

This ensures backward compatibility when operations evolve over time.

## Limitations

- **Single operation per document**: Multiple operations in one document are not supported for proto reversibility
- **No root-level field aliases**: Field aliases at the root level break proto-to-GraphQL reversibility
- **Alpha status**: The API may change in future releases

## Return Value

The `compileOperationsToProto` function returns an object with:

```typescript
{
  proto: string;           // Generated proto text
  root: protobuf.Root;     // Protobufjs root object
  lockData: ProtoLock;     // Lock data for field number stability
}