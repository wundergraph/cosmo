# GraphQL to Proto Mapping Conventions

This document outlines the rules and conventions used when converting GraphQL Schema Definition Language (SDL) to Protocol Buffer mappings.

## General Principles

The mapping process creates a structured representation that can be used to generate Protocol Buffer (proto3) definitions from GraphQL schemas. This intermediate mapping preserves the semantic relationships between GraphQL types while adapting them to Proto's structural requirements.

## Version and Service

- Each mapping has a version number (currently `1`)
- The service name is derived from user input or defaults to `DefaultService`

## Type Mapping

### Object Types

GraphQL object types are mapped to corresponding Proto message types with field mappings for each GraphQL field:

```graphql
type User {
  id: ID!
  name: String!
}
```

Each object type is represented in the `typeFieldMappings` list with its fields.

### Type Field Naming

- Field names are converted from GraphQL's camelCase to Proto's snake_case
- Example: `firstName` → `first_name`

## Operations Mapping

Query operations (fields on the Query type) are mapped to RPC methods:

- Each query field generates an operation mapping
- Operation names follow the pattern: `Query{CapitalizedFieldName}`
- Request message names: `Query{CapitalizedFieldName}Request`
- Response message names: `Query{CapitalizedFieldName}Response`

Example:
```graphql
type Query {
  user(id: ID!): User
}
```

Maps to an operation with:
- `original: "user"`
- `mapped: "QueryUser"`
- `request: "QueryUserRequest"`
- `response: "QueryUserResponse"`

## Arguments

Query arguments are mapped to fields in the request message:

- Arguments maintain their semantic meaning
- Argument names are converted to snake_case
- Each field with arguments will have corresponding `argumentMappings`

## Federation Entity Mapping

Federation entities (types with the `@key` directive) receive special handling:

```graphql
type Product @key(fields: "id") {
  id: ID!
  name: String!
}
```

Generates entity mappings with:
- `typeName: "Product"`
- `kind: "entity"`
- `key: "id"` (first key field from directive)
- `rpc: "LookupProductById"`
- `request: "LookupProductByIdRequest"`
- `response: "LookupProductByIdResponse"`

## Enum Types

GraphQL enums are converted to Proto enums with values prefixed by the enum type name:

```graphql
enum Role {
  ADMIN
  USER
}
```

Maps to enum mappings with values:
- `original: "ADMIN"` → `mapped: "ROLE_ADMIN"`
- `original: "USER"` → `mapped: "ROLE_USER"`

## Interface and Union Types

GraphQL interfaces and unions are handled by mapping the concrete types that implement them:

1. Interface fields are mapped on each implementing type
2. Union member types are individually mapped
3. Union types themselves don't generate mappings

## Input Types

Input types are mapped similarly to output types:

- Each input type appears in `typeFieldMappings`
- Input fields are converted to snake_case
- Nested input types are mapped recursively

```graphql
input UserInput {
  name: String!
  emailAddress: String!
}
```

Maps to field mappings with:
- `original: "name"` → `mapped: "name"`
- `original: "emailAddress"` → `mapped: "email_address"`

## Special Handling

- Federation-specific fields like `_entities` are skipped in operation mappings
- Built-in GraphQL types (`__typename`, etc.) are ignored
- Query, Mutation, and Subscription types receive special handling

## Type Naming Conventions

- Proto message type names preserve GraphQL type names
- Generated RPC service methods follow `{OperationType}{CapitalizedFieldName}` pattern
- Request/response message types follow `{Method}Request` and `{Method}Response` pattern

This mapping structure provides a complete representation of the GraphQL schema that can be used to generate valid Protocol Buffer definitions while maintaining semantic equivalence. 