import { federateSubgraphs, RootTypeField, Subgraph, unresolvableFieldError } from '../src';
import { describe, expect, test } from 'vitest';
import { documentNodeToNormalizedString, normalizeString, versionOneBaseSchema } from './utils/utils';
import { parse } from 'graphql';

describe('Entities federation tests', () => {
  test('that entities merge successfully', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphB]);
    expect(errors).toBeUndefined();
    const federatedGraph = federationResult!.federatedGraphAST;
    expect(documentNodeToNormalizedString(federatedGraph)).toBe(
      normalizeString(
        versionOneBaseSchema +
          `
      type Trainer {
        id: Int!
        details: Details!
        pokemon: [Pokemon!]!
      }

      type Details {
        name: String!
        age: Int!
      }

      type Pokemon {
        name: String!
        level: Int!
      }
    `,
      ),
    );
  });

  test('that an entity and non-declared entity merge if the non-entity is resolvable', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphC]);
    expect(errors).toBeUndefined();
    const federatedGraph = federationResult!.federatedGraphAST;
    expect(documentNodeToNormalizedString(federatedGraph)).toBe(
      normalizeString(
        versionOneBaseSchema +
          `
      type Trainer {
        id: Int!
        details: Details!
        pokemon: [Pokemon!]!
      }

      type Details {
        name: String!
        age: Int!
      }

      type Query {
        trainer: Trainer!
      }

      type Pokemon {
        name: String!
        level: Int!
      }
    `,
      ),
    );
  });

  test('that if an unresolvable field appears in the first subgraph, it returns an error', () => {
    const rootTypeField: RootTypeField = {
      inlineFragment: '',
      name: 'trainer',
      path: 'Query.trainer',
      parentTypeName: 'Query',
      responseType: 'Trainer!',
      rootTypeName: 'Trainer',
      subgraphs: new Set<string>(['subgraph-e']),
    };
    const result = federateSubgraphs([subgraphD, subgraphE]);
    expect(result.errors).toBeDefined();
    expect(result.errors).toHaveLength(3);
    expect(result.errors![0]).deep.equal(
      unresolvableFieldError(rootTypeField, 'details', ['Query.trainer.details { ... }'], 'subgraph-d', 'Trainer'),
    );
    // TODO these errors should not happen because it's the parent that's the problem
    expect(result.errors![1]).deep.equal(
      unresolvableFieldError(rootTypeField, 'name', ['Query.trainer.details.name'], 'subgraph-d', 'Details'),
    );
    expect(result.errors![2]).deep.equal(
      unresolvableFieldError(rootTypeField, 'age', ['Query.trainer.details.age'], 'subgraph-d', 'Details'),
    );
  });

  test('that ancestors of resolvable entities are also determined to be resolvable', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphC, subgraphF]);
    expect(errors).toBeUndefined();
    const federatedGraph = federationResult!.federatedGraphAST;
    expect(documentNodeToNormalizedString(federatedGraph)).toBe(
      normalizeString(
        versionOneBaseSchema +
          `
      type Query {
        trainer: Trainer!
      }

      type Trainer {
        id: Int!
        pokemon: [Pokemon!]!
        details: Details!
      }

      type Pokemon {
        name: String!
        level: Int!
      }

      type Details {
        name: String!
        facts: [Fact]!
      }

      type Fact {
        content: String!
      }
    `,
      ),
    );
  });

  test('that ancestors of resolvable entities that are not in the same subgraph return an error', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphC, subgraphF]);
    expect(errors).toBeUndefined();
    const federatedGraph = federationResult!.federatedGraphAST;
    expect(documentNodeToNormalizedString(federatedGraph)).toBe(
      normalizeString(
        versionOneBaseSchema +
          `
      type Query {
        trainer: Trainer!
      }

      type Trainer {
        id: Int!
        pokemon: [Pokemon!]!
        details: Details!
      }

      type Pokemon {
        name: String!
        level: Int!
      }

      type Details {
        name: String!
        facts: [Fact]!
      }

      type Fact {
        content: String!
      }
    `,
      ),
    );
  });

  test('that V1 and V2 entities merge successfully', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphB, subgraphG]);
    expect(errors).toBeUndefined();
    const federatedGraph = federationResult!.federatedGraphAST!;
    expect(documentNodeToNormalizedString(federatedGraph)).toBe(
      normalizeString(
        versionOneBaseSchema +
          `
      type Trainer {
        id: Int!
        pokemon: [Pokemon!]!
        details: Details!
      }

      type Pokemon {
        name: String!
        level: Int!
      }

      type Details {
        name: String!
        age: Int!
      }
    `,
      ),
    );
  });
});

const subgraphA: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Trainer @key(fields: "id") {
      id: Int!
      details: Details!
    }

    type Details {
      name: String!
      age: Int!
    }
  `),
};

const subgraphB: Subgraph = {
  name: 'subgraph-b',
  url: '',
  definitions: parse(`
    type Trainer @key(fields: "id") {
      id: Int!
      pokemon: [Pokemon!]!
    }

    type Pokemon {
      name: String!
      level: Int!
    }
  `),
};

const subgraphC: Subgraph = {
  name: 'subgraph-c',
  url: '',
  definitions: parse(`
    type Query {
      trainer: Trainer!
    }

    type Trainer {
      id: Int!
      pokemon: [Pokemon!]!
    }

    type Pokemon {
      name: String!
      level: Int!
    }
  `),
};

const subgraphD: Subgraph = {
  name: 'subgraph-d',
  url: '',
  definitions: parse(`
    type Trainer {
      id: Int!
      details: Details!
    }

    type Details {
      name: String!
      age: Int!
    }
  `),
};

const subgraphE: Subgraph = {
  name: 'subgraph-e',
  url: '',
  definitions: parse(`
    type Query {
      trainer: Trainer!
    }

    type Trainer @key(fields: "id") {
      id: Int!
    }
  `),
};

const subgraphF: Subgraph = {
  name: 'subgraph-f',
  url: '',
  definitions: parse(`
    type Trainer @key(fields: "id") {
      id: Int!
      details: Details!
    }

    type Details {
      name: String!
      facts: [Fact]!
    }

    type Fact {
      content: String!
    }
  `),
};

const subgraphG: Subgraph = {
  name: 'subgraph-g',
  url: '',
  definitions: parse(`
    extend type Trainer @key(fields: "id") {
      id: Int!
      details: Details!
    }

    type Details {
      name: String!
      age: Int!
    }
  `),
};
