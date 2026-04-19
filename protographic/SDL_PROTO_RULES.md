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
- ✓ Field resolvers with custom context
- ✓ Federation entity lookups with a single key
- ✓ Federation entity lookups with multiple keys
- ✓ Federation entity lookups with compound keys
- ✓ Federation entity lookups on interface objects
- ✓ Federation @requires directive (entity field dependencies)

#### Data Types

- ✓ Scalar arguments
- ✓ Complex input types
- ✓ Nullable scalar types
- ✓ Enum values with bidirectional mapping
- ✓ Interface types with implementing types
- ✓ Union types with member types
- ✓ Recursive types (self-referencing structures)
- ✓ Nested object types and relationships
- ✓ Lists (nullable and non-nullable)
- ✓ Nested lists (nullable and non-nullable)

</td>
<td width="50%" valign="top">

### 🚧 Current Limitations

#### Federation Features

- ✗ Federation entity lookups with nested keys

#### GraphQL Features

- ✗ Subscriptions (only Query and Mutation operations)
- ✗ Custom scalar conversion (fixed mappings only)
- ✗ Nullable list items (not supported in Protobuf)

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

### Interface Object Lookups

In addition to object types, interface types can also define `@key` directives, making them interface objects. When an interface has `@key`, a lookup method is generated for the interface itself, in addition to any lookups generated for the implementing types. The interface's proto message uses `oneof` (as with all interfaces), so the lookup response returns the interface wrapper which contains the concrete type.

Both the interface and its implementing types can independently declare `@key` directives with different key fields:

```graphql
interface Account @key(fields: "id") {
  id: ID!
  email: String!
}

type PersonalAccount implements Account @key(fields: "id") @key(fields: "email") {
  id: ID!
  email: String!
  name: String!
}

type BusinessAccount implements Account @key(fields: "id") {
  id: ID!
  email: String!
  taxId: String!
}
```

Maps to:

```protobuf
// Interface entity lookup
rpc LookupAccountById(LookupAccountByIdRequest) returns (LookupAccountByIdResponse) {}

// Implementing type lookups (each type has its own keys)
rpc LookupPersonalAccountById(LookupPersonalAccountByIdRequest) returns (LookupPersonalAccountByIdResponse) {}
rpc LookupPersonalAccountByEmail(LookupPersonalAccountByEmailRequest) returns (LookupPersonalAccountByEmailResponse) {}
rpc LookupBusinessAccountById(LookupBusinessAccountByIdRequest) returns (LookupBusinessAccountByIdResponse) {}

message LookupAccountByIdRequest {
  repeated LookupAccountByIdRequestKey keys = 1;
}

message LookupAccountByIdRequestKey {
  string id = 1;
}

message LookupAccountByIdResponse {
  repeated Account result = 1;
}

message Account {
  oneof instance {
    PersonalAccount personal_account = 1;
    BusinessAccount business_account = 2;
  }
}

message PersonalAccount {
  string id = 1;
  string email = 2;
  string name = 3;
}

message BusinessAccount {
  string id = 1;
  string email = 2;
  string tax_id = 3;
}
```

**Key Points**:

- The interface entity lookup returns the interface message (which contains `oneof instance`)
- Implementing types generate their own independent lookup methods based on their own `@key` directives
- `@requires` is **not** supported on interface objects — only on object types with `@key`

### Required Fields (@requires)

The `@requires` directive declares that a field depends on external fields from other subgraphs to be resolved. It is only supported on object types with `@key` (interfaces are excluded, even when declared as interface objects). For each field with `@requires`, a dedicated RPC method is generated that receives the entity key and the required external fields, and returns the computed field value.

This directive is part of Apollo Federation and enables a service to compute fields that depend on data owned by other services, without those services needing to know about the computed field.

#### Basic Required Fields

For a simple `@requires` directive with scalar fields:

```graphql
type Product @key(fields: "id") {
  id: ID!
  price: Float! @external
  itemCount: Int! @external
  stockHealthScore: Float! @requires(fields: "itemCount price")
}
```

Maps to:

```protobuf
rpc RequireProductStockHealthScoreById(RequireProductStockHealthScoreByIdRequest)
    returns (RequireProductStockHealthScoreByIdResponse) {}

message RequireProductStockHealthScoreByIdRequest {
  // Context provides the context for the required fields method
  repeated RequireProductStockHealthScoreByIdContext context = 1;
}

message RequireProductStockHealthScoreByIdContext {
  // The key message is provided by the entity lookup generation and re-used.
  LookupProductByIdRequestKey key = 1;
  RequireProductStockHealthScoreByIdFields fields = 2;
}

message RequireProductStockHealthScoreByIdResponse {
  // Result provides the result for the required fields method
  repeated RequireProductStockHealthScoreByIdResult result = 1;
}

message RequireProductStockHealthScoreByIdResult {
  double stock_health_score = 1;
}

message RequireProductStockHealthScoreByIdFields {
  int32 item_count = 1;
  double price = 2;
}
```

