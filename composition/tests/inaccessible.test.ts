import { describe, expect, test } from 'vitest';
import {
  allFieldDefinitionsAreInaccessibleError,
  federateSubgraphs,
  FieldData,
  ImplementationErrors,
  InvalidFieldImplementation,
  invalidFieldShareabilityError,
  normalizeSubgraph,
  ObjectDefinitionData,
  Subgraph,
  unimplementedInterfaceFieldsError,
} from '../src';
import { parse } from 'graphql';
import {
  normalizeString,
  schemaToSortedNormalizedString,
  versionTwoSchemaQueryAndPersistedDirectiveDefinitions,
} from './utils/utils';

describe('@inaccessible tests', () => {
  test('that inaccessible fields are not included in the federated graph', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphB]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoSchemaQueryAndPersistedDirectiveDefinitions +
          `
      type Entity {
        age: Int!
        id: ID!
      }
      
      type Query {
        entity: Entity!
      }
      
      scalar openfed__Scope
    `,
      ),
    );
  });

  test('that inaccessible fields are still subject to @shareable errors', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphC]);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(
      invalidFieldShareabilityError(
        {
          name: 'Entity',
          fieldDataByFieldName: new Map<string, FieldData>([
            [
              'name',
              {
                isShareableBySubgraphName: new Map<string, boolean>([
                  ['subgraph-a', true],
                  ['subgraph-c', false],
                ]),
              } as FieldData,
            ],
          ]),
        } as ObjectDefinitionData,
        new Set<string>(['name']),
      ),
    );
  });

  test('that composition is successful if a field is declared @inaccessible in both the interface definition and its implementation,', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphD]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoSchemaQueryAndPersistedDirectiveDefinitions +
          `
      type Entity implements Interface {
        id: ID!
      }
      
      interface Interface {
        id: ID!
      }
      
      type Query {
        entity: Entity!
      }
      
      scalar openfed__Scope
    `,
      ),
    );
  });

  test('that composition is successful if a field is declared @inaccessible in the interface but not in the implementation,', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphB, subgraphH]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoSchemaQueryAndPersistedDirectiveDefinitions +
          `
      type Entity implements Interface {
        age: Int!
        id: ID!
        name: String!
      }
      
      interface Interface {
        id: ID!
      }
      
      type Query {
        entity: Entity!
      }
      
      scalar openfed__Scope
    `,
      ),
    );
  });

  test('that an error is returned if an interface field is @inaccessible but the implementation field is not defined,', () => {
    const { errors } = normalizeSubgraph(subgraphE.definitions);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(
      unimplementedInterfaceFieldsError(
        'Entity',
        'object',
        new Map<string, ImplementationErrors>([
          [
            'Interface',
            {
              invalidFieldImplementations: new Map<string, InvalidFieldImplementation>(),
              unimplementedFields: ['name'],
            },
          ],
        ]),
      ),
    );
  });

  test('that an error is returned if an interface field is @inaccessible but the implementation field is not defined #2,', () => {
    const { errors } = federateSubgraphs([subgraphF, subgraphG]);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(
      unimplementedInterfaceFieldsError(
        'Entity',
        'object',
        new Map<string, ImplementationErrors>([
          [
            'Interface',
            {
              invalidFieldImplementations: new Map<string, InvalidFieldImplementation>(),
              unimplementedFields: ['name'],
            },
          ],
        ]),
      ),
    );
  });

  test('that an error is returned if all fields defined on an object are declared @inaccessible', () => {
    const { errors } = federateSubgraphs([subgraphA, subgraphI]);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(allFieldDefinitionsAreInaccessibleError('object', 'Object'));
  });

  test('that an error is returned if all fields defined on an extended object are declared @inaccessible', () => {
    const { errors } = federateSubgraphs([subgraphA, subgraphJ]);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(allFieldDefinitionsAreInaccessibleError('object', 'Object'));
  });

  test('that an error is returned if all fields defined on an interface are declared @inaccessible', () => {
    const { errors } = federateSubgraphs([subgraphA, subgraphK]);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(allFieldDefinitionsAreInaccessibleError('interface', 'Interface'));
  });

  test('that an error is returned if all fields defined on an extended interface are declared', () => {
    const { errors } = federateSubgraphs([subgraphA, subgraphL]);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(allFieldDefinitionsAreInaccessibleError('interface', 'Interface'));
  });
});

const subgraphA: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity!
    }
    
    type Entity @key(fields: "id") @shareable {
      id: ID!
      name: String! @inaccessible
    }
  `),
};

const subgraphB: Subgraph = {
  name: 'subgraph-b',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      age: Int!
    }
  `),
};

const subgraphC: Subgraph = {
  name: 'subgraph-c',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID! @shareable
      name: String!
    }
  `),
};

const subgraphD: Subgraph = {
  name: 'subgraph-d',
  url: '',
  definitions: parse(`
    interface Interface {
      id: ID!
      name: String! @inaccessible
    }
    
    type Entity implements Interface @key(fields: "id") @shareable {
      id: ID!
      name: String! @inaccessible
    }
  `),
};

const subgraphE: Subgraph = {
  name: 'subgraph-e',
  url: '',
  definitions: parse(`
    interface Interface {
      id: ID!
      name: String! @inaccessible
    }
    
    type Entity implements Interface @key(fields: "id") @shareable {
      id: ID!
    }
  `),
};

const subgraphF: Subgraph = {
  name: 'subgraph-f',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity!
    }
    
    interface Interface {
      id: ID!
    }
    
    type Entity implements Interface @key(fields: "id") {
      id: ID!
    }
  `),
};

const subgraphG: Subgraph = {
  name: 'subgraph-g',
  url: '',
  definitions: parse(`
    interface Interface {
      id: ID!
      name: String @inaccessible
    }
  `),
};

const subgraphH: Subgraph = {
  name: 'subgraph-h',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity!
    }
    
    interface Interface {
      id: ID!
      name: String @inaccessible
    }
    
    type Entity implements Interface @key(fields: "id") {
      id: ID!
      name: String!
    }
  `),
};

const subgraphI: Subgraph = {
  name: 'subgraph-i',
  url: '',
  definitions: parse(`
    type Object {
      name: String! @inaccessible
    }
  `),
};

const subgraphJ: Subgraph = {
  name: 'subgraph-j',
  url: '',
  definitions: parse(`
    type Object {
      name: String! @inaccessible
    }
    
    extend type Object {
      age: Int! @inaccessible
    }
  `),
};

const subgraphK: Subgraph = {
  name: 'subgraph-k',
  url: '',
  definitions: parse(`
    interface Interface {
      name: String! @inaccessible
    }
  `),
};

const subgraphL: Subgraph = {
  name: 'subgraph-l',
  url: '',
  definitions: parse(`
    interface Interface {
      name: String! @inaccessible
    }
    
    extend interface Interface {
      age: Int! @inaccessible
    }
  `),
};
