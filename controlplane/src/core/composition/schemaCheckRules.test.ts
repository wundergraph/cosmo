import { CriticalityLevel, diff, Rule } from '@graphql-inspector/core';
import { buildSchema } from 'graphql';
import { describe, expect, test } from 'vitest';
import {
  enumValuesAreExhaustive,
  inaccessibleChangesAreInvisible,
  internalFederationTypeRemovalsAreInvisible,
  schemaCheckRules,
  typeSystemDirectiveRemovalsAreInvisible,
} from './schemaCheckRules.js';

const INACCESSIBLE_DEFINITION =
  'directive @inaccessible on FIELD_DEFINITION | OBJECT | INTERFACE | UNION | ARGUMENT_DEFINITION | SCALAR | ENUM | ENUM_VALUE | INPUT_OBJECT | INPUT_FIELD_DEFINITION';

async function getCriticalityLevel({
  oldSDL,
  newSDL,
  rules,
  path,
}: {
  oldSDL: string;
  newSDL: string;
  rules: Rule[];
  path: string;
}) {
  const changes = await diff(
    buildSchema(`${INACCESSIBLE_DEFINITION} type Query { hello: String! } ${oldSDL}`),
    buildSchema(`${INACCESSIBLE_DEFINITION} type Query { hello: String! } ${newSDL}`),
    rules,
  );
  return changes.find((change) => change.path === path)?.criticality.level;
}

describe('Rule: enum values are exhaustive', () => {
  test('Should mark an added enum value as breaking', async () => {
    expect(
      await getCriticalityLevel({
        oldSDL: 'enum Alphabet { A B }',
        newSDL: 'enum Alphabet { A B C }',
        rules: [enumValuesAreExhaustive],
        path: 'Alphabet.C',
      }),
    ).toBe(CriticalityLevel.Breaking);
  });

  test('Should mark a removed enum value as breaking', async () => {
    expect(
      await getCriticalityLevel({
        oldSDL: 'enum Alphabet { A B C }',
        newSDL: 'enum Alphabet { A B }',
        rules: [enumValuesAreExhaustive],
        path: 'Alphabet.C',
      }),
    ).toBe(CriticalityLevel.Breaking);
  });

  test('Should keep the criticality of other changes', async () => {
    expect(
      await getCriticalityLevel({
        oldSDL: 'type User { name: String! }',
        newSDL: 'type User { name: String! age: Int }',
        rules: [enumValuesAreExhaustive],
        path: 'User.age',
      }),
    ).toBe(CriticalityLevel.NonBreaking);
  });
});

describe('Rule: changes to @inaccessible elements are invisible', () => {
  test.each([
    {
      change: 'a removed @inaccessible type',
      oldSDL: 'type User @inaccessible { name: String }',
      newSDL: '',
      path: 'User',
    },
    {
      change: 'a removed @inaccessible interface',
      oldSDL: 'interface Node @inaccessible { id: ID }',
      newSDL: '',
      path: 'Node',
    },
    {
      change: 'a removed @inaccessible field',
      oldSDL: 'type User { name: String age: Int @inaccessible }',
      newSDL: 'type User { name: String }',
      path: 'User.age',
    },
    {
      change: 'a field removed from an @inaccessible type',
      oldSDL: 'type User @inaccessible { name: String age: Int }',
      newSDL: 'type User @inaccessible { name: String }',
      path: 'User.age',
    },
    {
      change: 'a changed type of an @inaccessible field',
      oldSDL: 'type User { name: String age: Int @inaccessible }',
      newSDL: 'type User { name: String age: String @inaccessible }',
      path: 'User.age',
    },
    {
      change: 'a removed @inaccessible argument',
      oldSDL: 'type User { name(format: String @inaccessible): String }',
      newSDL: 'type User { name: String }',
      path: 'User.name.format',
    },
    {
      change: 'a required argument added to an @inaccessible field',
      oldSDL: 'type User { name: String @inaccessible }',
      newSDL: 'type User { name(format: String!): String @inaccessible }',
      path: 'User.name.format',
    },
    {
      change: 'a removed @inaccessible input field',
      oldSDL: 'input Filter { name: String age: Int @inaccessible }',
      newSDL: 'input Filter { name: String }',
      path: 'Filter.age',
    },
  ])('Should mark $change as non breaking', async ({ oldSDL, newSDL, path }) => {
    expect(await getCriticalityLevel({ oldSDL, newSDL, rules: [inaccessibleChangesAreInvisible], path })).toBe(
      CriticalityLevel.NonBreaking,
    );
  });

  test('Should keep adding @oneOf breaking when an @inaccessible input field shares its name', async () => {
    expect(
      await getCriticalityLevel({
        oldSDL: 'input Filter { oneOf: Int @inaccessible x: Int y: Int }',
        newSDL: 'input Filter @oneOf { oneOf: Int @inaccessible x: Int y: Int }',
        rules: [inaccessibleChangesAreInvisible],
        path: 'Filter.oneOf',
      }),
    ).toBe(CriticalityLevel.Breaking);
  });

  test('Should keep a removed accessible field breaking', async () => {
    expect(
      await getCriticalityLevel({
        oldSDL: 'type User { name: String age: Int }',
        newSDL: 'type User { name: String }',
        rules: [inaccessibleChangesAreInvisible],
        path: 'User.age',
      }),
    ).toBe(CriticalityLevel.Breaking);
  });

  test('Should mark an added @inaccessible enum value as non breaking', async () => {
    expect(
      await getCriticalityLevel({
        oldSDL: 'enum Alphabet { A B }',
        newSDL: 'enum Alphabet { A B C @inaccessible }',
        rules: [inaccessibleChangesAreInvisible],
        path: 'Alphabet.C',
      }),
    ).toBe(CriticalityLevel.NonBreaking);
  });

  test('Should mark a removed @inaccessible enum value as non breaking', async () => {
    expect(
      await getCriticalityLevel({
        oldSDL: 'enum Alphabet { A B C @inaccessible }',
        newSDL: 'enum Alphabet { A B }',
        rules: [inaccessibleChangesAreInvisible],
        path: 'Alphabet.C',
      }),
    ).toBe(CriticalityLevel.NonBreaking);
  });

  test('Should mark a value added to an @inaccessible enum as non breaking', async () => {
    expect(
      await getCriticalityLevel({
        oldSDL: 'enum Alphabet @inaccessible { A B }',
        newSDL: 'enum Alphabet @inaccessible { A B C }',
        rules: [inaccessibleChangesAreInvisible],
        path: 'Alphabet.C',
      }),
    ).toBe(CriticalityLevel.NonBreaking);
  });

  test('Should mark a value removed from an @inaccessible enum as non breaking', async () => {
    expect(
      await getCriticalityLevel({
        oldSDL: 'enum Alphabet @inaccessible { A B C }',
        newSDL: 'enum Alphabet @inaccessible { A B }',
        rules: [inaccessibleChangesAreInvisible],
        path: 'Alphabet.C',
      }),
    ).toBe(CriticalityLevel.NonBreaking);
  });

  test('Should keep a removed accessible enum value breaking', async () => {
    expect(
      await getCriticalityLevel({
        oldSDL: 'enum Alphabet { A B C }',
        newSDL: 'enum Alphabet { A B }',
        rules: [inaccessibleChangesAreInvisible],
        path: 'Alphabet.C',
      }),
    ).toBe(CriticalityLevel.Breaking);
  });
});

