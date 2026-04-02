import { describe, expect, test } from 'vitest';
import { SDLValidationVisitor } from '../../src/sdl-validation-visitor.js';

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

function buildUnionSdl(requiresFields: string): string {
  return `
        type Query {
          user(id: ID!): User!
        }

        type User @key(fields: "id") {
          id: ID!
          result: SearchResult! @external
          details: Details! @requires(fields: "${requiresFields}")
        }

        union SearchResult = Product | Article

        type Product {
          sku: String!
          price: Float!
        }

        type Article {
          title: String!
          body: String!
        }

        type Details {
          firstName: String!
          lastName: String!
        }
      `;
}

describe('Validation of @requires directive', () => {
  test('should validate a schema with a required field', () => {
    const sdl = `
      type Query {
        user(id: ID!): User!
      }

      type User @key(fields: "id") {
        id: ID!
        name: String! @external
        age: Int! @requires(fields: "name")
      }
    `;

    const visitor = new SDLValidationVisitor(sdl);
    const result = visitor.visit();

    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
  test('should return an error if the selection set does not contain __typename for an inline fragment', () => {
    const sdl = `
      type Query {
        user(id: ID!): User!
      }

      type User @key(fields: "id") {
        id: ID!
        pet: Animal! @external
        details: Details! @requires(fields: "pet { ... on Cat { name catBreed } ... on Dog { name dogBreed } }")
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

    const visitor = new SDLValidationVisitor(sdl);
    const result = visitor.visit();

    expect(result.errors).toHaveLength(2);
    expect(result.warnings).toHaveLength(0);
  });

  describe('__typename validation for inline fragments', () => {
    test('__typename in parent field, missing in all fragments — no errors', () => {
      const sdl = buildSdl('pet { __typename ... on Cat { name } ... on Dog { name } }');
      const visitor = new SDLValidationVisitor(sdl);
      const result = visitor.visit();

      expect(result.errors).toHaveLength(0);
    });

    test('__typename in each fragment, missing in parent — no errors', () => {
      const sdl = buildSdl('pet { ... on Cat { __typename name } ... on Dog { __typename name } }');
      const visitor = new SDLValidationVisitor(sdl);
      const result = visitor.visit();

      expect(result.errors).toHaveLength(0);
    });

    test('__typename in both parent and fragments — no errors', () => {
      const sdl = buildSdl('pet { __typename ... on Cat { __typename name } ... on Dog { __typename name } }');
      const visitor = new SDLValidationVisitor(sdl);
      const result = visitor.visit();

      expect(result.errors).toHaveLength(0);
    });

    test('__typename missing everywhere — 2 errors', () => {
      const sdl = buildSdl('pet { ... on Cat { name } ... on Dog { name } }');
      const visitor = new SDLValidationVisitor(sdl);
      const result = visitor.visit();

      expect(result.errors).toHaveLength(2);
    });

    test('__typename in parent, one fragment also has it — no errors', () => {
      const sdl = buildSdl('pet { __typename ... on Cat { __typename name } ... on Dog { name } }');
      const visitor = new SDLValidationVisitor(sdl);
      const result = visitor.visit();

      expect(result.errors).toHaveLength(0);
    });

    test('__typename only in one fragment, no parent — 1 error for Dog', () => {
      const sdl = buildSdl('pet { ... on Cat { __typename name } ... on Dog { name } }');
      const visitor = new SDLValidationVisitor(sdl);
      const result = visitor.visit();

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Dog');
      expect(result.errors[0]).toContain('in "pet"');
    });

    test('single fragment missing __typename, no parent — 1 error', () => {
      const sdl = buildSdl('pet { ... on Cat { name } }');
      const visitor = new SDLValidationVisitor(sdl);
      const result = visitor.visit();

      expect(result.errors).toHaveLength(1);
    });
  });

  describe('nested inline fragment __typename validation', () => {
    const nestedSdl = `
      type Query {
        user(id: ID!): User!
      }

      type User @key(fields: "id") {
        id: ID!
        pet: Animal! @external
        details: Details! @requires(fields: "PLACEHOLDER")
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

    function buildNestedSdl(requiresFields: string): string {
      return nestedSdl.replace('PLACEHOLDER', requiresFields);
    }

    test('nested fragments with __typename at both levels — no errors', () => {
      const sdl = buildNestedSdl(
        'pet { __typename ... on Cat { name friend { __typename ... on Dog { name } ... on Cat { name } } } ... on Dog { name } }',
      );
      const visitor = new SDLValidationVisitor(sdl);
      const result = visitor.visit();

      expect(result.errors).toHaveLength(0);
    });

    test('nested fragments missing __typename at inner level — errors for inner fragments', () => {
      const sdl = buildNestedSdl(
        'pet { __typename ... on Cat { name friend { ... on Dog { name } ... on Cat { name } } } ... on Dog { name } }',
      );
      const visitor = new SDLValidationVisitor(sdl);
      const result = visitor.visit();

      expect(result.errors).toHaveLength(2);
      expect(result.errors[0]).toContain('in "pet.friend"');
      expect(result.errors[1]).toContain('in "pet.friend"');
    });

    test('nested fragments with __typename in inner parent field — no errors', () => {
      const sdl = buildNestedSdl(
        'pet { __typename ... on Cat { name friend { __typename ... on Dog { name } } } ... on Dog { name } }',
      );
      const visitor = new SDLValidationVisitor(sdl);
      const result = visitor.visit();

      expect(result.errors).toHaveLength(0);
    });

    test('sibling inline fragment after nested field uses parent __typename, not inner field', () => {
      // __typename only on pet (outer), friend has no __typename.
      // After leaving friend, currentFieldSelectionSet must restore to pet so Dog (sibling) passes.
      const sdl = buildNestedSdl(
        'pet { __typename ... on Cat { name friend { __typename ... on Dog { name } } } ... on Dog { name } }',
      );
      const visitor = new SDLValidationVisitor(sdl);
      const result = visitor.visit();

      expect(result.errors).toHaveLength(0);
    });

    test('sibling inline fragment after nested field fails when neither level has __typename', () => {
      // No __typename anywhere — inner fragments (2) and both outer fragments (2) should all fail
      const sdl = buildNestedSdl(
        'pet { ... on Cat { name friend { ... on Dog { name } ... on Cat { name } } } ... on Dog { name } }',
      );
      const visitor = new SDLValidationVisitor(sdl);
      const result = visitor.visit();

      expect(result.errors).toHaveLength(4);
      const petErrors = result.errors.filter((e) => e.includes('in "pet"') && !e.includes('in "pet.friend"'));
      const petFriendErrors = result.errors.filter((e) => e.includes('in "pet.friend"'));
      expect(petErrors).toHaveLength(2);
      expect(petFriendErrors).toHaveLength(2);
    });

    test('triple nesting — path should be "pet.friend.friend"', () => {
      const sdl = buildNestedSdl(
        'pet { __typename ... on Cat { name friend { __typename ... on Dog { name friend { ... on Cat { name } } } } } ... on Dog { name } }',
      );
      const visitor = new SDLValidationVisitor(sdl);
      const result = visitor.visit();

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('in "pet.friend.friend"');
    });

    test('fragments at different nesting levels produce distinct paths', () => {
      // __typename missing at both levels
      const sdl = buildNestedSdl('pet { ... on Cat { name friend { ... on Dog { name } } } ... on Dog { name } }');
      const visitor = new SDLValidationVisitor(sdl);
      const result = visitor.visit();

      const petErrors = result.errors.filter((e) => e.includes('in "pet"') && !e.includes('in "pet.friend"'));
      const petFriendErrors = result.errors.filter((e) => e.includes('in "pet.friend"'));
      expect(petErrors).toHaveLength(2);
      expect(petFriendErrors).toHaveLength(1);
    });
  });

  describe('union type __typename validation', () => {
    test('__typename in parent field, missing in all fragments — no errors', () => {
      const sdl = buildUnionSdl('result { __typename ... on Product { sku } ... on Article { title } }');
      const visitor = new SDLValidationVisitor(sdl);
      const result = visitor.visit();

      expect(result.errors).toHaveLength(0);
    });

    test('__typename in each fragment, missing in parent — no errors', () => {
      const sdl = buildUnionSdl('result { ... on Product { __typename sku } ... on Article { __typename title } }');
      const visitor = new SDLValidationVisitor(sdl);
      const result = visitor.visit();

      expect(result.errors).toHaveLength(0);
    });

    test('__typename missing everywhere — 2 errors', () => {
      const sdl = buildUnionSdl('result { ... on Product { sku } ... on Article { title } }');
      const visitor = new SDLValidationVisitor(sdl);
      const result = visitor.visit();

      expect(result.errors).toHaveLength(2);
    });

    test('__typename only in one fragment — 1 error for Article', () => {
      const sdl = buildUnionSdl('result { ... on Product { __typename sku } ... on Article { title } }');
      const visitor = new SDLValidationVisitor(sdl);
      const result = visitor.visit();

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Article');
      expect(result.errors[0]).toContain('in "result"');
    });

    test('__typename in both parent and fragments — no errors', () => {
      const sdl = buildUnionSdl(
        'result { __typename ... on Product { __typename sku } ... on Article { __typename title } }',
      );
      const visitor = new SDLValidationVisitor(sdl);
      const result = visitor.visit();

      expect(result.errors).toHaveLength(0);
    });

    test('single union member fragment missing __typename — 1 error', () => {
      const sdl = buildUnionSdl('result { ... on Product { sku } }');
      const visitor = new SDLValidationVisitor(sdl);
      const result = visitor.visit();

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Product');
    });
  });
});
