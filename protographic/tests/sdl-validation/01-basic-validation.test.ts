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

        type Matrix {
            id: ID!
            name: String!
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

  test('should not return a warning if a field has a requires directive', () => {
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
    expect(result.warnings).toHaveLength(0);
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
    expect(result.warnings[0]).toContain(
      'No @connect__fieldResolver directive found on the field name - falling back to ID field',
    );
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

        input UserInput {
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
        directive @connect__fieldResolver(context: openfed__FieldSet!) on FIELD_DEFINITION
        scalar openfed__FieldSet

        type Query {
            user(id: ID!): User!
        }

        type User {
            name(context: String!): String! @connect__fieldResolver(context: "")
        }
    `;

    const visitor = new SDLValidationVisitor(sdl);
    const result = visitor.visit();

    expect(result.errors).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain(
      'No @connect__fieldResolver directive found on the field name - falling back to ID field',
    );
    expect(result.errors[0]).toContain('No fields with type ID found');
  });

  test('should raise a warning if an empty context was provided and it is able to default to the ID field', () => {
    const sdl = `
        directive @connect__fieldResolver(context: openfed__FieldSet!) on FIELD_DEFINITION
        scalar openfed__FieldSet

        type Query {
            user(id: ID!): User!
        }

        type User {
            id: ID!
            name(context: String!): String! @connect__fieldResolver
        }
    `;

    const visitor = new SDLValidationVisitor(sdl);
    const result = visitor.visit();

    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain(
      'No @connect__fieldResolver directive found on the field name - falling back to ID field',
    );
  });

  test('should return an error if multiple ID fields are present but no context is provided', () => {
    const sdl = `
        directive @connect__fieldResolver(context: openfed__FieldSet!) on FIELD_DEFINITION
        scalar openfed__FieldSet

        type Query {
            user(id: ID!): User!
        }

        type User {
            id: ID!
            uuid: ID!
            name(context: String!): String! @connect__fieldResolver
        }
    `;

    const visitor = new SDLValidationVisitor(sdl);
    const result = visitor.visit();

    expect(result.errors).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain(
      'No @connect__fieldResolver directive found on the field name - falling back to ID field',
    );
    expect(result.errors[0]).toContain(
      'Multiple fields with type ID found - provide a context with the fields you want to use in the @connect__fieldResolver directive',
    );
  });

  test('should return an error when attempting to use the resolver field in the context', () => {
    const sdl = `
        directive @connect__fieldResolver(context: openfed__FieldSet!) on FIELD_DEFINITION
        scalar openfed__FieldSet

        type Query {
            user(id: ID!): User!
        }

        type User {
            id: ID!
            name(context: String!): String! @connect__fieldResolver(context: "name")
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
        directive @connect__fieldResolver(context: openfed__FieldSet!) on FIELD_DEFINITION
        scalar openfed__FieldSet

        type Query {
            user(id: ID!): User!
        }

        type User {
            id: ID!
            name(context: String!): String! @connect__fieldResolver(context: "id nonExistingField")
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
        directive @connect__fieldResolver(context: openfed__FieldSet!) on FIELD_DEFINITION
        scalar openfed__FieldSet

        type Query {
            user(id: ID!): User!
        }

        type User {
            id: ID!
            uuid: ID!
            name(context: String!): String! @connect__fieldResolver(context: "id uuid")
        }
    `;

    const visitor = new SDLValidationVisitor(sdl);
    const result = visitor.visit();

    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  test('should not return an error if multiple ID fields are present and a context is provided with comma separated values', () => {
    const sdl = `
        directive @connect__fieldResolver(context: openfed__FieldSet!) on FIELD_DEFINITION
        scalar openfed__FieldSet

        type Query {
            user(id: ID!): User!
        }

        type User {
            id: ID!
            uuid: ID!
            otherId: ID!
            name(context: String!): String! @connect__fieldResolver(context: "id, uuid,otherId")
        }
    `;

    const visitor = new SDLValidationVisitor(sdl);
    const result = visitor.visit();

    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  test('should allow to only select one field from the context', () => {
    const sdl = `
        directive @connect__fieldResolver(context: openfed__FieldSet!) on FIELD_DEFINITION
        scalar openfed__FieldSet

        type Query {
            user(id: ID!): User!
        }

        type User {
            id: ID!
            firstname: String
            lastname: String
            grandparent(parent: String!): String! @connect__fieldResolver(context: "firstname")
        }
    `;

    const visitor = new SDLValidationVisitor(sdl);
    const result = visitor.visit();

    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
  test('should return an error if a field has a provides directive', () => {
    const sdl = `
        type Query {
            user: User!
        }

        type User @key(fields: "id") {
            id: ID!
            name: String! @external
            age: Int! @provides(fields: "name")
        }
    `;

    const visitor = new SDLValidationVisitor(sdl);
    const result = visitor.visit();

    expect(result.errors).toHaveLength(1);
    expect(result.warnings).toHaveLength(0);
    expect(result.errors[0]).toContain('Use of provides is not supported in connect subgraphs');
  });

  test('should return an error if a field contains a field in the context of another field', () => {
    const sdl = `
        type Query {
            user: User!
        }

        type User @key(fields: "id name") {
            id: ID!
            foo(a: String!): String! @connect__fieldResolver(context: "parent")
            parent(context: String!): String! @connect__fieldResolver(context: "foo")
        }
    `;

    const visitor = new SDLValidationVisitor(sdl);
    const result = visitor.visit();

    expect(result.errors).toHaveLength(2);
    expect(result.warnings).toHaveLength(0);
    expect(result.errors[0]).toContain(
      '[Error] Cycle detected in context: field "foo" is referenced in the following path: "foo.parent"',
    );
    expect(result.errors[1]).toContain(
      '[Error] Cycle detected in context: field "parent" is referenced in the following path: "parent.foo"',
    );
  });

  test('should return no error when no cycle is detected', () => {
    const sdl = `
        type Query {
            user: User!
        }

        type User @key(fields: "id name") {
            id: ID!
            foo(a: String!): String! @connect__fieldResolver(context: "id")
            parent(context: String!): String! @connect__fieldResolver(context: "id foo")
        }
    `;

    const visitor = new SDLValidationVisitor(sdl);
    const result = visitor.visit();

    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  test('should return an error if a field contains a deep cycle in the context', () => {
    const sdl = `
        type Query {
            user: User!
        }

        type User @key(fields: "id name") {
            id: ID!
            foo(a: String!): String! @connect__fieldResolver(context: "baz")
            bar(context: String!): String! @connect__fieldResolver(context: "foo")
            baz(context: String!): String! @connect__fieldResolver(context: "bar")
        }
    `;

    const visitor = new SDLValidationVisitor(sdl);
    const result = visitor.visit();

    expect(result.errors).toHaveLength(3);
    expect(result.warnings).toHaveLength(0);
    expect(result.errors[0]).toContain(
      '[Error] Cycle detected in context: field "foo" is referenced in the following path: "foo.baz.bar"',
    );
    expect(result.errors[1]).toContain(
      '[Error] Cycle detected in context: field "bar" is referenced in the following path: "bar.foo.baz"',
    );
    expect(result.errors[2]).toContain(
      '[Error] Cycle detected in context: field "baz" is referenced in the following path: "baz.bar.foo"',
    );
  });

  test('should return an error if an abstract type is used in a requires directive', () => {
    const sdl = `
        type Query {
            user: User!
        }

        type User @key(fields: "id name") {
            id: ID!
            pet: Animal! @external
            name: String! @requires(fields: "pet { ... on Cat { name } }")
        }

        type Cat {
            name: String!
        }

        type Dog {
            name: String!
        }

        union Animal = Cat | Dog
    `;

    const visitor = new SDLValidationVisitor(sdl);
    const result = visitor.visit();

    expect(result.errors).toHaveLength(1);
    expect(result.warnings).toHaveLength(0);
    expect(result.errors[0]).toContain(
      '[Error] Abstract types are not allowed in requires directives. Found Animal in User.pet at',
    );
  });

  test('should correctly handle nested fields in requires directives', () => {
    const sdl = `
    type Warehouse @key(fields: "id") {
      id: ID!
      name: String!
      location: String!
      inventoryCount: Int! @external
      restockData: RestockData! @external
      stockHealthScore: Float! @requires(fields: "inventoryCount restockData { lastRestockDate }")
    }

    type RestockData {
        lastRestockDate: String!
    }
`;

    const visitor = new SDLValidationVisitor(sdl);
    const result = visitor.visit();

    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  test('should return an error for invalid @requires field selection syntax', () => {
    const sdl = `
        type Query {
            user: User!
        }

        type User @key(fields: "id") {
            id: ID!
            name: String! @external
            age: Int! @requires(fields: "name {")
        }
    `;

    const visitor = new SDLValidationVisitor(sdl);
    const result = visitor.visit();

    expect(result.errors).toHaveLength(1);
    expect(result.warnings).toHaveLength(0);
    expect(result.errors[0]).toContain('Invalid @requires field selection syntax');
  });

  test('should return an error for @requires with unclosed braces', () => {
    const sdl = `
        type Query {
            user: User!
        }

        type User @key(fields: "id") {
            id: ID!
            details: Details! @external
            computed: String! @requires(fields: "details { foo")
        }

        type Details {
            foo: String!
        }
    `;

    const visitor = new SDLValidationVisitor(sdl);
    const result = visitor.visit();

    expect(result.errors).toHaveLength(1);
    expect(result.warnings).toHaveLength(0);
    expect(result.errors[0]).toContain('Invalid @requires field selection syntax');
  });
});
