import { CriticalityLevel, diff, Rule } from '@graphql-inspector/core';
import { buildSchema } from 'graphql';
import { describe, expect, test } from 'vitest';
import { enumValueChangesBreakExhaustiveSwitches } from './schemaCheckRules.js';

async function getCriticalityLevel(oldSDL: string, newSDL: string, rule: Rule, path: string) {
  const changes = await diff(
    buildSchema(`type Query { hello: String! } ${oldSDL}`),
    buildSchema(`type Query { hello: String! } ${newSDL}`),
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
