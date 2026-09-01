import { describe, expect, test } from 'vitest';
import { buildSchema, GraphQLSchema } from 'graphql';
import { SchemaCheckChangeAction } from '../../db/models.js';
import { getSchemaDiff, SchemaDiff } from '../composition/schemaCheck.js';
import {
  InspectorSchemaChange,
  SchemaUsageTrafficInspector,
  toInspectorChange,
} from './SchemaUsageTrafficInspector.js';

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

const change = (path: string, changeType: SchemaDiff['changeType'], message = `${changeType} ${path}`): SchemaDiff => ({
  path,
  changeType,
  message,
  isBreaking: true,
  meta: {} as SchemaDiff['meta'],
});

const action = (id: string, path: string | null, changeType: string | null) =>
  ({ id, path, changeType }) as unknown as SchemaCheckChangeAction;

describe('schemaChangesToInspectorChanges', () => {
  const inspector = new SchemaUsageTrafficInspector({} as any);

  test('maps every change to the stored action with the same path and change type', () => {
    const changes = [change('Query.a', 'FIELD_REMOVED'), change('Employee', 'TYPE_REMOVED')];
    const actions = [
      // Same path, different change type must not be picked up
      action('other', 'Query.a', 'FIELD_ADDED'),
      action('1', 'Query.a', 'FIELD_REMOVED'),
      action('2', 'Employee', 'TYPE_REMOVED'),
      // Actions without a path can never match a change
      action('3', null, 'TYPE_REMOVED'),
    ];

    expect(inspector.schemaChangesToInspectorChanges(changes, actions)).toEqual<InspectorSchemaChange[]>([
      { schemaChangeId: '1', typeName: 'Query', fieldName: 'a' },
      { schemaChangeId: '2', typeName: 'Employee' },
    ]);
  });

  test('uses the first matching action when duplicates are stored', () => {
    const changes = [change('Query.a', 'FIELD_REMOVED')];
    const actions = [action('first', 'Query.a', 'FIELD_REMOVED'), action('second', 'Query.a', 'FIELD_REMOVED')];

    expect(inspector.schemaChangesToInspectorChanges(changes, actions)).toEqual<InspectorSchemaChange[]>([
      { schemaChangeId: 'first', typeName: 'Query', fieldName: 'a' },
    ]);
  });

  test('drops changes that cannot be inspected', () => {
    const changes = [change('Query', 'TYPE_DESCRIPTION_CHANGED')];
    const actions = [action('1', 'Query', 'TYPE_DESCRIPTION_CHANGED')];

    expect(inspector.schemaChangesToInspectorChanges(changes, actions)).toEqual([]);
  });

  test('throws when a change has no stored action', () => {
    const changes = [change('Query.a', 'FIELD_REMOVED', 'Field a was removed')];

    expect(() => inspector.schemaChangesToInspectorChanges(changes, [])).toThrow(
      'Could not find schema check action for change Field a was removed',
    );
  });
});
