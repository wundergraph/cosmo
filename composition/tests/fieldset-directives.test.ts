import { describe, expect, test } from 'vitest';
import {
  abstractTypeInKeyFieldSetErrorMessage,
  argumentsInKeyFieldSetErrorMessage,
  ConditionalFieldData,
  ConfigurationData,
  duplicateFieldInFieldSetErrorMessage,
  federateSubgraphs,
  FieldSetDirective,
  INTERFACE,
  invalidInlineFragmentTypeConditionErrorMessage,
  invalidInlineFragmentTypeErrorMessage,
  invalidKeyDirectivesError,
  invalidProvidesOrRequiresDirectivesError,
  invalidSelectionOnUnionErrorMessage,
  invalidSelectionSetDefinitionErrorMessage,
  invalidSelectionSetErrorMessage,
  nonExternalConditionalFieldError,
  nonExternalConditionalFieldWarning,
  normalizeSubgraph,
  normalizeSubgraphFromString,
  OBJECT,
  parse,
  PROVIDES,
  REQUIRES,
  SCALAR,
  Subgraph,
  undefinedFieldInFieldSetErrorMessage,
  unexpectedArgumentErrorMessage,
  UNION,
  unparsableFieldSetErrorMessage,
} from '../src';
import {
  normalizeString,
  schemaQueryDefinition,
  schemaToSortedNormalizedString,
  versionTwoDirectiveDefinitions,
} from './utils/utils';

