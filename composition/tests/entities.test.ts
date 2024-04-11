import {
  ConfigurationData,
  duplicateDirectiveArgumentDefinitionsErrorMessage,
  federateSubgraphs,
  FieldData,
  invalidDirectiveError,
  invalidFieldShareabilityError,
  normalizeSubgraph,
  ObjectDefinitionData,
  Subgraph,
  undefinedRequiredArgumentsErrorMessage,
  unexpectedDirectiveArgumentErrorMessage,
} from '../src';
import { describe, expect, test } from 'vitest';
import {
  documentNodeToNormalizedString,
  normalizeString,
  schemaToSortedNormalizedString,
  versionOnePersistedBaseSchema,
  versionOneSchemaQueryAndPersistedDirectiveDefinitions,
  versionTwoSchemaQueryAndPersistedDirectiveDefinitions,
} from './utils/utils';
import { parse } from 'graphql';
import { FIELDS, KEY } from '../src/utils/string-constants';

describe('Entity tests', () => {
  describe('Entity normalization tests', () => {
    test('that an error is returned if the @key directive is defined with invalid arguments', () => {
      const hostPath = 'Entity';
      const { errors } = normalizeSubgraph(subgraphT.definitions, subgraphT.name);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(2);
      expect(errors![0]).toStrictEqual(
        invalidDirectiveError(KEY, hostPath, [
          unexpectedDirectiveArgumentErrorMessage(KEY, ['unknownArgument', 'duplicateUnknownArgument']),
          undefinedRequiredArgumentsErrorMessage(KEY, hostPath, [FIELDS], [FIELDS]),
        ]),
      );
      expect(errors![1]).toStrictEqual(
        invalidDirectiveError(KEY, hostPath, [
          duplicateDirectiveArgumentDefinitionsErrorMessage(KEY, hostPath, [FIELDS]),
        ]),
      );
    });
  });

  describe('Entity federation tests', () => {
    test('that entities merge successfully', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphB]);
      expect(errors).toBeUndefined();
      const federatedGraph = federationResult!.federatedGraphAST;
      expect(documentNodeToNormalizedString(federatedGraph)).toBe(
        normalizeString(
          versionOnePersistedBaseSchema +
            `
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
          versionOnePersistedBaseSchema +
            `
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
          versionOnePersistedBaseSchema +
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
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneSchemaQueryAndPersistedDirectiveDefinitions +
            `
      interface Interface {
        age: Int!
        id: ID!
        name: String!
      }
      
      type Query {
        dummy: String!
      }
    `,
        ),
      );
    });

    test('that errors are returned for non-shareable fields, even if they compose an adopted implicit entity key', () => {
      const { errors } = federateSubgraphs([subgraphL, subgraphM]);
      expect(errors).toBeDefined();
      expect(errors!.length).toBe(2);
      expect(errors![0]).toStrictEqual(
        invalidFieldShareabilityError(
          {
            name: 'Entity',
            fieldDataByFieldName: new Map<string, FieldData>([
              [
                'id',
                {
                  isShareableBySubgraphName: new Map<string, boolean>([
                    ['subgraph-l', true],
                    ['subgraph-m', false],
                  ]),
                } as FieldData,
              ],
              [
                'object',
                {
                  isShareableBySubgraphName: new Map<string, boolean>([
                    ['subgraph-l', true],
                    ['subgraph-m', false],
                  ]),
                } as FieldData,
              ],
              [
                'age',
                {
                  isShareableBySubgraphName: new Map<string, boolean>([
                    ['subgraph-l', true],
                    ['subgraph-m', false],
                  ]),
                } as FieldData,
              ],
            ]),
          } as ObjectDefinitionData,
          new Set<string>(['id', 'object', 'age']),
        ),
      );
      expect(errors![1]).toStrictEqual(
        invalidFieldShareabilityError(
          {
            name: 'Object',
            fieldDataByFieldName: new Map<string, FieldData>([
              [
                'id',
                {
                  isShareableBySubgraphName: new Map<string, boolean>([
                    ['subgraph-l', true],
                    ['subgraph-m', false],
                  ]),
                } as FieldData,
              ],
              [
                'name',
                {
                  isShareableBySubgraphName: new Map<string, boolean>([
                    ['subgraph-l', true],
                    ['subgraph-m', false],
                  ]),
                } as FieldData,
              ],
            ]),
          } as ObjectDefinitionData,
          new Set<string>(['id', 'name']),
        ),
      );
    });
  });

  describe('Entity configuration tests', () => {
    test('that the correct configuration is returned when a resolvable in a key directive is set to false', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphI, subgraphJ]);
      expect(errors).toBeUndefined();
      const subgraphConfigBySubgraphName = federationResult?.subgraphConfigBySubgraphName;
      const i = subgraphConfigBySubgraphName?.get('subgraph-i');
      expect(i).toBeDefined();
      const j = subgraphConfigBySubgraphName?.get('subgraph-j');
      expect(j).toBeDefined();
      expect(i!.configurationDataMap).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Query',
            {
              fieldNames: new Set<string>(['entity']),
              isRootNode: true,
              typeName: 'Query',
            },
          ],
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id', 'name']),
              isRootNode: true,
              keys: [{ disableEntityResolver: true, fieldName: '', selectionSet: 'id' }],
              typeName: 'Entity',
            },
          ],
        ]),
      );
      expect(j!.configurationDataMap).toStrictEqual(
        new Map<string, ConfigurationData>([
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
    });

    test('that the correct configuration is returned for implicit entities #1', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphJ, subgraphK]);
      expect(errors).toBeUndefined();
      const subgraphConfigBySubgraphName = federationResult?.subgraphConfigBySubgraphName;
      const j = subgraphConfigBySubgraphName?.get('subgraph-j');
      expect(j).toBeDefined();
      const k = subgraphConfigBySubgraphName?.get('subgraph-k');
      expect(k).toBeDefined();
      expect(j!.configurationDataMap).toStrictEqual(
        new Map<string, ConfigurationData>([
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
      expect(k!.configurationDataMap).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Query',
            {
              fieldNames: new Set<string>(['entity']),
              isRootNode: true,
              typeName: 'Query',
            },
          ],
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id', 'name']),
              isRootNode: true,
              keys: [{ disableEntityResolver: true, fieldName: '', selectionSet: 'id' }],
              typeName: 'Entity',
            },
          ],
        ]),
      );
    });

    test('that the correct configuration is returned for implicit entities with multiple valid keys', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphK, subgraphL]);
      expect(errors).toBeUndefined();
      const subgraphConfigBySubgraphName = federationResult?.subgraphConfigBySubgraphName;
      const k = subgraphConfigBySubgraphName?.get('subgraph-k');
      expect(k).toBeDefined();
      const l = subgraphConfigBySubgraphName?.get('subgraph-l');
      expect(l).toBeDefined();
      expect(k!.configurationDataMap).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Query',
            {
              fieldNames: new Set<string>(['entity']),
              isRootNode: true,
              typeName: 'Query',
            },
          ],
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id', 'name']),
              isRootNode: true,
              keys: [{ disableEntityResolver: true, fieldName: '', selectionSet: 'id' }],
              typeName: 'Entity',
            },
          ],
        ]),
      );
      expect(l!.configurationDataMap).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id', 'object', 'age']),
              isRootNode: true,
              keys: [
                { fieldName: '', selectionSet: 'id' },
                { fieldName: '', selectionSet: 'object { id }' },
              ],
              typeName: 'Entity',
            },
          ],
          [
            'Object',
            {
              fieldNames: new Set<string>(['id', 'name']),
              isRootNode: false,
              typeName: 'Object',
            },
          ],
        ]),
      );
    });

    test('that the correct configuration is returned for implicit entities with multiple valid and invalid keys across several graphs', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphO, subgraphP, subgraphQ, subgraphR]);
      expect(errors).toBeUndefined();
      const subgraphConfigBySubgraphName = federationResult?.subgraphConfigBySubgraphName;
      const o = subgraphConfigBySubgraphName?.get('subgraph-o');
      expect(o).toBeDefined();
      const p = subgraphConfigBySubgraphName?.get('subgraph-p');
      expect(p).toBeDefined();
      const q = subgraphConfigBySubgraphName?.get('subgraph-q');
      expect(q).toBeDefined();
      const r = subgraphConfigBySubgraphName?.get('subgraph-r');
      expect(r).toBeDefined();
      expect(o!.configurationDataMap).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Query',
            {
              fieldNames: new Set<string>(['entity']),
              isRootNode: true,
              typeName: 'Query',
            },
          ],
          [
            'Entity',
            {
              fieldNames: new Set<string>(['object', 'name']),
              isRootNode: true,
              keys: [
                { disableEntityResolver: true, fieldName: '', selectionSet: 'name' },
                { disableEntityResolver: true, fieldName: '', selectionSet: 'object { id nestedObject { id } }' },
              ],
              typeName: 'Entity',
            },
          ],
          [
            'Object',
            {
              fieldNames: new Set<string>(['id', 'nestedObject']),
              isRootNode: false,
              typeName: 'Object',
            },
          ],
          [
            'NestedObject',
            {
              fieldNames: new Set<string>(['id']),
              isRootNode: false,
              typeName: 'NestedObject',
            },
          ],
        ]),
      );
      expect(p!.configurationDataMap).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id', 'name', 'age']),
              isRootNode: true,
              keys: [
                { fieldName: '', selectionSet: 'id' },
                { fieldName: '', selectionSet: 'name' },
              ],
              typeName: 'Entity',
            },
          ],
        ]),
      );
      expect(q!.configurationDataMap).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Entity',
            {
              fieldNames: new Set<string>(['object', 'isEntity']),
              isRootNode: true,
              keys: [
                { fieldName: '', selectionSet: 'object { id nestedObject { id } }' },
                { fieldName: '', selectionSet: 'object { nestedObject { name } }' },
              ],
              typeName: 'Entity',
            },
          ],
          [
            'Object',
            {
              fieldNames: new Set<string>(['id', 'nestedObject']),
              isRootNode: false,
              typeName: 'Object',
            },
          ],
          [
            'NestedObject',
            {
              fieldNames: new Set<string>(['id', 'name']),
              isRootNode: false,
              typeName: 'NestedObject',
            },
          ],
        ]),
      );
      expect(r!.configurationDataMap).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id', 'property']),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'id' }],
              typeName: 'Entity',
            },
          ],
        ]),
      );
    });

    test('that external fields that compose an adopted implicit entity key are included in the router configuration', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphJ, subgraphN]);
      expect(errors).toBeUndefined();
      const subgraphConfigBySubgraphName = federationResult?.subgraphConfigBySubgraphName;
      const j = subgraphConfigBySubgraphName?.get('subgraph-j');
      expect(j).toBeDefined();
      const n = subgraphConfigBySubgraphName?.get('subgraph-n');
      expect(n).toBeDefined();
      expect(j!.configurationDataMap).toStrictEqual(
        new Map<string, ConfigurationData>([
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
      expect(n!.configurationDataMap).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Query',
            {
              fieldNames: new Set<string>(['entity']),
              isRootNode: true,
              typeName: 'Query',
            },
          ],
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id', 'name']),
              isRootNode: true,
              keys: [{ disableEntityResolver: true, fieldName: '', selectionSet: 'id' }],
              typeName: 'Entity',
            },
          ],
        ]),
      );
    });

    test('that resolvable false is correctly propagated in the ConfigurationData', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphS]);
      expect(errors).toBeUndefined();
      const subgraphConfigBySubgraphName = federationResult?.subgraphConfigBySubgraphName;
      const s = subgraphConfigBySubgraphName?.get('subgraph-s');
      expect(s).toBeDefined();
      expect(s!.configurationDataMap).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Query',
            {
              fieldNames: new Set<string>(['entities']),
              isRootNode: true,
              typeName: 'Query',
            },
          ],
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id', 'property']),
              isRootNode: true,
              keys: [
                { fieldName: '', selectionSet: 'id', disableEntityResolver: true },
                { fieldName: '', selectionSet: 'property' },
              ],
              typeName: 'Entity',
            },
          ],
        ]),
      );
    });

    test('that if a target key can be satisfied, it will included in the router configuration #1.1', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphU, subgraphV]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneSchemaQueryAndPersistedDirectiveDefinitions +
            `
        type Entity {
          a: Int!
          b: Boolean!
          id: ID!
          name: String!
        }
        
        type Query {
          entities: [Entity!]!
        }
      `,
        ),
      );
      const u = federationResult?.subgraphConfigBySubgraphName.get('subgraph-u');
      expect(u).toBeDefined();
      const v = federationResult?.subgraphConfigBySubgraphName.get('subgraph-v');
      expect(v).toBeDefined();
      expect(u!.configurationDataMap).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Query',
            {
              fieldNames: new Set<string>(['entities']),
              isRootNode: true,
              typeName: 'Query',
            },
          ],
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id', 'name', 'a']),
              isRootNode: true,
              typeName: 'Entity',
              keys: [
                { fieldName: '', selectionSet: 'id name' },
                { fieldName: '', selectionSet: 'name', disableEntityResolver: true },
              ],
            },
          ],
        ]),
      );
      expect(v!.configurationDataMap).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Entity',
            {
              fieldNames: new Set<string>(['name', 'b']),
              isRootNode: true,
              typeName: 'Entity',
              keys: [{ fieldName: '', selectionSet: 'name' }],
            },
          ],
        ]),
      );
    });

    test('that if a target key can be satisfied, it will included in the router configuration #1.2', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphV, subgraphU]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneSchemaQueryAndPersistedDirectiveDefinitions +
            `
        type Entity {
          a: Int!
          b: Boolean!
          id: ID!
          name: String!
        }
        
        type Query {
          entities: [Entity!]!
        }
      `,
        ),
      );
      const u = federationResult?.subgraphConfigBySubgraphName.get('subgraph-u');
      expect(u).toBeDefined();
      const v = federationResult?.subgraphConfigBySubgraphName.get('subgraph-v');
      expect(v).toBeDefined();
      expect(u!.configurationDataMap).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Query',
            {
              fieldNames: new Set<string>(['entities']),
              isRootNode: true,
              typeName: 'Query',
            },
          ],
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id', 'name', 'a']),
              isRootNode: true,
              typeName: 'Entity',
              keys: [
                { fieldName: '', selectionSet: 'id name' },
                { fieldName: '', selectionSet: 'name', disableEntityResolver: true },
              ],
            },
          ],
        ]),
      );
      expect(v!.configurationDataMap).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Entity',
            {
              fieldNames: new Set<string>(['name', 'b']),
              isRootNode: true,
              typeName: 'Entity',
              keys: [{ fieldName: '', selectionSet: 'name' }],
            },
          ],
        ]),
      );
    });

    test('that if a target key can be satisfied, it will included in the router configuration #2.1', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphW, subgraphX, subgraphY]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoSchemaQueryAndPersistedDirectiveDefinitions +
            `
        type Entity {
          a: Int!
          b: Boolean!
          c: Float!
          id: ID!
          object: Object!
        }
        
        type NestedObject {
          id: ID!
        }
        
        type Object {
          id: ID!
          name: String!
          nestedObject: NestedObject!
        }
        
        type Query {
          entities: [Entity!]!
        }
        
        scalar openfed__Scope
      `,
        ),
      );
      const w = federationResult?.subgraphConfigBySubgraphName.get('subgraph-w');
      expect(w).toBeDefined();
      const x = federationResult?.subgraphConfigBySubgraphName.get('subgraph-x');
      expect(x).toBeDefined();
      const y = federationResult?.subgraphConfigBySubgraphName.get('subgraph-y');
      expect(y).toBeDefined();
      expect(w!.configurationDataMap).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Query',
            {
              fieldNames: new Set<string>(['entities']),
              isRootNode: true,
              typeName: 'Query',
            },
          ],
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id', 'object', 'a']),
              isRootNode: true,
              typeName: 'Entity',
              keys: [
                { fieldName: '', selectionSet: 'id object { nestedObject { id } }' },
                { fieldName: '', selectionSet: 'id object { name }' },
                { fieldName: '', selectionSet: 'object { id }', disableEntityResolver: true },
                { fieldName: '', selectionSet: 'object { name }', disableEntityResolver: true },
              ],
            },
          ],
          [
            'Object',
            {
              fieldNames: new Set<string>(['id', 'name', 'nestedObject']),
              isRootNode: false,
              typeName: 'Object',
            },
          ],
          [
            'NestedObject',
            {
              fieldNames: new Set<string>(['id']),
              isRootNode: false,
              typeName: 'NestedObject',
            },
          ],
        ]),
      );
      expect(x!.configurationDataMap).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Entity',
            {
              fieldNames: new Set<string>(['object', 'b']),
              isRootNode: true,
              typeName: 'Entity',
              keys: [{ fieldName: '', selectionSet: 'object { id }' }],
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
      expect(y!.configurationDataMap).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id', 'object', 'c']),
              isRootNode: true,
              typeName: 'Entity',
              keys: [
                { fieldName: '', selectionSet: 'object { name }' },
                { fieldName: '', selectionSet: 'id object { nestedObject { id } }', disableEntityResolver: true },
                { fieldName: '', selectionSet: 'id object { name }', disableEntityResolver: true },
                { fieldName: '', selectionSet: 'object { id }', disableEntityResolver: true },
              ],
            },
          ],
          [
            'Object',
            {
              fieldNames: new Set<string>(['id', 'name', 'nestedObject']),
              isRootNode: false,
              typeName: 'Object',
            },
          ],
          [
            'NestedObject',
            {
              fieldNames: new Set<string>(['id']),
              isRootNode: false,
              typeName: 'NestedObject',
            },
          ],
        ]),
      );
    });

    test('that if a target key can be satisfied, it will included in the router configuration #2.2', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphW, subgraphY, subgraphX]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoSchemaQueryAndPersistedDirectiveDefinitions +
            `
        type Entity {
          a: Int!
          b: Boolean!
          c: Float!
          id: ID!
          object: Object!
        }
        
        type NestedObject {
          id: ID!
        }
        
        type Object {
          id: ID!
          name: String!
          nestedObject: NestedObject!
        }
        
        type Query {
          entities: [Entity!]!
        }
        
        scalar openfed__Scope
      `,
        ),
      );
      const w = federationResult?.subgraphConfigBySubgraphName.get('subgraph-w');
      expect(w).toBeDefined();
      const x = federationResult?.subgraphConfigBySubgraphName.get('subgraph-x');
      expect(x).toBeDefined();
      const y = federationResult?.subgraphConfigBySubgraphName.get('subgraph-y');
      expect(y).toBeDefined();
      expect(w!.configurationDataMap).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Query',
            {
              fieldNames: new Set<string>(['entities']),
              isRootNode: true,
              typeName: 'Query',
            },
          ],
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id', 'object', 'a']),
              isRootNode: true,
              typeName: 'Entity',
              keys: [
                { fieldName: '', selectionSet: 'id object { nestedObject { id } }' },
                { fieldName: '', selectionSet: 'id object { name }' },
                { fieldName: '', selectionSet: 'object { name }', disableEntityResolver: true },
                { fieldName: '', selectionSet: 'object { id }', disableEntityResolver: true },
              ],
            },
          ],
          [
            'Object',
            {
              fieldNames: new Set<string>(['id', 'name', 'nestedObject']),
              isRootNode: false,
              typeName: 'Object',
            },
          ],
          [
            'NestedObject',
            {
              fieldNames: new Set<string>(['id']),
              isRootNode: false,
              typeName: 'NestedObject',
            },
          ],
        ]),
      );
      expect(x!.configurationDataMap).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Entity',
            {
              fieldNames: new Set<string>(['object', 'b']),
              isRootNode: true,
              typeName: 'Entity',
              keys: [{ fieldName: '', selectionSet: 'object { id }' }],
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
      expect(y!.configurationDataMap).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id', 'object', 'c']),
              isRootNode: true,
              typeName: 'Entity',
              keys: [
                { fieldName: '', selectionSet: 'object { name }' },
                { fieldName: '', selectionSet: 'id object { nestedObject { id } }', disableEntityResolver: true },
                { fieldName: '', selectionSet: 'id object { name }', disableEntityResolver: true },
                { fieldName: '', selectionSet: 'object { id }', disableEntityResolver: true },
              ],
            },
          ],
          [
            'Object',
            {
              fieldNames: new Set<string>(['id', 'name', 'nestedObject']),
              isRootNode: false,
              typeName: 'Object',
            },
          ],
          [
            'NestedObject',
            {
              fieldNames: new Set<string>(['id']),
              isRootNode: false,
              typeName: 'NestedObject',
            },
          ],
        ]),
      );
    });

    test('that if a target key can be satisfied, it will included in the router configuration #2.3', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphX, subgraphW, subgraphY]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoSchemaQueryAndPersistedDirectiveDefinitions +
            `
        type Entity {
          a: Int!
          b: Boolean!
          c: Float!
          id: ID!
          object: Object!
        }
        
        type NestedObject {
          id: ID!
        }
        
        type Object {
          id: ID!
          name: String!
          nestedObject: NestedObject!
        }
        
        type Query {
          entities: [Entity!]!
        }
        
        scalar openfed__Scope
      `,
        ),
      );
      const w = federationResult?.subgraphConfigBySubgraphName.get('subgraph-w');
      expect(w).toBeDefined();
      const x = federationResult?.subgraphConfigBySubgraphName.get('subgraph-x');
      expect(x).toBeDefined();
      const y = federationResult?.subgraphConfigBySubgraphName.get('subgraph-y');
      expect(y).toBeDefined();
      expect(w!.configurationDataMap).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Query',
            {
              fieldNames: new Set<string>(['entities']),
              isRootNode: true,
              typeName: 'Query',
            },
          ],
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id', 'object', 'a']),
              isRootNode: true,
              typeName: 'Entity',
              keys: [
                { fieldName: '', selectionSet: 'id object { nestedObject { id } }' },
                { fieldName: '', selectionSet: 'id object { name }' },
                { fieldName: '', selectionSet: 'object { id }', disableEntityResolver: true },
                { fieldName: '', selectionSet: 'object { name }', disableEntityResolver: true },
              ],
            },
          ],
          [
            'Object',
            {
              fieldNames: new Set<string>(['id', 'name', 'nestedObject']),
              isRootNode: false,
              typeName: 'Object',
            },
          ],
          [
            'NestedObject',
            {
              fieldNames: new Set<string>(['id']),
              isRootNode: false,
              typeName: 'NestedObject',
            },
          ],
        ]),
      );
      expect(x!.configurationDataMap).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Entity',
            {
              fieldNames: new Set<string>(['object', 'b']),
              isRootNode: true,
              typeName: 'Entity',
              keys: [{ fieldName: '', selectionSet: 'object { id }' }],
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
      expect(y!.configurationDataMap).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id', 'object', 'c']),
              isRootNode: true,
              typeName: 'Entity',
              keys: [
                { fieldName: '', selectionSet: 'object { name }' },
                { fieldName: '', selectionSet: 'object { id }', disableEntityResolver: true },
                { fieldName: '', selectionSet: 'id object { nestedObject { id } }', disableEntityResolver: true },
                { fieldName: '', selectionSet: 'id object { name }', disableEntityResolver: true },
              ],
            },
          ],
          [
            'Object',
            {
              fieldNames: new Set<string>(['id', 'name', 'nestedObject']),
              isRootNode: false,
              typeName: 'Object',
            },
          ],
          [
            'NestedObject',
            {
              fieldNames: new Set<string>(['id']),
              isRootNode: false,
              typeName: 'NestedObject',
            },
          ],
        ]),
      );
    });

    test('that if a target key can be satisfied, it will included in the router configuration #2.4', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphX, subgraphY, subgraphW]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoSchemaQueryAndPersistedDirectiveDefinitions +
            `
        type Entity {
          a: Int!
          b: Boolean!
          c: Float!
          id: ID!
          object: Object!
        }
        
        type NestedObject {
          id: ID!
        }
        
        type Object {
          id: ID!
          name: String!
          nestedObject: NestedObject!
        }
        
        type Query {
          entities: [Entity!]!
        }
        
        scalar openfed__Scope
      `,
        ),
      );
      const w = federationResult?.subgraphConfigBySubgraphName.get('subgraph-w');
      expect(w).toBeDefined();
      const x = federationResult?.subgraphConfigBySubgraphName.get('subgraph-x');
      expect(x).toBeDefined();
      const y = federationResult?.subgraphConfigBySubgraphName.get('subgraph-y');
      expect(y).toBeDefined();
      expect(w!.configurationDataMap).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Query',
            {
              fieldNames: new Set<string>(['entities']),
              isRootNode: true,
              typeName: 'Query',
            },
          ],
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id', 'object', 'a']),
              isRootNode: true,
              typeName: 'Entity',
              keys: [
                { fieldName: '', selectionSet: 'id object { nestedObject { id } }' },
                { fieldName: '', selectionSet: 'id object { name }' },
                { fieldName: '', selectionSet: 'object { id }', disableEntityResolver: true },
                { fieldName: '', selectionSet: 'object { name }', disableEntityResolver: true },
              ],
            },
          ],
          [
            'Object',
            {
              fieldNames: new Set<string>(['id', 'name', 'nestedObject']),
              isRootNode: false,
              typeName: 'Object',
            },
          ],
          [
            'NestedObject',
            {
              fieldNames: new Set<string>(['id']),
              isRootNode: false,
              typeName: 'NestedObject',
            },
          ],
        ]),
      );
      expect(x!.configurationDataMap).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Entity',
            {
              fieldNames: new Set<string>(['object', 'b']),
              isRootNode: true,
              typeName: 'Entity',
              keys: [{ fieldName: '', selectionSet: 'object { id }' }],
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
      expect(y!.configurationDataMap).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id', 'object', 'c']),
              isRootNode: true,
              typeName: 'Entity',
              keys: [
                { fieldName: '', selectionSet: 'object { name }' },
                { fieldName: '', selectionSet: 'object { id }', disableEntityResolver: true },
                { fieldName: '', selectionSet: 'id object { nestedObject { id } }', disableEntityResolver: true },
                { fieldName: '', selectionSet: 'id object { name }', disableEntityResolver: true },
              ],
            },
          ],
          [
            'Object',
            {
              fieldNames: new Set<string>(['id', 'name', 'nestedObject']),
              isRootNode: false,
              typeName: 'Object',
            },
          ],
          [
            'NestedObject',
            {
              fieldNames: new Set<string>(['id']),
              isRootNode: false,
              typeName: 'NestedObject',
            },
          ],
        ]),
      );
    });

    test('that if a target key can be satisfied, it will included in the router configuration #2.5', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphY, subgraphW, subgraphX]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoSchemaQueryAndPersistedDirectiveDefinitions +
            `
        type Entity {
          a: Int!
          b: Boolean!
          c: Float!
          id: ID!
          object: Object!
        }
        
        type NestedObject {
          id: ID!
        }
        
        type Object {
          id: ID!
          name: String!
          nestedObject: NestedObject!
        }
        
        type Query {
          entities: [Entity!]!
        }
        
        scalar openfed__Scope
      `,
        ),
      );
      const w = federationResult?.subgraphConfigBySubgraphName.get('subgraph-w');
      expect(w).toBeDefined();
      const x = federationResult?.subgraphConfigBySubgraphName.get('subgraph-x');
      expect(x).toBeDefined();
      const y = federationResult?.subgraphConfigBySubgraphName.get('subgraph-y');
      expect(y).toBeDefined();
      expect(w!.configurationDataMap).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Query',
            {
              fieldNames: new Set<string>(['entities']),
              isRootNode: true,
              typeName: 'Query',
            },
          ],
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id', 'object', 'a']),
              isRootNode: true,
              typeName: 'Entity',
              keys: [
                { fieldName: '', selectionSet: 'id object { nestedObject { id } }' },
                { fieldName: '', selectionSet: 'id object { name }' },
                { fieldName: '', selectionSet: 'object { name }', disableEntityResolver: true },
                { fieldName: '', selectionSet: 'object { id }', disableEntityResolver: true },
              ],
            },
          ],
          [
            'Object',
            {
              fieldNames: new Set<string>(['id', 'name', 'nestedObject']),
              isRootNode: false,
              typeName: 'Object',
            },
          ],
          [
            'NestedObject',
            {
              fieldNames: new Set<string>(['id']),
              isRootNode: false,
              typeName: 'NestedObject',
            },
          ],
        ]),
      );
      expect(x!.configurationDataMap).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Entity',
            {
              fieldNames: new Set<string>(['object', 'b']),
              isRootNode: true,
              typeName: 'Entity',
              keys: [{ fieldName: '', selectionSet: 'object { id }' }],
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
      expect(y!.configurationDataMap).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id', 'object', 'c']),
              isRootNode: true,
              typeName: 'Entity',
              keys: [
                { fieldName: '', selectionSet: 'object { name }' },
                { fieldName: '', selectionSet: 'id object { nestedObject { id } }', disableEntityResolver: true },
                { fieldName: '', selectionSet: 'id object { name }', disableEntityResolver: true },
                { fieldName: '', selectionSet: 'object { id }', disableEntityResolver: true },
              ],
            },
          ],
          [
            'Object',
            {
              fieldNames: new Set<string>(['id', 'name', 'nestedObject']),
              isRootNode: false,
              typeName: 'Object',
            },
          ],
          [
            'NestedObject',
            {
              fieldNames: new Set<string>(['id']),
              isRootNode: false,
              typeName: 'NestedObject',
            },
          ],
        ]),
      );
    });

    test('that if a target key can be satisfied, it will included in the router configuration #2.6', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphY, subgraphX, subgraphW]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoSchemaQueryAndPersistedDirectiveDefinitions +
            `
        type Entity {
          a: Int!
          b: Boolean!
          c: Float!
          id: ID!
          object: Object!
        }
        
        type NestedObject {
          id: ID!
        }
        
        type Object {
          id: ID!
          name: String!
          nestedObject: NestedObject!
        }
        
        type Query {
          entities: [Entity!]!
        }
        
        scalar openfed__Scope
      `,
        ),
      );
      const w = federationResult?.subgraphConfigBySubgraphName.get('subgraph-w');
      expect(w).toBeDefined();
      const x = federationResult?.subgraphConfigBySubgraphName.get('subgraph-x');
      expect(x).toBeDefined();
      const y = federationResult?.subgraphConfigBySubgraphName.get('subgraph-y');
      expect(y).toBeDefined();
      expect(w!.configurationDataMap).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Query',
            {
              fieldNames: new Set<string>(['entities']),
              isRootNode: true,
              typeName: 'Query',
            },
          ],
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id', 'object', 'a']),
              isRootNode: true,
              typeName: 'Entity',
              keys: [
                { fieldName: '', selectionSet: 'id object { nestedObject { id } }' },
                { fieldName: '', selectionSet: 'id object { name }' },
                { fieldName: '', selectionSet: 'object { name }', disableEntityResolver: true },
                { fieldName: '', selectionSet: 'object { id }', disableEntityResolver: true },
              ],
            },
          ],
          [
            'Object',
            {
              fieldNames: new Set<string>(['id', 'name', 'nestedObject']),
              isRootNode: false,
              typeName: 'Object',
            },
          ],
          [
            'NestedObject',
            {
              fieldNames: new Set<string>(['id']),
              isRootNode: false,
              typeName: 'NestedObject',
            },
          ],
        ]),
      );
      expect(x!.configurationDataMap).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Entity',
            {
              fieldNames: new Set<string>(['object', 'b']),
              isRootNode: true,
              typeName: 'Entity',
              keys: [{ fieldName: '', selectionSet: 'object { id }' }],
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
      expect(y!.configurationDataMap).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id', 'object', 'c']),
              isRootNode: true,
              typeName: 'Entity',
              keys: [
                { fieldName: '', selectionSet: 'object { name }' },
                { fieldName: '', selectionSet: 'object { id }', disableEntityResolver: true },
                { fieldName: '', selectionSet: 'id object { nestedObject { id } }', disableEntityResolver: true },
                { fieldName: '', selectionSet: 'id object { name }', disableEntityResolver: true },
              ],
            },
          ],
          [
            'Object',
            {
              fieldNames: new Set<string>(['id', 'name', 'nestedObject']),
              isRootNode: false,
              typeName: 'Object',
            },
          ],
          [
            'NestedObject',
            {
              fieldNames: new Set<string>(['id']),
              isRootNode: false,
              typeName: 'NestedObject',
            },
          ],
        ]),
      );
    });
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

