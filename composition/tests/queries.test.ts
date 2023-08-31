import { federateSubgraphs, RootTypeField, Subgraph, unresolvableFieldError } from '../src';
import { parse } from 'graphql';
import { describe, expect, test } from 'vitest';
import {
  documentNodeToNormalizedString,
  normalizeString,
  versionOnePersistedBaseSchema,
  versionTwoPersistedBaseSchema,
} from './utils/utils';

describe('Query federation tests', () => {
  test('that shared queries that return a nested type that is only resolvable over multiple subgraphs are valid', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphB]);
    expect(errors).toBeUndefined();
    const federatedGraph = federationResult!.federatedGraphAST;
    expect(documentNodeToNormalizedString(federatedGraph)).toBe(
      normalizeString(
        versionTwoPersistedBaseSchema +
          `
      type Query {
        query: Nested
      }

      type Nested {
        nest: Nested2
      }

      type Nested2 {
        nest: Nested3
      }

      type Nested3 {
        nest: Nested4
      }

      type Nested4 {
        name: String
        age: Int
      }
    `,
      ),
    );
  });

  test('that unshared queries that return a nested type that cannot be resolved in a single subgraph returns an error', () => {
    const rootTypeField: RootTypeField = {
      inlineFragment: '',
      name: 'query',
      path: 'Query.query',
      parentTypeName: 'Query',
      responseType: 'Nested',
      rootTypeName: 'Nested',
      subgraphs: new Set<string>(['subgraph-b']),
    };
    const { errors } = federateSubgraphs([subgraphB, subgraphC]);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(
      unresolvableFieldError(rootTypeField, 'name', ['Query.query.nest.nest.nest.name'], 'subgraph-c', 'Nested4'),
    );
  });

  test('that unresolvable fields return an error', () => {
    const parentTypeName = 'Friend';
    const rootTypeField: RootTypeField = {
      inlineFragment: '',
      name: 'friend',
      path: 'Query.friend',
      parentTypeName: 'Query',
      responseType: parentTypeName,
      rootTypeName: parentTypeName,
      subgraphs: new Set<string>(['subgraph-d']),
    };
    const { errors } = federateSubgraphs([subgraphD, subgraphF]);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(
      unresolvableFieldError(rootTypeField, 'age', ['Query.friend.age'], 'subgraph-f', parentTypeName),
    );
  });

  test('that unresolvable fields that are the first fields to be added still return an error', () => {
    const parentTypeName = 'Friend';
    const rootTypeField: RootTypeField = {
      inlineFragment: '',
      name: 'friend',
      path: 'Query.friend',
      parentTypeName: 'Query',
      responseType: parentTypeName,
      rootTypeName: parentTypeName,
      subgraphs: new Set<string>(['subgraph-d']),
    };
    const { errors } = federateSubgraphs([subgraphF, subgraphD]);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(
      unresolvableFieldError(rootTypeField, 'age', ['Query.friend.age'], 'subgraph-f', parentTypeName),
    );
  });

  test('that multiple unresolved fields return an error for each', () => {
    const parentTypeName = 'Friend';
    const rootTypeField: RootTypeField = {
      inlineFragment: '',
      name: 'friend',
      path: 'Query.friend',
      parentTypeName: 'Query',
      responseType: parentTypeName,
      rootTypeName: parentTypeName,
      subgraphs: new Set<string>(['subgraph-d']),
    };
    const { errors } = federateSubgraphs([subgraphD, subgraphF, subgraphG]);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(2);
    expect(errors![0]).toStrictEqual(
      unresolvableFieldError(rootTypeField, 'age', ['Query.friend.age'], 'subgraph-f', parentTypeName),
    );
    expect(errors![1]).toStrictEqual(
      unresolvableFieldError(rootTypeField, 'hobbies', ['Query.friend.hobbies'], 'subgraph-g', parentTypeName),
    );
  });

  test('that shared queries that return a type that is only resolvable over multiple subgraphs are valid', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphD, subgraphE]);
    expect(errors).toBeUndefined();
    const federatedGraph = federationResult!.federatedGraphAST;
    expect(documentNodeToNormalizedString(federatedGraph)).toBe(
      normalizeString(
        versionTwoPersistedBaseSchema +
          `
      type Query {
        friend: Friend
      }

      type Friend {
        name: String!
        age: Int!
      }
    `,
      ),
    );
  });

  test('that shared queries that return an interface that is only resolvable over multiple subgraphs are valid', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphH, subgraphI]);
    expect(errors).toBeUndefined();
    const federatedGraph = federationResult!.federatedGraphAST;
    expect(documentNodeToNormalizedString(federatedGraph)).toBe(
      normalizeString(
        versionOnePersistedBaseSchema +
          `
      interface Human {
        name: String!
        age: Int!
      }
      
      type Query {
        humans: [Human]
      }

      type Friend implements Human {
        name: String!
        age: Int!
      }
    `,
      ),
    );
  });

  test('that queries that return interfaces whose constituent types are unresolvable return an error', () => {
    const rootTypeField: RootTypeField = {
      inlineFragment: '',
      name: 'humans',
      path: 'Query.humans',
      parentTypeName: 'Query',
      responseType: '[Human]',
      rootTypeName: 'Human',
      subgraphs: new Set<string>(['subgraph-i']),
    };
    const result = federateSubgraphs([subgraphI, subgraphJ]);
    expect(result.errors).toBeDefined();
    expect(result.errors![0]).toStrictEqual(
      unresolvableFieldError(rootTypeField, 'name', ['Query.humans ... on Friend name'], 'subgraph-j', 'Friend'),
    );
  });

  test('that queries that return nested interfaces whose constituent types are unresolvable return an error', () => {
    const rootTypeField: RootTypeField = {
      inlineFragment: '',
      name: 'humans',
      path: 'Query.humans',
      parentTypeName: 'Query',
      responseType: '[Human]',
      rootTypeName: 'Human',
      subgraphs: new Set<string>(['subgraph-k']),
    };
    const { errors } = federateSubgraphs([subgraphK, subgraphL]);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(
      unresolvableFieldError(
        rootTypeField,
        'age',
        ['Query.humans ... on Friend pets ... on Cat age'],
        'subgraph-l',
        'Cat',
      ),
    );
  });

  test('that shared queries that return a union that is only resolvable over multiple subgraphs are valid', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphM, subgraphN]);
    expect(errors).toBeUndefined();
    const federatedGraph = federationResult!.federatedGraphAST;
    expect(documentNodeToNormalizedString(federatedGraph)).toBe(
      normalizeString(
        versionOnePersistedBaseSchema +
          `
      union Human = Friend | Enemy
      
      type Query {
        humans: [Human]
      }

      type Friend {
        name: String!
      }
      
      type Enemy {
        name: String!
      }
    `,
      ),
    );
  });

  test('that queries that return unions whose constituent types are unresolvable return an error', () => {
    const rootTypeField: RootTypeField = {
      inlineFragment: ' ... on Enemy ',
      name: 'humans',
      path: 'Query.humans',
      parentTypeName: 'Query',
      responseType: '[Human]',
      rootTypeName: 'Human',
      subgraphs: new Set<string>(['subgraph-o']),
    };
    const result = federateSubgraphs([subgraphO, subgraphP]);
    expect(result.errors).toBeDefined();
    expect(result.errors).toHaveLength(1);
    expect(result.errors![0]).toStrictEqual(
      unresolvableFieldError(rootTypeField, 'age', ['Query.humans ... on Enemy age'], 'subgraph-p', 'Enemy'),
    );
  });
});