describe('openfed_FieldSet tests', () => {
  describe('@key FieldSets', () => {
    test('that a complex key FieldSet is validated', () => {
      const { errors, normalizationResult } = normalizeSubgraphFromString(`
      scalar DateTime
      
      type Rating {
        comments: [PostBody]
        stars: Float!
      }
      
      type PostBody {
        author: String!
        date: DateTime!
        content: String!
      }

      type Post {
        title: String!
        body: PostBody!
        rating: Rating
      }

      type Entity @key(fields: """
        posts {
          rating {
            stars,
            comments {
              content,
              author
            },
          },
          title,
          body {
            author,
            date,
            content,
          },
        },
        name,
        id,
      """) {
        id: String!
        name: String!
        posts: [Post]
      }
    `);
      expect(errors).toBeUndefined();
    });

    test('that referencing undefined arguments in the FieldSet returns an error', () => {
      const { errors } = normalizeSubgraphFromString(`
      type Entity @key(fields: "id(undefinedArg: \\"hi\\")") {
        id: ID!
      }
    `);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        invalidKeyDirectivesError('Entity', [
          unexpectedArgumentErrorMessage(`id(undefinedArg: "hi")`, 'Entity.id', 'undefinedArg'),
        ]),
      );
    });

    test('that referencing defined arguments in the FieldSet returns an error', () => {
      const { errors } = normalizeSubgraphFromString(`
      type Entity @key(fields: "id(undefinedArg: \\"hi\\")") {
        id(undefinedArg: String!): ID!
      }
    `);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        invalidKeyDirectivesError('Entity', [
          argumentsInKeyFieldSetErrorMessage(`id(undefinedArg: "hi")`, 'Entity.id'),
        ]),
      );
    });

    test('that including a field that defines an argument in the FieldSet returns an error', () => {
      const { errors } = normalizeSubgraphFromString(`
      type Entity @key(fields: "id") {
        id(undefinedArg: String!): ID!
      }
    `);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        invalidKeyDirectivesError('Entity', [argumentsInKeyFieldSetErrorMessage(`id`, 'Entity.id')]),
      );
    });

    test('that including an undefined field in the FieldSet returns an error', () => {
      const { errors } = normalizeSubgraphFromString(`
      type Entity @key(fields: "name") {
        id: ID!
      }
    `);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        invalidKeyDirectivesError('Entity', [undefinedFieldInFieldSetErrorMessage(`name`, 'Entity', 'name')]),
      );
    });

    test('that including an interface in the FieldSet returns an error', () => {
      const { errors } = normalizeSubgraph(subgraphL.definitions, subgraphL.name);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        invalidKeyDirectivesError('Entity', [
          abstractTypeInKeyFieldSetErrorMessage(`id`, 'Entity.id', INTERFACE, INTERFACE),
        ]),
      );
    });

    test('that including a union in the FieldSet returns an error', () => {
      const { errors } = normalizeSubgraphFromString(`
      type Entity @key(fields: "id") {
        id: Union!
      }
      
      type ObjectOne {
        name: String!
      }
      
      type ObjectTwo {
        name: String!
      }
      
      union Union = ObjectOne | ObjectTwo
    `);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        invalidKeyDirectivesError('Entity', [abstractTypeInKeyFieldSetErrorMessage(`id`, 'Entity.id', UNION, UNION)]),
      );
    });

    test('that an empty key returns a parse error', () => {
      const { errors } = normalizeSubgraphFromString(`
      type Entity @key(fields: "") {
        id: ID!
      }
    `);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        invalidKeyDirectivesError('Entity', [
          unparsableFieldSetErrorMessage('', new Error(`Syntax Error: Expected Name, found "}".`)),
        ]),
      );
    });

    test('that an empty slection set returns a parse error', () => {
      const { errors } = normalizeSubgraphFromString(`
      type Entity @key(fields: "id { }") {
        id: Object!
      }
      
      type Object {
        name: String!
      }  
    `);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        invalidKeyDirectivesError('Entity', [
          unparsableFieldSetErrorMessage('id { }', new Error(`Syntax Error: Expected Name, found "}".`)),
        ]),
      );
    });

    test('that a consecutive selection set returns a parse error', () => {
      const { errors } = normalizeSubgraphFromString(`
      type Entity @key(fields: "id { { name } }") {
        id: Object!
      }
      
      type Object {
        name: String!
      }  
    `);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        invalidKeyDirectivesError('Entity', [
          unparsableFieldSetErrorMessage('id { { name } }', new Error(`Syntax Error: Expected Name, found "{".`)),
        ]),
      );
    });

    test('that a selection set on a type without fields returns an error', () => {
      const { errors } = normalizeSubgraphFromString(`
      type Entity @key(fields: "id { something }") {
        id: ID!
      }
    `);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        invalidKeyDirectivesError('Entity', [
          invalidSelectionSetDefinitionErrorMessage('id { something }', ['Entity.id'], 'ID', SCALAR),
        ]),
      );
    });

    test('that an object-like without a selection set returns an error', () => {
      const { errors } = normalizeSubgraphFromString(`
      type Entity @key(fields: "id") {
        id: Object!
      }
      
      type Object {
        name: String!
      }  
    `);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        invalidKeyDirectivesError('Entity', [invalidSelectionSetErrorMessage('id', ['Entity.id'], OBJECT, OBJECT)]),
      );
    });

    test('that a nested object-like without a selection set returns an error', () => {
      const { errors } = normalizeSubgraphFromString(`
      type Entity @key(fields: "id { object { object } }") {
        id: Object!
      }
      
      type Object {
        object: AnotherObject!
      }
      
      type AnotherObject {
        object: YetAnotherObject!
      }
      
      type YetAnotherObject {
        name: String!
      }
    `);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        invalidKeyDirectivesError('Entity', [
          invalidSelectionSetErrorMessage(
            'id { object { object } }',
            ['AnotherObject.object'],
            'YetAnotherObject',
            OBJECT,
          ),
        ]),
      );
    });

    test('that a duplicated field returns an error', () => {
      const { errors } = normalizeSubgraphFromString(`
      type Entity @key(fields: "id name age size id") {
        id: ID!
        name: String!
        age: Int!
        size: Float!
      }
    `);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        invalidKeyDirectivesError('Entity', [duplicateFieldInFieldSetErrorMessage('id name age size id', 'Entity.id')]),
      );
    });

    test('that a duplicated nested field returns an error', () => {
      const { errors } = normalizeSubgraphFromString(`
      type Entity @key(fields: "id { object { object { name } object { name } } }") {
        id: Object!
      }
      
      type Object {
        object: AnotherObject!
      }
      
      type AnotherObject {
        object: YetAnotherObject!
      }
      
      type YetAnotherObject {
        name: String!
      }
    `);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        invalidKeyDirectivesError('Entity', [
          duplicateFieldInFieldSetErrorMessage(
            'id { object { object { name } object { name } } }',
            'AnotherObject.object',
          ),
        ]),
      );
    });
  });

  describe('@provides FieldSets', () => {
    // TODO will be addressed with external validation changes
    test.skip('that a @provides directive is ignored when declared on a non-entity response type', () => {
      const { errors, normalizationResult } = normalizeSubgraphFromString(`
        type Object {
          id: ID! @provides(fields: "name")
        }
      `);
      expect(errors).toBeUndefined();
      expect(normalizationResult).toBeDefined();
      expect(normalizationResult!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
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

    test('that a @provides FieldSet supports an immediate inline fragment', () => {
      const { errors, normalizationResult } = normalizeSubgraphFromString(`
        type Object {
          entity: Entity! @provides(fields: "... on Entity { name }")
        }
        
        type Entity @key(fields: "id") {
          id: ID!
          name: String! @external
        }
      `);
      expect(errors).toBeUndefined();
      expect(normalizationResult).toBeDefined();
      expect(normalizationResult!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Object',
            {
              fieldNames: new Set<string>(['entity']),
              isRootNode: false,
              provides: [{ fieldName: 'entity', selectionSet: '... on Entity { name }' }],
              typeName: 'Object',
            },
          ],
          [
            'Entity',
            {
              externalFieldNames: new Set<string>(['name']),
              fieldNames: new Set<string>(['id']),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'id' }],
              typeName: 'Entity',
            },
          ],
        ]),
      );
    });

    test('that a @provides FieldSet returns an error for an invalid inline fragment', () => {
      const { errors, normalizationResult } = normalizeSubgraphFromString(`
        type Object {
          id: ID!
          entity: Entity! @provides(fields: "... on I { name }")
        }
        
        type Entity @key(fields: "id") {
          id: ID!
          name: String!
        }

        interface I {
          name: String!
        }
      `);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        invalidProvidesOrRequiresDirectivesError(PROVIDES, [
          ` On "Object.entity" —` +
            invalidInlineFragmentTypeErrorMessage('... on I { name }', ['Object.entity'], 'I', 'Entity'),
        ]),
      );
    });

    test('that a @provides FieldSet supports multiple inline fragments', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphM.definitions, subgraphM.name);
      expect(errors).toBeUndefined();
      expect(normalizationResult).toBeDefined();
      expect(normalizationResult!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Object',
            {
              fieldNames: new Set<string>(['entity']),
              isRootNode: false,
              provides: [{ fieldName: 'entity', selectionSet: 'interface { ... on I { ... on I { name } } }' }],
              typeName: 'Object',
            },
          ],
          [
            'Entity',
            {
              externalFieldNames: new Set<string>(['interface']),
              fieldNames: new Set<string>(['id']),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'id' }],
              typeName: 'Entity',
            },
          ],
          [
            'I',
            {
              fieldNames: new Set<string>(['name']),
              isRootNode: false,
              typeName: 'I',
            },
          ],
          [
            'Implementation',
            {
              fieldNames: new Set<string>(['name']),
              isRootNode: false,
              typeName: 'Implementation',
            },
          ],
        ]),
      );
    });

    test('that a @provides FieldSet supports an inline fragment with a valid type condition', () => {
      const { errors, normalizationResult } = normalizeSubgraphFromString(`
        type Object {
          entity: Entity! @provides(fields: "interface { ... on AnotherObject { name } }")
        }
        
        type Entity @key(fields: "id") {
          id: ID!
          interface: I! @external
        }
        
        interface I {
          name: String!
        }
        
        type AnotherObject implements I {
          name: String!
        }
      `);
      expect(errors).toBeUndefined();
      expect(normalizationResult).toBeDefined();
      expect(normalizationResult!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Object',
            {
              fieldNames: new Set<string>(['entity']),
              isRootNode: false,
              provides: [{ fieldName: 'entity', selectionSet: 'interface { ... on AnotherObject { name } }' }],
              typeName: 'Object',
            },
          ],
          [
            'Entity',
            {
              externalFieldNames: new Set<string>(['interface']),
              fieldNames: new Set<string>(['id']),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'id' }],
              typeName: 'Entity',
            },
          ],
          [
            'I',
            {
              fieldNames: new Set<string>(['name']),
              isRootNode: false,
              typeName: 'I',
            },
          ],
          [
            'AnotherObject',
            {
              fieldNames: new Set<string>(['name']),
              isRootNode: false,
              typeName: 'AnotherObject',
            },
          ],
        ]),
      );
    });

    test('that a @provides FieldSet returns an error for an inline fragment with an invalid type condition on an interface', () => {
      const { errors } = normalizeSubgraph(subgraphN.definitions, subgraphN.name);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        invalidProvidesOrRequiresDirectivesError(PROVIDES, [
          ` On "Object.entity" —` +
            invalidInlineFragmentTypeConditionErrorMessage(
              'interface { ... on AnotherObject { name } }',
              ['Entity.interface'],
              'AnotherObject',
              INTERFACE,
              'I',
            ),
        ]),
      );
    });

    test('that a @provides FieldSet supports an inline fragment with a valid type condition on a union', () => {
      const { errors, normalizationResult } = normalizeSubgraphFromString(`
        type Object {
          entity: Entity! @provides(fields: "union { ... on AnotherObject { name } }")
        }

        type Entity @key(fields: "id") {
          id: ID!
          union: U! @external
        }
        
        union U = AnotherObject
        
        type AnotherObject {
          name: String!
        }
      `);
      expect(errors).toBeUndefined();
      expect(normalizationResult).toBeDefined();
      expect(normalizationResult!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Object',
            {
              fieldNames: new Set<string>(['entity']),
              isRootNode: false,
              provides: [{ fieldName: 'entity', selectionSet: 'union { ... on AnotherObject { name } }' }],
              typeName: 'Object',
            },
          ],
          [
            'Entity',
            {
              externalFieldNames: new Set<string>(['union']),
              fieldNames: new Set<string>(['id']),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'id' }],
              typeName: 'Entity',
            },
          ],
          [
            'AnotherObject',
            {
              fieldNames: new Set<string>(['name']),
              isRootNode: false,
              typeName: 'AnotherObject',
            },
          ],
        ]),
      );
    });

    test('that a @provides FieldSet returns an error if a union does not define a fragment', () => {
      const { errors } = normalizeSubgraphFromString(`
        type Object {
          entity: Entity! @provides(fields: "union { name }")
        }

        type Entity @key(fields: "id") {
          id: ID!
          union: U! @external
        }
        
        union U = AnotherObject
        
        type AnotherObject {
          name: String!
        }
      `);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        invalidProvidesOrRequiresDirectivesError(PROVIDES, [
          ` On "Object.entity" —` + invalidSelectionOnUnionErrorMessage('union { name }', ['Entity.union'], 'U'),
        ]),
      );
    });

    test('that a @provides FieldSet returns an error for an inline fragment with an invalid type condition on a union', () => {
      const { errors } = normalizeSubgraphFromString(`
        type Object {
          entity: Entity! @provides(fields: "union { ... on YetAnotherObject { name } }")
        }

        type Entity @key(fields: "id") {
          id: ID!
          union: U! @external
        }
        
        union U = AnotherObject
        
        type AnotherObject {
          name: String!
        }
        
        type YetAnotherObject {
          name: String!
        }
      `);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        invalidProvidesOrRequiresDirectivesError(PROVIDES, [
          ` On "Object.entity" —` +
            invalidInlineFragmentTypeConditionErrorMessage(
              'union { ... on YetAnotherObject { name } }',
              ['Entity.union'],
              'YetAnotherObject',
              UNION,
              'U',
            ),
        ]),
      );
    });

    test('that a @provides FieldSet allows undefined optional arguments', () => {
      const { errors, normalizationResult } = normalizeSubgraphFromString(`
        type Object {
          entity: Entity! @provides(fields: "anotherObject { name }")
        }
        type Entity @key(fields: "id") {
          id: ID!
          anotherObject(arg: String): AnotherObject! @external
        }
 
        type AnotherObject {
          name: String!
        }
      `);
      expect(errors).toBeUndefined();
      expect(normalizationResult).toBeDefined();
      expect(normalizationResult!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Object',
            {
              fieldNames: new Set<string>(['entity']),
              isRootNode: false,
              provides: [{ fieldName: 'entity', selectionSet: 'anotherObject { name }' }],
              typeName: 'Object',
            },
          ],
          [
            'Entity',
            {
              externalFieldNames: new Set<string>(['anotherObject']),
              fieldNames: new Set<string>(['id']),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'id' }],
              typeName: 'Entity',
            },
          ],
          [
            'AnotherObject',
            {
              fieldNames: new Set<string>(['name']),
              isRootNode: false,
              typeName: 'AnotherObject',
            },
          ],
        ]),
      );
    });

    test('that a @provides FieldSet allows defined optional arguments', () => {
      const { errors, normalizationResult } = normalizeSubgraphFromString(`
        type Object {
          entity: Entity! @provides(fields: "anotherObject(arg: \\"string\\") { name }")
        }
        type Entity @key(fields: "id") {
          id: ID!
          anotherObject(arg: String): AnotherObject! @external
        }
 
        type AnotherObject {
          name: String!
        }
      `);
      expect(errors).toBeUndefined();
      expect(normalizationResult).toBeDefined();
      expect(normalizationResult!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Object',
            {
              fieldNames: new Set<string>(['entity']),
              isRootNode: false,
              provides: [{ fieldName: 'entity', selectionSet: 'anotherObject(arg: "string") { name }' }],
              typeName: 'Object',
            },
          ],
          [
            'Entity',
            {
              externalFieldNames: new Set<string>(['anotherObject']),
              fieldNames: new Set<string>(['id']),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'id' }],
              typeName: 'Entity',
            },
          ],
          [
            'AnotherObject',
            {
              fieldNames: new Set<string>(['name']),
              isRootNode: false,
              typeName: 'AnotherObject',
            },
          ],
        ]),
      );
    });

    test('that a @provides directive produces the correct conditional field datas', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphA.definitions, subgraphA.name);
      expect(errors).toBeUndefined();
      expect(normalizationResult!.conditionalFieldDataByCoordinates).toStrictEqual(
        new Map<string, ConditionalFieldData>([
          [
            'NestedObject.age',
            {
              providedBy: [
                {
                  fieldCoordinatesPath: ['Query.entity', 'Entity.object', 'Object.nestedObject', 'NestedObject.age'],
                  fieldPath: ['entity', 'object', 'nestedObject', 'age'],
                },
                {
                  fieldCoordinatesPath: ['Query.entities', 'Entity.object', 'Object.nestedObject', 'NestedObject.age'],
                  fieldPath: ['entities', 'object', 'nestedObject', 'age'],
                },
              ],
              requiredBy: [],
            },
          ],
          [
            'NestedObject.name',
            {
              providedBy: [
                {
                  fieldCoordinatesPath: ['Query.entity', 'Entity.object', 'Object.nestedObject', 'NestedObject.name'],
                  fieldPath: ['entity', 'object', 'nestedObject', 'name'],
                },
                {
                  fieldCoordinatesPath: ['Query.entities', 'Entity.object', 'Object.nestedObject', 'NestedObject.name'],
                  fieldPath: ['entities', 'object', 'nestedObject', 'name'],
                },
              ],
              requiredBy: [],
            },
          ],
        ]),
      );
    });

    test('that a @provides directive on a renamed root type produces the correct conditional field datas', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphB.definitions, subgraphB.name);
      expect(errors).toBeUndefined();
      expect(normalizationResult!.conditionalFieldDataByCoordinates).toStrictEqual(
        new Map<string, ConditionalFieldData>([
          [
            'NestedObject.age',
            {
              providedBy: [
                {
                  fieldCoordinatesPath: ['Query.entity', 'Entity.object', 'Object.nestedObject', 'NestedObject.age'],
                  fieldPath: ['entity', 'object', 'nestedObject', 'age'],
                },
                {
                  fieldCoordinatesPath: ['Query.entities', 'Entity.object', 'Object.nestedObject', 'NestedObject.age'],
                  fieldPath: ['entities', 'object', 'nestedObject', 'age'],
                },
              ],
              requiredBy: [],
            },
          ],
          [
            'NestedObject.name',
            {
              providedBy: [
                {
                  fieldCoordinatesPath: ['Query.entity', 'Entity.object', 'Object.nestedObject', 'NestedObject.name'],
                  fieldPath: ['entity', 'object', 'nestedObject', 'name'],
                },
                {
                  fieldCoordinatesPath: ['Query.entities', 'Entity.object', 'Object.nestedObject', 'NestedObject.name'],
                  fieldPath: ['entities', 'object', 'nestedObject', 'name'],
                },
              ],
              requiredBy: [],
            },
          ],
        ]),
      );
    });

    test('that an error is returned if provided field in a v2 subgraph is not @external and has no @external ancestor', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphC.definitions, subgraphC.name);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(4);
      expect(errors![0]).toStrictEqual(
        nonExternalConditionalFieldError(
          `Query.entity`,
          `subgraph-c`,
          `NestedObject.age`,
          `object { nestedObject { age name } }`,
          FieldSetDirective.PROVIDES,
        ),
      );
      expect(errors![1]).toStrictEqual(
        nonExternalConditionalFieldError(
          `Query.entity`,
          `subgraph-c`,
          `NestedObject.name`,
          `object { nestedObject { age name } }`,
          FieldSetDirective.PROVIDES,
        ),
      );
      expect(errors![2]).toStrictEqual(
        nonExternalConditionalFieldError(
          `Query.entities`,
          `subgraph-c`,
          `NestedObject.age`,
          `object { nestedObject { age name } }`,
          FieldSetDirective.PROVIDES,
        ),
      );
      expect(errors![3]).toStrictEqual(
        nonExternalConditionalFieldError(
          `Query.entities`,
          `subgraph-c`,
          `NestedObject.name`,
          `object { nestedObject { age name } }`,
          FieldSetDirective.PROVIDES,
        ),
      );
    });

    // TODO
    test.skip('that provides on interface is valid', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphI, subgraphJ, subgraphK]);
      expect(errors).toBeUndefined();
    });

    // TODO
    test.skip('that an error is returned if a field is part of both a @provides and @key FieldSet', () => {});
  });

  describe('@requires FieldSets', () => {
    // todo
    test('that a @requires directive is ignored when declared on a non-entity parent', () => {
      const { errors, normalizationResult } = normalizeSubgraphFromString(`
        type Object {
          id: ID!
          name: Object! @requires(fields: "id")
        }
      `);
      expect(errors).toBeUndefined();
      expect(normalizationResult).toBeDefined();
      expect(normalizationResult!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
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

    test('that a @requires FieldSet supports an immediate inline fragment', () => {
      const { errors, normalizationResult } = normalizeSubgraphFromString(`
        type Entity @key(fields: "id") {
          id: ID!
          name: String! @external
          age: Int! @requires(fields: "... on Entity { name }")
        }
      `);
      expect(errors).toBeUndefined();
      expect(normalizationResult).toBeDefined();
      expect(normalizationResult!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Entity',
            {
              externalFieldNames: new Set<string>(['name']),
              fieldNames: new Set<string>(['id', 'age']),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'id' }],
              requires: [{ fieldName: 'age', selectionSet: '... on Entity { name }' }],
              typeName: 'Entity',
            },
          ],
        ]),
      );
    });

    test('that a @requires FieldSet returns an error for an invalid inline fragment', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphO.definitions, subgraphO.name);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        invalidProvidesOrRequiresDirectivesError(REQUIRES, [
          ` On "Entity.age" —` + invalidInlineFragmentTypeErrorMessage('... on I { name }', [], 'I', 'Entity'),
        ]),
      );
    });

    test('that a @requires FieldSet supports multiple inline fragments', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphP.definitions, subgraphP.name);
      expect(errors).toBeUndefined();
      expect(normalizationResult).toBeDefined();
      expect(normalizationResult!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Entity',
            {
              externalFieldNames: new Set<string>(['name']),
              fieldNames: new Set<string>(['id', 'age']),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'id' }],
              requires: [{ fieldName: 'age', selectionSet: 'name { ... on I { ... on I { name } } }' }],
              typeName: 'Entity',
            },
          ],
          [
            'I',
            {
              fieldNames: new Set<string>(['name']),
              isRootNode: false,
              typeName: 'I',
            },
          ],
          [
            'Object',
            {
              fieldNames: new Set<string>(['name']),
              isRootNode: false,
              typeName: 'Object',
            },
          ],
        ]),
      );
    });

    test('that a @requires FieldSet supports an inline fragment with a valid type condition', () => {
      const { errors, normalizationResult } = normalizeSubgraphFromString(`
        type Entity @key(fields: "id") {
          id: ID!
          interface: I! @external
          age: Int! @requires(fields: "interface { ... on Object { age } }")
        }
        
        interface I {
          name: String!
        }
        
        type Object implements I {
          name: String!
          age: Int!
        }  
      `);
      expect(errors).toBeUndefined();
      expect(normalizationResult).toBeDefined();
      expect(normalizationResult!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Entity',
            {
              externalFieldNames: new Set<string>(['interface']),
              fieldNames: new Set<string>(['id', 'age']),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'id' }],
              requires: [{ fieldName: 'age', selectionSet: 'interface { ... on Object { age } }' }],
              typeName: 'Entity',
            },
          ],
          [
            'I',
            {
              fieldNames: new Set<string>(['name']),
              isRootNode: false,
              typeName: 'I',
            },
          ],
          [
            'Object',
            {
              fieldNames: new Set<string>(['name', 'age']),
              isRootNode: false,
              typeName: 'Object',
            },
          ],
        ]),
      );
    });

    test('that a @requires FieldSet returns an error for an inline fragment with an invalid type condition on an interface', () => {
      const { errors } = normalizeSubgraph(subgraphQ.definitions, subgraphQ.name);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        invalidProvidesOrRequiresDirectivesError(REQUIRES, [
          ` On "Entity.age" —` +
            invalidInlineFragmentTypeConditionErrorMessage(
              'interface { ... on Object { age } }',
              ['Entity.interface'],
              OBJECT,
              INTERFACE,
              'I',
            ),
        ]),
      );
    });

    test('that a @requires FieldSet supports an inline fragment with a valid type condition on a union', () => {
      const { errors, normalizationResult } = normalizeSubgraphFromString(`
        type Entity @key(fields: "id") {
          id: ID!
          union: U! @external
          age: Int! @requires(fields: "union { ... on Object { age } }")
        }
        
        union U = Object
        
        type Object {
          name: String!
          age: Int!
        }  
      `);
      expect(errors).toBeUndefined();
      expect(normalizationResult).toBeDefined();
      expect(normalizationResult!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Entity',
            {
              externalFieldNames: new Set<string>(['union']),
              fieldNames: new Set<string>(['id', 'age']),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'id' }],
              requires: [{ fieldName: 'age', selectionSet: 'union { ... on Object { age } }' }],
              typeName: 'Entity',
            },
          ],
          [
            'Object',
            {
              fieldNames: new Set<string>(['name', 'age']),
              isRootNode: false,
              typeName: 'Object',
            },
          ],
        ]),
      );
    });

    test('that a @requires FieldSet returns an error if a union does not define a fragment', () => {
      const { errors } = normalizeSubgraphFromString(`
        type Entity @key(fields: "id") {
          id: ID!
          union: U @external
          name: String! @requires(fields: "union { name }")
        }
        
        union U = Object
        
        type Object {
          name: String!
        }
      `);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        invalidProvidesOrRequiresDirectivesError(REQUIRES, [
          ` On "Entity.name" —` + invalidSelectionOnUnionErrorMessage('union { name }', ['Entity.union'], 'U'),
        ]),
      );
    });

    test('that a @requires FieldSet returns an error for an inline fragment with an invalid type condition on a union', () => {
      const { errors } = normalizeSubgraphFromString(`
        type Entity @key(fields: "id") {
          id: ID!
          union: U! @external
          age: Int! @requires(fields: "union { ... on AnotherObject { age } }")
        }
        
        union U = Object
        
        type Object {
          name: String!
          age: Int!
        }
        
        type AnotherObject {
          name: String!
        }
      `);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        invalidProvidesOrRequiresDirectivesError(REQUIRES, [
          ` On "Entity.age" —` +
            invalidInlineFragmentTypeConditionErrorMessage(
              'union { ... on AnotherObject { age } }',
              ['Entity.union'],
              'AnotherObject',
              UNION,
              'U',
            ),
        ]),
      );
    });

    test('that a @requires FieldSet allows undefined optional arguments', () => {
      const { errors, normalizationResult } = normalizeSubgraphFromString(`
        type Entity @key(fields: "id") {
          id: ID!
          object(arg: String): Object! @external
          age: Int! @requires(fields: "object { name }")
        }
 
        type Object {
          name: String!
        }
      `);
      expect(errors).toBeUndefined();
      expect(normalizationResult).toBeDefined();
      expect(normalizationResult!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Entity',
            {
              externalFieldNames: new Set<string>(['object']),
              fieldNames: new Set<string>(['id', 'age']),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'id' }],
              requires: [{ fieldName: 'age', selectionSet: 'object { name }' }],
              typeName: 'Entity',
            },
          ],
          [
            'Object',
            {
              fieldNames: new Set<string>(['name']),
              isRootNode: false,
              typeName: 'Object',
            },
          ],
        ]),
      );
    });

    test('that a @requires FieldSet allows defined optional arguments', () => {
      const { errors, normalizationResult } = normalizeSubgraphFromString(`
        type Entity @key(fields: "id") {
          id: ID!
          object(arg: String): Object! @external
          age: Int! @requires(fields: "object(arg: \\"string\\") { name }")
        }
 
        type Object {
          name: String!
        }
      `);
      expect(errors).toBeUndefined();
      expect(normalizationResult).toBeDefined();
      expect(normalizationResult!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Entity',
            {
              externalFieldNames: new Set<string>(['object']),
              fieldNames: new Set<string>(['id', 'age']),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'id' }],
              requires: [{ fieldName: 'age', selectionSet: 'object(arg: "string") { name }' }],
              typeName: 'Entity',
            },
          ],
          [
            'Object',
            {
              fieldNames: new Set<string>(['name']),
              isRootNode: false,
              typeName: 'Object',
            },
          ],
        ]),
      );
    });

    test('that a @requires FieldSet allows inline fragments #1', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphH.definitions, subgraphH.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            versionTwoDirectiveDefinitions +
            `
            type Entity @key(fields: "id") {
              id: ID!
              interface: InterfaceOne @external
              requirerOne: String! @requires(
                fields: """
                interface {
                  ... on InterfaceTwo {
                    ... on ObjectOne {
                      isObjectOne
                    }
                    name
                    ... on ObjectTwo {
                      isObjectTwo
                    }
                  }
                  age
                }
                """
              )
              requirerTwo: String! @requires(
                fields: """
                interface {
                  ... on InterfaceOne {
                    age
                  }
                }
                """
              )
            }

            interface InterfaceOne {
              age: Int!
            }

            interface InterfaceTwo implements InterfaceOne {
              age: Int!
              name: String!
            }

            type ObjectOne implements InterfaceOne & InterfaceTwo @inaccessible {
              age: Int!
              isObjectOne: Boolean!
              name: String!
            }

            type ObjectTwo implements InterfaceOne & InterfaceTwo {
              age: Int!
              isObjectTwo: Boolean!
              name: String!
            }

            type Query {
              entity: Entity!
            }
            
            scalar openfed__FieldSet
            
            scalar openfed__Scope
          `,
        ),
      );
      expect(normalizationResult!.configurationDataByTypeName).toStrictEqual(
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
              externalFieldNames: new Set<string>(['interface']),
              fieldNames: new Set<string>(['id', 'requirerOne', 'requirerTwo']),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'id' }],
              requires: [
                {
                  fieldName: 'requirerOne',
                  selectionSet:
                    'interface { age ... on InterfaceTwo { name ... on ObjectOne { isObjectOne } ... on ObjectTwo { isObjectTwo } } }',
                },
                { fieldName: 'requirerTwo', selectionSet: 'interface { ... on InterfaceOne { age } }' },
              ],
              typeName: 'Entity',
            },
          ],
          [
            'InterfaceOne',
            {
              fieldNames: new Set<string>(['age']),
              isRootNode: false,
              typeName: 'InterfaceOne',
            },
          ],
          [
            'InterfaceTwo',
            {
              fieldNames: new Set<string>(['age', 'name']),
              isRootNode: false,
              typeName: 'InterfaceTwo',
            },
          ],
          [
            'ObjectOne',
            {
              fieldNames: new Set<string>(['age', 'name', 'isObjectOne']),
              isRootNode: false,
              typeName: 'ObjectOne',
            },
          ],
          [
            'ObjectTwo',
            {
              fieldNames: new Set<string>(['age', 'name', 'isObjectTwo']),
              isRootNode: false,
              typeName: 'ObjectTwo',
            },
          ],
        ]),
      );
    });
  });

  describe('Router configuration tests', () => {
    test('that a field that forms part of a @requires field set cannot be used as an implicit key', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphD, subgraphE]);
      expect(errors).toBeUndefined();
      const d = federationResult!.subgraphConfigBySubgraphName.get(subgraphD.name);
      expect(d!.configurationDataByTypeName).toStrictEqual(
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
              fieldNames: new Set<string>(['id', 'name', 'object']),
              isRootNode: true,
              keys: [
                {
                  fieldName: '',
                  selectionSet: 'id',
                },
                {
                  disableEntityResolver: true,
                  fieldName: '',
                  selectionSet: 'id object { nestedObject { id } }',
                },
              ],
              requires: [
                {
                  fieldName: 'name',
                  selectionSet: 'object { nestedObject { name } }',
                },
              ],
              typeName: 'Entity',
            },
          ],
          [
            'Object',
            {
              fieldNames: new Set<string>(['nestedObject']),
              isRootNode: false,
              typeName: 'Object',
            },
          ],
          [
            'NestedObject',
            {
              externalFieldNames: new Set<string>(['name']),
              fieldNames: new Set<string>(['id']),
              isRootNode: false,
              typeName: 'NestedObject',
            },
          ],
        ]),
      );
      expect(d).toBeDefined();
      const e = federationResult!.subgraphConfigBySubgraphName.get(subgraphE.name);
      expect(e).toBeDefined();
      expect(e!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id', 'object', 'age']),
              isRootNode: true,
              keys: [
                {
                  fieldName: '',
                  selectionSet: 'id object { nestedObject { id } }',
                },
                {
                  fieldName: '',
                  selectionSet: 'id object { nestedObject { name } }',
                },
                {
                  disableEntityResolver: true,
                  fieldName: '',
                  selectionSet: 'id',
                },
              ],
              typeName: 'Entity',
            },
          ],
          [
            'Object',
            {
              fieldNames: new Set<string>(['nestedObject']),
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
    });

    test('that non-external v1 fields that form part of a @requires field set are treated as non-conditional but return a warning', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([subgraphE, subgraphF]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toStrictEqual(
        nonExternalConditionalFieldWarning(
          'Entity.name',
          'subgraph-f',
          'NestedObject.name',
          'object { nestedObject { name } }',
          FieldSetDirective.REQUIRES,
        ),
      );
      const e = federationResult!.subgraphConfigBySubgraphName.get(subgraphE.name);
      expect(e).toBeDefined();
      expect(e!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id', 'object', 'age']),
              isRootNode: true,
              keys: [
                {
                  fieldName: '',
                  selectionSet: 'id object { nestedObject { id } }',
                },
                {
                  fieldName: '',
                  selectionSet: 'id object { nestedObject { name } }',
                },
                {
                  disableEntityResolver: true,
                  fieldName: '',
                  selectionSet: 'id',
                },
              ],
              typeName: 'Entity',
            },
          ],
          [
            'Object',
            {
              fieldNames: new Set<string>(['nestedObject']),
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
      const f = federationResult!.subgraphConfigBySubgraphName.get(subgraphF.name);
      expect(f).toBeDefined();
      expect(f!.configurationDataByTypeName).toStrictEqual(
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
              fieldNames: new Set<string>(['id', 'name', 'object']),
              isRootNode: true,
              keys: [
                {
                  fieldName: '',
                  selectionSet: 'id',
                },
                {
                  disableEntityResolver: true,
                  fieldName: '',
                  selectionSet: 'id object { nestedObject { id } }',
                },
                {
                  disableEntityResolver: true,
                  fieldName: '',
                  selectionSet: 'id object { nestedObject { name } }',
                },
              ],
              requires: [
                {
                  fieldName: 'name',
                  selectionSet: 'object { nestedObject { name } }',
                },
              ],
              typeName: 'Entity',
            },
          ],
          [
            'Object',
            {
              fieldNames: new Set<string>(['nestedObject']),
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
    });

    test('that non-external v1 fields that form part of a @provides field set are treated as non-conditional but return a warning', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([subgraphE, subgraphG]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toStrictEqual(
        nonExternalConditionalFieldWarning(
          'Query.entity',
          'subgraph-g',
          'NestedObject.name',
          'object { nestedObject { name } }',
          FieldSetDirective.PROVIDES,
        ),
      );
      const e = federationResult!.subgraphConfigBySubgraphName.get(subgraphE.name);
      expect(e).toBeDefined();
      expect(e!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id', 'object', 'age']),
              isRootNode: true,
              keys: [
                {
                  fieldName: '',
                  selectionSet: 'id object { nestedObject { id } }',
                },
                {
                  fieldName: '',
                  selectionSet: 'id object { nestedObject { name } }',
                },
                {
                  disableEntityResolver: true,
                  fieldName: '',
                  selectionSet: 'id',
                },
              ],
              typeName: 'Entity',
            },
          ],
          [
            'Object',
            {
              fieldNames: new Set<string>(['nestedObject']),
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
      const g = federationResult!.subgraphConfigBySubgraphName.get(subgraphG.name);
      expect(g).toBeDefined();
      expect(g!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Query',
            {
              fieldNames: new Set<string>(['entity']),
              isRootNode: true,
              provides: [
                {
                  fieldName: 'entity',
                  selectionSet: 'object { nestedObject { name } }',
                },
              ],
              typeName: 'Query',
            },
          ],
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id', 'name', 'object']),
              isRootNode: true,
              keys: [
                {
                  fieldName: '',
                  selectionSet: 'id',
                },
                {
                  disableEntityResolver: true,
                  fieldName: '',
                  selectionSet: 'id object { nestedObject { id } }',
                },
                {
                  disableEntityResolver: true,
                  fieldName: '',
                  selectionSet: 'id object { nestedObject { name } }',
                },
              ],
              typeName: 'Entity',
            },
          ],
          [
            'Object',
            {
              fieldNames: new Set<string>(['nestedObject']),
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
    });
  });
});

