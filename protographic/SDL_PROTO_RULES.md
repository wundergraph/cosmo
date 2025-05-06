# GraphQL SDL to Protocol Buffer Conversion Rules

This document outlines the rules and conventions used by Protographic when converting GraphQL Schema Definition Language (SDL) to Protocol Buffers.

## Basic Type Mappings

### Scalar Types

| GraphQL Type | Protocol Buffer Type |
|--------------|----------------------|
| ID           | string               |
| String       | string               |
| Int          | int32                |
| Float        | double               |
| Boolean      | bool                 |

### Complex Types

| GraphQL Type       | Protocol Buffer Representation         |
|--------------------|---------------------------------------|
| Object Type        | message                               |
| Input Object Type  | message                               |
| Enum Type          | enum with prefixed values             |
| Interface Type     | message with oneof for implementations|
| Union Type         | message with oneof for member types   |
| List Type          | repeated field                        |
| Non-Null Type      | regular field (Proto3 has no nullability) |

## Naming Conventions

1. **Field Names**: GraphQL camelCase field names are converted to snake_case in Protocol Buffers
2. **Type Names**: Preserved as-is from GraphQL
3. **Enum Values**: Prefixed with the enum type name in uppercase (e.g., `STATUS_ACTIVE`)
4. **Operation Methods**: Prefixed with type (`Query` or `Mutation`) followed by operation name

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
  string id = 1;
}

message LookupProductByIdResult {
  Product product = 1;
}

message LookupProductByIdResponse {
  repeated LookupProductByIdResult results = 1;
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

## Federation Support

Types with Federation's `@key` directive generate dedicated lookup methods rather than using the `_entities` field approach used in pure GraphQL.

## Field Numbering

Protocol Buffer field numbers are assigned sequentially starting from 1 for each message. 