const subgraphA: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      query: Nested @shareable
    }

    type Nested @shareable {
      nest: Nested2
    }

    type Nested2 @shareable {
      nest: Nested3
    }

    type Nested3 @shareable {
      nest: Nested4
    }

    type Nested4 {
      name: String
    }
  `),
};

const subgraphB: Subgraph = {
  name: 'subgraph-b',
  url: '',
  definitions: parse(`
    type Query {
      query: Nested @shareable
    }

    type Nested @shareable {
      nest: Nested2
    }

    type Nested2 @shareable {
      nest: Nested3
    }

    type Nested3 @shareable {
      nest: Nested4
    }

    type Nested4 {
      age: Int
    }
  `),
};

const subgraphC: Subgraph = {
  name: 'subgraph-c',
  url: '',
  definitions: parse(`
    type Nested @shareable {
      nest: Nested2
    }

    type Nested2 @shareable {
      nest: Nested3
    }

    type Nested3 @shareable {
      nest: Nested4
    }

    type Nested4 {
      name: String
    }
  `),
};

const subgraphD = {
  name: 'subgraph-d',
  url: '',
  definitions: parse(`
    type Query {
      friend: Friend @shareable
    }

    type Friend {
      name: String!
    }
  `),
};

const subgraphE = {
  name: 'subgraph-e',
  url: '',
  definitions: parse(`
    type Query {
      friend: Friend @shareable
    }

    type Friend {
      age: Int!
    }
  `),
};

const subgraphF = {
  name: 'subgraph-f',
  url: '',
  definitions: parse(`
    type Friend {
      age: Int!
    }
  `),
};

const subgraphG = {
  name: 'subgraph-g',
  url: '',
  definitions: parse(`
    type Friend {
      hobbies: [String!]!
    }
  `),
};

const subgraphH = {
  name: 'subgraph-h',
  url: '',
  definitions: parse(`
    type Query {
      humans: [Human]
    }
    
    interface Human {
      name: String!
    }
    
    type Friend implements Human {
      name: String!
    }
  `),
};

const subgraphI = {
  name: 'subgraph-i',
  url: '',
  definitions: parse(`
    type Query {
      humans: [Human]
    }
    
    interface Human {
      age: Int!
    }
    
    type Friend implements Human {
      age: Int!
    }
  `),
};

const subgraphJ = {
  name: 'subgraph-j',
  url: '',
  definitions: parse(`
    interface Human {
      name: String!
    }
    
    type Friend implements Human {
      name: String!
    }
  `),
};

const subgraphK = {
  name: 'subgraph-k',
  url: '',
  definitions: parse(`
    type Query {
      humans: [Human]
    }
    
    interface Human {
      name: String!
      pets: [Pet]
    }
    
    interface Pet {
      name: String!
    }
    
    type Cat implements Pet {
      name: String!
    }
    
    type Friend implements Human {
      name: String!
      pets: [Pet]
    }
  `),
};

const subgraphL = {
  name: 'subgraph-l',
  url: '',
  definitions: parse(`
    interface Human {
      name: String!
      pets: [Pet]
    }
    
    interface Pet {
      age: Int!
    }
    
    type Cat implements Pet {
      age: Int!
    }
    
    type Friend implements Human {
      name: String!
      pets: [Pet]
    }
  `),
};

const subgraphM = {
  name: 'subgraph-m',
  url: '',
  definitions: parse(`
    type Query {
      humans: [Human]
    }
    
    union Human = Friend
    
    type Friend {
      name: String!
    }
  `),
};

const subgraphN = {
  name: 'subgraph-n',
  url: '',
  definitions: parse(`
    type Query {
      humans: [Human]
    }
    
    union Human = Enemy
    
    type Enemy {
      name: String!
    }
  `),
};

const subgraphO = {
  name: 'subgraph-o',
  url: '',
  definitions: parse(`
    type Query {
      humans: [Human]
    }
    
    union Human = Friend | Enemy
    
    type Friend {
      name: String!
    }
    
    type Enemy {
      name: String!
    }
  `),
};

const subgraphP = {
  name: 'subgraph-p',
  url: '',
  definitions: parse(`
    union Human = Enemy
    
    type Enemy {
      age: Int!
    }
  `),
};
