import { describe, expect, test } from 'vitest';
import { buildSchema, GraphQLSchema } from 'graphql';
import { getSchemaDiff } from '../composition/schemaCheck.js';
import { InspectorSchemaChange, InspectorSchemaChangeGroup, toInspectorChange } from './SchemaUsageTrafficInspector.js';

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

      expect(changes).toEqual<InspectorSchemaChange[]>([
        {
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
          path: ['a', 'b'],
          typeName: 'Query',
          isArgument: true,
          isNull: false,
        },
      ]);
    });

    test('Change argument type from optional same to required same', async () => {
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
          path: ['a', 'b'],
          typeName: 'Query',
          fieldName: 'b',
          isArgument: true,
          isNull: true,
        },
      ]);
    });

    test('Change argument type from optional different to required different', async () => {
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
          path: ['a', 'b'],
          typeName: 'Query',
          fieldName: 'b',
          isArgument: true,
        },
      ]);
    });

    test('Change argument type from required different to required different', async () => {
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
          path: ['a', 'b'],
          typeName: 'Query',
          fieldName: 'b',
          isArgument: true,
        },
      ]);
    });

    test('Change argument type from optional different to optional different', async () => {
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
          path: ['Foo'],
          isInput: true,
        },
      ]);
    });

    test('Remove an Input field', async () => {
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
          path: ['Foo'],
          isInput: true,
        },
      ]);
    });

    test('Change input field type from required different to required different', async () => {
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
          path: ['Foo'],
          isInput: true,
        },
      ]);
    });

    test('Change input field type from optional same to required same', async () => {
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
          typeName: 'Foo',
          fieldName: 'a',
          isInput: true,
          isNull: true,
        },
        {
          path: ['Foo'],
          isInput: true,
          isNull: true,
        },
      ]);
    });

    test('Change input field type from optional different to required different', async () => {
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
          path: ['Foo'],
          isInput: true,
        },
      ]);
    });

    test('Change input field type from optional different to optional different', async () => {
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
          typeName: 'Rocket',
        },
        {
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
        },
        i.toString(),
      ),
    )
    .filter((c) => c !== null) as InspectorSchemaChangeGroup[];

  // Flatten groups
  const result: InspectorSchemaChange[] = [];
  for (const group of groups) {
    result.push(...group.changes);
  }
  return result;
}
