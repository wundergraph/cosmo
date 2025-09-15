import { buildSchema } from 'graphql';
import { describe, expect, test } from 'vitest';
import { SDLValidationVisitor } from '../../src/sdl-validation-visitor';

describe('SDL Validation', () => {
  test('should validate a basic schema', () => {
    const sdl = `
            type Query {
                stringField: String
            }
        `;

    const visitor = new SDLValidationVisitor(sdl);
    const result = visitor.visit();

    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  test('should validate a complex valid schema', () => {
    const sdl = `
            type Query {
                user(id: ID!): User!
                users: [User!]!
                storage(id: ID!): Storage!
                project(id: ID!): Project!
                projects: [Project!]!
            }

            type User @key(fields: "id") {
                id: ID!
                name: String!
                age: Int!
            }

            type Storage @key(fields: "id name") {
                id: ID!
                name: String!
                size: Int!
            }

            type Project @key(fields: "id") @key(fields: "name") {
                id: ID!
                name: String!
                storage: Storage!
                users: [User!]!
                matrix: [[Matrix!]]!
                tags: [[String!]]
            }
        `;

    const visitor = new SDLValidationVisitor(sdl);
    const result = visitor.visit();

    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  test('should return a warning if a list type has a nullable item', () => {
    const sdl = `
            type Query {
                stringField: [String]!
            }
        `;

    const visitor = new SDLValidationVisitor(sdl);
    const result = visitor.visit();

    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Nullable items are not supported in list types');
  });

  test('should return a warning if a nested list type has a nullable item', () => {
    const sdl = `
            type Query {
                stringField: [[String]!]!
            }
        `;

    const visitor = new SDLValidationVisitor(sdl);
    const result = visitor.visit();

    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Nullable items are not supported in list types');
  });

  test('should return a warning if a type has a nested key directive', () => {
    const sdl = `
            type Query {
                user: User!
            }

            type Nested {
                name: String!
            }

            type User @key(fields: "id nested { name }") {
                id: ID!
                nested: Nested!
            }
        `;

    const visitor = new SDLValidationVisitor(sdl);
    const result = visitor.visit();

    expect(result.errors).toHaveLength(1);
    expect(result.warnings).toHaveLength(0);
    expect(result.errors[0]).toContain('Nested key directives are not supported');
  });

  test('should return a warning if a field has a requires directive', () => {
    const sdl = `
            type Query {
                user: User!
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
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Use of requires is not supported yet');
  });
});
