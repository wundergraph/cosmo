import { federateSubgraphs, RootTypeFieldData, Subgraph, unresolvableFieldError } from '../src';
import { describe, expect, test } from 'vitest';
import { documentNodeToNormalizedString, normalizeString, versionOnePersistedBaseSchema } from './utils/utils';
import { parse } from 'graphql';

describe('Entities federation tests', () => {
  test('that entities merge successfully', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphB]);
    expect(errors).toBeUndefined();
    const federatedGraph = federationResult!.federatedGraphAST;
    expect(documentNodeToNormalizedString(federatedGraph)).toBe(
      normalizeString(
        versionOnePersistedBaseSchema + `
      type Query {
        dummy: String!
      }

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
        versionOnePersistedBaseSchema + `
      type Query {
        dummy: String!
        trainer: Trainer!
      }

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

  test('that if an unresolvable field appears in the first subgraph, it returns an error', () => {
    const rootTypeFieldData: RootTypeFieldData = {
      fieldName: 'trainer',
      fieldTypeNodeString: 'Trainer!',
      path: 'Query.trainer',
      subgraphs: new Set<string>(['subgraph-e']),
      typeName: 'Query',
    };
    const result = federateSubgraphs([subgraphD, subgraphE]);
    expect(result.errors).toBeDefined();
    expect(result.errors).toHaveLength(1);
    expect(result.errors![0]).toStrictEqual(
      unresolvableFieldError(
        rootTypeFieldData,
        'details',
        ['subgraph-d'],
        'Query.trainer.details { ... }',
        'Trainer'
      ),
    );
  });

  test('that ancestors of resolvable entities are also determined to be resolvable', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphC, subgraphF]);
    expect(errors).toBeUndefined();
    const federatedGraph = federationResult!.federatedGraphAST;
    expect(documentNodeToNormalizedString(federatedGraph)).toBe(
      normalizeString(
        versionOnePersistedBaseSchema +
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
        versionOnePersistedBaseSchema +
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
    const federatedGraph = federationResult!.federatedGraphAST;
    expect(documentNodeToNormalizedString(federatedGraph)).toBe(
      normalizeString(
        versionOnePersistedBaseSchema + `
      type Trainer {
        id: Int!
        pokemon: [Pokemon!]!
        details: Details!
      }

      type Pokemon {
        name: String!
        level: Int!
      }
      
      type Query {
        dummy: String!
      }

      type Details {
        name: String!
        age: Int!
      }
    `,
      ),
    );
  });

  test('that interfaces can declare the @key directive', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphH]);
    expect(errors).toBeUndefined();
    const federatedGraph = federationResult!.federatedGraphAST;
    expect(documentNodeToNormalizedString(federatedGraph)).toBe(normalizeString(versionOnePersistedBaseSchema + `
      interface Interface {
        id: ID!
        name: String!
        age: Int!
      }
      
      type Query {
        dummy: String!
      }
    `));
  });
});

const subgraphA: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String!
    }

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
    type Query {
      dummy: String!
    }

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

const subgraphH: Subgraph = {
  name: 'subgraph-h',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String!
    }

    interface Interface @key(fields: "id") {
      id: ID!
      name: String!
      age: Int!
    }
  `),
};