const subgraphA: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query @shareable {
      entity: Entity! @provides(fields: "object { nestedObject { age name } }")
      entities: [Entity!]! @provides(fields: "object { nestedObject { age name } }")
    }
    
    type Entity @key(fields: "id") {
      id: ID!
      object: Object!
    }
    
    type Object {
      nestedObject: NestedObject!
    }
    
    type NestedObject {
      age: Int! @external
      name: String! @external
    }
  `),
};

const subgraphB: Subgraph = {
  name: 'subgraph-b',
  url: '',
  definitions: parse(`
    schema {
      query: Queries
    }
    
    type Queries @shareable {
      entity: Entity! @provides(fields: "object { nestedObject { age name } }")
      entities: [Entity!]! @provides(fields: "object { nestedObject { age name } }")
    }
    
    type Entity @key(fields: "id") {
      id: ID!
      object: Object!
    }
    
    type Object {
      nestedObject: NestedObject!
    }
    
    type NestedObject {
      age: Int! @external
      name: String! @external
    }
  `),
};

const subgraphC: Subgraph = {
  name: 'subgraph-c',
  url: '',
  definitions: parse(`
    schema {
      query: Queries
    }
    
    type Queries @shareable {
      entity: Entity! @provides(fields: "object { nestedObject { age name } }")
      entities: [Entity!]! @provides(fields: "object { nestedObject { age name } }")
    }
    
    type Entity @key(fields: "id") {
      id: ID!
      object: Object!
    }
    
    type Object {
      nestedObject: NestedObject!
    }
    
    type NestedObject {
      age: Int!
      name: String!
    }
  `),
};

const subgraphD: Subgraph = {
  name: 'subgraph-d',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity!
    }
    
    type Entity @key(fields: "id") {
      id: ID!
      name: String! @requires(fields: "object { nestedObject { name } }")
      object: Object! @shareable
    }
    
    type Object {
      nestedObject: NestedObject! @shareable
    }
    
    type NestedObject @shareable {
      id: ID!
      name: String! @external
    }
  `),
};

