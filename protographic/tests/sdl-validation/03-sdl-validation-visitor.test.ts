import { describe, expect, test } from 'vitest';
import { SDLValidationVisitor } from '../../src/sdl-validation-visitor.js';

describe('SDLValidationVisitor public API', () => {
  const cleanSdl = `
    type Query {
      hello: String!
    }
  `;

  describe('error message formatting', () => {
    test('errors include [Error] prefix and location info', () => {
      const sdl = `
        type Query {
          user: User!
        }
        type User @key(fields: "id nested { name }") {
          id: ID!
          nested: Nested!
        }
        type Nested {
          name: String!
        }
      `;
      const visitor = new SDLValidationVisitor(sdl);
      const result = visitor.visit();

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toMatch(/^\[Error]/);
      expect(result.errors[0]).toMatch(/at line \d+, column \d+/);
    });

    test('warnings include [Warning] prefix and location info', () => {
      const sdl = `
        type Query {
          items: [String]!
        }
      `;
      const visitor = new SDLValidationVisitor(sdl);
      const result = visitor.visit();

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toMatch(/^\[Warning]/);
      expect(result.warnings[0]).toMatch(/at line \d+, column \d+/);
    });
  });

  describe('validateCompositeTypeReflection edge cases', () => {
    test('@requires with unparseable field set produces error', () => {
      const sdl = `
        type Query {
          user(id: ID!): User!
        }
        type User @key(fields: "id") {
          id: ID!
          name: String! @external
          details: String! @requires(fields: "{ invalid [")
        }
      `;
      const visitor = new SDLValidationVisitor(sdl);
      const result = visitor.visit();

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes('Invalid @requires directive'))).toBe(true);
    });

    test('multiple @requires on different fields in the same type validates each independently', () => {
      const sdl = `
        type Query {
          user(id: ID!): User!
        }
        type User @key(fields: "id") {
          id: ID!
          pet: Animal! @external
          companion: Animal! @external
          petName: String! @requires(fields: "pet { __typename ... on Cat { name } }")
          companionName: String! @requires(fields: "companion { __typename ... on Dog { breed } }")
        }
        interface Animal {
          name: String!
        }
        type Cat implements Animal {
          name: String!
        }
        type Dog implements Animal {
          name: String!
          breed: String!
        }
      `;
      const visitor = new SDLValidationVisitor(sdl);
      const result = visitor.visit();

      // Both @requires are valid — __typename is present
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('schema parse error handling', () => {
    test('completely invalid GraphQL throws during construction', () => {
      expect(() => new SDLValidationVisitor('this is not graphql at all!!!')).toThrow();
    });

    test('visit() wraps parse errors as TypeError', () => {
      // Construct with valid SDL, then corrupt to trigger visit() error path
      const visitor = new SDLValidationVisitor(cleanSdl);
      // Override the schema to force a parse failure in visit()
      (visitor as any).schema = '!!!invalid!!!';
      expect(() => visitor.visit()).toThrow(TypeError);
    });
  });
});
