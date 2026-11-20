import { CriticalityLevel, diff, Rule } from '@graphql-inspector/core';
import { buildSchema } from 'graphql';
import { describe, expect, test } from 'vitest';
import {
  enumValuesAreExhaustive,
  inaccessibleEnumValueChangesAreInvisible,
  internalFederationTypeRemovalsAreInvisible,
  schemaCheckRules,
  typeSystemDirectiveRemovalsAreInvisible,
} from './schemaCheckRules.js';

const INACCESSIBLE_DEFINITION = 'directive @inaccessible on ENUM | ENUM_VALUE';

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

describe('Rule: @inaccessible enum value changes are invisible', () => {
  test('Should mark an added @inaccessible enum value as non breaking', async () => {
    expect(
      await getCriticalityLevel({
        oldSDL: 'enum Alphabet { A B }',
        newSDL: 'enum Alphabet { A B C @inaccessible }',
        rules: [inaccessibleEnumValueChangesAreInvisible],
        path: 'Alphabet.C',
      }),
    ).toBe(CriticalityLevel.NonBreaking);
  });

  test('Should mark a removed @inaccessible enum value as non breaking', async () => {
    expect(
      await getCriticalityLevel({
        oldSDL: 'enum Alphabet { A B C @inaccessible }',
        newSDL: 'enum Alphabet { A B }',
        rules: [inaccessibleEnumValueChangesAreInvisible],
        path: 'Alphabet.C',
      }),
    ).toBe(CriticalityLevel.NonBreaking);
  });

  test('Should mark a value added to an @inaccessible enum as non breaking', async () => {
    expect(
      await getCriticalityLevel({
        oldSDL: 'enum Alphabet @inaccessible { A B }',
        newSDL: 'enum Alphabet @inaccessible { A B C }',
        rules: [inaccessibleEnumValueChangesAreInvisible],
        path: 'Alphabet.C',
      }),
    ).toBe(CriticalityLevel.NonBreaking);
  });

  test('Should mark a value removed from an @inaccessible enum as non breaking', async () => {
    expect(
      await getCriticalityLevel({
        oldSDL: 'enum Alphabet @inaccessible { A B C }',
        newSDL: 'enum Alphabet @inaccessible { A B }',
        rules: [inaccessibleEnumValueChangesAreInvisible],
        path: 'Alphabet.C',
      }),
    ).toBe(CriticalityLevel.NonBreaking);
  });

  test('Should keep a removed accessible enum value breaking', async () => {
    expect(
      await getCriticalityLevel({
        oldSDL: 'enum Alphabet { A B C }',
        newSDL: 'enum Alphabet { A B }',
        rules: [inaccessibleEnumValueChangesAreInvisible],
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
