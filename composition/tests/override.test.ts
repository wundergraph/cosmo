import { describe, expect, test } from 'vitest';
import { Kind, parse } from 'graphql';
import {
  batchNormalize,
  ConfigurationData,
  duplicateOverriddenFieldErrorMessage,
  duplicateOverriddenFieldsError,
  equivalentSourceAndTargetOverrideError,
  federateSubgraphs,
  FieldContainer,
  invalidDirectiveError,
  invalidDirectiveLocationErrorMessage,
  normalizeSubgraph,
  ObjectContainer,
  shareableFieldDefinitionsError,
  Subgraph,
  subgraphValidationError,
} from '../src';
import { documentNodeToNormalizedString, normalizeString, versionTwoPersistedBaseSchema } from './utils/utils';
import { OVERRIDE } from '../src/utils/string-constants';
import { invalidOverrideTargetSubgraphNameWarning } from '../src/warnings/warnings';

describe('@override directive Tests', () => {
  test('that a warning is returned if @override targets an unknown subgraph name', () => {
    const { errors, federationResult, warnings } = federateSubgraphs([subgraphA, subgraphB]);
    expect(errors).toBeUndefined();
    expect(warnings).toBeDefined();
    expect(warnings![0]).toStrictEqual(invalidOverrideTargetSubgraphNameWarning('subgraph-z', 'Entity', ['age']));
    expect(documentNodeToNormalizedString(federationResult!.federatedGraphAST)).toBe(
      normalizeString(
        versionTwoPersistedBaseSchema +
          `
      type Query {
        query: Entity!
      }
      
      type Entity {
        id: ID!
        name: String!
        age: Int!
      }
    `,
      ),
    );
  });

  test('that an error is returned if @override is declared on multiple instances of a field', () => {
    const { errors } = federateSubgraphs([subgraphA, subgraphC, subgraphD]);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(
      duplicateOverriddenFieldsError([
        duplicateOverriddenFieldErrorMessage('Entity.name', ['subgraph-c', 'subgraph-d']),
      ]),
    );
  });

  test('that an error is returned if the source and target subgraph name for @override are equivalent', () => {
    const { errors } = normalizeSubgraph(subgraphQ.definitions, 'subgraph-q');
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(equivalentSourceAndTargetOverrideError('subgraph-q', 'Entity.name'));
  });

  test('that an overridden field does not need to be declared shareable', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphC]);
    expect(errors).toBeUndefined();
    expect(documentNodeToNormalizedString(federationResult!.federatedGraphAST)).toBe(
      normalizeString(
        versionTwoPersistedBaseSchema +
          `
      type Query {
        query: Entity!
      }
      
      type Entity {
        id: ID!
        age: Int!
        name: String!
      }
    `,
      ),
    );
  });

  test('that an overridden field does not need to be declared shareable #1', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphI, subgraphJ]);
    expect(errors).toBeUndefined();
    expect(documentNodeToNormalizedString(federationResult!.federatedGraphAST)).toBe(
      normalizeString(
        versionTwoPersistedBaseSchema +
          `
      type Query {
        query: Entity!
      }
      
      type Entity {
        id: ID!
        age: Int!
        name: String!
      }
    `,
      ),
    );
  });

  test('that an overridden field does not need to be declared shareable #2', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphJ, subgraphI]);
    expect(errors).toBeUndefined();
    expect(documentNodeToNormalizedString(federationResult!.federatedGraphAST)).toBe(
      normalizeString(
        versionTwoPersistedBaseSchema +
          `
      type Entity {
        id: ID!
        name: String!
        age: Int!
      }
      
      type Query {
        query: Entity!
      }
    `,
      ),
    );
  });

  test('that an overridden field does not need to be declared shareable #3', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphI, subgraphJ, subgraphK]);
    expect(errors).toBeUndefined();
    expect(documentNodeToNormalizedString(federationResult!.federatedGraphAST)).toBe(
      normalizeString(
        versionTwoPersistedBaseSchema +
          `
      type Query {
        query: Entity!
      }
      
      type Entity {
        id: ID!
        age: Int!
        name: String!
        number: Int!
      }
    `,
      ),
    );
  });

  test('that an overridden field does not need to be declared shareable #4', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphL, subgraphM]);
    expect(errors).toBeUndefined();
    expect(documentNodeToNormalizedString(federationResult!.federatedGraphAST)).toBe(
      normalizeString(
        versionTwoPersistedBaseSchema +
          `
       type Entity {
        id: ID!
        name: String!
      }
      
      type Query {
        query: Entity!
      }
    `,
      ),
    );
  });

  test('that an overridden field does not need to be declared shareable #5', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphN, subgraphO]);
    expect(errors).toBeUndefined();
    expect(documentNodeToNormalizedString(federationResult!.federatedGraphAST)).toBe(
      normalizeString(
        versionTwoPersistedBaseSchema +
          `
       type Entity {
        id: ID!
        name: String!
      }
      
      type Query {
        query: Entity!
      }
    `,
      ),
    );
  });

  test('that an overridden field does not need to be declared shareable #6', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphE, subgraphP]);
    expect(errors).toBeUndefined();
    expect(documentNodeToNormalizedString(federationResult!.federatedGraphAST)).toBe(
      normalizeString(
        versionTwoPersistedBaseSchema +
          `
        type Entity {
          id: ID!
          name: String!
        }
        
        type Query {
          query: Entity!
        }
    `,
      ),
    );
  });

  test('that an overridden field does not need to be declared shareable #7', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphP, subgraphE]);
    expect(errors).toBeUndefined();
    expect(documentNodeToNormalizedString(federationResult!.federatedGraphAST)).toBe(
      normalizeString(
        versionTwoPersistedBaseSchema +
          `
        type Query {
          query: Entity!
        }
        
        type Entity {
          id: ID!
          name: String!
        }
    `,
      ),
    );
  });

  test('that > 1 instance of an un-shareable field returns an error regardless of override', () => {
    const { errors } = federateSubgraphs([subgraphA, subgraphC, subgraphE]);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(
      shareableFieldDefinitionsError(
        {
          node: { name: { value: 'Entity' } },
          fields: new Map<string, FieldContainer>([
            [
              'name',
              {
                node: { name: { value: 'name' } },
                subgraphsByShareable: new Map<string, boolean>([
                  ['subgraph-c', false],
                  ['subgraph-e', true],
                ]),
              } as FieldContainer,
            ],
          ]),
        } as ObjectContainer,
        new Set<string>(['name']),
      ),
    );
  });

  test('that > 1 instance of an un-shareable field returns an error regardless of override #2', () => {
    const { errors } = federateSubgraphs([subgraphA, subgraphI, subgraphJ]);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(
      shareableFieldDefinitionsError(
        {
          node: { name: { value: 'Entity' } },
          fields: new Map<string, FieldContainer>([
            [
              'name',
              {
                node: { name: { value: 'name' } },
                subgraphsByShareable: new Map<string, boolean>([
                  ['subgraph-a', false],
                  ['subgraph-j', true],
                ]),
              } as FieldContainer,
            ],
          ]),
        } as ObjectContainer,
        new Set<string>(['name']),
      ),
    );
  });

  test('that @override produces the correct engine configuration', () => {
    const { errors, internalSubgraphBySubgraphName } = batchNormalize([subgraphA, subgraphE, subgraphF]);
    expect(errors).toBeUndefined();
    const a = internalSubgraphBySubgraphName.get('subgraph-a');
    expect(a).toBeDefined();
    const e = internalSubgraphBySubgraphName.get('subgraph-e');
    expect(e).toBeDefined();
    const g = internalSubgraphBySubgraphName.get('subgraph-f');
    expect(g).toBeDefined();
    expect(a!.configurationDataMap).toStrictEqual(
      new Map<string, ConfigurationData>([
        [
          'Query',
          {
            fieldNames: new Set<string>(['query']),
            isRootNode: true,
            typeName: 'Query',
          },
        ],
        [
          'Entity',
          {
            fieldNames: new Set<string>(['id', 'age']),
            isRootNode: true,
            keys: [{ fieldName: '', selectionSet: 'id' }],
            typeName: 'Entity',
          },
        ],
      ]),
    );
    expect(e!.configurationDataMap).toStrictEqual(
      new Map<string, ConfigurationData>([
        [
          'Entity',
          {
            fieldNames: new Set<string>(['id', 'name']),
            isRootNode: true,
            keys: [{ fieldName: '', selectionSet: 'id' }],
            typeName: 'Entity',
          },
        ],
      ]),
    );
    expect(g!.configurationDataMap).toStrictEqual(
      new Map<string, ConfigurationData>([
        [
          'Entity',
          {
            fieldNames: new Set<string>(['id', 'name', 'age']),
            isRootNode: true,
            keys: [{ fieldName: '', selectionSet: 'id' }],
            typeName: 'Entity',
          },
        ],
      ]),
    );
  });

  test('that if @override is declared at an invalid location, an error is returned', () => {
    const { errors } = federateSubgraphs([subgraphG, subgraphH]);
    expect(errors).toBeDefined();
    const hostPath = 'Entity.name(argOne: ...)';
    expect(errors![0]).toStrictEqual(
      subgraphValidationError('subgraph-g', [
        invalidDirectiveError(OVERRIDE, hostPath, [
          invalidDirectiveLocationErrorMessage(hostPath, Kind.ARGUMENT, OVERRIDE),
        ]),
      ]),
    );
  });
});