const subgraphI: Subgraph = {
  name: 'subgraph-i',
  url: '',
  definitions: parse(`
    type Query {
      entity: [Entity!]!
    }

    type Entity @key(fields: "id", resolvable: false) {
      id: ID!
      name: String!
    }
  `),
};

const subgraphJ: Subgraph = {
  name: 'subgraph-j',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      age: Int!
    }
  `),
};

const subgraphK: Subgraph = {
  name: 'subgraph-k',
  url: '',
  definitions: parse(`
    type Query {
      entity: [Entity!]!
    }
    
    type Entity {
      id: ID!
      name: String!
    }
  `),
};

const subgraphL: Subgraph = {
  name: 'subgraph-l',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") @key(fields: "object { id }") {
      id: ID!
      object: Object!
      age: Int!
    }
    
    type Object {
      id: ID!
      name: String!
    }
  `),
};

const subgraphM: Subgraph = {
  name: 'subgraph-m',
  url: '',
  definitions: parse(`
    type Query @shareable {
      entity: [Entity!]!
    }
    
    type Entity {
      id: ID!
      object: Object!
      age: Int!
    }
    
    type Object {
      id: ID!
      name: String!
    }
  `),
};

const subgraphN: Subgraph = {
  name: 'subgraph-n',
  url: '',
  definitions: parse(`
    type Query {
      entity: [Entity!]!
    }
    
    type Entity {
      id: ID! @external
      name: String!
    }
  `),
};

