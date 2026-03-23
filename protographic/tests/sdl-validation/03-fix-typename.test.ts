import { describe, expect, test } from 'vitest';
import { SDLValidationVisitor } from '../../src/sdl-validation-visitor.js';

function buildNestedSdl(requiresFields: string): string {
  return `
        type Query {
          user(id: ID!): User!
        }

        type User @key(fields: "id") {
          id: ID!
          pet: Animal! @external
          details: Details! @requires(fields: "${requiresFields}")
        }

        interface Animal {
          name: String!
          friend: Animal!
        }

        type Cat implements Animal {
          name: String!
          friend: Animal!
          catBreed: String!
        }

        type Dog implements Animal {
          name: String!
          friend: Animal!
          dogBreed: String!
        }

        type Details {
          firstName: String!
          lastName: String!
        }
      `;
}

function buildSdl(requiresFields: string): string {
  return `
      type Query {
        user(id: ID!): User!
      }

      type User @key(fields: "id") {
        id: ID!
        pet: Animal! @external
        details: Details! @requires(fields: "${requiresFields}")
      }

      interface Animal {
        name: String!
      }

      type Cat implements Animal {
        name: String!
        catBreed: String!
      }

      type Dog implements Animal {
        name: String!
        dogBreed: String!
      }

      type Details {
        firstName: String!
        lastName: String!
      }
    `;
}

describe('Fix __typename in @requires field sets', () => {
  test('fix=false reports errors without fixing', () => {
    const sdl = buildSdl('pet { ... on Cat { name } ... on Dog { name } }');
    const visitor = new SDLValidationVisitor(sdl);
    const result = visitor.visit();

    expect(result.errors).toHaveLength(2);
    expect(visitor.getFixedSelections().size).toBe(0);
  });

  test('fix=true adds __typename to fragments missing it', () => {
    const sdl = buildSdl('pet { ... on Cat { name } ... on Dog { name } }');
    const visitor = new SDLValidationVisitor(sdl, { fix: true });
    const result = visitor.visit();

    expect(result.errors).toHaveLength(0);

    const fixes = visitor.getFixedSelections();
    expect(fixes.size).toBe(1);

    const fixed = [...fixes.values()][0];
    expect(fixed).toContain('__typename');
  });

  test('fix=true with __typename already present produces no fixes', () => {
    const sdl = buildSdl('pet { __typename ... on Cat { name } ... on Dog { name } }');
    const visitor = new SDLValidationVisitor(sdl, { fix: true });
    const result = visitor.visit();

    expect(result.errors).toHaveLength(0);
    expect(visitor.getFixedSelections().size).toBe(0);
  });

  test('fix=true adds __typename only to the fragment missing it', () => {
    const sdl = buildSdl('pet { ... on Cat { __typename name } ... on Dog { name } }');
    const visitor = new SDLValidationVisitor(sdl, { fix: true });
    const result = visitor.visit();

    expect(result.errors).toHaveLength(0);

    const fixes = visitor.getFixedSelections();
    expect(fixes.size).toBe(1);

    const fixed = [...fixes.values()][0];
    // Dog fragment should now have __typename
    expect(fixed).toMatch(/on Dog\s*{\s*__typename/);
  });

  test('fix defaults to false when options not provided', () => {
    const sdl = buildSdl('pet { ... on Cat { name } ... on Dog { name } }');
    const visitor = new SDLValidationVisitor(sdl);
    const result = visitor.visit();

    expect(result.errors).toHaveLength(2);
    expect(visitor.getFixedSelections().size).toBe(0);
  });

  describe('nested inline fragments', () => {
    test('fix=true adds __typename to nested fragments', () => {
      const sdl = buildNestedSdl(
        'pet { __typename ... on Cat { name friend { ... on Dog { name } ... on Cat { name } } } ... on Dog { name } }',
      );
      const visitor = new SDLValidationVisitor(sdl, { fix: true });
      const result = visitor.visit();

      expect(result.errors).toHaveLength(0);

      const fixes = visitor.getFixedSelections();
      expect(fixes.size).toBe(1);

      const fixed = [...fixes.values()][0];
      // Inner fragments should have __typename added
      expect(fixed).toMatch(/friend\s*{[^}]*on Dog\s*{\s*__typename/);
    });
  });
});
