import { federateSubgraphs, invalidSubgraphNamesError, noBaseTypeExtensionError, Subgraph } from '../src';
import { parse } from 'graphql';
import { describe, expect, test } from 'vitest';
import {
  documentNodeToNormalizedString,
  normalizeString,
  versionOneBaseSchema,
  versionTwoBaseSchema,
} from './utils/utils';

describe('FederationFactory tests', () => {
  test('that trying to federate with non-unique subgraph names returns an error', () => {
    const { errors } = federateSubgraphs([pandas, pandas, users, users]);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(invalidSubgraphNamesError([pandas.name, users.name], []));
  });

  test('that trying to federate with empty subgraph names returns an error', () => {
    const { errors } = federateSubgraphs([emptySubgraph, emptySubgraph]);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    const errorMessage = errors![0].message;
    expect(errorMessage).contains(
      `Subgraphs to be federated must each have a unique, non-empty name.\n` +
        ` The 1st subgraph in the array did not define a name.`,
    );
    expect(errorMessage).contains(
      ` The 2nd subgraph in the array did not define a name.` +
        ` Consequently, any further errors will temporarily identify this subgraph as "`,
    );
  });

  test('that trying to federate with both non-unique and empty subgraph names returns an error', () => {
    const { errors } = federateSubgraphs([users, users, pandas, pandas, emptySubgraph, emptySubgraph, emptySubgraph]);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    const errorMessage = errors![0].message;
    expect(errorMessage).contains(
      `Subgraphs to be federated must each have a unique, non-empty name.\n` +
        ` The following subgraph names are not unique:\n  "users", "pandas"\n` +
        ` The 5th subgraph in the array did not define a name.` +
        ` Consequently, any further errors will temporarily identify this subgraph as "`,
    );
    expect(errorMessage).contains(
      ` The 6th subgraph in the array did not define a name.` +
        ` Consequently, any further errors will temporarily identify this subgraph as "`,
    );
    expect(errorMessage).contains(
      ` The 7th subgraph in the array did not define a name.` +
        ` Consequently, any further errors will temporarily identify this subgraph as "`,
    );
  });

  test('that subgraphs are federated #1', () => {
    const result = federateSubgraphs([pandas, products, reviews, users]);
    expect(result.errors).toBeUndefined();
    const federatedGraph = result.federatedGraphAST!;
    expect(documentNodeToNormalizedString(federatedGraph)).toBe(
      normalizeString(
        versionTwoBaseSchema +
          `
      directive @myDirective(a: String!) on FIELD_DEFINITION
      directive @hello on FIELD_DEFINITION
      directive @override(from: String!) on FIELD_DEFINITION

      interface SkuItf {
        sku: String
      }

      interface ProductItf implements SkuItf {
        id: ID!
        sku: String
        name: String
        package: String
        variation: ProductVariation
        dimensions: ProductDimension
        createdBy: User
        hidden: String
        oldField: String
        reviewsCount: Int!
        reviewsScore: Float!
        reviews: [Review!]!
      }
      
      type Query {
        allPandas: [Panda]
        panda(name: ID!): Panda
        allProducts: [ProductItf]
        product(id: ID!): ProductItf
        review(id: Int!): Review
      }

      type Panda {
        name: ID!
        favoriteFood: String
      }

      type Product implements ProductItf & SkuItf {
        id: ID!
        sku: String
        name: String
        package: String
        variation: ProductVariation
        dimensions: ProductDimension
        createdBy: User
        hidden: String
        reviewsScore: Float!
        oldField: String
        reviewsCount: Int!
        reviews: [Review!]!
      }

      enum ShippingClass {
        STANDARD
        EXPRESS
      }

      type ProductVariation {
        id: ID!
        name: String
      }

      type ProductDimension {
        size: String
        weight: Float
      }

      type User {
        email: ID!
        totalProductsCreated: Int
        name: String
      }

      type Review {
        id: Int!
        body: String!
      }
    `,
      ),
    );
  });

  test('that subgraphs are federated #2', () => {
    const result = federateSubgraphs([subgraphA, subgraphB]);
    expect(result.errors).toBeUndefined();
    const federatedGraph = result.federatedGraphAST!;
    expect(documentNodeToNormalizedString(federatedGraph)).toBe(
      normalizeString(
        versionTwoBaseSchema +
          `
      type Query {
        pokemon: [Pokemon]
        trainer: [Trainer!]!
      }

      type Trainer {
        id: Int!
        name: String
        pokemon: [Pokemon!]!
      }

      type Pokemon {
        name: String
        level: Int!
        moves: [Move!]!
      }

      type Move {
        name: String!
        pp: Int!
        hasEffect: Boolean!
      }`,
      ),
    );
  });

  test('that extension orphans return an error', () => {
    const { errors } = federateSubgraphs([subgraphC, subgraphD]);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(noBaseTypeExtensionError('Entity'));
  });

  test('that root types are promoted', () => {
    const { errors, federatedGraphAST } = federateSubgraphs([subgraphE]);
    expect(errors).toBeUndefined();
    expect(documentNodeToNormalizedString(federatedGraphAST!)).toBe(
      normalizeString(
        versionOneBaseSchema +
          `
      type Query {
        string: String
      }  
    `,
      ),
    );
  });

  test('that custom root types are renamed', () => {
    const { errors, federatedGraphAST } = federateSubgraphs([subgraphF]);
    expect(errors).toBeUndefined();
    expect(documentNodeToNormalizedString(federatedGraphAST!)).toBe(
      normalizeString(
        versionOneBaseSchema +
          `
      type Query {
        string: String
      }  
    `,
      ),
    );
  });
});

