import { beforeAll, describe, expect, test } from 'vitest';
import { LATEST_ROUTER_COMPATIBILITY_VERSION } from '@wundergraph/composition';
import { getDiffBetweenGraphs, GetDiffBetweenGraphsResult } from '../src/core/composition/schemaCheck.js';
import { SchemaChangeType } from '../src/types/index.js';

describe('BreakingChanges', () => {
  test('Should cause breaking changes on removing a field', async () => {
    const schemaA = 'type Query { hello: String! }';
    const schemaB = 'type Query { a: String! }';

    const schemaChanges = await getDiffBetweenGraphs(schemaA, schemaB, LATEST_ROUTER_COMPATIBILITY_VERSION);

    expect(schemaChanges.kind).toBe('success');

    if (schemaChanges.kind === 'success') {
      expect(schemaChanges.breakingChanges.length).not.toBe(0);
      expect(schemaChanges.breakingChanges[0].message).toBe("Field 'hello' was removed from object type 'Query'");
      expect(schemaChanges.breakingChanges[0].path).toBe('Query.hello');
      expect(schemaChanges.breakingChanges[0].changeType).toBe(SchemaChangeType.FIELD_REMOVED);
    }
  });

  test('Should cause breaking changes on removing a type', async (testContext) => {
    const schemaA = 'type Query { hello: String! } type User { name: String! }';
    const schemaB = 'type Query { hello: String! }';

    const schemaChanges = await getDiffBetweenGraphs(schemaA, schemaB, LATEST_ROUTER_COMPATIBILITY_VERSION);

    expect(schemaChanges.kind).toBe('success');

    if (schemaChanges.kind === 'success') {
      expect(schemaChanges.breakingChanges.length).not.toBe(0);
      expect(schemaChanges.breakingChanges[0].message).toBe("Type 'User' was removed");
      expect(schemaChanges.breakingChanges[0].path).toBe('User');
      expect(schemaChanges.breakingChanges[0].changeType).toBe(SchemaChangeType.TYPE_REMOVED);
    }
  });

  test('Should not cause breaking changes on adding a field', async () => {
    const schemaA = 'type Query { hello: String! }';
    const schemaB = 'type Query { hello: String! a: String! }';

    const schemaChanges = await getDiffBetweenGraphs(schemaA, schemaB, LATEST_ROUTER_COMPATIBILITY_VERSION);

    expect(schemaChanges.kind).toBe('success');

    if (schemaChanges.kind === 'success') {
      expect(schemaChanges.breakingChanges.length).toBe(0);
    }
  });

  test('Should cause breaking changes on changing the type of a field', async () => {
    const schemaA = 'type Query { hello: String! } type User { name: String! }';
    const schemaB = 'type Query { hello: String! } type User { name: Int! }';

    const schemaChanges = await getDiffBetweenGraphs(schemaA, schemaB, LATEST_ROUTER_COMPATIBILITY_VERSION);

    expect(schemaChanges.kind).toBe('success');

    if (schemaChanges.kind === 'success') {
      expect(schemaChanges.breakingChanges.length).not.toBe(0);
      expect(schemaChanges.breakingChanges[0].message).toBe("Field 'User.name' changed type from 'String!' to 'Int!'");
      expect(schemaChanges.breakingChanges[0].path).toBe('User.name');
      expect(schemaChanges.breakingChanges[0].changeType).toBe(SchemaChangeType.FIELD_TYPE_CHANGED);
    }
  });

  test('Should cause breaking changes on removing an input field', async () => {
    const schemaA = 'type Query { hello: String! } input User { name: String! a: String! }';
    const schemaB = 'type Query { hello: String! } input User { a: String! }';

    const schemaChanges = await getDiffBetweenGraphs(schemaA, schemaB, LATEST_ROUTER_COMPATIBILITY_VERSION);

    expect(schemaChanges.kind).toBe('success');

    if (schemaChanges.kind === 'success') {
      expect(schemaChanges.breakingChanges.length).not.toBe(0);
      expect(schemaChanges.breakingChanges[0].message).toBe(
        "Input field 'name' was removed from input object type 'User'",
      );
      expect(schemaChanges.breakingChanges[0].path).toBe('User.name');
      expect(schemaChanges.breakingChanges[0].changeType).toBe(SchemaChangeType.INPUT_FIELD_REMOVED);
    }
  });

  test('Should cause breaking changes on removing an enum field', async () => {
    const schemaA = 'type Query { hello: String! } enum Alphabet { A B C }';
    const schemaB = 'type Query { hello: String! } enum Alphabet { A B }';

    const schemaChanges = await getDiffBetweenGraphs(schemaA, schemaB, LATEST_ROUTER_COMPATIBILITY_VERSION);

    expect(schemaChanges.kind).toBe('success');

    if (schemaChanges.kind === 'success') {
      expect(schemaChanges.breakingChanges.length).not.toBe(0);
      expect(schemaChanges.breakingChanges[0].message).toBe("Enum value 'C' was removed from enum 'Alphabet'");
      expect(schemaChanges.breakingChanges[0].path).toBe('Alphabet.C');
      expect(schemaChanges.breakingChanges[0].changeType).toBe(SchemaChangeType.ENUM_VALUE_REMOVED);
    }
  });

  test('Should cause breaking changes on adding an enum value', async () => {
    const schemaA = 'type Query { hello: String! } enum Alphabet { A B }';
    const schemaB = 'type Query { hello: String! } enum Alphabet { A B C }';

    const schemaChanges = await getDiffBetweenGraphs(schemaA, schemaB, LATEST_ROUTER_COMPATIBILITY_VERSION);

    expect(schemaChanges.kind === 'success' && schemaChanges.breakingChanges.map((c) => c.path)).toStrictEqual([
      'Alphabet.C',
    ]);
  });

  describe('Adding an @inaccessible enum value', () => {
    let schemaChanges: GetDiffBetweenGraphsResult;

    beforeAll(async () => {
      schemaChanges = await getDiffBetweenGraphs(
        'type Query { hello: String! } enum Alphabet { A B }',
        'type Query { hello: String! } enum Alphabet { A B C @inaccessible }',
        LATEST_ROUTER_COMPATIBILITY_VERSION,
      );
    });

    test('Should not cause breaking changes', () => {
      expect(schemaChanges.kind === 'success' && schemaChanges.breakingChanges).toStrictEqual([]);
    });

    test('Should report the enum value as a non breaking change', () => {
      expect(schemaChanges.kind === 'success' && schemaChanges.nonBreakingChanges.map((c) => c.changeType)).toContain(
        SchemaChangeType.ENUM_VALUE_ADDED,
      );
    });
  });

  test('Should not cause breaking changes on adding a value to an @inaccessible enum', async () => {
    const schemaA = 'type Query { hello: String! } enum Alphabet @inaccessible { A B }';
    const schemaB = 'type Query { hello: String! } enum Alphabet @inaccessible { A B C }';

    const schemaChanges = await getDiffBetweenGraphs(schemaA, schemaB, LATEST_ROUTER_COMPATIBILITY_VERSION);

    expect(schemaChanges.kind === 'success' && schemaChanges.breakingChanges).toStrictEqual([]);
  });

  describe('Removing an @inaccessible enum value', () => {
    let schemaChanges: GetDiffBetweenGraphsResult;

    beforeAll(async () => {
      schemaChanges = await getDiffBetweenGraphs(
        'type Query { hello: String! } enum Alphabet { A B C @inaccessible }',
        'type Query { hello: String! } enum Alphabet { A B }',
        LATEST_ROUTER_COMPATIBILITY_VERSION,
      );
    });

    test('Should not cause breaking changes', () => {
      expect(schemaChanges.kind === 'success' && schemaChanges.breakingChanges).toStrictEqual([]);
    });

    test('Should report the enum value as a non breaking change', () => {
      expect(schemaChanges.kind === 'success' && schemaChanges.nonBreakingChanges.map((c) => c.changeType)).toContain(
        SchemaChangeType.ENUM_VALUE_REMOVED,
      );
    });
  });

  test('Should not cause breaking changes on removing a value from an @inaccessible enum', async () => {
    const schemaA = 'type Query { hello: String! } enum Alphabet @inaccessible { A B C }';
    const schemaB = 'type Query { hello: String! } enum Alphabet @inaccessible { A B }';

    const schemaChanges = await getDiffBetweenGraphs(schemaA, schemaB, LATEST_ROUTER_COMPATIBILITY_VERSION);

    expect(schemaChanges.kind === 'success' && schemaChanges.breakingChanges).toStrictEqual([]);
  });

  test('Should cause non breaking changes on adding directives to fields', async () => {
    const schemaA = 'type Query { hello: String! @shareable } type User { name: String! }';
    const schemaB = 'type Query { hello: String! @shareable } type User { name: String! @shareable }';

    const schemaChanges = await getDiffBetweenGraphs(schemaA, schemaB, LATEST_ROUTER_COMPATIBILITY_VERSION);

    expect(schemaChanges.kind).toBe('success');

    if (schemaChanges.kind === 'success') {
      expect(schemaChanges.nonBreakingChanges.length).toBe(1);
      expect(schemaChanges.nonBreakingChanges[0].message).toBe("Directive 'shareable' was added to field 'User.name'");
      expect(schemaChanges.nonBreakingChanges[0].path).toBe('User.name.shareable');
      expect(schemaChanges.nonBreakingChanges[0].changeType).toBe(
        SchemaChangeType.DIRECTIVE_USAGE_FIELD_DEFINITION_ADDED,
      );
    }
  });

  test('Should cause non breaking changes on removing directives from fields', async () => {
    const schemaA = 'type Query { hello: String! @shareable } type User { name: String! @shareable }';
    const schemaB = 'type Query { hello: String! @shareable } type User { name: String! }';

    const schemaChanges = await getDiffBetweenGraphs(schemaA, schemaB, LATEST_ROUTER_COMPATIBILITY_VERSION);

    expect(schemaChanges.kind).toBe('success');

    if (schemaChanges.kind === 'success') {
      expect(schemaChanges.nonBreakingChanges.length).toBe(1);
      expect(schemaChanges.nonBreakingChanges[0].message).toBe(
        "Directive 'shareable' was removed from field 'User.name'",
      );
      expect(schemaChanges.nonBreakingChanges[0].path).toBe('User.name.shareable');
      expect(schemaChanges.nonBreakingChanges[0].changeType).toBe(
        SchemaChangeType.DIRECTIVE_USAGE_FIELD_DEFINITION_REMOVED,
      );
    }
  });

  test('Should not cause breaking changes on removing the last use of a federation directive', async () => {
    const schemaA = 'type Query { hello: String! @shareable }';
    const schemaB = 'type Query { hello: String! }';

    const schemaChanges = await getDiffBetweenGraphs(schemaA, schemaB, LATEST_ROUTER_COMPATIBILITY_VERSION);

    expect(schemaChanges.kind === 'success' && schemaChanges.breakingChanges).toStrictEqual([]);
  });

  test('Should not cause breaking changes on removing the last @key', async () => {
    const schemaA = 'type Query { hello: String! } type User @key(fields: "name") { name: String! }';
    const schemaB = 'type Query { hello: String! } type User { name: String! }';

    const schemaChanges = await getDiffBetweenGraphs(schemaA, schemaB, LATEST_ROUTER_COMPATIBILITY_VERSION);

    expect(schemaChanges.kind === 'success' && schemaChanges.breakingChanges).toStrictEqual([]);
  });

  test('Should not cause breaking changes on removing the last @requiresScopes', async () => {
    const schemaA = 'type Query { hello: String! @requiresScopes(scopes: [["read"]]) }';
    const schemaB = 'type Query { hello: String! }';

    const schemaChanges = await getDiffBetweenGraphs(schemaA, schemaB, LATEST_ROUTER_COMPATIBILITY_VERSION);

    expect(schemaChanges.kind === 'success' && schemaChanges.breakingChanges).toStrictEqual([]);
  });

  test('Should not cause breaking changes on removing a type system directive definition', async () => {
    const schemaA = 'directive @internal on FIELD_DEFINITION type Query { hello: String! }';
    const schemaB = 'type Query { hello: String! }';

    const schemaChanges = await getDiffBetweenGraphs(schemaA, schemaB, LATEST_ROUTER_COMPATIBILITY_VERSION);

    expect(schemaChanges.kind === 'success' && schemaChanges.breakingChanges).toStrictEqual([]);
  });

  test('Should cause breaking changes on removing an executable directive definition', async () => {
    const schemaA = 'directive @cached on FIELD type Query { hello: String! }';
    const schemaB = 'type Query { hello: String! }';

    const schemaChanges = await getDiffBetweenGraphs(schemaA, schemaB, LATEST_ROUTER_COMPATIBILITY_VERSION);

    expect(schemaChanges.kind === 'success' && schemaChanges.breakingChanges.map((c) => c.path)).toStrictEqual([
      '@cached',
    ]);
  });

  test('Should cause non breaking changes on adding directives to objects', async () => {
    const schemaA = 'type Query { hello: String! } type User { name: String! }';
    const schemaB = 'type Query { hello: String! } type User @key(fields: "name") { name: String! }';

    const schemaChanges = await getDiffBetweenGraphs(schemaA, schemaB, LATEST_ROUTER_COMPATIBILITY_VERSION);

    expect(schemaChanges.kind).toBe('success');

    if (schemaChanges.kind === 'success') {
      expect(schemaChanges.nonBreakingChanges).toHaveLength(3);
      expect(schemaChanges.nonBreakingChanges).toStrictEqual([
        {
          message: "Type 'openfed__FieldSet' was added",
          changeType: SchemaChangeType.TYPE_ADDED,
          path: 'openfed__FieldSet',
          isBreaking: false,
          meta: {
            addedTypeName: 'openfed__FieldSet',
          },
        },
        {
          message: "Directive 'key' was added to object 'User'",
          changeType: SchemaChangeType.DIRECTIVE_USAGE_OBJECT_ADDED,
          path: 'User.key',
          isBreaking: false,
          meta: {
            addedDirectiveName: 'key',
            objectName: 'User',
          },
        },
        {
          message: "Directive 'key' was added",
          changeType: SchemaChangeType.DIRECTIVE_ADDED,
          path: '@key',
          isBreaking: false,
          meta: {
            addedDirectiveName: 'key',
          },
        },
      ]);
    }
  });

  test('Should cause non breaking changes on removing directives from objects', async () => {
    const schemaA = 'type Query { hello: String! } type User @key(fields: "name") { name: String! }';
    const schemaB = 'type Query { hello: String! } type User { name: String! }';

    const schemaChanges = await getDiffBetweenGraphs(schemaA, schemaB, LATEST_ROUTER_COMPATIBILITY_VERSION);

    expect(schemaChanges.kind).toBe('success');

    if (schemaChanges.kind === 'success') {
      expect(schemaChanges.nonBreakingChanges.length).toBe(3);
      expect(schemaChanges.nonBreakingChanges[1].message).toBe("Directive 'key' was removed from object 'User'");
      expect(schemaChanges.nonBreakingChanges[1].path).toBe('User.key');
      expect(schemaChanges.nonBreakingChanges[1].changeType).toBe(SchemaChangeType.DIRECTIVE_USAGE_OBJECT_REMOVED);
    }
  });
});
