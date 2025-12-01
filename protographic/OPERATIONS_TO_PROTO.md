# GraphQL Operations to Protocol Buffer Compiler ⚠️ ALPHA

> **Note**: This feature is currently in alpha. The API may change in future releases.

## Table of Contents

- [Overview](#overview)
- [Concepts](#concepts)
  - [Named Operations Requirement](#named-operations-requirement)
  - [Field Number Stability](#field-number-stability)
  - [Idempotency Levels](#idempotency-levels)
- [CLI Reference](#cli-reference)
  - [Command Options](#command-options)
  - [Examples](#examples)
- [API Reference](#api-reference)
  - [compileOperationsToProto](#compileoperationstoproto)
  - [Options Interface](#options-interface)
- [Tutorial](#tutorial)
  - [Basic Usage](#basic-usage)
  - [Working with Fragments](#working-with-fragments)
  - [Handling Subscriptions](#handling-subscriptions)
  - [Maintaining Field Stability](#maintaining-field-stability)
- [Advanced Topics](#advanced-topics)
  - [Custom Scalar Mappings](#custom-scalar-mappings)
  - [Proto Lock Files](#proto-lock-files)
- [Troubleshooting](#troubleshooting)

---

## Overview

The operations-to-proto compiler generates Protocol Buffer service definitions directly from named GraphQL operations (trusted documents/persisted operations), allowing you to define your API through the specific GraphQL operations your clients actually use rather than exposing the entire schema.

### Benefits

- **Precise API Surface**: Only generates proto messages for the fields actually used in your operations
- **Client-Driven Design**: The proto schema reflects your actual client needs
- **Smaller Proto Files**: Eliminates unused types and fields
- **Better Performance**: Reduced message sizes and faster serialization
- **Type Safety**: Ensures your proto definitions match your actual queries

### When to Use Operations-Based Generation

Use operations-based generation when:
- You want to minimize the proto API surface area
- You have a large GraphQL schema but only use a subset of it
- You want proto definitions that exactly match your client operations
- You need to maintain multiple proto versions for different clients
- You're working with trusted documents or persisted operations

---

## Concepts

### Named Operations Requirement

All operations must have a name. The operation name becomes the RPC method name in the generated proto.

**✅ Correct: Named operation**
```graphql
query GetUser($id: ID!) {
  user(id: $id) {
    name
  }
}
```

**❌ Incorrect: Anonymous operation**
```graphql
query {
  user(id: "123") {
    name
  }
}
```

Anonymous operations will throw an error during compilation.

### How It Works

The compiler generates proto from GraphQL operation files:

```bash
wgc grpc-service generate MyService \
  --input schema.graphql \
  --output ./proto \
  --with-operations ./operations
```

**Generates:**
- Proto messages only for fields used in operations
- Request/response messages per operation
- `service.proto.lock.json` for field number stability

### Field Number Stability

Protocol Buffers require stable field numbers to maintain backward compatibility. The system uses a lock file (`service.proto.lock.json`) to track field numbers across regenerations.

**How it works:**

1. **First Generation**: Assigns sequential field numbers (1, 2, 3, ...)
2. **Lock File Created**: Records message names and field numbers
3. **Subsequent Generations**: Preserves existing field numbers
4. **New Fields**: Assigned the next available number
5. **Removed Fields**: Numbers are reserved (not reused)

**Benefits:**

- **Backward Compatibility**: Old clients work with new proto definitions
- **Safe Refactoring**: Reorder fields without breaking compatibility
- **Version Management**: Track proto evolution over time

### Idempotency Levels

gRPC supports idempotency levels to indicate whether operations have side effects:

- **NO_SIDE_EFFECTS**: Safe to retry, doesn't modify state
- **DEFAULT**: May have side effects, retry with caution

When using operations-based generation, all Query operations are automatically marked with `NO_SIDE_EFFECTS` idempotency level, indicating they are safe to retry without side effects.

**Note:** Mutations and Subscriptions are never marked with idempotency levels.

---

## CLI Reference

### Command Options

```bash
wgc grpc-service generate [name] [options]
```

#### Required Arguments

| Argument | Description |
|----------|-------------|
| `name` | The name of the proto service (e.g., `UserService`) |

#### Required Options

| Option | Description |
|--------|-------------|
| `-i, --input <path>` | Path to the GraphQL schema file |

#### Output Options

| Option | Default | Description |
|--------|---------|-------------|
| `-o, --output <path>` | `.` | Output directory for generated files |
| `-p, --package-name <name>` | `service.v1` | Proto package name |

#### Operations Mode Options

| Option | Description |
|--------|-------------|
| `-w, --with-operations <path>` | Path to directory containing `.graphql` or `.gql` operation files. Subdirectories are traversed recursively. Enables operations-based generation. |
| `--prefix-operation-type` | Prefix RPC method names with operation type (Query/Mutation/Subscription) |
| `--custom-scalar-mapping <json>` | Custom scalar type mappings as inline JSON string. Example: `'{"DateTime":"google.protobuf.Timestamp","UUID":"string"}'` |
| `--custom-scalar-mapping-file <path>` | Path to JSON file containing custom scalar type mappings. Example: `./mappings.json` |

#### Language-Specific Options

| Option | Description |
|--------|-------------|
| `-g, --go-package <name>` | Adds `option go_package` to the proto file |

### Examples

#### Basic Operations-Based Generation

```bash
wgc grpc-service generate UserService \
  --input schema.graphql \
  --output ./proto \
  --with-operations ./operations
```

#### With Operation Type Prefixing

```bash
wgc grpc-service generate UserService \
  --input schema.graphql \
  --output ./proto \
  --with-operations ./operations \
  --prefix-operation-type
```

#### With Custom Scalar Mappings (Inline)

```bash
wgc grpc-service generate UserService \
  --input schema.graphql \
  --output ./proto \
  --with-operations ./operations \
  --custom-scalar-mapping '{"DateTime":"google.protobuf.Timestamp","UUID":"string"}'
```

#### With Custom Scalar Mappings (File)

```bash
wgc grpc-service generate UserService \
  --input schema.graphql \
  --output ./proto \
  --with-operations ./operations \
  --custom-scalar-mapping-file ./scalar-mappings.json
```

#### With Go Package

```bash
wgc grpc-service generate UserService \
  --input schema.graphql \
  --output ./proto \
  --with-operations ./operations \
  --go-package github.com/myorg/myapp/proto/user/v1
```


---

## API Reference

### compileOperationsToProto

Compiles GraphQL operations to Protocol Buffer definitions.

```typescript
function compileOperationsToProto(
  operationSource: string | DocumentNode,
  schemaOrSDL: GraphQLSchema | string,
  options?: OperationsToProtoOptions
): CompileOperationsToProtoResult
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `operationSource` | `string \| DocumentNode` | GraphQL operations as a string or parsed DocumentNode |
| `schemaOrSDL` | `GraphQLSchema \| string` | GraphQL schema or SDL string |
| `options` | `OperationsToProtoOptions` | Optional configuration |

#### Returns

```typescript
interface CompileOperationsToProtoResult {
  proto: string;              // Generated proto text
  root: protobuf.Root;        // Protobufjs AST root
  lockData: ProtoLock;        // Lock data for field stability
}
```

### Options Interface

```typescript
interface OperationsToProtoOptions {
  // Service Configuration
  serviceName?: string;           // Default: "DefaultService"
  packageName?: string;           // Default: "service.v1"
  
  // Language Options
  goPackage?: string;
  javaPackage?: string;
  javaOuterClassname?: string;
  javaMultipleFiles?: boolean;
  csharpNamespace?: string;
  rubyPackage?: string;
  phpNamespace?: string;
  phpMetadataNamespace?: string;
  objcClassPrefix?: string;
  swiftPrefix?: string;
  
  // Generation Options
  includeComments?: boolean;           // Default: true
  prefixOperationType?: boolean;       // Default: false
  queryIdempotency?: 'NO_SIDE_EFFECTS' | 'DEFAULT';  // Optional
  maxDepth?: number;                   // Default: 50
  
  // Field Stability
  lockData?: ProtoLock;           // Previous lock data
}
```

#### Example Usage

```typescript
import { compileOperationsToProto } from '@wundergraph/protographic';
import { readFileSync } from 'fs';

const schema = readFileSync('schema.graphql', 'utf8');
const operations = readFileSync('operations.graphql', 'utf8');

const result = compileOperationsToProto(operations, schema, {
  serviceName: 'UserService',
  packageName: 'myorg.user.v1',
  goPackage: 'github.com/myorg/myapp/proto/user/v1',
  prefixOperationType: true,
  queryIdempotency: 'NO_SIDE_EFFECTS',  // All queries are marked as idempotent
  includeComments: true,
  customScalarMappings: {
    'DateTime': 'google.protobuf.Timestamp',
    'UUID': 'string'
  },
});

console.log(result.proto);
// Save lock data for next generation
writeFileSync('service.proto.lock.json', JSON.stringify(result.lockData, null, 2));
```

---

## Tutorial

### Basic Usage

Let's walk through a complete example of generating proto from GraphQL operations.

#### Step 1: Create Your GraphQL Schema

**schema.graphql:**

```graphql
type Query {
  user(id: ID!): User
  users(limit: Int, offset: Int): [User!]!
}

type Mutation {
  createUser(input: CreateUserInput!): User
  updateUser(id: ID!, input: UpdateUserInput!): User
}

type User {
  id: ID!
  name: String!
  email: String!
  age: Int
  createdAt: String!
}

input CreateUserInput {
  name: String!
  email: String!
  age: Int
}

input UpdateUserInput {
  name: String
  email: String
  age: Int
}
```

#### Step 2: Create Your Operations

Create a directory for your operations. You can organize them in subdirectories:

```bash
mkdir -p operations/queries operations/mutations
```

**operations/queries/get-user.graphql:**

```graphql
query GetUser($id: ID!) {
  user(id: $id) {
    id
    name
    email
  }
}
```

**operations/queries/list-users.graphql:**

```graphql
query ListUsers($limit: Int, $offset: Int) {
  users(limit: $limit, offset: $offset) {
    id
    name
    email
    createdAt
  }
}
```

**operations/mutations/create-user.graphql:**

```graphql
mutation CreateUser($input: CreateUserInput!) {
  createUser(input: $input) {
    id
    name
    email
    createdAt
  }
}
```

**Note:** The tool will recursively find all `.graphql`, `.gql`, `.graphqls`, and `.gqls` files in the operations directory and its subdirectories.

#### Step 3: Generate Proto

```bash
wgc grpc-service generate UserService \
  --input schema.graphql \
  --output ./proto \
  --with-operations ./operations \
  --go-package github.com/myorg/myapp/proto/user/v1
```

#### Step 4: Review Generated Files

**proto/service.proto:**

```protobuf
syntax = "proto3";

package service.v1;

import "google/protobuf/wrappers.proto";

option go_package = "github.com/myorg/myapp/proto/user/v1";

service UserService {
  rpc GetUser(GetUserRequest) returns (GetUserResponse) {}
  
  rpc ListUsers(ListUsersRequest) returns (ListUsersResponse) {}
  
  rpc CreateUser(CreateUserRequest) returns (CreateUserResponse) {}
}

message GetUserRequest {
  string id = 1;
}

message GetUserResponse {
  message User {
    string id = 1;
    string name = 2;
    google.protobuf.StringValue email = 3;
  }
  
  User user = 1;
}

// ... more messages
```

### Working with Fragments

Fragments are fully supported in operations-based generation.

**operations/user-fields.graphql:**

```graphql
fragment UserFields on User {
  id
  name
  email
}

fragment UserWithTimestamp on User {
  ...UserFields
  createdAt
}

query GetUserWithFragment($id: ID!) {
  user(id: $id) {
    ...UserWithTimestamp
  }
}
```

The generated proto will include all fields from the fragments.

### Handling Subscriptions

Subscriptions are generated as server-streaming RPC methods.

**operations/user-updates.graphql:**

```graphql
subscription OnUserUpdated($userId: ID!) {
  userUpdated(userId: $userId) {
    id
    name
    email
  }
}
```

**Generated proto:**

```protobuf
service UserService {
  rpc OnUserUpdated(OnUserUpdatedRequest) returns (stream OnUserUpdatedResponse) {}
}
```

### Maintaining Field Stability

Field number stability is crucial for backward compatibility.

#### Initial Generation

```bash
wgc grpc-service generate UserService \
  --input schema.graphql \
  --with-operations ./operations \
  --output ./proto
```

**Generated lock file:**

```json
{
  "messages": {
    "GetUserResponse": {
      "fields": {
        "id": 1,
        "name": 2,
        "email": 3
      }
    }
  }
}
```

#### Adding a New Field

Update your operation to include a new field:

```graphql
query GetUser($id: ID!) {
  user(id: $id) {
    id
    name
    email
    age  # New field
  }
}
```

Regenerate - the lock file preserves existing field numbers and assigns the next available number to the new field.

---

## Advanced Topics


### Custom Scalar Mappings

GraphQL custom scalars can be mapped to proto types using either inline JSON or a separate configuration file.

#### Common Scalar Mappings

| GraphQL Scalar | Recommended Proto Type |
|----------------|----------------------|
| `DateTime` | `google.protobuf.Timestamp` |
| `Date` | `google.protobuf.Timestamp` |
| `JSON` | `google.protobuf.Struct` |
| `UUID` | `string` |
| `BigInt` | `int64` |

#### Using Inline JSON

Pass custom scalar mappings directly as a JSON string:

```bash
wgc grpc-service generate UserService \
  --input schema.graphql \
  --output ./proto \
  --with-operations ./operations \
  --custom-scalar-mapping '{"DateTime":"google.protobuf.Timestamp","UUID":"string"}'
```

#### Using a Configuration File

Create a JSON file with your scalar mappings:

**scalar-mappings.json:**
```json
{
  "DateTime": "google.protobuf.Timestamp",
  "Date": "google.protobuf.Timestamp",
  "UUID": "string",
  "JSON": "google.protobuf.Struct",
  "BigInt": "int64"
}
```

Then reference it in your command:

```bash
wgc grpc-service generate UserService \
  --input schema.graphql \
  --output ./proto \
  --with-operations ./operations \
  --custom-scalar-mapping-file ./scalar-mappings.json
```

**Note:** You cannot use both `--custom-scalar-mapping` and `--custom-scalar-mapping-file` simultaneously. Choose one approach based on your needs.

#### In Code

When using the API directly, pass the mappings as an object:

```typescript
const result = compileOperationsToProto(operations, schema, {
  customScalarMappings: {
    'DateTime': 'google.protobuf.Timestamp',
    'UUID': 'string',
    'JSON': 'google.protobuf.Struct'
  }
});
```

### Proto Lock Files

The lock file maintains field number stability across generations.

#### Lock File Structure

```json
{
  "messages": {
    "MessageName": {
      "fields": {
        "field_name": 1,
        "another_field": 2
      },
      "reservedNumbers": [3, 5],
      "reservedNames": ["old_field"]
    }
  }
}
```

#### Best Practices

1. **Commit Lock Files**: Always commit lock files to version control
2. **Never Edit Manually**: Let the tool manage the lock file
3. **Backup Before Major Changes**: Keep a backup before significant refactoring
4. **Review Changes**: Check lock file diffs in code reviews

---

## Troubleshooting

### Common Issues

#### No Operation Files Found

**Error:**
```text
No GraphQL operation files (.graphql, .gql) found in ./operations
```

**Solution:**
- Ensure your operation files have `.graphql`, `.gql`, `.graphqls`, or `.gqls` extensions
- Check the path to your operations directory
- Verify files contain valid GraphQL operations
- Note: The directory is traversed recursively, so operation files in subdirectories will be included

#### Anonymous Operations Not Supported

**Error:**
```text
Operations must be named
```

**Solution:**
Name all your operations:

```graphql
# ❌ Bad - anonymous
query {
  user(id: "1") {
    name
  }
}

# ✅ Good - named
query GetUser {
  user(id: "1") {
    name
  }
}
```

#### Field Number Conflicts

**Error:**
```text
Field number conflict in message X
```

**Solution:**
- Delete the lock file and regenerate (breaking change)
- Or manually resolve conflicts in the lock file (advanced)

---

### Version Management

1. **Semantic Versioning**: Use semver for proto packages
2. **Package Naming**: Include version in package name (`myorg.user.v1`)
3. **Breaking Changes**: Increment major version for breaking changes
4. **Lock File Commits**: Always commit lock files with proto changes

---

## Limitations

- **Named operations only**: All operations must have a name. Anonymous operations are not supported
- **Single operation per document**: Multiple operations in one document are not supported for proto reversibility
- **No root-level field aliases**: Field aliases at the root level break proto-to-GraphQL reversibility
- **Alpha status**: The API may change in future releases
