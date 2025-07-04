# WunderGraph Composition

[![npm version](https://badge.fury.io/js/%40wundergraph%2Fcomposition.svg)](https://badge.fury.io/js/%40wundergraph%2Fcomposition)

The WunderGraph composition library facilitates the federation of multiple subgraph schemas into a 
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
import { federateSubgraphs, FederationResult, Subgraph } from '@wundergraph/composition';
import { parse } from 'graphql';

const result: FederationResult = federateSubgraphs([subgraphA, subgraphB]);

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

### FederationResult

The `federateSubgraphs` function returns `FederationResult`, which is a union of `FederationResultSuccess` and 
`FederationResultFailure`. Both types in the union always define the following mutual properties:

| property | Description                            | type           |
|----------|----------------------------------------|----------------|
| success  | assertion of composition success       | boolean        |
| warnings | array of composition warnings (if any) | Array<Warning> |

#### FederationResultSuccess
If federation was successful, the return type is `FederationResultSuccess`.

| property             | Description                                                 | type                  |
|----------------------|-------------------------------------------------------------|-----------------------|
| federatedGraphAST    | an AST object representation of the federated graph sdl     | graphql.DocumentNode  |
| federatedGraphSchema | a schema object representation of the federated graph sdl   | graphql.GraphQLSchema |
| success              | assertion that composition was successful                   | true                  |
| warnings             | array of composition warnings (if any)                      | Array<Warning>        |

#### FederationResultFailure
If federation was unsuccessful, the return type is `FederationResultFailure`.

| property | Description                                 | type           |
|----------|---------------------------------------------|----------------|
| errors   | array of composition errors                 | Array<Error>   |
| success  | assertion that composition was unsuccessful | false          |
| warnings | array of composition warnings (if any)      | Array<Warning> |

### Debugging

If normalization of any subgraph fails, or the federated graph itself is invalid,
the AST and schema will not be produced (undefined properties).
In these cases, the errors array will be defined and populated.
An example of a simple debugging framework might be:

```typescript
import { federateSubgraphs, FederationResult, Subgraph } from '@wundergraph.composition';
import { print, printSchema } from 'graphql';

const result: FederationResult = federateSubgraphs([subgraphA, subgraphB]);

if (result.success) {
  // Both options to print the federated graph as a string are included for documentational purposes only
  console.log(print(result.federatedGraphAST)); // log the federated graph AST as a string
  console.log(printSchema(result.federatedGraphSchema)); // log the federated graph schema as a string
} else {
  for (const err of result.errors) {
    console.log(err.message);
  }
}
for (const warning of result.warnings) {
  console.log(warning);
}

// subgraph definitions would be below [removed for brevity]
```

### Errors

Errors can happen in three main stages:
1. While validating the subgraph metadata, e.g., validating that each `Subgraph` object has a unique name.
2. During the normalization process, which prepares the subgraph for federation.
(if this stage fails, federation will not be attempted)
3. During the federation process itself.

All errors will be appended to the `FederationResultFailure.errors` array.

## Subgraph object

The `Subgraph` object is the core of the WunderGraph composition library.
The `definitions` property must be provided as a `graphQL.DocumentNode` type.
This is easily achieved by passing string representation of the subgraph SDL to the graphql.js `parse` function.
An example is shown below:

```typescript
import { Subgraph } from '@wundergraph/composition'
import { parse } from 'graphql';

const subgraphA: Subgraph = {
  name: 'subgraph-a',
  url: 'http://localhost:4001',
  definitions: parse(`
    type Query {
      user: User!
    }

    type User {
      name: String!
    }
  `),
};
```

### Subgraph Properties

| property    | Description                               | type                 |
|-------------|-------------------------------------------|----------------------|
| name        | unique name of the subgraph               | string               |
| url         | unique endpoint for the subgraph          | string               |
| definitions | an AST representation of the subgraph SDL | graphql.DocumentNode |

### Contributing
When adding or changing error, please ensure GraphQL types begin with a capital letter for clarity:
- Enum
- Input Object
- Interface
- Object
- Scalar
- Union
