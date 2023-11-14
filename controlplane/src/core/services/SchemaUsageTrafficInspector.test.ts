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

      expect(changes).toEqual<InspectorSchemaChange[]>([
        {
          isArgument: true,
          path: ['a', 'b'],
          schemaChangeId: '0',
          typeName: 'Query',
        },
      ]);

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
            isArgument: true,
            path: ['details', 'all'],
            schemaChangeId: '0',
            typeName: 'Rocket',
          },
        ]);
      });
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
          fieldName: 'b',
          isInput: true,
          schemaChangeId: '0',
          typeName: 'Foo',
        },
      ]);
    });

    test('Change the type of an Input field', async () => {
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
          fieldName: 'a',
          isInput: true,
          schemaChangeId: '0',
          typeName: 'Foo',
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
          fieldName: 'a',
          schemaChangeId: '1',
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
          schemaChangeId: '0',
        },
      ]);
    });
  });
});

async function getBreakingChanges(a: GraphQLSchema, b: GraphQLSchema): Promise<InspectorSchemaChange[]> {
  const changes = await getSchemaDiff(a, b);
  return changes
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
    .filter((c) => c !== null) as InspectorSchemaChange[];
}
