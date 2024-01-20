import {
  ConfigurationData,
  federateSubgraphs,
  FieldContainer,
  ObjectContainer,
  RootTypeFieldData,
  shareableFieldDefinitionsError,
  Subgraph,
  unresolvableFieldError,
} from '../src';
import { describe, expect, test } from 'vitest';
import { documentNodeToNormalizedString, normalizeString, versionOnePersistedBaseSchema } from './utils/utils';
import { parse } from 'graphql';

describe('Entity Tests', () => {
  describe('Entity Federation Tests', () => {
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
          'Trainer',
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
      const federatedGraph = federationResult!.federatedGraphAST;
      expect(documentNodeToNormalizedString(federatedGraph)).toBe(
        normalizeString(
          versionOnePersistedBaseSchema +
            `
      interface Interface {
        id: ID!
        name: String!
        age: Int!
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
        shareableFieldDefinitionsError(
          {
            node: { name: { value: 'Entity' } },
            fields: new Map<string, FieldContainer>([
              [
                'id',
                {
                  node: { name: { value: 'id' } },
                  subgraphsByShareable: new Map<string, boolean>([
                    ['subgraph-l', true],
                    ['subgraph-m', false],
                  ]),
                } as FieldContainer,
              ],
              [
                'object',
                {
                  node: { name: { value: 'object' } },
                  subgraphsByShareable: new Map<string, boolean>([
                    ['subgraph-l', true],
                    ['subgraph-m', false],
                  ]),
                } as FieldContainer,
              ],
              [
                'age',
                {
                  node: { name: { value: 'age' } },
                  subgraphsByShareable: new Map<string, boolean>([
                    ['subgraph-l', true],
                    ['subgraph-m', false],
                  ]),
                } as FieldContainer,
              ],
            ]),
          } as ObjectContainer,
          new Set<string>(['id', 'object', 'age']),
        ),
      );
      expect(errors![1]).toStrictEqual(
        shareableFieldDefinitionsError(
          {
            node: { name: { value: 'Object' } },
            fields: new Map<string, FieldContainer>([
              [
                'id',
                {
                  node: { name: { value: 'id' } },
                  subgraphsByShareable: new Map<string, boolean>([
                    ['subgraph-l', true],
                    ['subgraph-m', false],
                  ]),
                } as FieldContainer,
              ],
              [
                'name',
                {
                  node: { name: { value: 'name' } },
                  subgraphsByShareable: new Map<string, boolean>([
                    ['subgraph-l', true],
                    ['subgraph-m', false],
                  ]),
                } as FieldContainer,
              ],
            ]),
          } as ObjectContainer,
          new Set<string>(['id', 'name']),
        ),
      );
    });
  });

  describe('Entity Configuration Tests', () => {
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