describe('Rule: type system directive removals are invisible', () => {
  test('Should mark a removed type system directive as non breaking', async () => {
    expect(
      await getCriticalityLevel({
        oldSDL: 'directive @internal on FIELD_DEFINITION',
        newSDL: '',
        rules: [typeSystemDirectiveRemovalsAreInvisible],
        path: '@internal',
      }),
    ).toBe(CriticalityLevel.NonBreaking);
  });

  test('Should keep a removed executable directive breaking', async () => {
    expect(
      await getCriticalityLevel({
        oldSDL: 'directive @cached on FIELD',
        newSDL: '',
        rules: [typeSystemDirectiveRemovalsAreInvisible],
        path: '@cached',
      }),
    ).toBe(CriticalityLevel.Breaking);
  });

  test('Should keep a removed variable definition directive breaking', async () => {
    expect(
      await getCriticalityLevel({
        oldSDL: 'directive @sensitive on VARIABLE_DEFINITION',
        newSDL: '',
        rules: [typeSystemDirectiveRemovalsAreInvisible],
        path: '@sensitive',
      }),
    ).toBe(CriticalityLevel.Breaking);
  });
});

describe('Rule: internal federation type removals are invisible', () => {
  test('Should mark a removed internal federation type as non breaking', async () => {
    expect(
      await getCriticalityLevel({
        oldSDL: 'scalar openfed__FieldSet',
        newSDL: '',
        rules: [internalFederationTypeRemovalsAreInvisible],
        path: 'openfed__FieldSet',
      }),
    ).toBe(CriticalityLevel.NonBreaking);
  });

  test('Should keep a removed type breaking', async () => {
    expect(
      await getCriticalityLevel({
        oldSDL: 'type User { name: String }',
        newSDL: '',
        rules: [internalFederationTypeRemovalsAreInvisible],
        path: 'User',
      }),
    ).toBe(CriticalityLevel.Breaking);
  });
});

describe('All rules in order', () => {
  test('Should mark an added enum value as breaking', async () => {
    expect(
      await getCriticalityLevel({
        oldSDL: 'enum Alphabet { A B }',
        newSDL: 'enum Alphabet { A B C }',
        rules: schemaCheckRules,
        path: 'Alphabet.C',
      }),
    ).toBe(CriticalityLevel.Breaking);
  });

  test('Should mark an added @inaccessible enum value as non breaking', async () => {
    expect(
      await getCriticalityLevel({
        oldSDL: 'enum Alphabet { A B }',
        newSDL: 'enum Alphabet { A B C @inaccessible }',
        rules: schemaCheckRules,
        path: 'Alphabet.C',
      }),
    ).toBe(CriticalityLevel.NonBreaking);
  });
});
