import { describe, expect, test } from 'vitest';
import {
  abstractTypeInKeyFieldSetErrorMessage,
  argumentsInKeyFieldSetErrorMessage,
  ConfigurationData,
  duplicateFieldInFieldSetErrorMessage,
  federateSubgraphs,
  FederationResultSuccess,
  FIRST_ORDINAL,
  INTERFACE,
  invalidDirectiveError,
  invalidInlineFragmentTypeConditionErrorMessage,
  invalidInlineFragmentTypeErrorMessage,
  invalidProvidesOrRequiresDirectivesError,
  invalidSelectionOnUnionErrorMessage,
  invalidSelectionSetDefinitionErrorMessage,
  invalidSelectionSetErrorMessage,
  KEY,
  nonExternalConditionalFieldWarning,
  NormalizationResultFailure,
  NormalizationResultSuccess,
  normalizeSubgraph,
  normalizeSubgraphFromString,
  NOT_APPLICABLE,
  OBJECT,
  parse,
  PROVIDES,
  REQUIRES,
  requiresDefinedOnNonEntityFieldWarning,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  SCALAR,
  Subgraph,
  undefinedFieldInFieldSetErrorMessage,
  unexpectedArgumentErrorMessage,
  UNION,
  unparsableFieldSetErrorMessage,
} from '../../../src';
import { schemaQueryDefinition, versionTwoDirectiveDefinitions } from '../utils/utils';
import { normalizeString, normalizeSubgraphSuccess, schemaToSortedNormalizedString } from '../../utils/utils';

