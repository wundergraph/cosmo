# RFC Entity Caching

This document describes the design of the entity caching system for Cosmo Router.
The goal is to provide a high-performance, scalable, and reliable caching system for entities.
The Router connects to a Cache Service like Redis to store and retrieve entities instead of fetching them from Subgraphs.

This document describes how caching can be implemented by the user in terms of TTL, cache eviction, and cache invalidation.

## Cache Key Template

The cache key template looks like this:

```
{{prefix}}:{{typename}}:{{keys}}
```

- **prefix**: A prefix, e.g. to make the cache key unique per user
- **typename**: The typename of the entity, in case of unions or interfaces, the name of the union or interface
- **keys**: The keys of the entity, e.g. the id field of the entity

## Simple Caching Example with one Subgraph and one Entity

```graphql
type Query {
    entity(id: ID!): Entity @cache(ttl: 60)
}

type Entity @key(fields: "id") {
    id: ID!
    name: String
    age: Int
}
```

In this example, the `entity` query is cached for 60 seconds. The cache key is the `id` of the entity.
As the argument `id` is named exactly the same as the field `id` of the `Entity` type,
no additional configuration is needed.
The cache key is the `id` of the entity.

Cache key for the entity with id `1`: `:Entity:1`

## Mapping the Entity Key to a different field Argument

```graphql
type Query {
    entity(entityID: ID!): Entity @cache(ttl: 60, entityKeyMapping: [{arg: "entityID", field: "id"}])
}

type Entity @key(fields: "id") {
    id: ID!
    name: String
    age: Int
}
```

Cache key for the entity with id `1`: `:Entity:1`

The `entityKeyMapping` argument can be used to map entity keys to different arguments.

## Mapping nested Arguments to Entity Keys

```graphql
type Query {
    entity(input: EntityInput!): Entity @cache(ttl: 60, entityKeyMapping: [{arg: "entity.id", field: "id"}])
}

input EntityInput {
    id: ID!
}

type Entity @key(fields: "id") {
    id: ID!
    name: String
    age: Int
}
```

Cache key for the input `{id: 1}`: `:Entity:1`

It's possible to map nested arguments to entity keys using dot notation in the `arg` field.

## Stale While Revalidate

```graphql
type Query {
    entity(id: ID!): Entity @cache(ttl: 60, swr: 60)
}

type Entity @key(fields: "id") {
    id: ID!
    name: String
    age: Int
}
```

In this example, the `entity` query is cached for 60 seconds.
The `swr` argument is set to 60 seconds, which means that the cache is considered stale after 60 seconds.
When the cache is stale, the Router will return the cached value and fetch the latest value from the Subgraph in the background.

This feature is useful when the cache might expire quite often, but the data is still useful for a short period of time.
E.g. if we don't want requests to directly hit the Subgraph,
we can return the cached value and fetch the latest value in the background using the `swr` argument.

Cache Key for the entity with id `1`: `:Entity:1`

## Include additional fields in the Cache Key, e.g. the sub Claim from a JWT

```graphql
type Query {
    entity(id: ID!): Entity @cache(ttl: 60) @authenticated
}

type Entity @key(fields: "id") @cacheKey(prefix: "user:{{ claims.sub }}") {
    id: ID!
    name: String
    age: Int
}
```

In this example, the cache key is prefixed with the `sub` claim from the JWT token.
This way, the cache is unique per user.

Cache Key for the entity with id `1` and sub claim `123`: `user:123:Entity:1`

## Cache Eviction and Cache Invalidation through Mutations

```graphql
type Mutation {
    updateEntity(id: ID!, name: String, age: Int): Entity @cacheInvalidate
}

type Entity @key(fields: "id") {
    id: ID!
    name: String
    age: Int
}
```

In this example, the `updateEntity` mutation will invalidate the following cache key: `:Entity:1`

## Cache Invalidation through EDFS Events

## Finding Caching Opportunities

One concern regarding caching is that you might believe that there's no caching opportunity,
the data might not be a good fit for caching,
or you might think that your API is so dynamic that caching wouldn't improve anything.

To address this, we can build analytics around resolving entities to be able to "suggest" cache directives.
Here's how this can work:

1. When we resolve a Query, we generate a hash for each entity after resolving it
   We can store this information in a table in Clickhouse in the following format

   __typename + key map (key name -> key value) + hash

   In addition, we need to be able to store information in another? table on the dependencies of fetches and entities.
   This would allow us to correlate fetches and resolved entities.

2. Once we have all of this information stored, we can calculate the change rate of an entity and how it's changing
   E.g. we could be able to understand when an entity changes, e.g. after a mutation or an EDFS event.

3. As we understand the change rate, we can identify entities that get requested frequently but have a low change rate: A caching opportunity
4. We can now correlate the caching opportunity with the fetches (and their latency) and quantify the impact

As a result of this process, we can make specific suggestions like:
- Add a caching rule to the User entity to speed up the main landing page load time by 20%
- Reduce load on the User Service by 80% by caching the User entity




