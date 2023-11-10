import { describe, expect, test } from 'vitest';
import { parse } from 'graphql/index';
import {
  batchNormalize,
  ConfigurationData,
  duplicateOverriddenFieldErrorMessage,
  duplicateOverriddenFieldsError,
  federateSubgraphs,
  FieldContainer,
  invalidDirectiveError,
  invalidDirectiveLocationErrorMessage,
  invalidOverrideTargetSubgraphNameError,
  ObjectContainer,
  shareableFieldDefinitionsError,
  Subgraph,
  subgraphValidationError,
} from '../src';
import { documentNodeToNormalizedString, normalizeString, versionTwoPersistedBaseSchema } from './utils/utils';
import { OVERRIDE } from '../src/utils/string-constants';
import { Kind } from 'graphql';

describe('@override directive Tests', () => {
  test('that an error is returned if @override targets an unknown subgraph name', () => {
    const { errors } = federateSubgraphs([subgraphA, subgraphB]);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(subgraphValidationError(
      'subgraph-b',
      [invalidOverrideTargetSubgraphNameError('subgraph-z', 'Entity', ['name'])],
    ));
  });

  test('that an error is returned if @override is declared on multiple instances of a field', () => {
    const { errors } = federateSubgraphs([subgraphA, subgraphC, subgraphD]);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(duplicateOverriddenFieldsError(
      [duplicateOverriddenFieldErrorMessage('Entity.name', ['subgraph-c', 'subgraph-d'])],
    ));
  });

  test('that an overridden field does not need to be declared shareable', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphC]);
    expect(errors).toBeUndefined();
    expect(documentNodeToNormalizedString(federationResult!.federatedGraphAST))
      .toBe(normalizeString(versionTwoPersistedBaseSchema + `
      type Query {
        query: Entity!
      }
      
      type Entity {
        id: ID!
        age: Int!
        name: String!
      }
    `));
  });

  test('that > 1 instance of an un-shareable field returns an error regardless of override', () => {
    const { errors } = federateSubgraphs([subgraphA, subgraphC, subgraphE]);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(shareableFieldDefinitionsError(
      {
        node: { name: { value: 'Entity' } },
        fields: new Map<string, FieldContainer>([[
          'name',
          {
            node: { name: { value: 'name' } },
            subgraphsByShareable: new Map<string, boolean>([['subgraph-c', false], ['subgraph-e', true]]),
          } as FieldContainer,
        ]]),
      } as ObjectContainer,
      new Set<string>(['name']),
    ));
  });

  test('that @override produces the correct engine configuration', () => {
    const { errors, internalSubgraphsBySubgraphName } = batchNormalize([subgraphA, subgraphE, subgraphF]);
    expect(errors).toBeUndefined();
    const a = internalSubgraphsBySubgraphName.get('subgraph-a');
    expect(a).toBeDefined();
    const e = internalSubgraphsBySubgraphName.get('subgraph-e');
    expect(e).toBeDefined();
    const g = internalSubgraphsBySubgraphName.get('subgraph-f');
    expect(g).toBeDefined();
    expect(a!.configurationDataMap).toStrictEqual(new Map<string, ConfigurationData>([
      ['Query', {
        fieldNames: new Set<string>(['query']),
        isRootNode: true,
        typeName: 'Query',
      }],
      ['Entity', {
        fieldNames: new Set<string>(['id', 'age']),
        isRootNode: true,
        keys: [{ fieldName: '', selectionSet: 'id' }],
        typeName: 'Entity',
      }],
    ]));
    expect(e!.configurationDataMap).toStrictEqual(new Map<string, ConfigurationData>([
      ['Entity', {
        fieldNames: new Set<string>(['id', 'name']),
        isRootNode: true,
        keys: [{ fieldName: '', selectionSet: 'id' }],
        typeName: 'Entity',
      }],
    ]));
    expect(g!.configurationDataMap).toStrictEqual(new Map<string, ConfigurationData>([
      ['Entity', {
        fieldNames: new Set<string>(['id', 'name', 'age']),
        isRootNode: true,
        keys: [{ fieldName: '', selectionSet: 'id' }],
        typeName: 'Entity',
      }],
    ]));
  });

  test('that if @override is declared at an invalid location, an error is returned', () => {
    const { errors } = federateSubgraphs([subgraphG, subgraphH]);
    expect(errors).toBeDefined();
    const hostPath = 'Entity.name(argOne: ...)';
    expect(errors![0]).toStrictEqual(subgraphValidationError('subgraph-g', [invalidDirectiveError(
      OVERRIDE, hostPath, [invalidDirectiveLocationErrorMessage(hostPath, Kind.ARGUMENT, OVERRIDE)],
    )]));
  });
});

const subgraphA: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
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
      name: String! @override(from: "subgraph-z")
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
    type Query {
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