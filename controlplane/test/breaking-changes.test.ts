import { describe, expect, test } from 'vitest';
import { getDiffBetweenGraphs } from '../src/core/composition/schemaCheck.js';
import { SchemaChangeType } from '../src/types/index.js';

describe('BreakingChanges', () => {
  test('Should cause breaking changes on removing a field', async () => {
    const schemaA = 'type Query { hello: String! }';
    const schemaB = 'type Query { a: String! }';

    const schemaChanges = await getDiffBetweenGraphs(schemaA, schemaB);

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

    const schemaChanges = await getDiffBetweenGraphs(schemaA, schemaB);

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

    const schemaChanges = await getDiffBetweenGraphs(schemaA, schemaB);

    expect(schemaChanges.kind).toBe('success');

    if (schemaChanges.kind === 'success') {
      expect(schemaChanges.breakingChanges.length).toBe(0);
    }
  });

  test('Should cause breaking changes on changing the type of a field', async () => {
    const schemaA = 'type Query { hello: String! } type User { name: String! }';
    const schemaB = 'type Query { hello: String! } type User { name: Int! }';

    const schemaChanges = await getDiffBetweenGraphs(schemaA, schemaB);

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

    const schemaChanges = await getDiffBetweenGraphs(schemaA, schemaB);

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

    const schemaChanges = await getDiffBetweenGraphs(schemaA, schemaB);

    expect(schemaChanges.kind).toBe('success');

    if (schemaChanges.kind === 'success') {
      expect(schemaChanges.breakingChanges.length).not.toBe(0);
      expect(schemaChanges.breakingChanges[0].message).toBe("Enum value 'C' was removed from enum 'Alphabet'");
      expect(schemaChanges.breakingChanges[0].path).toBe('Alphabet.C');
      expect(schemaChanges.breakingChanges[0].changeType).toBe(SchemaChangeType.ENUM_VALUE_REMOVED);
    }
  });
});
