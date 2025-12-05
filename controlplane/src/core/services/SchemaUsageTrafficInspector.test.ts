import { describe, expect, test } from 'vitest';
import { buildSchema, GraphQLSchema } from 'graphql';
import { getSchemaDiff } from '../composition/schemaCheck.js';
import { InspectorSchemaChange, toInspectorChange } from './SchemaUsageTrafficInspector.js';

describe('Schema Change converter', (ctx) => {
  describe('Arguments', (ctx) => {
    test('Add a new required argument', async () => {
      const a = buildSchema(/* GraphQL */ `
        type Query {
          a: String
        }
      `);
      const b = buildSchema(/* GraphQL */ `
        type Query {
          a(b: Boolean!): String
        }
      `);

      const changes = await getBreakingChanges(a, b);

      // the below conditions are for what would constitute a breaking change
      // if the condition exists, it would be breaking
      expect(changes).toEqual<InspectorSchemaChange[]>([
        {
          schemaChangeId: '0',
          path: ['a'],
          typeName: 'Query',
        },
      ]);
    });

    test('Add a new required argument nested', async () => {
      const a = buildSchema(/* GraphQL */ `
        type Rocket {
          details: String
        }
        type Query {
          a(b: Boolean!): Rocket
        }
      `);
      const b = buildSchema(/* GraphQL */ `
        type Rocket {
          details(all: Boolean!): String
        }
        type Query {
          a(b: Boolean!): Rocket
        }
      `);

      const changes = await getBreakingChanges(a, b);

      expect(changes).toEqual<InspectorSchemaChange[]>([
        {
          schemaChangeId: '0',
          path: ['details'],
          typeName: 'Rocket',
        },
      ]);
    });

    test('Remove a required argument', async () => {
      const a = buildSchema(/* GraphQL */ `
        type Query {
          a(b: Boolean!): String
        }
      `);
      const b = buildSchema(/* GraphQL */ `
        type Query {
          a: String
        }
      `);

      const changes = await getBreakingChanges(a, b);

      expect(changes).toEqual<InspectorSchemaChange[]>([
        {
          schemaChangeId: '0',
          path: ['a'],
          typeName: 'Query',
        },
      ]);
    });

    test('Remove an optional argument', async () => {
      const a = buildSchema(/* GraphQL */ `
        type Query {
          a(b: Boolean): String
        }
      `);
      const b = buildSchema(/* GraphQL */ `
        type Query {
          a: String
        }
      `);

      const changes = await getBreakingChanges(a, b);

      expect(changes).toEqual<InspectorSchemaChange[]>([
        {
          schemaChangeId: '0',
          path: ['a', 'b'],
          typeName: 'Query',
          isArgument: true,
          isNull: false,
        },
      ]);
    });

    test('Change argument type from optional to required same', async () => {
      const a = buildSchema(/* GraphQL */ `
        type Query {
          a(b: Boolean): String
        }
      `);
      const b = buildSchema(/* GraphQL */ `
        type Query {
          a(b: Boolean!): String
        }
      `);

      const changes = await getBreakingChanges(a, b);

      expect(changes).toEqual<InspectorSchemaChange[]>([
        {
          schemaChangeId: '0',
          path: ['a', 'b'],
          typeName: 'Query',
          fieldName: 'b',
          isArgument: true,
          isNull: true,
        },
      ]);
    });

    test('Change argument type from optional to required different', async () => {
      const a = buildSchema(/* GraphQL */ `
        type Query {
          a(b: Boolean): String
        }
      `);
      const b = buildSchema(/* GraphQL */ `
        type Query {
          a(b: String!): String
        }
      `);

      const changes = await getBreakingChanges(a, b);

      expect(changes).toEqual<InspectorSchemaChange[]>([
        {
          schemaChangeId: '0',
          path: ['a', 'b'],
          typeName: 'Query',
          fieldName: 'b',
          isArgument: true,
        },
      ]);
    });

    test('Change argument type from required to required different', async () => {
      const a = buildSchema(/* GraphQL */ `
        type Query {
          a(b: Boolean!): String
        }
      `);
      const b = buildSchema(/* GraphQL */ `
        type Query {
          a(b: String!): String
        }
      `);

      const changes = await getBreakingChanges(a, b);

      expect(changes).toEqual<InspectorSchemaChange[]>([
        {
          schemaChangeId: '0',
          path: ['a', 'b'],
          typeName: 'Query',
          fieldName: 'b',
          isArgument: true,
        },
      ]);
    });

    test('Change argument type from optional to optional different', async () => {
      const a = buildSchema(/* GraphQL */ `
        type Query {
          a(b: Boolean): String
        }
      `);
      const b = buildSchema(/* GraphQL */ `
        type Query {
          a(b: String): String
        }
      `);

      const changes = await getBreakingChanges(a, b);

      expect(changes).toEqual<InspectorSchemaChange[]>([
        {
          schemaChangeId: '0',
          path: ['a', 'b'],
          typeName: 'Query',
          fieldName: 'b',
          isArgument: true,
          isNull: false,
        },
      ]);
    });
  });

  describe('Input', (ctx) => {
    test('Add a new required Input field', async () => {
      const a = buildSchema(/* GraphQL */ `
        input Foo {
          a: String!
        }
      `);
      const b = buildSchema(/* GraphQL */ `
        input Foo {
          a: String!
          b: String!
        }
      `);

      const changes = await getBreakingChanges(a, b);

      expect(changes).toEqual<InspectorSchemaChange[]>([
        {
          schemaChangeId: '0',
          path: ['Foo'],
          isInput: true,
          isNull: false,
        },
      ]);
    });

    test('Remove a required input field', async () => {
      const a = buildSchema(/* GraphQL */ `
        input Foo {
          a: String!
          b: String!
        }
      `);
      const b = buildSchema(/* GraphQL */ `
        input Foo {
          a: String!
        }
      `);

      const changes = await getBreakingChanges(a, b);

      expect(changes).toEqual<InspectorSchemaChange[]>([
        {
          schemaChangeId: '0',
          path: ['Foo'],
          isInput: true,
          isNull: false,
        },
      ]);
    });

    test('Remove an optional input field', async () => {
      const a = buildSchema(/* GraphQL */ `
        input Foo {
          a: String!
          b: String
        }
      `);
      const b = buildSchema(/* GraphQL */ `
        input Foo {
          a: String!
        }
      `);

      const changes = await getBreakingChanges(a, b);

      // As we dont know whether the field is optional or required, we use the same condition as required fields
      // We will not miss any breaking ops but will have some ops which might not be breaking
      expect(changes).toEqual<InspectorSchemaChange[]>([
        {
          schemaChangeId: '0',
          path: ['Foo'],
          isInput: true,
          isNull: false,
        },
      ]);
    });

    test('Change input field type from required to required different', async () => {
      const a = buildSchema(/* GraphQL */ `
        input Foo {
          a: String!
        }
      `);
      const b = buildSchema(/* GraphQL */ `
        input Foo {
          a: Int!
        }
      `);

      const changes = await getBreakingChanges(a, b);

      expect(changes).toEqual<InspectorSchemaChange[]>([
        {
          schemaChangeId: '0',
          path: ['Foo'],
          isInput: true,
          isNull: false,
        },
      ]);
    });

    test('Change input field type from optional to required same', async () => {
      const a = buildSchema(/* GraphQL */ `
        input Foo {
          a: String
        }
      `);
      const b = buildSchema(/* GraphQL */ `
        input Foo {
          a: String!
        }
      `);

      const changes = await getBreakingChanges(a, b);

      expect(changes).toEqual<InspectorSchemaChange[]>([
        {
          schemaChangeId: '0',
          typeName: 'Foo',
          fieldName: 'a',
          isInput: true,
          isNull: true,
        },
      ]);
    });

    test('Change input field type from optional to required different', async () => {
      const a = buildSchema(/* GraphQL */ `
        input Foo {
          a: String
        }
      `);
      const b = buildSchema(/* GraphQL */ `
        input Foo {
          a: Int!
        }
      `);

      const changes = await getBreakingChanges(a, b);

      expect(changes).toEqual<InspectorSchemaChange[]>([
        {
          schemaChangeId: '0',
          path: ['Foo'],
          isInput: true,
          isNull: false,
        },
      ]);
    });

    test('Change input field type from optional to optional different', async () => {
      const a = buildSchema(/* GraphQL */ `
        input Foo {
          a: String
        }
      `);
      const b = buildSchema(/* GraphQL */ `
        input Foo {
          a: Int
        }
      `);

      const changes = await getBreakingChanges(a, b);

      expect(changes).toEqual<InspectorSchemaChange[]>([
        {
          schemaChangeId: '0',
          typeName: 'Foo',
          fieldName: 'a',
          isInput: true,
          isNull: false,
        },
      ]);
    });
  });

  describe('Types', (ctx) => {
    test('Type removed', async () => {
      const a = buildSchema(/* GraphQL */ `
        type Rocket {
          details: String
        }
        type Query {
          a(b: Boolean!): Rocket
        }
      `);
      const b = buildSchema(/* GraphQL */ `
        type Query {
          a(b: Boolean!): String
        }
      `);

      const changes = await getBreakingChanges(a, b);

      expect(changes).toEqual<InspectorSchemaChange[]>([
        {
          schemaChangeId: '0',
          typeName: 'Rocket',
        },
        {
          schemaChangeId: '1',
          fieldName: 'a',
          typeName: 'Query',
        },
      ]);
    });
  });

  describe('Enums', (ctx) => {
    test('Enum Value added', async () => {
      const a = buildSchema(/* GraphQL */ `
        type Query {
          fieldA: String
        }

        enum enumA {
          A
        }
      `);

      const b = buildSchema(/* GraphQL */ `
        type Query {
          fieldA: String
        }

        enum enumA {
          A
          B
        }
      `);

      const changes = await getBreakingChanges(a, b);

      expect(changes).toEqual<InspectorSchemaChange[]>([
        {
          schemaChangeId: '0',
          namedType: 'enumA',
        },
      ]);
    });

    test('Directive removed should be ignored', async () => {
      const a = buildSchema(/* GraphQL */ `
        directive @test on FIELD_DEFINITION

        type Query {
          a: String @test
        }
      `);
      const b = buildSchema(/* GraphQL */ `
        type Query {
          a: String
        }
      `);

      const changes = await getBreakingChanges(a, b);

      expect(changes).toEqual<InspectorSchemaChange[]>([]);
    });
  });
});

async function getBreakingChanges(a: GraphQLSchema, b: GraphQLSchema): Promise<InspectorSchemaChange[]> {
  const changes = await getSchemaDiff(a, b);
  const groups = changes
    .map((c, i) =>
      toInspectorChange(
        {
          path: c.path!,
          message: c.message,
          changeType: c.changeType,
          isBreaking: c.isBreaking,
          meta: c.meta,
        },
        i.toString(),
      ),
    )
    .filter((c) => c !== null) as InspectorSchemaChange[];

  return groups;
}
