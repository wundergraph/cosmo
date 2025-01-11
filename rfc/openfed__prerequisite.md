---
title: "@openfed__prerequisite directive to conduct behaviour before another operation."
author: David Stutt
---

# Overview
The `@openfed__prerequisite` directive (henceforth simply "prerequisite") intends to be a flexible and powerful addition
to GraphQL Federation.
When included in a schema, the directive will always perform its defined behaviour before the rest of the operation.
This would allow the user to:
- Validate an input that references an entity.
- Validate an input against another operation.

Potential idea and discussion point:
- Inject input through the response of an exterior query.

# Definition
This is the proposed definition of the directive (functionality is discussed in the appropriate section):
```graphql
directive @openfed__prerequisite(
  resolveEntity: openfed__ResolveEntityInput
  resolveQuery: openfed__ResolveQueryInput
) on ARGUMENT_DEFINITION

input openfed__ResolveEntityInput {
  typeName: String!
  fields: openfed__InputSet!
}

input openfed__ResolveQueryInput {
  query: String!
}

scalar openfed__InputSet
```

# Functionality

The `prerequisite` directive (currently) defines two optional arguments.
The arguments are mutually exclusive; and although they are both optional (limitation of GraphQL), one (and only one) 
argument _must_ be defined.
Failure to define an argument, or defining both, will result in a composition error.

## 1. resolveEntity argument
The `resolveEntity` argument requires two inputs:
- `typeName`: The `__typename` of the entity to be validated.
- `fields`: The key field(s) that form the primary key.

### The typeName input
The `typeName` input corresponds to the `__typename` of an entity that defines an entity resolver in the same subgraph
that defines the directive.

Composition will fail if the type referenced by the `typeName` input is not an Object that defines a valid `@key`
directive with the `resolvable` argument either omitted or explicitly set to true.

### The fields input
The `fields` input is type `openfed__InputSet!` (henceforth simply `InputSet`).
The `InputSet` Scalar is similar but distinct from the `openfed__FieldSet` Scalar, which is used to define the `fields`
argument for a `@key` directive.

This Scalar encodes two things:
- The key fields for the entity.
- The name of the Inputs whose value will be propagated to the corresponding key field.

#### Directive defined on an argument that returns a leaf (Scalar or Enum)
In the event that the directive is defined directly on an argument that returns a leaf type (Scalar or Enum):
- `resolveEntity.fields` must define a single valid key field name. If the entity defines only compound or composite
primary keys, the directive cannot be defined on a leaf type argument and must be defined on a composite type argument.
- The type of the argument must be equally or more restrictive than the type of the 
  valid key field, _i.e._, an appropriate subtype, _e.g._, `String!` for `String` or `[Int!]!` for `[Int]`.
- Naming is irrelevant. If the value of the argument is valid, it will be propagated to the key field.

A composition error will occur if any of these rules are broken.

##### Examples:
1. Valid: Argument name `id` and key field name `id` match.
```graphql
type Mutation {
    updateEmail(
      id: ID! @openfed__prerequisite(resolveEntity: { typeName: "User", fields: "id" })
      email: String!
    ): User
}

type User @key(fields: "id") {
  id: ID!
  email: String!
}
```

2. Valid: Argument name `userID` and key field name `id` do not match.
```graphql
type Mutation {
    updateEmail(
      userID: ID! @openfed__prerequisite(resolveEntity: { typeName: "User", fields: "id" })
      email: String!
    ): User
}

type User @key(fields: "id") {
  id: ID!
  email: String!
}
```

3. Invalid (composition error): Argument type `Int!` and key field type `ID!` are incompatible.
```graphql
type Mutation {
    updateEmail(
      id: Int! @openfed__prerequisite(resolveEntity: { typeName: "User", fields: "id" })
      email: String!
    ): User
}

type User @key(fields: "id") {
  id: ID!
  email: String!
}
```

4. Invalid (composition error): Argument type `ID` is less restrictive than the key field type `ID!`.
```graphql
type Mutation {
    updateEmail(
      id: ID @openfed__prerequisite(resolveEntity: { typeName: "User", fields: "id" })
      email: String!
    ): User
}

type User @key(fields: "id") {
  id: ID!
  email: String!
}
```

5. Valid: Argument type `ID!` is more restrictive than the key field type `ID`.
```graphql
type Mutation {
    updateEmail(
      id: ID! @openfed__prerequisite(resolveEntity: { typeName: "User", fields: "id" })
      email: String!
    ): User
}

type User @key(fields: "id") {
  id: ID
  email: String!
}
```

#### Directive defined on an argument that returns an Input Object
In the event that the directive is defined on an argument that returns a Input Object:
- `resolveEntity.fields` may define a compound/composite primary key. A key field name must directly correspond to an 
identically named field defined directly on the Input Object unless otherwise mapped (see below).
- As before, Input fields types must be equally or more restrictive than the type of their key field counterpart.

A composition error will occur if any of these rules are broken.

##### Mapping:
If the corresponding Input field of a key field has a different name or is not defined directly on the argument Input
Object, _i.e._, it is a nested Input field, mapping must be used.
Note that mapping is only necessary for leaf types.

Mapping is defined with the key field name on the left, a colon `:` to denote a mapping, and a period `.` delimited path
to the corresponding Input field on the right:
`keyFieldName:period.delimited.path.to.input.field`

Here is an example:

```graphql
type Mutation {
  updateUser(
    input: MyInput! 
    @openfed__prerequisite(resolveEntity: { 
      typeName: "User", 
      fields: """
        id
        internalUser {
          id:input.id
          name:input.userName
          age:input.userAge
        }
      """
    })
  ): User
}

input MyInput {
  id: ID!
  name: String!
  input: NestedInput!
}

input NestedInput {
  id: ID!
  userName: String!
  userAge: Int!
}

type User @key(fields: "id internalUser { id name age }") {
  id: ID!
  internalUser: InternalUser!
}

type InternalUser {
  id: ID!
  name: String!
  age: Int!
}
```

In the example above, the field set `id internalUser { id name age }` must be mapped to the Input `MyInput`:
- `User.id` corresponds directly to `MyInput.id`, so no mapping is required.
- `User.internalUser` is a composite type, so no mapping is required.
- `User.internalUser.id` corresponds to `MyInput.input.id`.
- `User.internalUser.name` corresponds to `MyInput.input.name`.
- `User.internalUser.age` corresponds to `MyInput.input.userAge`.

##### Further examples:
1. Valid: Each key field names directly corresponds to a top-level Input field.
```graphql
type Mutation {
    addReviewToProduct(
      input: ReviewInput! @openfed__prerequisite(resolveEntity: { typeName: "Product", fields: "sku upc" })
    ): Product
}

input ReviewInput {
  content: String!
  sku: ID!
  upc: Int!
}

type Review {
  content: String!
}

type Product @key(fields: "sku upc") {
  sku: ID!
  upc: Int!
  reviews: [Review!]!
}
```

2. Valid: All key field names do not directly correspond to a top-level Input field but define valid mapping.
```graphql
type Mutation {
    addReviewToProduct(
      input: ReviewInput!
      @openfed__prerequisite(resolveEntity: { typeName: "Product", fields: "sku:productSku upc:productUpc" })
    ): Review
}

input ReviewInput {
  content: String!
  productSku: ID!
  productUpc: Int!
}

type Review {
  content: String!
}

type Product @key(fields: "sku upc") {
  sku: ID!
  upc: Int!
  reviews: [Review!]!
}
```

3. Valid: Key field name (`sku`) directly corresponds to a top-level Input field (`ReviewInput.sku`). 
Key field name `upc` does not directly correspond to a top-level Input field but defines valid mapping 
(`ReviewInput.productUpc`).
```graphql
type Mutation {
  addReviewToProduct(
    input: ReviewInput!
    @openfed__prerequisite(resolveEntity: { typeName: "Product", fields: "sku upc:productUpc" })
  ): Review
}

input ReviewInput {
  content: String!
  sku: ID!
  productUpc: Int!
}

type Review {
  content: String!
}

type Product @key(fields: "sku upc") {
  sku: ID!
  upc: Int!
  reviews: [Review!]!
}
```

4. Valid: Key field name `upc` directly corresponds to a top-level Input field (`ReviewInput.upc`). 
Key field name `usku` does not directly correspond to a top-level Input field but defines valid mapping 
(`ReviewInput.nestedInput.sku`).
```graphql
type Mutation {
  addReviewToProduct(
    input: ReviewInput!
    @openfed__prerequisite(resolveEntity: { typeName: "Product", fields: "sku:nestedInput.sku upc" })
  ): Review
}

input ReviewInput {
  content: String!
  upc: Int!
  nestedInput: NestedInput!
}

input NestedInput {
  sku: ID!
}

type Review {
  content: String!
}

type Product @key(fields: "sku upc") {
  sku: ID!
  upc: Int!
  reviews: [Review!]!
}
```

5. Invalid (composition error): Key field name `sku` defines invalid mapping (`ReviewInput.nestedInput.sku` does not 
exist).
```graphql
type Mutation {
  addReviewToProduct(
    input: ReviewInput!
    @openfed__prerequisite(resolveEntity: { typeName: "Product", fields: "sku:nestedInput.sku upc" })
  ): Review
}

input ReviewInput {
  content: String!
  upc: Int!
  nestedInput: NestedInput!
}

input NestedInput {
  productSku: ID!
}

type Review {
  content: String!
}

type Product @key(fields: "sku upc") {
  sku: ID!
  upc: Int!
  reviews: [Review!]!
}
```

6. Invalid (composition error): All key field names define valid mapping but `NestedInput.productSku` of type `[ID]`
is incompatible with type `ID!`.
```graphql
type Mutation {
  addReviewToProduct(
    input: ReviewInput!
    @openfed__prerequisite(resolveEntity: { typeName: "Product", fields: "sku:nestedInput.productSku upc:productUpc" })
  ): Review
}

input ReviewInput {
  content: String!
  productUpc: Int!
  nestedInput: NestedInput!
}

input NestedInput {
  productSku: Int!
}

type Review {
  content: String!
}

type Product @key(fields: "sku upc") {
  sku: ID!
  upc: Int!
  reviews: [Review!]!
}
```

### Entity Representation Call returns data
If the entity representation call is successful, data will be returned.
This means that entity reference is valid and the operation cannot proceed.

### Entity Representation Call returns null
If the entity representation call is unsuccessful, null will be returned.
This means that entity reference is invalid and operation cannot proceed.
Cosmo will produce an error and the operation will not be committed.

### Potential discussion points
- Multiple entities (batching)
- List inputs
- Mapping syntax

## 2. resolveQuery argument
Coming soon!