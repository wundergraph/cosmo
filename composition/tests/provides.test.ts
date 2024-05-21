import { describe, expect, test } from 'vitest';
import { ConfigurationData, federateSubgraphs, Subgraph } from '../src';
import { parse } from 'graphql';

describe('@provides directive tests', () => {
  describe('Federation tests', () => {
    test('that fields declared @external due to @provides are added to configuration fieldNames', () => {
      const { errors, federationResult } = federateSubgraphs([a, b]);
      expect(errors).toBeUndefined();
      expect(federationResult).toBeDefined();
      const aConfig = federationResult!.subgraphConfigBySubgraphName.get('a');
      expect(aConfig).toBeDefined();
      const bConfig = federationResult!.subgraphConfigBySubgraphName.get('b');
      expect(bConfig).toBeDefined();
      expect(aConfig!.configurationDataMap).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id', 'object']),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'id' }],
              typeName: 'Entity',
            },
          ],
          [
            'Object',
            {
              fieldNames: new Set<string>(['id']),
              isRootNode: false,
              typeName: 'Object',
            },
          ],
          [
            'Query',
            {
              fieldNames: new Set<string>(['entity']),
              isRootNode: true,
              provides: [{ fieldName: 'entity', selectionSet: 'object { id }' }],
              typeName: 'Query',
            },
          ],
        ]),
      );
      expect(bConfig!.configurationDataMap).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id', 'name', 'object']),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'id' }],
              typeName: 'Entity',
            },
          ],
          [
            'Object',
            {
              fieldNames: new Set<string>(['id']),
              isRootNode: false,
              typeName: 'Object',
            },
          ],
        ]),
      );
    });
  });
});

const a: Subgraph = {
  name: 'a',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      object: Object! @external @shareable
    }
    
    type Object @shareable {
      id: ID!
    }
    
    type Query {
      entity: Entity! @provides(fields: "object { id }")
    }
  `),
};

const b: Subgraph = {
  name: 'b',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      name: String!
      object: Object! @shareable
    }
    
    type Object @shareable {
      id: ID!
    }
  `),
};