const subgraphA: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query @shareable {
      query: Entity!
    }
    
    type Entity @key(fields: "id") {
      id: ID!
      name: String!
      age: Int! @shareable
    }
  `),
};

const subgraphB: Subgraph = {
  name: 'subgraph-b',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      age: Int! @override(from: "subgraph-z") @shareable
    }
  `),
};

const subgraphC: Subgraph = {
  name: 'subgraph-c',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      name: String! @override(from: "subgraph-a")
    }
  `),
};

const subgraphD: Subgraph = {
  name: 'subgraph-d',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      name: String! @override(from: "subgraph-c")
    }
  `),
};

const subgraphE: Subgraph = {
  name: 'subgraph-e',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      name: String! @shareable
    }
  `),
};

const subgraphF: Subgraph = {
  name: 'subgraph-f',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      name: String! @override(from: "subgraph-a") @shareable
      age: Int! @shareable
    }
  `),
};

const subgraphG: Subgraph = {
  name: 'subgraph-g',
  url: '',
  definitions: parse(`
    type Query @shareable {
      query: Entity
    }

    type Entity @key(fields: "id") @shareable {
      id: ID!
      name(argOne: String! @override(from: "subgraph-h")): String!
    }
  `),
};

const subgraphH: Subgraph = {
  name: 'subgraph-h',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") @shareable {
      id: ID!
      name(argOne: String!): String!
    }
  `),
};

const subgraphI: Subgraph = {
  name: 'subgraph-i',
  url: '',
  definitions: parse(`
    type Query @shareable {
      query: Entity!
    }
    
    type Entity @key(fields: "id") {
      id: ID!
      name: String!
      age: Int! @shareable
    }
  `),
};

const subgraphJ: Subgraph = {
  name: 'subgraph-j',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      name: String! @shareable @override(from: "subgraph-i")
    }
  `),
};

