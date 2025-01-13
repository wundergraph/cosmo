import { describe, expect, test } from 'vitest';
import {
  abstractTypeInKeyFieldSetErrorMessage,
  argumentsInKeyFieldSetErrorMessage,
  ConfigurationData,
  duplicateFieldInFieldSetErrorMessage,
  federateSubgraphs,
  INTERFACE,
  invalidInlineFragmentTypeConditionErrorMessage,
  invalidInlineFragmentTypeErrorMessage,
  invalidKeyDirectivesError,
  invalidProvidesOrRequiresDirectivesError,
  invalidSelectionOnUnionErrorMessage,
  invalidSelectionSetDefinitionErrorMessage,
  invalidSelectionSetErrorMessage,
  nonExternalConditionalFieldWarning,
  normalizeSubgraph,
  normalizeSubgraphFromString,
  NOT_APPLICABLE,
  OBJECT,
  parse,
  REQUIRES,
  requiresDefinedOnNonEntityFieldWarning,
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

  describe('@requires FieldSets', () => {
    test('that a @requires directive is ignored when declared on a non-entity parent', () => {
      const { errors, normalizationResult, warnings } = normalizeSubgraphFromString(`
        type Object {
          id: ID!
          name: Object! @requires(fields: "id")
        }
      `);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(2);
      expect(warnings[0]).toStrictEqual(requiresDefinedOnNonEntityFieldWarning(`Object.name`, NOT_APPLICABLE));
      expect(warnings[1]).toStrictEqual(
        nonExternalConditionalFieldWarning('Object.name', NOT_APPLICABLE, 'Object.id', 'id', REQUIRES),
      );
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
      const { errors } = normalizeSubgraph(subgraphO.definitions, subgraphO.name);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        invalidProvidesOrRequiresDirectivesError(REQUIRES, [
          ` On "Entity.age":\n -` + invalidInlineFragmentTypeErrorMessage('... on I { name }', [], 'I', 'Entity'),
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
          ` On "Entity.age":\n -` +
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
          ` On "Entity.name":\n -` + invalidSelectionOnUnionErrorMessage('union { name }', ['Entity.union'], 'U'),
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
          ` On "Entity.age":\n -` +
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
          REQUIRES,
        ),
      );
      expect(warnings[0].subgraph.name).toBe('subgraph-f');
      const eConfig = federationResult!.subgraphConfigBySubgraphName.get(subgraphE.name);
      expect(eConfig).toBeDefined();
      expect(eConfig!.configurationDataByTypeName).toStrictEqual(
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
      const fConfig = federationResult!.subgraphConfigBySubgraphName.get(subgraphF.name);
      expect(fConfig).toBeDefined();
      expect(fConfig!.configurationDataByTypeName).toStrictEqual(
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
