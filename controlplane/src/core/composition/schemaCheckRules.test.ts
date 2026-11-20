import { CriticalityLevel, diff, Rule } from '@graphql-inspector/core';
import { buildSchema } from 'graphql';
import { describe, expect, test } from 'vitest';
import { enumValueChangesAreBreaking, inaccessibleEnumValueChangesAreInvisible } from './schemaCheckRules.js';

const INACCESSIBLE_DEFINITION = 'directive @inaccessible on ENUM | ENUM_VALUE';

async function getCriticalityLevel({
  oldSDL,
  newSDL,
  rule,
  path,
}: {
  oldSDL: string;
  newSDL: string;
  rule: Rule;
  path: string;
}) {
  const changes = await diff(
    buildSchema(`${INACCESSIBLE_DEFINITION} type Query { hello: String! } ${oldSDL}`),
    buildSchema(`${INACCESSIBLE_DEFINITION} type Query { hello: String! } ${newSDL}`),
    [rule],
  );
  return changes.find((change) => change.path === path)?.criticality.level;
}

describe('enumValueChangesAreBreaking', () => {
  test('Should mark an added enum value as breaking', async () => {
    expect(
      await getCriticalityLevel({
        oldSDL: 'enum Alphabet { A B }',
        newSDL: 'enum Alphabet { A B C }',
        rule: enumValueChangesAreBreaking,
        path: 'Alphabet.C',
      }),
    ).toBe(CriticalityLevel.Breaking);
  });

  test('Should mark a removed enum value as breaking', async () => {
    expect(
      await getCriticalityLevel({
        oldSDL: 'enum Alphabet { A B C }',
        newSDL: 'enum Alphabet { A B }',
        rule: enumValueChangesAreBreaking,
        path: 'Alphabet.C',
      }),
    ).toBe(CriticalityLevel.Breaking);
  });

  test('Should keep the criticality of other changes', async () => {
    expect(
      await getCriticalityLevel({
        oldSDL: 'type User { name: String! }',
        newSDL: 'type User { name: String! age: Int }',
        rule: enumValueChangesAreBreaking,
        path: 'User.age',
      }),
    ).toBe(CriticalityLevel.NonBreaking);
  });
});

describe('inaccessibleEnumValueChangesAreInvisible', () => {
  test('Should mark an added @inaccessible enum value as non breaking', async () => {
    expect(
      await getCriticalityLevel({
        oldSDL: 'enum Alphabet { A B }',
        newSDL: 'enum Alphabet { A B C @inaccessible }',
        rule: inaccessibleEnumValueChangesAreInvisible,
        path: 'Alphabet.C',
      }),
    ).toBe(CriticalityLevel.NonBreaking);
  });

  test('Should mark a removed @inaccessible enum value as non breaking', async () => {
    expect(
      await getCriticalityLevel({
        oldSDL: 'enum Alphabet { A B C @inaccessible }',
        newSDL: 'enum Alphabet { A B }',
        rule: inaccessibleEnumValueChangesAreInvisible,
        path: 'Alphabet.C',
      }),
    ).toBe(CriticalityLevel.NonBreaking);
  });

  test('Should mark a value added to an @inaccessible enum as non breaking', async () => {
    expect(
      await getCriticalityLevel({
        oldSDL: 'enum Alphabet @inaccessible { A B }',
        newSDL: 'enum Alphabet @inaccessible { A B C }',
        rule: inaccessibleEnumValueChangesAreInvisible,
        path: 'Alphabet.C',
      }),
    ).toBe(CriticalityLevel.NonBreaking);
  });

  test('Should mark a value removed from an @inaccessible enum as non breaking', async () => {
    expect(
      await getCriticalityLevel({
        oldSDL: 'enum Alphabet @inaccessible { A B C }',
        newSDL: 'enum Alphabet @inaccessible { A B }',
        rule: inaccessibleEnumValueChangesAreInvisible,
        path: 'Alphabet.C',
      }),
    ).toBe(CriticalityLevel.NonBreaking);
  });

  test('Should keep a removed accessible enum value breaking', async () => {
    expect(
      await getCriticalityLevel({
        oldSDL: 'enum Alphabet { A B C }',
        newSDL: 'enum Alphabet { A B }',
        rule: inaccessibleEnumValueChangesAreInvisible,
        path: 'Alphabet.C',
      }),
    ).toBe(CriticalityLevel.Breaking);
  });
});
