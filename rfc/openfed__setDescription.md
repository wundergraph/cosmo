---
title: "@openfed__setDescription: Propagate specific descriptions to the federated graph"
author: David Stutt
---

This RFC proposes a new directive, `@openfed__setDescription`, which aims to deliver the following:
1. Propagate a specific description to the federated graph.
2. Propagate a description to the federated graph that is different to the description on the subgraph 
(internal/private vs. external/public).
3. Choose not to propagate any descriptions to the federated graph at all.

# Motivations

GraphQL type definitions can (and often do, e.g., entity Objects) exist in multiple subgraphs at any one time—a "shared
definition".
Each of these shared definitions allows a description to be defined.
However, the federated graph can only define a single description.
In the event that multiple shared definitions define a description, the rules that WunderGraph Cosmo follows are quite 
simple:
1. Store the first description encountered.
2. If a longer description (by character length) is encountered, update the record to this longer description.
3. If another description of the same length is encountered, keep the current description record (which will be the 
same length).
4. Propagate the description in the record to the federated graph.

Customers have requested more granular control over which description should be propagated to the federated graph, 
if any.

# Proposal

A new directive, `@openfed__setDescription`, aims to facilitate all desired granularity for how and when descriptions
are propagated to the federated graph.

## Definition

The potential definition of the directive:
```graphql
  directive @openfed__setDescription(public: Boolean! = true, content: String) on 
    ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION 
    | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | SCHEMA | UNION
```

The directive can be defined on any type system directive location (all of which allow a description to be defined).

## Arguments

The directive definition proposes two arguments.

### public
- Required but defaults to `true`.
- Declares whether the description is to be propagated in the federated graph.
- On any given instance of a shared definition, only one `@openfed__setDescription` instance may set `public` to
`true` or there will be a composition error.
- If `public` is set to `false`, the description will _never_ be propagated to the federated graph.
This means the description instance will effectively be completely ignored by federation, 
_e.g._, even when following "normal" WunderGraph Cosmo description rules.

### content
- Optional.
- Does nothing if the `public` argument is set to `false`.
- Allows the definition of a new description, _e.g._, one that is different to the actual description in the subgraph
(which may be intended to be private/internal), or for a definition (such as an extension) that cannot define 
descriptions.

# Considerations/discussion points

The following is a list of considerations and/or potential discussion points:

## Single source of precedence/single public description
The federated graph can only define a single description.
This description is "normally" the longest description (the first of that length in a tie).
If the `@openfed__setDescription` defines the argument `public` as `true` (the default value), that description will be 
propagated to the federated graph.
If the `@openfed__setDescription` defines the argument `content`, the value of the content argument will "override"
what the "original" description.
If more than one shared definition instance defines the `@openfed__setDescription` `public` argument as `true`, a
composition error will be returned.
Only one shared definition instance may declare a public description.

## Parent level vs. child level
If `@openfed__setDescription` is defined on a parent level, _e.g._, an `Object type`, should all its children (_i.e._,
fields) "inherit" the public declaration?
For example:
```graphql
# subgraph A

  """
  A.Query description.
  """
  type Query @openfed__setDescription {
    """
    A.Query.dummy description.
    """
    dummy: String! @shareable
  }
```

```graphql
# subgraph B

  """
  B.Query description, which is longer than A.
  """
  type Query {
    """
    B.Query.dummy description, which is longer than A.
    """
    dummy: String! @shareable
  }
```

For these two subgraphs, should the result be:
1. `@openfed__setDescription` is only considered for the explicit location on which it is defined:
```graphql
# federated graph

  """
  A.Query description.
  """
  type Query {
    """
    B.Query.dummy description, which is longer than A.
    """
    dummy: String! @shareable
  }
```

2. `@openfed__setDescription` is "inherited" by its children:
```graphql
# federated graph

  """
  A.Query description.
  """
  type Query {
    """
    A.Query.dummy description.
    """
    dummy: String! @shareable
  }
```

It's also possible a new argument, _e.g._, `inheritance: Boolean! = false`, could dictate whether the behaviour 
defined on the parent is "inherited" by children, _e.g._, all `public: true` or all `public: false`.
The child should also be able to override this behaviour by explicitly defining its own directive.
I'm mostly of the opinion that descriptions should be explicit and granular, and inherited/coerced behaviour might be
more troublesome than helpful.

# Examples

The following are some examples intended to illustrate how the directive functions.
Each example includes the subgraphs and their result after federation.

1. General example.
Subgraphs:
```graphql
# subgraph A
  """
  A.Query description.
  """
  type Query {
  """
  A.Query.entities description that propagates as normal.
  """
  entity(
    """
    A.entity.id description that should be private/subgraph-only.
    """
    id: ID! @openfed__setDescription(public: false)
  ): Entity
}

  """
  A.Entity description that is overridden by the directive.
  """
  type Entity @key(fields: "id") @openfed_setDescription(content: "A.Entity description from content argument.") {
  """
  A.Entity.id description that should be private/subgraph only.
  """
  id: ID! @openfed__setDescription(public: false)
  name: String! @openfed_setDescription(content: "A.Entity.name description from content argument.")
  }
```

```graphql
# subgraph B
    
  """
  B.Query description that propagates because it is longer than A.Query description.
  """
  type Query {
    dummy: String!
  }

  """
  B.Entity description that is effectively ignored.
  """
  type Entity @key(fields: "id") @openfed_setDescription(public: false, content: "This is also ignored.") {
    """
    B.Entity.id description that should be private/subgraph only.
    """
    id: ID! @openfed__setDescription(public: false)
    """
    B.Entity.name description that is not propagated due to the directive on A.Entity.name.
    """
    name: String! @external
    fullName: String! @requires(fields: "name")
  }
```

Result:
```graphql
# federated graph

  """
  B.Query description that propagates because it is longer than A.Query description.
  """
  type Query {
    """
    A.Query.entities description that propagates as normal.
    """
    entity(id: ID!): Entity
    dummy: String!
  }
    
  """
  A.Entity description from content argument.
  """
  type Entity {
    id: ID!
    """
    A.Entity.name description from content argument.
    """
    name: String!
    fullName: String!
  }
```

2. Propagating a description to the federated graph through an extension
Subgraphs:
```graphql
# subgraph A

  """
  A.Query description.
  """
  type Query {
    """
    A.Query.dummy description.
    """
    dummy: String! @shareable
  }
```

```graphql
# subgraph B

  extend type Query @setDescription(content: "B.Query extension description set by content argument.") {
    """
    B.Query.dummy description.
    """
    dummy: String! @shareable
  }
```
Result:
```graphql
# federated graph

  """
  B.Query extension description set by content argument.
  """
  type Query {
    """
    A.Query.dummy description.
    """
    dummy: String! @shareable
  }
```

3. Composition error due to a single instance declaring more than one public description.
Subgraphs:
```graphql
# subgraph A

  """
  A.Query description.
  """
  type Query @setDescription {
    dummy: String! @shareable
  }
```

```graphql
# subgraph B

  """
  B.Query description.
  """
  type Query @setDescription {
    dummy: String! @shareable
  }
```

Result:
```
Composition error (more than one description cannot be public).
```
