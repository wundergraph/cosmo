---
author: Jens Neuse
title: @resolve directive to resolve input fields or entity request inputs in the Router
---

## Problem

It's common to have a Subgraph that can mutate entities which have references to other entities.
When a mutation is performed, we've got to ensure that the referenced entity exists or if the ID is valid.

The problem could be solved by making a network call from one Subgraph to another to validate the integrity of the reference.
However, this approach would introduce multiple problems.

1. We create a dependency between Subgraphs which creates tight coupling
2. Schema usage metrics only work for requests that are resolved through the Router

We're adding unnecessary complexity and overhead to the system by requiring network calls between Subgraphs.
We could solve this issue by calling other Subgraphs through the Router,
but this would require us the expose the validation query to the public API,
or we'd have to run a separate instance of the Router for internal use with a contract,
which adds complexity again.

Wouldn't it be great if we could somehow validate references in a declarative way?
In addition, such a solution could allow us to "query" input fields for operations that are not directly related to the entity.

## Solution

I propose to add "internal" fields which we mark as `@inaccessible`.
These can be used by the Router to resolve information that is useful to other Subgraphs, but not directly accessible as keys.

In addition, I propose a new directive `@resolve` which allows us to define a query on an input field.
This input field can be market as `@inaccessible` to prevent exposing it to the public API.
As such, clients are not able to define the input field in their queries.
Instead, the Router will execute the query defined in the `@resolve` directive and pass the result to the input.

# Benefits

Implicit data dependencies between services are invisible.
If you call a mutation on Subgraph A,
and Subgraph A needs to call Subgraph B and C to fulfill this mutation,
the reality is that this mutation depends on Subgraph A, B, and C.

However, in this scenario, we're only seeing Subgraph A in the analytics, query planning, etc. because the Subgraphs B and C are being called "off-graph".
Implicit off-graph calls are invisible.
We're unaware they are happening, but even worse, we simply don't understand the relationship between a root field (e.g. Mutation) and our service layer.

By explicitly defining our data dependencies on the graph,
we can build tooling around information like query plans, analytics, etc.
so we can make these dependencies nost just visible,
but use them to our advantage.

Breaking change detection can use schema usage from these "internal" calls to prevent production issues.
Query plans can show these implicit dependencies.
A dashboard can show which queries depend on which services, explicit and implicit.
Another dashboard can show dependencies between services.

## Example 1: Validate a Reference

```graphql
# Review Subgraph
type Review @key(fields: "id") {
    id: ID!
    rating: Int!
    comment: String!
}

extend type Product @key(fields: "id") {
    id: ID!
    reviews: [Review]
}

type Query {
    reviewByID(id: ID!): Review @inaccessible
}
```

```graphql
# Product Admin Subgraph

input RemoveReviewInput {
    productID: ID!
    reviewID: ID!
    # This field is used to validate the review exists
    # if the Router resolves it to null, the mutation will fail because the field is not nullable
    # if it's resolved to a value, the mutation will have access to the content as part of the input
    review: RemoveReviewReviewInput! @inaccessible @resolve(query: "query Review($id: ID!) { reviewByID(id: $id) { id }}", variables: "{ \"id\": {{ .entity.reviewID }} }")
}

input RemoveReviewReviewInput {
    id: ID!
}

type Mutation {
    removeReview(input: RemoveReviewInput!): Review
}
```

## Example 2: Query input from another Subgraph

Let's say we've got a userInfo Subgraph which is able to provide user information based on request headers.
We'd like to make this information available to all other Subgraphs without exposing it to the public API.

```graphql
# UserInfo Subgraph
type Query {
    userInfo: UserInfo @inaccessible
}

type UserInfo @inaccessible {
    id: ID!
    name: String!
    email: String!
}
```

We've defined a UserInfo Subgraph which provides user information.
We're market the `userInfo` field and the `UserInfo` type as `@inaccessible` to prevent clients from accessing this information directly.
Let's see how we can use it in another Subgraph:

```graphql
# User Subgraph
type Query {
    currentUser(input: CurrentUserInput! @inaccessible): User
}

input CurrentUserInput {
    info: UserInfoInput @inaccessible @resolve(query: "query { info: userInfo { id name email }}")
}

input UserInfoInput {
    id: ID!
    name: String!
    email: String!
}

type User {
    id: ID!
    name: String!
    email: String!
}
```

The public schema of the Supergraph will look as follows:

```graphql
type Query {
    currentUser: User
}

type User {
    id: ID!
    name: String!
    email: String!
}
```

As an alternative, it's also possible to use the `@resolve` directive on a field to resolve the value of the field.

```graphql
# User Subgraph
type User @key(fields: "id") {
    id: ID!
    name: String! @requires(fields: "info")
    email: String! @requires(fields: "info")
    info: UserInfo @inaccessible @resolve(query: "query { info: userInfo { id name email }}")
}

type UserInfo @inaccessible {
    id: ID!
    name: String!
    email: String!
}
```

Both the `name` and `email` fields are marked as `@requires` to ensure that the `info` field is resolved before the `name` and `email` fields are resolved.
The `info` field is marked as `@inaccessible` to prevent clients from accessing this information directly.
If the Router would want to resolve the `name` or `email` field,
it would first resolve the `info` field and attach it to the entities request variables.

Subgraph request example:

```json
{
  "query": "_entities($representations: [_Any!]!) { _entities(representations: $representations) { ... on User { id name email } } }",
  "variables": {
    "representations": [{ "__typename": "User", "id": "1", "info": { "id": "1", "name": "Alice", "email": "alice@dot.com" } }]
  }
}
```
