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

  test('should return an error if a field has an invalid resolver context', () => {
    const sdl = `
        type Query {
            user: User!
        }

        type User {
            name(context: String!): String!
        }
    `;

    const visitor = new SDLValidationVisitor(sdl);
    const result = visitor.visit();

    expect(result.errors).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('No @resolved directive found on the field name - falling back to ID field');
    expect(result.errors[0]).toContain('No fields with type ID found');
  });

  test('should not return an error for fields with arguments in operation types', () => {
    const sdl = `
        type Query {
            user(id: ID!): User!
        }
        
        type Mutation {
            createUser(user: UserInput!): User!
        }

        type Subscription {
            user(id: ID!): User!
        }

        type User {
            id: ID!
            name: String!
        }
    `;

    const visitor = new SDLValidationVisitor(sdl);
    const result = visitor.visit();

    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  test('should return an error if an empty context was provided and no ID field is present', () => {
    const sdl = `
        directive @resolved(context: openfed__FieldSet!) on FIELD_DEFINITION
        scalar openfed__FieldSet

        type Query {
            user(id: ID!): User!
        }

        type User {
            name(context: String!): String! @resolved(context: "")
        }
    `;

    const visitor = new SDLValidationVisitor(sdl);
    const result = visitor.visit();

    expect(result.errors).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('No @resolved directive found on the field name - falling back to ID field');
    expect(result.errors[0]).toContain('No fields with type ID found');
  });

  test('should raise a warning if an empty context was provided and it is able to default to the ID field', () => {
    const sdl = `
        directive @resolved(context: openfed__FieldSet!) on FIELD_DEFINITION
        scalar openfed__FieldSet

        type Query {
            user(id: ID!): User!
        }

        type User {
            id: ID!
            name(context: String!): String! @resolved
        }
    `;

    const visitor = new SDLValidationVisitor(sdl);
    const result = visitor.visit();

    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('No @resolved directive found on the field name - falling back to ID field');
  });

  test('should return an error if multiple ID fields are present but no context is provided', () => {
    const sdl = `
        directive @resolved(context: openfed__FieldSet!) on FIELD_DEFINITION
        scalar openfed__FieldSet

        type Query {
            user(id: ID!): User!
        }

        type User {
            id: ID!
            uuid: ID!
            name(context: String!): String! @resolved
        }
    `;

    const visitor = new SDLValidationVisitor(sdl);
    const result = visitor.visit();

    expect(result.errors).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('No @resolved directive found on the field name - falling back to ID field');
    expect(result.errors[0]).toContain(
      'Multiple fields with type ID found - provide a context with the fields you want to use in the @resolved directive',
    );
  });

  test('should return an error when attempting to use the resolver field in the context', () => {
    const sdl = `
        directive @resolved(context: openfed__FieldSet!) on FIELD_DEFINITION
        scalar openfed__FieldSet

        type Query {
            user(id: ID!): User!
        }

        type User {
            id: ID!
            name(context: String!): String! @resolved(context: "name")
        }
    `;

    const visitor = new SDLValidationVisitor(sdl);
    const result = visitor.visit();

    expect(result.errors).toHaveLength(1);
    expect(result.warnings).toHaveLength(0);
    expect(result.errors[0]).toContain(
      'Invalid context provided for resolver. Cannot contain resolver field in the context',
    );
  });

  test('should return an error when attempting to use a non existing field in the context', () => {
    const sdl = `
        directive @resolved(context: openfed__FieldSet!) on FIELD_DEFINITION
        scalar openfed__FieldSet

        type Query {
            user(id: ID!): User!
        }

        type User {
            id: ID!
            name(context: String!): String! @resolved(context: "id nonExistingField")
        }
    `;

    const visitor = new SDLValidationVisitor(sdl);
    const result = visitor.visit();

    expect(result.errors).toHaveLength(1);
    expect(result.warnings).toHaveLength(0);
    expect(result.errors[0]).toContain(
      'Invalid context provided for resolver. Context contains invalid fields: nonExistingField',
    );
  });

  test('should not return an error if multiple ID fields are present and a context is provided', () => {
    const sdl = `
        directive @resolved(context: openfed__FieldSet!) on FIELD_DEFINITION
        scalar openfed__FieldSet

        type Query {
            user(id: ID!): User!
        }

        type User {
            id: ID!
            uuid: ID!
            name(context: String!): String! @resolved(context: "id uuid")
        }
    `;

    const visitor = new SDLValidationVisitor(sdl);
    const result = visitor.visit();

    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  test('should not return an error if multiple ID fields are present and a context is provided with comma separated values', () => {
    const sdl = `
        directive @resolved(context: openfed__FieldSet!) on FIELD_DEFINITION
        scalar openfed__FieldSet

        type Query {
            user(id: ID!): User!
        }

        type User {
            id: ID!
            uuid: ID!
            otherId: ID!
            name(context: String!): String! @resolved(context: "id, uuid,otherId")
        }
    `;

    const visitor = new SDLValidationVisitor(sdl);
    const result = visitor.visit();

    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  test('should allow to only select one field from the context', () => {
    const sdl = `
        directive @resolved(context: openfed__FieldSet!) on FIELD_DEFINITION
        scalar openfed__FieldSet

        type Query {
            user(id: ID!): User!
        }

        type User {
            id: ID!
            firstname: String
            lastname: String
            grandparent(parent: String!): String! @resolved(context: "firstname")
        }
    `;

    const visitor = new SDLValidationVisitor(sdl);
    const result = visitor.visit();

    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});