const subgraphA = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    directive @external on FIELD_DEFINITION | OBJECT
    directive @key(fields: String!) on INTERFACE | OBJECT
    directive @provides(fields: String!) on FIELD_DEFINITION
    directive @requires(fields: String!) on FIELD_DEFINITION
    directive @shareable on FIELD_DEFINITION | OBJECT

    type Query {
      pokemon: [Pokemon] @shareable
    }

    type Trainer @key(fields: "id") {
      id: Int!
      name: String @shareable
    }

    type Pokemon {
      name: String! @shareable
      level: Int! @shareable
      moves: [Move!]!  @shareable
    }

    type Move {
      name: String! @shareable
      pp: Int! @shareable
    }
  `),
};

const subgraphB = {
  name: 'subgraph-b',
  url: '',
  definitions: parse(`
    type Query {
      trainer: [Trainer!]!
      pokemon: [Pokemon!]! @shareable
    }

    type Trainer @key(fields: "id") {
      id: Int!
      name: String! @shareable
      pokemon: [Pokemon!]!
    }

    type Pokemon {
      name: String @shareable
      level: Int! @shareable
      moves: [Move!]! @shareable
    }

    type Move @shareable {
      name: String!
      pp: Int!
      hasEffect: Boolean!
    }
  `),
};

const pandas: Subgraph = {
  name: 'pandas',
  url: '',
  definitions: parse(`
    type Query {
      allPandas: [Panda]
      panda(name: ID!): Panda
    }

    type Panda {
      name:ID!
      favoriteFood: String @tag(name: "nom-nom-nom")
    }
  `),
};

const products: Subgraph = {
  name: 'products',
  url: '',
  definitions: parse(`
    directive @myDirective(a: String!) on FIELD_DEFINITION
    directive @hello on FIELD_DEFINITION

    type Query {
      allProducts: [ProductItf]
      product(id: ID!): ProductItf
    }

    interface SkuItf {
      sku: String
    }

    interface ProductItf implements SkuItf {
      id: ID!
      sku: String
      name: String
      package: String
      variation: ProductVariation
      dimensions: ProductDimension
      createdBy: User
      hidden: String @inaccessible
      oldField: String @deprecated(reason: "refactored out")
    }

    type Product implements ProductItf & SkuItf @key(fields: "id") @key(fields: "sku package") @key(fields: "sku variation { id }"){
      id: ID! @tag(name: "hi-from-products")
      sku: String
      name: String @hello
      package: String
      variation: ProductVariation
      dimensions: ProductDimension
      createdBy: User
      hidden: String
      reviewsScore: Float! @shareable
      oldField: String
    }

    enum ShippingClass {
      STANDARD
      EXPRESS
    }

    type ProductVariation {
      id: ID!
      name: String
    }

    type ProductDimension @shareable {
      size: String
      weight: Float
    }

    type User @key(fields: "email") {
      email: ID!
      totalProductsCreated: Int @shareable
    }
  `),
};

const reviews: Subgraph = {
  name: 'reviews',
  url: '',
  definitions: parse(`
    directive @override(from: String!) on FIELD_DEFINITION
  
    type Query {
      review(id: Int!): Review
    }

    type Product implements ProductItf @key(fields: "id") {
      id: ID!
      reviewsCount: Int!
      reviewsScore: Float! @shareable @override(from: "products")
      reviews: [Review!]!
    }

    interface ProductItf {
      id: ID!
      reviewsCount: Int!
      reviewsScore: Float!
      reviews: [Review!]!
    }

    type Review {
      id: Int!
      body: String!
    }
  `),
};

const users: Subgraph = {
  name: 'users',
  url: '',
  definitions: parse(`
    type User @key(fields:"email") {
      email:ID! @tag(name: "test-from-users")
      name: String
      totalProductsCreated: Int @shareable
    }
  `),
};

const emptySubgraph: Subgraph = {
  name: '',
  url: '',
  definitions: parse(`
    scalar String
  `),
};

const subgraphC: Subgraph = {
  name: 'subgraph-c',
  url: '',
  definitions: parse(`
    schema {
      query: Query
    }
    
    type Query {
      string: String
    }  
  `),
};

const subgraphD: Subgraph = {
  name: 'subgraph-d',
  url: '',
  definitions: parse(`
    extend type Entity @key(fields: "id") {
      id: ID!
    }    
  `),
};

const subgraphE: Subgraph = {
  name: 'subgraph-e',
  url: '',
  definitions: parse(`
    extend type Query {
      string: String
    }
  `),
};

const subgraphF: Subgraph = {
  name: 'subgraph-f',
  url: '',
  definitions: parse(`
    schema {
      query: CustomQuery
    }
    type CustomQuery {
      string: String
    }
  `),
};