**Naming Convention**: `Require{EntityType}{FieldName}By{KeyFields}`

For the example above: `RequireProductStockHealthScoreById`

- Entity type: `Product`
- Field name: `StockHealthScore`
- Key fields: `Id` (from the `@key` directive)

#### Message Structure Breakdown

Five messages are generated for each `@requires` field:

1. **Request Message** (`Require...Request`): Wraps a repeated context for batch processing
2. **Context Message** (`Require...Context`): Pairs the entity key with the required fields
   - `key`: References the same key structure as the entity lookup (`Lookup...RequestKey`)
   - `fields`: Contains the external fields specified in `@requires`
3. **Fields Message** (`Require...Fields`): Contains only the fields from the `@requires` selection (converted to snake_case)
4. **Response Message** (`Require...Response`): Wraps a repeated result for batch processing
5. **Result Message** (`Require...Result`): Contains only the resolved field value (the one with `@requires`)

The context message links the entity key (which identifies the entity) with the required external fields (which provide the data needed to compute the field).

#### Nested Required Fields

The `@requires` directive supports nested field selections for complex types:

```graphql
type Product @key(fields: "id") {
  id: ID!
  manufacturerId: ID! @external
  details: ProductDetails! @external
  name: String! @requires(fields: "manufacturerId details { description reviewSummary { status message } }")
  price: Float!
}

type ProductDetails {
  id: ID!
  description: String!
  title: String!
  reviewSummary: ActionResult!
}

type ActionResult {
  status: String!
  message: String!
}
```

Maps to:

```protobuf
rpc RequireProductNameById(RequireProductNameByIdRequest)
    returns (RequireProductNameByIdResponse) {}

message RequireProductNameByIdRequest {
  repeated RequireProductNameByIdContext context = 1;
}

message RequireProductNameByIdContext {
  LookupProductByIdRequestKey key = 1;
  RequireProductNameByIdFields fields = 2;
}

message RequireProductNameByIdResponse {
  repeated RequireProductNameByIdResult result = 1;
}

message RequireProductNameByIdResult {
  string name = 1;
}

message RequireProductNameByIdFields {
  message ProductDetails {
    message ActionResult {
      string status = 1;
      string message = 2;
    }

    string description = 1;
    ActionResult review_summary = 2;
  }

  string manufacturer_id = 1;
  ProductDetails details = 2;
}
```

**Key Points**:

- The `Fields` message contains only the selected subset from the `@requires` directive, not the full types
- Nested types are generated as nested proto messages within the `Fields` message
- Only the selected fields from nested types are included (e.g., `description` and `reviewSummary` from `ProductDetails`, not `id` or `title`)
- Field order in the proto matches the normalized selection order

#### Composite Types in Required Fields (Interfaces & Unions)

When `@requires` references a field whose type is an interface or union, the required field selection must include inline fragments to specify which fields to extract from each concrete type.

##### The `__typename` Requirement

When using inline fragments on an interface or union field in `@requires`, `__typename` must be present in the selection set. This is required for the engine to determine which concrete type to deserialize at runtime. Validation produces errors with field paths (e.g., `in "pet.friend"`) for nested selections missing `__typename`.

Example:

```graphql
@requires(fields: "primaryItem { __typename ... on PalletItem { name } ... on ContainerItem { name } }")
```

##### Selection Normalization

Before proto generation, selections are normalized by distributing parent-level fields into each inline fragment. For example:

```graphql
media { id ... on Book { author } ... on Movie { director } }
```

Normalizes to:

```graphql
media { ... on Book { id author } ... on Movie { id director } }
```

This ensures each fragment is self-contained. Nested inline fragments on sub-interfaces are also flattened to concrete types. For example, given `Employee` (interface) with implementors `Manager`, `Engineer`, `Contractor`, and `Intern` — where `Engineer` and `Contractor` also implement `Managed`:

```graphql
# Before normalization:
members {
  id
  ... on Managed { supervisor }
}

# After normalization — expanded to all concrete types,
# with `supervisor` only on types that implement Managed:
members {
  ... on Manager { id }
  ... on Engineer { id supervisor }
  ... on Contractor { id supervisor }
  ... on Intern { id }
}
```

