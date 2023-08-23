# WunderGraph Composition

The WunderGraph composition library allows to federate multiple subgraph schemas into a 
single federated GraphQL schema.

### Prerequisites

- [Node.js 16 LTS or higher](https://nodejs.dev/en/about/releases/)

## Federating subgraphs

The `federateSubgraphs` function is responsible for producing a valid federated graph.
Each subgraph will be normalized and validated before federation.
This normalization process does not affect the upstream schema.
The final federated graph will also be validated.
The function must be provided with an array of at least one [`Subgraph` object](#Subgraph-object).
An example federation of two simple subgraphs:

```typescript
import { federateSubgraphs, Subgraph } from '@wundergraph.composition';
import { parse } from 'graphql';

const federationResult: FederationResult = federateSubgraphs([subgraphA, subgraphB]);

const subgraphA: Subgraph = {
  name: 'subgraph-a',
  url: 'http://localhost:4001',
  definitions: parse(`
    type User @key(fields: "id") {
      id: ID!
      name: String!
    }
  `),
};

const subgraphB: Subgraph = {
  name: 'subgraph-b',
  url: 'http://localhost:4002',
  definitions: parse(`
    type Query {
      users: [User!]!
    }
      
    type User @key(fields: "id") {
      id: ID!
      interests: [String!]!
    }
  `),
};
```

### FederationResult properties

The `federateSubgraphs` function returns a `FederationResult` object.
If federation was successful, the `errors` property will be undefined, and both the `federatedGraphAST` and 
the `federatedGraphSchema` objects will be defined.

| property             | Description                                     | type                               |
|----------------------|-------------------------------------------------|------------------------------------|
| errors               | unique name of the subgraph                     | Error[] \| undefined               |
| federatedGraphAST    | federated schema represented as an AST          | graphql.DocumentNode \| undefined  |
| federatedGraphSchema | federated schema represented as a schema object | graphql.GraphQLSchema \| undefined |

### Debugging

If normalization of any subgraph fails, or the federated graph itself is invalid,
the AST and schema will not be produced (undefined properties).
In these cases, the errors array will be defined and populated.
An example of a simple debugging framework might be:

```typescript
import { federateSubgraphs, Subgraph } from '@wundergraph.composition';
import { print, printSchema } from 'graphql';

const result = federateSubgraphs([subgraphA, subgraphB]);
if (result.errors) {
  for (const err of result.errors) {
    console.log(err.message);
  }
} else {
  // Both options to print the federated graph as a string are included for documentational purposes only
  console.log(print(result.federatedGraphAST!)); // log the federated graph AST as a string
  console.log(printSchema(result.federatedGraphSchema!)); // log the federated graph schema as a string
}

// subgraph definitions would be below [removed for brevity]
```

### Errors

Errors can happen in three main stages:
1. While validating the subgraph metadata, e.g., validating that each `Subgraph` object has a unique name.
2. During the normalization process, which prepares the subgraph for federation.
(if this stage fails, federation will not be attempted)
3. During the federation process itself.

All errors will be appended to the `FederationResult.errors` array.
Often, the error message will suggest potential fixes. For instance:

`Error: The following root path is unresolvable:
    Query.user.name
    This is because:
        The root type field "Query.user" is defined in the following subgraphs: "subgraph-b".
    However, "User.name" is only defined in the following subgraphs: "subgraph-c".
    Consequently, "User.name" cannot be resolved through the root type field "Query.user".
    Potential solutions:
        Convert "User" into an entity using a "@key" directive.
        Add the shareable root type field "Query.user" to the following subgraphs: "subgraph-c".
            For example (note that V1 fields are shareable by default and do not require a directive):
                type Query {
                    ...
                    user: User @shareable
                }
`

## Subgraph object

The `Subgraph` object is the core of the WunderGraph composition library.
An example is shown below:

```typescript
import { Subgraph } from '@wundergraph/composition'
import { parse } from 'graphql';

const subgraphA: Subgraph = {
  name: 'subgraph-a',
  url: 'http://localhost:4001',
  definitions: parse(`
    type User {
      name: String!
    }
  `),
};
```

### Subgraph Properties

| property    | Description                      | type                 |
|-------------|----------------------------------|----------------------|
| name        | unique name of the subgraph      | string               |
| url         | unique endpoint for the subgraph | string               |
| definitions | SDL of the subgraph              | graphql.DocumentNode |