const subgraphE: Subgraph = {
  name: 'subgraph-e',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id object { nestedObject { id } }") @key(fields: "id object { nestedObject { name } }") {
      id: ID!
      object: Object!
      age: Int!
    }
    
    type Object {
      nestedObject: NestedObject!
    }
    
    type NestedObject {
      id: ID!
      name: String!
    }
  `),
};

const subgraphF: Subgraph = {
  name: 'subgraph-f',
  url: '',
  definitions: parse(`
    schema {
      query: Queries  
    }
    
    type Queries {
      entity: Entity!
    }
    
    type Entity @key(fields: "id") {
      id: ID!
      name: String! @requires(fields: "object { nestedObject { name } }")
      object: Object!
    }
    
    type Object {
      nestedObject: NestedObject!
    }
    
    type NestedObject {
      id: ID!
      name: String!
    }
  `),
};

const subgraphG: Subgraph = {
  name: 'subgraph-g',
  url: '',
  definitions: parse(`
    schema {
      query: Queries  
    }
    
    type Queries {
      entity: Entity! @provides(fields: "object { nestedObject { name } }")
    }
    
    type Entity @key(fields: "id") {
      id: ID!
      name: String!
      object: Object!
    }
    
    type Object {
      nestedObject: NestedObject!
    }
    
    type NestedObject {
      id: ID!
      name: String!
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

    type Entity @key(fields: "id") {
      id: ID!
      interface: InterfaceOne @external
      requirerOne: String!
      @requires(
        fields: """
        interface {
          ... on InterfaceTwo {
            ... on ObjectOne {
              isObjectOne
            }
            name
            ... on ObjectTwo {
              isObjectTwo
            }
          }
          age
        }
        """
      )
      requirerTwo: String!
      @requires(
        fields: """
          interface {
            ... on InterfaceOne {
              age
            }
          }
        """
      )
    }

    interface InterfaceOne {
      age: Int!
    }

    interface InterfaceTwo implements InterfaceOne {
      age: Int!
      name: String!
    }

    type ObjectOne implements InterfaceOne & InterfaceTwo @inaccessible {
      age: Int!
      name: String!
      isObjectOne: Boolean!
    }

    type ObjectTwo implements InterfaceOne & InterfaceTwo {
      age: Int!
      name: String!
      isObjectTwo: Boolean!
    }
  `),
};

const subgraphI: Subgraph = {
  name: 'subgraph-i',
  url: '',
  definitions: parse(`
    extend schema
    @link(
      url: "https://specs.apollo.dev/federation/v2.3"
      import: ["@key", "@shareable", "@external", "@provides"]
    )

    type Query {
      media: Media @shareable
      book: Book @provides(fields: "animals { ... on Dog { name } }")
    }

    interface Media {
      id: ID!
    }

    interface Animal {
      id: ID!
    }

    type Book implements Media @key(fields: "id") {
      id: ID!
      animals: [Animal] @shareable
    }

    type Dog implements Animal @key(fields: "id") {
      id: ID! @external
      name: String @external
    }

    type Cat implements Animal @key(fields: "id") {
      id: ID! @external
    }
  `),
};

const subgraphJ: Subgraph = {
  name: 'subgraph-j',
  url: '',
  definitions: parse(`
    extend schema
    @link(
      url: "https://specs.apollo.dev/federation/v2.3"
      import: ["@key", "@shareable", "@provides", "@external"]
    )

    type Query {
      media: Media @shareable @provides(fields: "animals { id name }")
    }

    interface Media {
      id: ID!
      animals: [Animal]
    }

    interface Animal {
      id: ID!
      name: String
    }

    type Book implements Media {
      id: ID! @shareable
      animals: [Animal] @external
    }

    type Dog implements Animal {
      id: ID! @external
      name: String @external
    }

    type Cat implements Animal {
      id: ID! @external
      name: String @external
    }
  `),
};

const subgraphK: Subgraph = {
  name: 'subgraph-k',
  url: '',
  definitions: parse(`
    extend schema
    @link(
      url: "https://specs.apollo.dev/federation/v2.3"
      import: ["@key", "@shareable"]
    )

    interface Media {
      id: ID!
      animals: [Animal]
    }

    interface Animal {
      id: ID!
      name: String
    }

    type Book implements Media @key(fields: "id") {
      id: ID!
      animals: [Animal] @shareable
    }

    type Dog implements Animal @key(fields: "id") {
      id: ID!
      name: String @shareable
      age: Int
    }

    type Cat implements Animal @key(fields: "id") {
      id: ID!
      name: String @shareable
      age: Int
    }
  `),
};

const subgraphL: Subgraph = {
  name: 'subgraph-l',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: Interface!
    }

    interface Interface {
      name: String!
    }
    
    type Object implements Interface {
      name: String!
    }
  `),
};

