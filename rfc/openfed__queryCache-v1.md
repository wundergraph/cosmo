---
title: "@openfed__queryCache: return a cache from a root query field"
author: David Stutt
---

# Introduction
```graphql
directive @openfed__queryCache(
  maxAge: Int!
  includeHeaders: Boolean = false
  shadowMode: Boolean = false
) on FIELD_DEFINITION
```

The intention of `@openfed__queryCache` is to allow the user to configure type agnostic caching for a query.
The premise is simple:
Has the query root field with its appropriate argument values been requested before within the maxAge limit?
Yes: retrieve from the cache
No: fetch and repopulate the cache

# Cache key

## No field arguments
If the operation provides no argument values (regardless of whether the field defines arguments), the cache key might
simply be `Query.fieldName`.

## Field arguments
If the the operation provides argument values, those values will need to be deterministically ordered.
For instance:
```graphql
query {
  user(a: 1, b: 2)
}
```

and
```graphql
query {
  user(b: 2, a: 1)
}
```

should hit the same cache value.

This should also be true for more complex inputs, e.g.:

```graphql
query {
  user(
    inputA: {
      a: "hello",
      b: "world"
    },
    inputB: {
      a: 6.9
      inputC: {
        x: 1,
        y: true,
      },
    },
  )
}
```
and
```graphql
query {
  user(
    inputB: {
      inputC: {
        y: true,
        x: 1,
      },
      a: 6.9
    },
    inputA: {
      b: "world"
      a: "hello",
    },
  )
}
```
should hit the same cache value.

# Interaction with @openfed__entityCache
`@openfed__queryCache` is intended to be type agnostic.
If the user defines this directive on a query field, the input is used as a key, and a value (if it exists) is
retrieved.
If the user intends to use the entity cache from a query field, a different method would be used (upcoming RFC).

# Errors
Errors will be returned from composition if:
1. The directive is defined on a non query root field.
2. The query root field defines any other caching directive.
3. The max age is <= 0.