const subgraphK: Subgraph = {
  name: 'subgraph-k',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      name: String! @shareable
      number: Int!
    }
  `),
};

const subgraphL: Subgraph = {
  name: 'subgraph-l',
  url: '',
  definitions: parse(`
    type Query @shareable {
      query: Entity!
    }
    
    type Entity @key(fields: "id") {
      id: ID!
    }
    
    extend type Entity {
      name: String! @shareable @override(from: "subgraph-m")
    }
  `),
};

const subgraphM: Subgraph = {
  name: 'subgraph-m',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      name: String!
    }
  `),
};

const subgraphN: Subgraph = {
  name: 'subgraph-n',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
    }
    
    extend type Entity {
      name: String!
    }
  `),
};

const subgraphO: Subgraph = {
  name: 'subgraph-o',
  url: '',
  definitions: parse(`
    type Query @shareable {
      query: Entity!
    }
    
    type Entity @key(fields: "id") {
      id: ID!
      name: String! @override(from: "subgraph-n")
    }
  `),
};

const subgraphP: Subgraph = {
  name: 'subgraph-p',
  url: '',
  definitions: parse(`
    type Query @shareable {
      query: Entity!
    }
    
    type Entity @key(fields: "id") {
      id: ID!
      name: String! @override(from: "subgraph-e")
    }
  `),
};

const subgraphQ: Subgraph = {
  name: 'subgraph-q',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      name: String! @override(from: "subgraph-q")
    }
  `),
};
