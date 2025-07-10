# GraphQL SDL to Protocol Buffer Conversion Rules

This document outlines the rules and conventions used by Protographic when converting GraphQL Schema Definition Language (SDL) to Protocol Buffers.

Rules should follow [Proto Best Practices](https://protobuf.dev/best-practices/dos-donts/).

## ✨ Features and Limitations

<table>
<tr>
<td width="50%" valign="top">

### 🚀 Supported Features

#### Operation Types

- ✓ Query operations
- ✓ Mutation operations
- ✓ Federation entity lookups with a single key

#### Data Types

- ✓ Scalar arguments
- ✓ Complex input types
- ✓ Enum values with bidirectional mapping
- ✓ Interface types with implementing types
- ✓ Union types with member types
- ✓ Recursive types (self-referencing structures)
- ✓ Nested object types and relationships

</td>
<td width="50%" valign="top">

### 🚧 Current Limitations

#### Federation Features

- ✗ Federation entity lookups with multiple keys
- ✗ Federation entity lookups with nested keys
- ✗ @requires directive

#### GraphQL Features

- ✗ Subscriptions (only Query and Mutation operations)
- ✗ Custom scalar conversion (fixed mappings only)
- ✗ Field resolvers

</td>
</tr>
</table>

## Basic Type Mappings

### Scalar Types

| GraphQL Type | Protocol Buffer Type (Non-Null) | Protocol Buffer Type (Nullable) |
| ------------ | ------------------------------- | ------------------------------- |
| ID           | string                          | google.protobuf.StringValue     |
| String       | string                          | google.protobuf.StringValue     |
| Int          | int32                           | google.protobuf.Int32Value      |
| Float        | double                          | google.protobuf.DoubleValue     |
| Boolean      | bool                            | google.protobuf.BoolValue       |

### Complex Types

| GraphQL Type      | Protocol Buffer Representation            |
| ----------------- | ----------------------------------------- |
| Object Type       | message                                   |
| Input Object Type | message                                   |
| Enum Type         | enum with prefixed values                 |
| Interface Type    | message with oneof for implementations    |
| Union Type        | message with oneof for member types       |
| List Type         | repeated field                            |
| Nested List Type  | message with repeated field               |
| Non-Null Type     | regular field (Proto3 has no nullability) |

## Naming Conventions

1. **Field Names**: GraphQL camelCase field names are converted to snake_case in Protocol Buffers
2. **Type Names**: Preserved as-is from GraphQL
3. **Enum Values**: Prefixed with the enum type name in uppercase (e.g., `STATUS_ACTIVE`)
4. **Operation Methods**: Prefixed with type (`Query` or `Mutation`) followed by operation name
5. **Nested List Wrappers**: For nested lists, a wrapper message is created with the name format `{Type}List`

## Operation Mapping

### Queries and Mutations

Each query or mutation field is mapped to an RPC method with request and response messages:

```graphql
type Query {
  user(id: ID!): User
}
```

Maps to:

```protobuf
rpc QueryUser(QueryUserRequest) returns (QueryUserResponse) {}

message QueryUserRequest {
  string id = 1;
}

message QueryUserResponse {
  User user = 1;
}
```

### Entity Lookups

For types with `@key` directive, lookup methods are generated:

```graphql
type Product @key(fields: "id") {
  id: ID!
  name: String!
}
```

Maps to:

```protobuf
rpc LookupProductById(LookupProductByIdRequest) returns (LookupProductByIdResponse) {}

message LookupProductByIdRequest {
  repeated LookupProductByIdRequestKey keys = 1;
}

message LookupProductByIdRequestKey {
  string id = 1;
}

message LookupProductByIdResponse {
  repeated Product result = 1;
}
```

## Interface and Union Handling

### Interfaces

GraphQL interfaces are mapped to Protocol Buffer messages with a `oneof` field containing all implementing types:

```graphql
interface Node {
  id: ID!
}

type User implements Node {
  id: ID!
  name: String!
}

type Post implements Node {
  id: ID!
  title: String!
}
```

Maps to:

```protobuf
message Node {
  oneof instance {
    User user = 1;
    Post post = 2;
  }
}

message User {
  string id = 1;
  string name = 2;
}

message Post {
  string id = 1;
  string title = 2;
}
```

### Unions

GraphQL unions are mapped similarly to interfaces:

```graphql
union SearchResult = User | Post

type User {
  id: ID!
  name: String!
}

type Post {
  id: ID!
  title: String!
}
```

Maps to:

```protobuf
message SearchResult {
  oneof value {
    User user = 1;
    Post post = 2;
  }
}
```

## Enum Handling

GraphQL enums are mapped to Protocol Buffer enums with an additional UNSPECIFIED value:

```graphql
enum UserRole {
  ADMIN
  USER
}
```

Maps to:

```protobuf
enum UserRole {
  USER_ROLE_UNSPECIFIED = 0;
  USER_ROLE_ADMIN = 1;
  USER_ROLE_USER = 2;
}
```

## Nested List Types

For nested lists in GraphQL (e.g., `[[Type]]`), Protographic creates a wrapper message:

```graphql
type Matrix {
  values: [[Int!]!]!
}
```

Maps to:

```protobuf
message IntList {
  repeated int32 result = 1;
}

message Matrix {
  repeated IntList values = 1;
}
```

This approach is used for any nested list, regardless of the depth of nesting. For complex nested types, wrapper messages are created automatically with the naming convention of `{BaseType}List`.

## Field Numbering and Stability

Protographic ensures stable field numbering across schema changes by using a "proto lock" mechanism:

1. **Field Numbering**: Each field in a message is assigned a sequential number starting from 1
2. **Field Removal**: When a field is removed from a schema, its number is reserved to prevent reuse
3. **Reserved Numbers**: Field numbers for removed fields are tracked in the `reserved` statement
4. **Field Re-addition**: If a removed field is later re-added, it gets a new field number to maintain compatibility
5. **Range Notation**: When multiple consecutive field numbers are reserved, they're represented efficiently using range notation (e.g., `reserved 2 to 4, 5;` for fields 2, 3, 4, and 5)

This mechanism ensures backward compatibility when fields are added, removed, or renamed.

### Example: Field Reservation During Schema Evolution

Consider this evolution of a GraphQL type over time:

#### Initial Schema (v1)

```graphql
type User {
  id: ID! # Field number 1
  name: String! # Field number 2
  email: String! # Field number 3
  age: Int # Field number 4
  bio: String # Field number 5
  isActive: Boolean # Field number 6
}
```

Generates:

```protobuf
import "google/protobuf/wrappers.proto";

message User {
  string id = 1;
  string name = 2;
  string email = 3;
  google.protobuf.Int32Value age = 4;
  google.protobuf.StringValue bio = 5;
  google.protobuf.BoolValue is_active = 6;
}
```

#### Schema Change (v2) - Removed multiple fields

```graphql
type User {
  id: ID!
  name: String!
  # email was removed (field 3)
  # age was removed (field 4)
  # bio was removed (field 5)
  isActive: Boolean
}
```

Generates (with range notation for reserved fields):

```protobuf
import "google/protobuf/wrappers.proto";

message User {
  reserved 3 to 5;  // Efficiently reserves fields 3, 4, and 5
  string id = 1;
  string name = 2;
  google.protobuf.BoolValue is_active = 6;
}
```

#### Schema Change (v3) - Added and restored some fields

```graphql
type User {
  id: ID!
  name: String!
  bio: String # Restoring previously removed field
  isActive: Boolean
  createdAt: String # New field gets number 7, not 3, 4, or 5
}
```

Generates:

```protobuf
import "google/protobuf/wrappers.proto";

message User {
  reserved 3 to 4;  // Fields 3 and 4 remain reserved
  string id = 1;
  string name = 2;
  google.protobuf.StringValue bio = 5;   // Restored field keeps its original number
  google.protobuf.BoolValue is_active = 6;
  google.protobuf.StringValue created_at = 7; // New field gets next available number
}
```

This careful tracking of field numbers ensures that clients using older versions of the Protobuf schema won't misinterpret data when fields are added, removed, or changed. The proto lock manager maintains this state across schema evolutions automatically.

## Documentation and Comments

Protographic preserves documentation from GraphQL schemas and converts it to Protocol Buffer comments:

### Comment Conversion

| GraphQL Documentation | Protocol Buffer Representation |
| -------------------- | ------------------------------ |
| Single-line descriptions (`"description"`) | Single-line comments (`// comment`) |
| Multi-line descriptions (`"""description"""`) | Multi-line comments (`/* comment */`) |
| Field descriptions | Field comments |
| Type descriptions | Message/enum comments |
| Enum value descriptions | Enum value comments |
| Operation descriptions | RPC method comments |

### Comment Preservation

When generating Protocol Buffers, Protographic:

1. **Type Documentation**: Preserves descriptions from GraphQL types and converts them to comments before message/enum definitions
2. **Field Documentation**: Preserves descriptions from GraphQL fields and converts them to comments before field definitions
3. **Enum Value Documentation**: Preserves descriptions from GraphQL enum values and converts them to comments before enum value definitions
4. **Operation Documentation**: Preserves descriptions from GraphQL operations (Query/Mutation fields) and uses them for RPC method documentation
5. **Entity Documentation**: Uses entity type descriptions for adding documentation to lookup methods for Federation entities
6. **Request/Response Documentation**: Generates contextual documentation for request/response messages based on operation descriptions

This approach ensures that documentation and business context from the GraphQL schema is properly reflected in the generated Protocol Buffer definitions, making it easier for developers to understand the purpose and usage of messages and fields.

## Federation Support

Types with Federation's `@key` directive generate dedicated lookup methods rather than using the `_entities` field approach used in pure GraphQL. The lookup methods are optimized for batch processing of entities.