const subgraphO: Subgraph = {
  name: 'subgraph-o',
  url: '',
  definitions: parse(`
    type Query {
      entity: [Entity!]!
    }
    
    type Entity {
      object: Object!
      name: String!
    }
    
    type Object {
      id: ID!
      nestedObject: NestedObject!
    }
    
    type NestedObject {
      id: ID!
    }
  `),
};

const subgraphP: Subgraph = {
  name: 'subgraph-p',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") @key(fields: "name") {
      id: ID!
      name: String!
      age: Int!
    }
  `),
};

const subgraphQ: Subgraph = {
  name: 'subgraph-q',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "object { id nestedObject { id } }") @key(fields: "object { nestedObject { name } }") {
      object: Object!
      isEntity: Boolean!
    }
    
    type Object {
      id: ID!
      nestedObject: NestedObject!
    }
    
    type NestedObject {
      id: ID!
      name: String!
    }
  `),
};

const subgraphR: Subgraph = {
  name: 'subgraph-r',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      property: String!
    }
  `),
};

const subgraphS: Subgraph = {
  name: 'subgraph-s',
  url: '',
  definitions: parse(`
    type Query {
      entities: [Entity!]!
    }
    
    type Entity @key(fields: "id", resolvable: false) @key(fields: "property") {
      id: ID!
      property: String!
    }
  `),
};

const subgraphT: Subgraph = {
  name: 'subgraph-t',
  url: '',
  definitions: parse(`
    type Query {
      entities: [Entity!]!
    }
    
    type Entity @key(unknownArgument: 1, duplicateUnknownArgument: false, duplicateUnknownArgument: "string") @key(fields: "id", fields: "property") {
      id: ID!
      property: String!
    }
  `),
};

const subgraphU: Subgraph = {
  name: 'subgraph-u',
  url: '',
  definitions: parse(`
    type Query {
      entities: [Entity!]!
    }
    
    type Entity @key(fields: "id, name") {
      id: ID!
      name: String!
      a: Int!
    }
  `),
};

const subgraphV: Subgraph = {
  name: 'subgraph-v',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "name") {
      name: String!
      b: Boolean!
    }
  `),
};

const subgraphW: Subgraph = {
  name: 'subgraph-w',
  url: '',
  definitions: parse(`
    type Query {
      entities: [Entity!]!
    }
    
    type Entity @key(fields: "id object { nestedObject { id } }") @key(fields: "id object { name }") {
      id: ID!
      object: Object!
      a: Int!
    }
    
    type Object {
      id: ID! @shareable
      name: String!
      nestedObject: NestedObject!
    }
    
    type NestedObject {
      id: ID!
    }
  `),
};

const subgraphX: Subgraph = {
  name: 'subgraph-x',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "object { id }") {
      object: Object!
      b: Boolean!
    }
    
    type Object {
      id: ID!
    }
  `),
};

const subgraphY: Subgraph = {
  name: 'subgraph-y',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "object { name }") {
      id: ID! @shareable
      object: Object!
      c: Float!
    }
    
    type Object {
      id: ID! @shareable
      name: String!
      nestedObject: NestedObject! @shareable
    }
    
    type NestedObject {
      id: ID! @shareable
    }
  `),
};
