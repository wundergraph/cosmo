import { describe, expect, test } from 'vitest';
import {
  abstractTypeInKeyFieldSetErrorMessage,
  argumentsInKeyFieldSetErrorMessage,
  ConfigurationData,
  duplicateFieldInFieldSetErrorMessage,
  invalidInlineFragmentTypeConditionErrorMessage,
  invalidInlineFragmentTypeErrorMessage,
  invalidKeyDirectivesError,
  invalidProvidesOrRequiresDirectivesError,
  invalidSelectionOnUnionErrorMessage,
  invalidSelectionSetDefinitionErrorMessage,
  invalidSelectionSetErrorMessage,
  normalizeSubgraphFromString,
  undefinedFieldInFieldSetErrorMessage,
  unexpectedArgumentErrorMessage,
  unparsableFieldSetErrorMessage,
} from '../src';
import { PROVIDES, REQUIRES } from '../src/utils/string-constants';

describe('openfed_FieldSet Tests', () => {
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
      const { errors } = normalizeSubgraphFromString(`
      type Entity @key(fields: "id") {
        id: Interface!
      }
      
      interface Interface {
        name: String!
      }
    `);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        invalidKeyDirectivesError('Entity', [
          abstractTypeInKeyFieldSetErrorMessage(`id`, 'Entity.id', 'Interface', 'interface'),
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
        invalidKeyDirectivesError('Entity', [
          abstractTypeInKeyFieldSetErrorMessage(`id`, 'Entity.id', 'Union', 'union'),
        ]),
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
          invalidSelectionSetDefinitionErrorMessage('id { something }', 'Entity.id', 'ID', 'scalar'),
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
        invalidKeyDirectivesError('Entity', [invalidSelectionSetErrorMessage('id', 'Entity.id', 'Object', 'object')]),
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
            'AnotherObject.object',
            'YetAnotherObject',
            'object',
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
      expect(normalizationResult!.configurationDataByParentTypeName).toStrictEqual(
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
      expect(normalizationResult!.configurationDataByParentTypeName).toStrictEqual(
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
          ` On "Object.entity" —` + invalidInlineFragmentTypeErrorMessage('... on I { name }', 'Entity', 'I', 'Entity'),
        ]),
      );
    });

    test('that a @provides FieldSet supports multiple inline fragments', () => {
      const { errors, normalizationResult } = normalizeSubgraphFromString(`
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
      `);
      expect(errors).toBeUndefined();
      expect(normalizationResult).toBeDefined();
      expect(normalizationResult!.configurationDataByParentTypeName).toStrictEqual(
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
      expect(normalizationResult!.configurationDataByParentTypeName).toStrictEqual(
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
      const { errors } = normalizeSubgraphFromString(`
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
      `);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        invalidProvidesOrRequiresDirectivesError(PROVIDES, [
          ` On "Object.entity" —` +
            invalidInlineFragmentTypeConditionErrorMessage(
              'interface { ... on AnotherObject { name } }',
              'Entity.interface',
              'AnotherObject',
              'interface',
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
      expect(normalizationResult!.configurationDataByParentTypeName).toStrictEqual(
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
          ` On "Object.entity" —` + invalidSelectionOnUnionErrorMessage('union { name }', 'Entity.union', 'U'),
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
              'Entity.union',
              'YetAnotherObject',
              'union',
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
      expect(normalizationResult!.configurationDataByParentTypeName).toStrictEqual(
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
      expect(normalizationResult!.configurationDataByParentTypeName).toStrictEqual(
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
  });

  describe('@requires FieldSets', () => {
    test('that a @requires directive is ignored when declared on a non-entity parent', () => {
      const { errors, normalizationResult } = normalizeSubgraphFromString(`
        type Object {
          id: ID!
          name: Object! @requires(fields: "id")
        }
      `);
      expect(errors).toBeUndefined();
      expect(normalizationResult).toBeDefined();
      expect(normalizationResult!.configurationDataByParentTypeName).toStrictEqual(
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
      expect(normalizationResult!.configurationDataByParentTypeName).toStrictEqual(
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
      const { errors, normalizationResult } = normalizeSubgraphFromString(`
        type Entity @key(fields: "id") {
          id: ID!
          name: I! @external
          age: Int! @requires(fields: "... on I { name }")
        }

        interface I {
          name: String!
        }
      `);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        invalidProvidesOrRequiresDirectivesError(REQUIRES, [
          ` On "Entity.age" —` + invalidInlineFragmentTypeErrorMessage('... on I { name }', 'Entity', 'I', 'Entity'),
        ]),
      );
    });

    test('that a @requires FieldSet supports multiple inline fragments', () => {
      const { errors, normalizationResult } = normalizeSubgraphFromString(`
        type Entity @key(fields: "id") {
          id: ID!
          name: I! @external
          age: Int! @requires(fields: "name { ... on I { ... on I { name } } }")
        }
        
        interface I {
          name: String!
        }
      `);
      expect(errors).toBeUndefined();
      expect(normalizationResult).toBeDefined();
      expect(normalizationResult!.configurationDataByParentTypeName).toStrictEqual(
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
      expect(normalizationResult!.configurationDataByParentTypeName).toStrictEqual(
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
      const { errors } = normalizeSubgraphFromString(`
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
      `);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        invalidProvidesOrRequiresDirectivesError(REQUIRES, [
          ` On "Entity.age" —` +
            invalidInlineFragmentTypeConditionErrorMessage(
              'interface { ... on Object { age } }',
              'Entity.interface',
              'Object',
              'interface',
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
      expect(normalizationResult!.configurationDataByParentTypeName).toStrictEqual(
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
          ` On "Entity.name" —` + invalidSelectionOnUnionErrorMessage('union { name }', 'Entity.union', 'U'),
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
              'Entity.union',
              'AnotherObject',
              'union',
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
      expect(normalizationResult!.configurationDataByParentTypeName).toStrictEqual(
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
      expect(normalizationResult!.configurationDataByParentTypeName).toStrictEqual(
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
  });
});