##### Proto Mapping — Interface/Union Becomes `oneof`

The interface or union type maps to a message with `oneof instance` containing each concrete type. `__typename` is consumed during validation only — it does **not** appear in the generated proto.

```graphql
type Storage @key(fields: "id") {
  id: ID!
  primaryItem: StorageItem! @external
  itemInfo: String!
    @requires(
      fields: "primaryItem { __typename ... on PalletItem { name palletCount } ... on ContainerItem { name containerSize } }"
    )
}

interface StorageItem {
  name: String!
}

type PalletItem implements StorageItem {
  name: String!
  palletCount: Int!
}

type ContainerItem implements StorageItem {
  name: String!
  containerSize: String!
}
```

Maps to (Fields message only):

```protobuf
message RequireStorageItemInfoByIdFields {
  message PalletItem {
    string name = 1;
    int32 pallet_count = 2;
  }

  message ContainerItem {
    string name = 1;
    string container_size = 2;
  }

  message StorageItem {
    oneof instance {
      ContainerItem container_item = 1;
      PalletItem pallet_item = 2;
    }
  }

  StorageItem primary_item = 1;
}
```

**Key Points**:

- `__typename` is absent from the proto — it is consumed during validation only
- The interface type becomes a message with `oneof instance`
- Each implementing type gets its own message with only the fields selected in its fragment
- All type messages (`StorageItem`, `PalletItem`, `ContainerItem`) are **nested inside** the `Fields` message. This scoping ensures they don't collide with the root-level messages of the same name, which contain all fields of the type — while the nested versions contain only the subset selected in `@requires`
- The same pattern applies to union types (union member types instead of implementing types)

#### Required Fields with Arguments

When a field annotated with @requires defines arguments, it is handled the same as other @requires-annotated fields. However, the generated proto request message includes an additional field, field_args, which contains the argument values provided in the query.

```graphql
type User @key(fields: "id") {
  id: ID!
  post(slug: String!, maxResults: Int!): Post! @requires(fields: "name")
}
```

Maps to:

```protobuf
rpc RequireUserPostById(RequireUserPostByIdRequest) returns (RequireUserPostByIdResponse) {}

message RequireUserPostByIdRequest {
  repeated RequireUserPostByIdContext context = 1;
  RequireUserPostByIdArgs field_args = 2;  // Added when field has arguments
}

message RequireUserPostByIdArgs {
  string slug = 1;
  int32 max_results = 2;
}
```

## Field Resolvers

Field resolvers allow you to define custom resolution logic for specific fields within a GraphQL type. Using the `@connect__fieldResolver` directive, you can specify which fields should be resolved through dedicated RPC methods, enabling lazy loading, computed fields, or integration with external data sources.

Fields with the `@connect__fieldResolver` directive are excluded from the parent type's Proto message. This is the same behavior as fields with arguments, which are always treated as resolver fields. This ensures that expensive or lazily-loaded fields are not part of the regular response returned by operations — they are only resolved through their dedicated RPC methods.

### Basic Field Resolver with Arguments

Fields with arguments are automatically treated as resolver fields. Additionally, fields marked with `@connect__fieldResolver` generate dedicated RPC methods with request and response messages:

```graphql
type User {
  id: ID!
  name: String!
  posts(limit: Int!): [Post!]! @connect__fieldResolver(context: "id")
}

type Post {
  id: ID!
  title: String!
}

type Query {
  user(id: ID!): User
}
```

Maps to:

```protobuf
rpc ResolveUserPosts(ResolveUserPostsRequest) returns (ResolveUserPostsResponse) {}

// Request message includes context and field arguments
message ResolveUserPostsRequest {
  // context provides the resolver context for the field posts of type User.
  repeated ResolveUserPostsContext context = 1;
  // field_args provides the arguments for the resolver field posts of type User.
  ResolveUserPostsArgs field_args = 2;
}

message ResolveUserPostsContext {
  string id = 1;  // Context field from parent type
}

message ResolveUserPostsArgs {
  int32 limit = 1;  // Field argument
}

message ResolveUserPostsResult {
  repeated Post posts = 1;
}

message ResolveUserPostsResponse {
  repeated ResolveUserPostsResult result = 1;
}
```

### Field Resolver without Arguments

The `@connect__fieldResolver` directive can also be used on fields **without arguments** to exclude expensive fields from the parent type's message and resolve them separately. In this case, no `Args` message is generated and the request message only contains the `context` field:

```graphql
type User {
  id: ID!
  name: String!
  avatar: String! @connect__fieldResolver(context: "id")
}

type Query {
  user(id: ID!): User
}
```

