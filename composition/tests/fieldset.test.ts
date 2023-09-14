import { describe, expect, test } from 'vitest';
import {
  abstractTypeInKeyFieldSetErrorMessage,
  argumentsInKeyFieldSetErrorMessage,
  duplicateFieldInFieldSetErrorMessage,
  invalidKeyDirectivesError,
  invalidSelectionSetDefinitionErrorMessage,
  invalidSelectionSetErrorMessage,
  normalizeSubgraphFromString,
  undefinedFieldInFieldSetErrorMessage,
  unexpectedArgumentErrorMessage,
  unparsableFieldSetErrorMessage,
} from '../src';

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
      const { errors} = normalizeSubgraphFromString(`
      type Entity @key(fields: "id(undefinedArg: \\"hi\\")") {
        id: ID!
      }
    `);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1)
      expect(errors![0]).toStrictEqual(invalidKeyDirectivesError(
        'Entity',
        [unexpectedArgumentErrorMessage(
          `id(undefinedArg: "hi")`, 'Entity.id', 'undefinedArg',
        )],
      ));
    });

    test('that referencing defined arguments in the FieldSet returns an error', () => {
      const { errors} = normalizeSubgraphFromString(`
      type Entity @key(fields: "id(undefinedArg: \\"hi\\")") {
        id(undefinedArg: String!): ID!
      }
    `);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1)
      expect(errors![0]).toStrictEqual(invalidKeyDirectivesError(
        'Entity',
        [argumentsInKeyFieldSetErrorMessage(`id(undefinedArg: "hi")`, 'Entity.id')],
      ));
    });

    test('that including a field that defines an argument in the FieldSet returns an error', () => {
      const { errors} = normalizeSubgraphFromString(`
      type Entity @key(fields: "id") {
        id(undefinedArg: String!): ID!
      }
    `);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1)
      expect(errors![0]).toStrictEqual(invalidKeyDirectivesError(
        'Entity',
        [argumentsInKeyFieldSetErrorMessage(`id`, 'Entity.id')],
      ));
    });

    test('that including an undefined field in the FieldSet returns an error', () => {
      const { errors} = normalizeSubgraphFromString(`
      type Entity @key(fields: "name") {
        id: ID!
      }
    `);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1)
      expect(errors![0]).toStrictEqual(invalidKeyDirectivesError(
        'Entity',
        [undefinedFieldInFieldSetErrorMessage(`name`, 'Entity', 'name')],
      ));
    });

    test('that including an interface in the FieldSet returns an error', () => {
      const { errors} = normalizeSubgraphFromString(`
      type Entity @key(fields: "id") {
        id: Interface!
      }
      
      interface Interface {
        name: String!
      }
    `);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1)
      expect(errors![0]).toStrictEqual(invalidKeyDirectivesError(
        'Entity',
        [abstractTypeInKeyFieldSetErrorMessage(
          `id`, 'Entity.id', 'Interface', 'interface',
        )],
      ));
    });

    test('that including a union in the FieldSet returns an error', () => {
      const { errors} = normalizeSubgraphFromString(`
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
      expect(errors).toHaveLength(1)
      expect(errors![0]).toStrictEqual(invalidKeyDirectivesError(
        'Entity',
        [abstractTypeInKeyFieldSetErrorMessage(
          `id`, 'Entity.id', 'Union', 'union',
        )],
      ));
    });

    test('that an empty key returns a parse error', () => {
      const { errors} = normalizeSubgraphFromString(`
      type Entity @key(fields: "") {
        id: ID!
      }
    `);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1)
      expect(errors![0]).toStrictEqual(invalidKeyDirectivesError(
        'Entity',
        [unparsableFieldSetErrorMessage('', new Error(`Syntax Error: Expected Name, found "}".`))],
      ));
    });

    test('that an empty slection set returns a parse error', () => {
      const { errors} = normalizeSubgraphFromString(`
      type Entity @key(fields: "id { }") {
        id: Object!
      }
      
      type Object {
        name: String!
      }  
    `);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1)
      expect(errors![0]).toStrictEqual(invalidKeyDirectivesError(
        'Entity',
        [unparsableFieldSetErrorMessage('id { }', new Error(`Syntax Error: Expected Name, found "}".`))],
      ));
    });

    test('that a consecutive selection set returns a parse error', () => {
      const { errors} = normalizeSubgraphFromString(`
      type Entity @key(fields: "id { { name } }") {
        id: Object!
      }
      
      type Object {
        name: String!
      }  
    `);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1)
      expect(errors![0]).toStrictEqual(invalidKeyDirectivesError(
        'Entity',
        [unparsableFieldSetErrorMessage('id { { name } }', new Error(`Syntax Error: Expected Name, found "{".`))],
      ));
    });

    test('that a selection set on a type without fields returns an error', () => {
      const { errors} = normalizeSubgraphFromString(`
      type Entity @key(fields: "id { something }") {
        id: ID!
      }
    `);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1)
      expect(errors![0]).toStrictEqual(invalidKeyDirectivesError(
        'Entity',
        [invalidSelectionSetDefinitionErrorMessage(
          'id { something }',
          'Entity.id',
          'ID',
          'scalar',
        )],
      ));
    });

    test('that an object-like without a selection set returns an error', () => {
      const { errors} = normalizeSubgraphFromString(`
      type Entity @key(fields: "id") {
        id: Object!
      }
      
      type Object {
        name: String!
      }  
    `);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1)
      expect(errors![0]).toStrictEqual(invalidKeyDirectivesError(
        'Entity',
        [invalidSelectionSetErrorMessage(
          'id', 'Entity.id', 'Object', 'object',
        )],
      ));
    });

    test('that a nested object-like without a selection set returns an error', () => {
      const { errors} = normalizeSubgraphFromString(`
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
      expect(errors).toHaveLength(1)
      expect(errors![0]).toStrictEqual(invalidKeyDirectivesError(
        'Entity',
        [invalidSelectionSetErrorMessage(
          'id { object { object } }',
          'AnotherObject.object',
          'YetAnotherObject',
          'object',
        )],
      ));
    });

    test('that a duplicated field returns an error', () => {
      const { errors} = normalizeSubgraphFromString(`
      type Entity @key(fields: "id name age size id") {
        id: ID!
        name: String!
        age: Int!
        size: Float!
      }
    `);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1)
      expect(errors![0]).toStrictEqual(invalidKeyDirectivesError(
        'Entity',
        [duplicateFieldInFieldSetErrorMessage(
          'id name age size id',
          'Entity.id',
        )],
      ));
    });

    test('that a duplicated nested field returns an error', () => {
      const { errors} = normalizeSubgraphFromString(`
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
      expect(errors).toHaveLength(1)
      expect(errors![0]).toStrictEqual(invalidKeyDirectivesError(
        'Entity',
        [duplicateFieldInFieldSetErrorMessage(
          'id { object { object { name } object { name } } }',
          'AnotherObject.object',
        )],
      ));
    });
  });
});