describe('openfed_FieldSet tests', () => {
  describe('@key FieldSets', () => {
    test('that a complex key FieldSet is validated', () => {
      const result = normalizeSubgraphFromString(
        `
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
    `,
        true,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
    });

    test('that referencing undefined arguments in the FieldSet returns an error', () => {
      const result = normalizeSubgraphFromString(
        `
      type Entity @key(fields: "id(undefinedArg: \\"hi\\")") {
        id: ID!
      }
    `,
        true,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        invalidDirectiveError(KEY, 'Entity', FIRST_ORDINAL, [
          unexpectedArgumentErrorMessage(`id(undefinedArg: "hi")`, 'Entity.id', 'undefinedArg'),
        ]),
      );
    });

    test('that referencing defined arguments in the FieldSet returns an error', () => {
      const result = normalizeSubgraphFromString(
        `
      type Entity @key(fields: "id(undefinedArg: \\"hi\\")") {
        id(undefinedArg: String!): ID!
      }
    `,
        true,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        invalidDirectiveError(KEY, 'Entity', FIRST_ORDINAL, [
          argumentsInKeyFieldSetErrorMessage(`id(undefinedArg: "hi")`, 'Entity.id'),
        ]),
      );
    });

    test('that including a field that defines an argument in the FieldSet returns an error', () => {
      const result = normalizeSubgraphFromString(
        `
      type Entity @key(fields: "id") {
        id(undefinedArg: String!): ID!
      }
    `,
        true,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        invalidDirectiveError(KEY, 'Entity', FIRST_ORDINAL, [argumentsInKeyFieldSetErrorMessage(`id`, 'Entity.id')]),
      );
    });

    test('that including an undefined field in the FieldSet returns an error', () => {
      const result = normalizeSubgraphFromString(
        `
      type Entity @key(fields: "name") {
        id: ID!
      }
    `,
        true,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        invalidDirectiveError(KEY, 'Entity', FIRST_ORDINAL, [
          undefinedFieldInFieldSetErrorMessage(`name`, 'Entity', 'name'),
        ]),
      );
    });

    test('that including an interface in the FieldSet returns an error', () => {
      const result = normalizeSubgraph(
        subgraphL.definitions,
        subgraphL.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        invalidDirectiveError(KEY, 'Entity', FIRST_ORDINAL, [
          abstractTypeInKeyFieldSetErrorMessage(`id`, 'Entity.id', INTERFACE, INTERFACE),
        ]),
      );
    });

    test('that including a Union in the FieldSet returns an error', () => {
      const result = normalizeSubgraphFromString(
        `
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
    `,
        true,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        invalidDirectiveError(KEY, 'Entity', FIRST_ORDINAL, [
          abstractTypeInKeyFieldSetErrorMessage(`id`, 'Entity.id', UNION, UNION),
        ]),
      );
    });

    test('that an empty key returns a parse error', () => {
      const result = normalizeSubgraphFromString(
        `
      type Entity @key(fields: "") {
        id: ID!
      }
    `,
        true,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        invalidDirectiveError(KEY, 'Entity', FIRST_ORDINAL, [
          unparsableFieldSetErrorMessage('', new Error(`Syntax Error: Expected Name, found "}".`)),
        ]),
      );
    });

    test('that an empty slection set returns a parse error', () => {
      const result = normalizeSubgraphFromString(
        `
      type Entity @key(fields: "id { }") {
        id: Object!
      }
      
      type Object {
        name: String!
      }  
    `,
        true,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        invalidDirectiveError(KEY, 'Entity', FIRST_ORDINAL, [
          unparsableFieldSetErrorMessage('id { }', new Error(`Syntax Error: Expected Name, found "}".`)),
        ]),
      );
    });

    test('that a consecutive selection set returns a parse error', () => {
      const result = normalizeSubgraphFromString(
        `
      type Entity @key(fields: "id { { name } }") {
        id: Object!
      }
      
      type Object {
        name: String!
      }  
    `,
        true,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        invalidDirectiveError(KEY, 'Entity', FIRST_ORDINAL, [
          unparsableFieldSetErrorMessage('id { { name } }', new Error(`Syntax Error: Expected Name, found "{".`)),
        ]),
      );
    });

    test('that a selection set on a type without fields returns an error', () => {
      const result = normalizeSubgraphFromString(
        `
      type Entity @key(fields: "id { something }") {
        id: ID!
      }
    `,
        true,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        invalidDirectiveError(KEY, 'Entity', FIRST_ORDINAL, [
          invalidSelectionSetDefinitionErrorMessage('id { something }', ['Entity.id'], 'ID', SCALAR),
        ]),
      );
    });

    test('that an object-like without a selection set returns an error', () => {
      const result = normalizeSubgraphFromString(
        `
      type Entity @key(fields: "id") {
        id: Object!
      }
      
      type Object {
        name: String!
      }  
    `,
        true,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        invalidDirectiveError(KEY, 'Entity', FIRST_ORDINAL, [
          invalidSelectionSetErrorMessage('id', ['Entity.id'], OBJECT, OBJECT),
        ]),
      );
    });

    test('that a nested object-like without a selection set returns an error', () => {
      const result = normalizeSubgraphFromString(
        `
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
    `,
        true,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        invalidDirectiveError(KEY, 'Entity', FIRST_ORDINAL, [
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
      const result = normalizeSubgraphFromString(
        `
      type Entity @key(fields: "id name age size id") {
        id: ID!
        name: String!
        age: Int!
        size: Float!
      }
    `,
        true,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        invalidDirectiveError(KEY, 'Entity', FIRST_ORDINAL, [
          duplicateFieldInFieldSetErrorMessage('id name age size id', 'Entity.id'),
        ]),
      );
    });

    test('that a duplicated nested field returns an error', () => {
      const result = normalizeSubgraphFromString(
        `
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
    `,
        true,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        invalidDirectiveError(KEY, 'Entity', FIRST_ORDINAL, [
          duplicateFieldInFieldSetErrorMessage(
            'id { object { object { name } object { name } } }',
            'AnotherObject.object',
          ),
        ]),
      );
    });
  });

  describe('@requires FieldSets', () => {
    test('that a warning is returned for an unconditionally provided @external field that is also required', () => {
      const result = normalizeSubgraphSuccess(subgraphA, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(true);
      expect(result.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Entity',
            {
              isRootNode: true,
              fieldNames: new Set<string>(['id', 'name']),
              keys: [
                {
                  fieldName: '',
                  selectionSet: 'id',
                },
              ],
              typeName: 'Entity',
            },
          ],
        ]),
      );
    });

    test('that a @requires directive is ignored when declared on a non-entity parent', () => {
      const result = normalizeSubgraphFromString(
        `
        type Object {
          id: ID!
          name: Object! @requires(fields: "id")
        }
      `,
        true,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(2);
      expect(result.warnings[0]).toStrictEqual(requiresDefinedOnNonEntityFieldWarning(`Object.name`, NOT_APPLICABLE));
      expect(result.warnings[1]).toStrictEqual(
        nonExternalConditionalFieldWarning('Object.name', NOT_APPLICABLE, 'Object.id', 'id', REQUIRES),
      );
      expect(result.configurationDataByTypeName).toStrictEqual(
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
      const result = normalizeSubgraphFromString(
        `
        type Entity @key(fields: "id") {
          id: ID!
          name: String! @external
          age: Int! @requires(fields: "... on Entity { name }")
        }
      `,
        true,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.configurationDataByTypeName).toStrictEqual(
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
      const result = normalizeSubgraph(
        subgraphO.definitions,
        subgraphO.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        invalidProvidesOrRequiresDirectivesError(REQUIRES, [
          ` On field "Entity.age":\n -` + invalidInlineFragmentTypeErrorMessage('... on I { name }', [], 'I', 'Entity'),
        ]),
      );
    });

    test('that a @requires FieldSet supports multiple inline fragments', () => {
      const result = normalizeSubgraph(
        subgraphP.definitions,
        subgraphP.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.configurationDataByTypeName).toStrictEqual(
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
      const result = normalizeSubgraphFromString(
        `
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
      `,
        true,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.configurationDataByTypeName).toStrictEqual(
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
      const result = normalizeSubgraph(
        subgraphQ.definitions,
        subgraphQ.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        invalidProvidesOrRequiresDirectivesError(REQUIRES, [
          ` On field "Entity.age":\n -` +
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
      const result = normalizeSubgraphFromString(
        `
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
      `,
        true,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.configurationDataByTypeName).toStrictEqual(
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
      const result = normalizeSubgraphFromString(
        `
        type Entity @key(fields: "id") {
          id: ID!
          union: U @external
          name: String! @requires(fields: "union { name }")
        }
        
        union U = Object
        
        type Object {
          name: String!
        }
      `,
        true,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        invalidProvidesOrRequiresDirectivesError(REQUIRES, [
          ` On field "Entity.name":\n -` + invalidSelectionOnUnionErrorMessage('union { name }', ['Entity.union'], 'U'),
        ]),
      );
    });

    test('that a @requires FieldSet returns an error for an inline fragment with an invalid type condition on a union', () => {
      const result = normalizeSubgraphFromString(
        `
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
      `,
        true,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        invalidProvidesOrRequiresDirectivesError(REQUIRES, [
          ` On field "Entity.age":\n -` +
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
      const result = normalizeSubgraphFromString(
        `
        type Entity @key(fields: "id") {
          id: ID!
          object(arg: String): Object! @external
          age: Int! @requires(fields: "object { name }")
        }
 
        type Object {
          name: String!
        }
      `,
        true,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.configurationDataByTypeName).toStrictEqual(
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
      const result = normalizeSubgraphFromString(
        `
        type Entity @key(fields: "id") {
          id: ID!
          object(arg: String): Object! @external
          age: Int! @requires(fields: "object(arg: \\"string\\") { name }")
        }
 
        type Object {
          name: String!
        }
      `,
        true,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.configurationDataByTypeName).toStrictEqual(
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
      const result = normalizeSubgraph(
        subgraphH.definitions,
        subgraphH.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
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
      expect(result.configurationDataByTypeName).toStrictEqual(
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
      const result = federateSubgraphs(
        [subgraphD, subgraphE],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      const d = result.subgraphConfigBySubgraphName.get(subgraphD.name);
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
      const e = result.subgraphConfigBySubgraphName.get(subgraphE.name);
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
      const result = federateSubgraphs(
        [subgraphE, subgraphF],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toStrictEqual(
        nonExternalConditionalFieldWarning(
          'Entity.name',
          'subgraph-f',
          'NestedObject.name',
          'object { nestedObject { name } }',
          REQUIRES,
        ),
      );
      expect(result.warnings[0].subgraph.name).toBe('subgraph-f');
      const eConfig = result.subgraphConfigBySubgraphName.get(subgraphE.name);
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
      const f = result.subgraphConfigBySubgraphName.get(subgraphF.name);
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
      const result = federateSubgraphs(
        [subgraphE, subgraphG],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toStrictEqual(
        nonExternalConditionalFieldWarning(
          'Query.entity',
          'subgraph-g',
          'NestedObject.name',
          'object { nestedObject { name } }',
          PROVIDES,
        ),
      );
      expect(result.warnings[0].subgraph.name).toBe('subgraph-g');
      const e = result.subgraphConfigBySubgraphName.get(subgraphE.name);
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
      const g = result.subgraphConfigBySubgraphName.get(subgraphG.name);
      expect(g).toBeDefined();
      expect(g!.configurationDataByTypeName).toStrictEqual(
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

const subgraphA: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    extend type Entity @key(fields: "id") {
      id: ID! @external
      name: String! @requires(fields: "id")
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