const subgraphM: Subgraph = {
  name: 'subgraph-m',
  url: '',
  definitions: parse(`
    type Object {
      entity: Entity! @provides(fields: "interface { ... on I { ... on I { name } } }")
    }

    type Entity @key(fields: "id") {
      id: ID!
      interface: I! @external
    }

    interface I {
      name: String!
    }
    
    type Implementation implements I {
      name: String!
    }
  `),
};

const subgraphN: Subgraph = {
  name: 'subgraph-n',
  url: '',
  definitions: parse(`
    type Object {
      entity: Entity! @provides(fields: "interface { ... on AnotherObject { name } }")
    }

    type Entity @key(fields: "id") {
      id: ID!
      interface: I! @external
    }

    interface I {
      name: String!
    }

    type AnotherObject {
      name: String!
    }
    
    type Implementation implements I {
      name: String!
    }
  `),
};

const subgraphO: Subgraph = {
  name: 'subgraph-o',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      name: I! @external
      age: Int! @requires(fields: "... on I { name }")
    }

    interface I {
      name: String!
    }
    
    type Object implements I {
      name: String!
    }
  `),
};

const subgraphP: Subgraph = {
  name: 'subgraph-p',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      name: I! @external
      age: Int! @requires(fields: "name { ... on I { ... on I { name } } }")
    }

    interface I {
      name: String!
    }
    
    type Object implements I {
      name: String!
    }
  `),
};

const subgraphQ: Subgraph = {
  name: 'subgraph-q',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      interface: I! @external
      age: Int! @requires(fields: "interface { ... on Object { age } }")
    }

    interface I {
      name: String!
    }

    type Object {
      name: String!
      age: Int!
    }
    
    type Implementation implements I {
      name: String!
    }
  `),
};
