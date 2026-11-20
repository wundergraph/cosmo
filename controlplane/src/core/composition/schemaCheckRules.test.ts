import { CriticalityLevel, diff, Rule } from '@graphql-inspector/core';
import { buildSchema } from 'graphql';
import { describe, expect, test } from 'vitest';
import {
  enumValueChangesBreakExhaustiveSwitches,
  inaccessibleEnumValueChangesAreInvisible,
} from './schemaCheckRules.js';

const INACCESSIBLE_DEFINITION = 'directive @inaccessible on ENUM | ENUM_VALUE';

async function getCriticalityLevel(oldSDL: string, newSDL: string, rule: Rule, path: string) {
  const changes = await diff(
    buildSchema(`${INACCESSIBLE_DEFINITION} type Query { hello: String! } ${oldSDL}`),
    buildSchema(`${INACCESSIBLE_DEFINITION} type Query { hello: String! } ${newSDL}`),
    [rule],
  );
  return changes.find((change) => change.path === path)?.criticality.level;
}

describe('enumValueChangesBreakExhaustiveSwitches', () => {
  test('Should mark an added enum value as breaking', async () => {
    expect(
      await getCriticalityLevel(
        'enum Alphabet { A B }',
        'enum Alphabet { A B C }',
        enumValueChangesBreakExhaustiveSwitches,
        'Alphabet.C',
      ),
    ).toBe(CriticalityLevel.Breaking);
  });

  test('Should mark a removed enum value as breaking', async () => {
    expect(
      await getCriticalityLevel(
        'enum Alphabet { A B C }',
        'enum Alphabet { A B }',
        enumValueChangesBreakExhaustiveSwitches,
        'Alphabet.C',
      ),
    ).toBe(CriticalityLevel.Breaking);
  });

  test('Should keep the criticality of other changes', async () => {
    expect(
      await getCriticalityLevel(
        'type User { name: String! }',
        'type User { name: String! age: Int }',
        enumValueChangesBreakExhaustiveSwitches,
        'User.age',
      ),
    ).toBe(CriticalityLevel.NonBreaking);
  });
});

describe('inaccessibleEnumValueChangesAreInvisible', () => {
  test('Should mark an added @inaccessible enum value as non breaking', async () => {
    expect(
      await getCriticalityLevel(
        'enum Alphabet { A B }',
        'enum Alphabet { A B C @inaccessible }',
        inaccessibleEnumValueChangesAreInvisible,
        'Alphabet.C',
      ),
    ).toBe(CriticalityLevel.NonBreaking);
  });

  test('Should mark a value added to an @inaccessible enum as non breaking', async () => {
    expect(
      await getCriticalityLevel(
        'enum Alphabet @inaccessible { A B }',
        'enum Alphabet @inaccessible { A B C }',
        inaccessibleEnumValueChangesAreInvisible,
        'Alphabet.C',
      ),
    ).toBe(CriticalityLevel.NonBreaking);
  });
});
