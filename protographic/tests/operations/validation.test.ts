import { describe, expect, test } from 'vitest';
import { compileOperationsToProto } from '../../src/index.js';

describe('GraphQL Operation Validation', () => {
  const schema = `
    type Query {
      user(id: ID!): User
    }

    type User {
      id: ID!
      name: String!
      friends: [User!]!
    }
  `;

  test('should reject circular fragment references', () => {
    const operation = `
      query GetUser($id: ID!) {
        user(id: $id) {
          ...UserWithFriends
        }
      }

      fragment UserWithFriends on User {
        id
        name
        friends {
          ...UserWithFriends
        }
      }
    `;

    expect(() => compileOperationsToProto(operation, schema)).toThrow(/cannot spread fragment.*within itself/i);
  });

  test('should reject unknown types', () => {
    const operation = `
      query GetUser($id: ID!) {
        user(id: $id) {
          id
          name
          unknownField
        }
      }
    `;

    expect(() => compileOperationsToProto(operation, schema)).toThrow(/Invalid GraphQL operation/);
  });

  test('should reject invalid field selections', () => {
    const operation = `
      query GetUser($id: ID!) {
        user(id: $id) {
          id
          name {
            nested
          }
        }
      }
    `;

    expect(() => compileOperationsToProto(operation, schema)).toThrow(/Invalid GraphQL operation/);
  });

  test('should reject type mismatches', () => {
    const operation = `
      query GetUser($id: String!) {
        user(id: $id) {
          id
          name
        }
      }
    `;

    expect(() => compileOperationsToProto(operation, schema)).toThrow(/Invalid GraphQL operation/);
  });

  test('should accept valid operations', () => {
    const operation = `
      query GetUser($id: ID!) {
        user(id: $id) {
          id
          name
          friends {
            id
            name
          }
        }
      }
    `;

    expect(() => compileOperationsToProto(operation, schema)).not.toThrow();
  });

  test('should accept valid operations with non-circular fragments', () => {
    const operation = `
      query GetUser($id: ID!) {
        user(id: $id) {
          ...UserFields
          friends {
            ...UserFields
          }
        }
      }

      fragment UserFields on User {
        id
        name
      }
    `;

    expect(() => compileOperationsToProto(operation, schema)).not.toThrow();
  });

  test('should reject operations with undefined fragments', () => {
    const operation = `
      query GetUser($id: ID!) {
        user(id: $id) {
          ...UndefinedFragment
        }
      }
    `;

    expect(() => compileOperationsToProto(operation, schema)).toThrow(/Invalid GraphQL operation/);
  });

  test('should reject operations with unused fragments', () => {
    const operation = `
      query GetUser($id: ID!) {
        user(id: $id) {
          id
          name
        }
      }

      fragment UnusedFragment on User {
        id
        name
      }
    `;

    expect(() => compileOperationsToProto(operation, schema)).toThrow(/Invalid GraphQL operation/);
  });
});