Maps to:

```protobuf
rpc ResolveUserAvatar(ResolveUserAvatarRequest) returns (ResolveUserAvatarResponse) {}

message ResolveUserAvatarContext {
  string id = 1;
}

// Request message only includes context (no field_args)
message ResolveUserAvatarRequest {
  repeated ResolveUserAvatarContext context = 1;
}

message ResolveUserAvatarResult {
  string avatar = 1;
}

message ResolveUserAvatarResponse {
  repeated ResolveUserAvatarResult result = 1;
}

// Note: avatar is excluded from the User message
message User {
  string id = 1;
  string name = 2;
}
```

### Field Resolver Components

For field resolvers **with arguments**, four message types are generated:

1. **Context Message** (`Resolve{Type}{Field}Context`): Contains fields from the parent type needed to resolve the field
2. **Args Message** (`Resolve{Type}{Field}Args`): Contains the arguments passed to the field
3. **Result Message** (`Resolve{Type}{Field}Result`): Contains the resolved field value
4. **Request/Response Messages**: Standard request/response pattern for the RPC method

For field resolvers **without arguments**, the `Args` message is omitted and the request message only contains the `context` field.

### Context Specification

The `context` parameter in `@connect__fieldResolver` is **required** and specifies which fields from the parent type should be available to the resolver:

```graphql
type User {
  id: ID!
  name: String!
  email: String!
  post(upper: Boolean!): Post! @connect__fieldResolver(context: "id name")
}
```

Maps to:

```protobuf
message ResolveUserPostContext {
  string id = 1;
  string name = 2;
}
```

#### Automatic Context Inference (Without Directive)

If the `@connect__fieldResolver` directive is **not specified** on a field with arguments, Protographic automatically infers that it needs resolution and uses the first field of type `ID` found in the parent type as context:

```graphql
type User {
  id: ID!
  name: String!
  posts(limit: Int!): [Post!]! # No directive: automatically uses "id" as context
}
```

#### Context Validation Rules

When the `@connect__fieldResolver` directive is specified:

- The `context` parameter is **required** - you must explicitly specify which field(s) to use

When the directive is NOT specified (automatic inference):

- If no `ID` field exists, an error is raised
- If multiple `ID` fields exist, an error is raised (you must use the directive with explicit context)

In all cases:

- Context fields are converted from camelCase to snake_case following Protocol Buffer naming conventions

### Field Name Conversion

Following Protocol Buffer best practices, GraphQL camelCase field names are converted to snake_case in all generated messages:

```graphql
type User {
  id: ID!
  myLongFieldName: String!
  anotherVeryLongField: Int!
  post: Post! @connect__fieldResolver(context: "id myLongFieldName anotherVeryLongField")
}
```

Maps to:

```protobuf
message ResolveUserPostContext {
  string id = 1;
  string my_long_field_name = 2;      // Converted to snake_case
  int32 another_very_long_field = 3;  // Converted to snake_case
}
```

This conversion applies to:

- Context field names
- Argument field names
- Result field names
- All fields in the parent type message

### Complex Field Arguments

Field resolvers support complex input types as arguments:

```graphql
type Product {
  id: ID!
  count(filters: ProductCountFilter): Int! @connect__fieldResolver(context: "id")
}

input ProductCountFilter {
  minPrice: Float
  maxPrice: Float
  inStock: Boolean
  searchTerm: String
}
```

Maps to:

```protobuf
message ResolveProductCountArgs {
  ProductCountFilter filters = 1;
}

message ResolveProductCountContext {
  string id = 1;
}

message ProductCountFilter {
  google.protobuf.DoubleValue min_price = 1;
  google.protobuf.DoubleValue max_price = 2;
  google.protobuf.BoolValue in_stock = 3;
  google.protobuf.StringValue search_term = 4;
}
```

### Nested Field Resolvers

Field resolvers can be defined on types that are themselves returned by other field resolvers, enabling multi-level lazy loading:

```graphql
type User {
  id: ID!
  post(upper: Boolean!): Post! @connect__fieldResolver(context: "id")
}

type Post {
  id: ID!
  comment(upper: Boolean!): Comment! @connect__fieldResolver(context: "id")
}

type Comment {
  content: String!
}
```

Maps to:

```protobuf
// First level resolver
rpc ResolveUserPost(ResolveUserPostRequest) returns (ResolveUserPostResponse) {}

// Second level resolver
rpc ResolvePostComment(ResolvePostCommentRequest) returns (ResolvePostCommentResponse) {}
```

### Batch Resolution

Field resolver requests support batch processing through repeated context messages, allowing efficient resolution of fields for multiple parent instances:

```protobuf
message ResolveUserPostsRequest {
  repeated ResolveUserPostsContext context = 1;  // Multiple contexts for batch processing
  ResolveUserPostsArgs field_args = 2;
}

message ResolveUserPostsResponse {
  repeated ResolveUserPostsResult result = 1;  // Results in same order as contexts
}
```

The service implementation must return results in the same order as the provided contexts to ensure correct mapping back to parent instances.

### List Return Types

Field resolvers can return both scalar and list types:

```graphql
type User {
  id: ID!
  posts(limit: Int!): [Post!]! # Returns list
  activePost: Post # Returns single item (nullable)
}
```

For nullable list returns, wrapper messages are used following the same rules as described in the "List Types" section:

```protobuf
message ResolveUserCommentsResult {
  ListOfComment comments = 1;  // Uses wrapper for nullable list
}
```

## Interface and Union Handling

### Interfaces

GraphQL interfaces are mapped to Protocol Buffer messages with a `oneof` field containing all implementing types. Interfaces can also define `@key` directives to become interface objects — see [Interface Object Lookups](#interface-object-lookups) for details.

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

If a GraphQL enum explicitly declares an `UNSPECIFIED` value, it is deduplicated into the auto-generated zero-position entry rather than producing a duplicate, regardless of order:

```graphql
enum State {
  UNSPECIFIED
  ACTIVE
  INACTIVE
}
```

Maps to:

```protobuf
enum State {
  STATE_UNSPECIFIED = 0;
  STATE_ACTIVE = 1;
  STATE_INACTIVE = 2;
}
```

## List Types

Protographic handles GraphQL list nullability by creating wrapper messages when needed, since Protocol Buffers doesn't natively support nullable lists or nested list structures.

### Core Concepts

- **Non-nullable single-level lists**: Use the `repeated` keyword directly
- **Nullable lists**: Wrapped in `ListOf{Type}` messages
- **Nested lists**: Always use wrapper messages with multiple `ListOf` prefixes based on nesting level (e.g., `ListOfListOfString`)
- **Nullable list items**: Currently ignored (no wrapper generated for item nullability)

### Non-Nullable Single Lists

Non-nullable lists use `repeated` fields directly:

```graphql
type User {
  tags: [String!]!
}
```

Maps to:

```protobuf
message User {
  repeated string tags = 1;
}
```

### Nullable Single Lists

Nullable lists require wrapper messages:
We always use a nested `List` message to wrap the repeated field as repeated fields are not nullable in Protobuf.
In order to ensure correct nullability, this is handled on the engine side. The service implementation needs to follow the GraphQL rules for nullability.

```graphql
type User {
  optionalTags: [String]
}
```

Maps to:

```protobuf
message ListOfString {
  message List {
    repeated string items = 1;
  }
  List list = 1;
}

message User {
  ListOfString optional_tags = 1;
}
```

### Non-Nullable Nested Lists

Non-nullable nested lists always use wrapper messages to preserve inner list nullability:

```graphql
type User {
  categories: [[String!]!]!
}
```

Maps to:

```protobuf
message ListOfString {
  message List {
    repeated string items = 1;
  }
  List list = 1;
}

message ListOfListOfString {
  message List {
    repeated ListOfString items = 1;
  }
  List list = 1;
}

message User {
  ListOfListOfString categories = 1;
}
```

### Nullable Nested Lists

Nullable nested lists use nested wrapper messages:

```graphql
type User {
  posts: [[String]]
}
```

Maps to:

```protobuf
message ListOfString {
  repeated string items = 1;
}

message ListOfListOfString {
  message List {
    repeated ListOfString items = 1;
  }
  List list = 1;
}

message User {
  ListOfListOfString posts = 1;
}
```

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

| GraphQL Documentation                         | Protocol Buffer Representation        |
| --------------------------------------------- | ------------------------------------- |
| Single-line descriptions (`"description"`)    | Single-line comments (`// comment`)   |
| Multi-line descriptions (`"""description"""`) | Multi-line comments (`/* comment */`) |
| Field descriptions                            | Field comments                        |
| Type descriptions                             | Message/enum comments                 |
| Enum value descriptions                       | Enum value comments                   |
| Operation descriptions                        | RPC method comments                   |

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

Additionally, fields marked with the `@requires` directive generate separate RPC methods that compute field values based on external dependencies. Each `@requires` field produces its own RPC method that receives the entity key along with the required external fields, enabling cross-subgraph field resolution. See [Required Fields (@requires)](#required-fields-requires) for detailed examples and message structure documentation.
