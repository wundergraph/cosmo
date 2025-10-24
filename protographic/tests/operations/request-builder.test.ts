import { describe, expect, test } from 'vitest';
import { buildSchema, parse } from 'graphql';
import {
  buildRequestMessage,
  buildInputObjectMessage,
  buildEnumType,
} from '../../src/operations/request-builder';
import { createFieldNumberManager } from '../../src/operations/field-numbering';

describe('Request Builder', () => {
  describe('buildRequestMessage', () => {
    test('should build request message with no variables', () => {
      const schema = buildSchema(`
        type Query {
          users: [User]
        }
        
        type User {
          id: ID!
        }
      `);
      
      const query = parse(`
        query GetUsers {
          users {
            id
          }
        }
      `);
      
      const operation = query.definitions[0];
      if (operation.kind !== 'OperationDefinition') {
        throw new Error('Invalid operation');
      }
      
      const message = buildRequestMessage(
        'GetUsersRequest',
        operation.variableDefinitions || [],
        schema,
      );
      
      expect(message.name).toBe('GetUsersRequest');
      expect(message.fieldsArray).toHaveLength(0);
    });

    test('should build request message with scalar variables', () => {
      const schema = buildSchema(`
        type Query {
          user(id: ID!, name: String): User
        }
        
        type User {
          id: ID!
          name: String
        }
      `);
      
      const query = parse(`
        query GetUser($id: ID!, $name: String) {
          user(id: $id, name: $name) {
            id
            name
          }
        }
      `);
      
      const operation = query.definitions[0];
      if (operation.kind !== 'OperationDefinition') {
        throw new Error('Invalid operation');
      }
      
      const message = buildRequestMessage(
        'GetUserRequest',
        operation.variableDefinitions || [],
        schema,
      );
      
      expect(message.name).toBe('GetUserRequest');
      expect(message.fieldsArray).toHaveLength(2);
      expect(message.fields.id).toBeDefined();
      expect(message.fields.name).toBeDefined();
    });

    test('should handle non-null variables correctly', () => {
      const schema = buildSchema(`
        type Query {
          user(id: ID!): User
        }
        
        type User {
          id: ID!
        }
      `);
      
      const query = parse(`
        query GetUser($id: ID!) {
          user(id: $id) {
            id
          }
        }
      `);
      
      const operation = query.definitions[0];
      if (operation.kind !== 'OperationDefinition') {
        throw new Error('Invalid operation');
      }
      
      const message = buildRequestMessage(
        'GetUserRequest',
        operation.variableDefinitions || [],
        schema,
      );
      
      expect(message.fields.id).toBeDefined();
      expect(message.fields.id.type).toBe('string');
    });

    test('should handle list variables', () => {
      const schema = buildSchema(`
        type Query {
          users(ids: [ID!]!): [User]
        }
        
        type User {
          id: ID!
        }
      `);
      
      const query = parse(`
        query GetUsers($ids: [ID!]!) {
          users(ids: $ids) {
            id
          }
        }
      `);
      
      const operation = query.definitions[0];
      if (operation.kind !== 'OperationDefinition') {
        throw new Error('Invalid operation');
      }
      
      const message = buildRequestMessage(
        'GetUsersRequest',
        operation.variableDefinitions || [],
        schema,
      );
      
      expect(message.fields.ids).toBeDefined();
      expect(message.fields.ids.repeated).toBe(true);
    });

    test('should use field number manager', () => {
      const schema = buildSchema(`
        type Query {
          user(id: ID!, name: String): User
        }
        
        type User {
          id: ID!
        }
      `);
      
      const query = parse(`
        query GetUser($id: ID!, $name: String) {
          user(id: $id, name: $name) {
            id
          }
        }
      `);
      
      const operation = query.definitions[0];
      if (operation.kind !== 'OperationDefinition') {
        throw new Error('Invalid operation');
      }
      
      const manager = createFieldNumberManager();
      
      const message = buildRequestMessage(
        'GetUserRequest',
        operation.variableDefinitions || [],
        schema,
        {
          fieldNumberManager: manager,
        },
      );
      
      expect(manager.getFieldNumber('GetUserRequest', 'id')).toBe(1);
      expect(manager.getFieldNumber('GetUserRequest', 'name')).toBe(2);
    });

    test('should handle input object variables', () => {
      const schema = buildSchema(`
        type Query {
          createUser(input: UserInput!): User
        }
        
        input UserInput {
          name: String!
          email: String!
        }
        
        type User {
          id: ID!
          name: String
        }
      `);
      
      const query = parse(`
        query CreateUser($input: UserInput!) {
          createUser(input: $input) {
            id
          }
        }
      `);
      
      const operation = query.definitions[0];
      if (operation.kind !== 'OperationDefinition') {
        throw new Error('Invalid operation');
      }
      
      const message = buildRequestMessage(
        'CreateUserRequest',
        operation.variableDefinitions || [],
        schema,
      );
      
      expect(message.fields.input).toBeDefined();
      expect(message.fields.input.type).toBe('UserInput');
    });

    test('should convert variable names to snake_case', () => {
      const schema = buildSchema(`
        type Query {
          user(firstName: String): User
        }
        
        type User {
          id: ID!
        }
      `);
      
      const query = parse(`
        query GetUser($firstName: String) {
          user(firstName: $firstName) {
            id
          }
        }
      `);
      
      const operation = query.definitions[0];
      if (operation.kind !== 'OperationDefinition') {
        throw new Error('Invalid operation');
      }
      
      const message = buildRequestMessage(
        'GetUserRequest',
        operation.variableDefinitions || [],
        schema,
      );
      
      expect(message.fields.first_name).toBeDefined();
    });
  });

  describe('buildInputObjectMessage', () => {
    test('should build message from input object type', () => {
      const schema = buildSchema(`
        input UserInput {
          name: String!
          email: String!
          age: Int
        }
      `);
      
      const inputType = schema.getType('UserInput');
      if (!inputType || inputType.constructor.name !== 'GraphQLInputObjectType') {
        throw new Error('Invalid input type');
      }
      
      const message = buildInputObjectMessage(inputType as any);
      
      expect(message.name).toBe('UserInput');
      expect(message.fieldsArray).toHaveLength(3);
      expect(message.fields.name).toBeDefined();
      expect(message.fields.email).toBeDefined();
      expect(message.fields.age).toBeDefined();
    });

    test('should handle nested input objects', () => {
      const schema = buildSchema(`
        input ProfileInput {
          bio: String
        }
        
        input UserInput {
          name: String!
          profile: ProfileInput
        }
      `);
      
      const inputType = schema.getType('UserInput');
      if (!inputType || inputType.constructor.name !== 'GraphQLInputObjectType') {
        throw new Error('Invalid input type');
      }
      
      const message = buildInputObjectMessage(inputType as any);
      
      expect(message.name).toBe('UserInput');
      expect(message.fields.profile).toBeDefined();
      expect(message.fields.profile.type).toBe('ProfileInput');
    });

    test('should use field number manager', () => {
      const schema = buildSchema(`
        input UserInput {
          name: String!
          email: String!
        }
      `);
      
      const inputType = schema.getType('UserInput');
      if (!inputType || inputType.constructor.name !== 'GraphQLInputObjectType') {
        throw new Error('Invalid input type');
      }
      
      const manager = createFieldNumberManager();
      
      const message = buildInputObjectMessage(inputType as any, {
        fieldNumberManager: manager,
      });
      
      expect(manager.getFieldNumber('UserInput', 'name')).toBeDefined();
      expect(manager.getFieldNumber('UserInput', 'email')).toBeDefined();
    });
  });

  describe('buildEnumType', () => {
    test('should build enum from GraphQL enum type', () => {
      const schema = buildSchema(`
        enum Status {
          ACTIVE
          INACTIVE
          PENDING
        }
      `);
      
      const enumType = schema.getType('Status');
      if (!enumType || enumType.constructor.name !== 'GraphQLEnumType') {
        throw new Error('Invalid enum type');
      }
      
      const protoEnum = buildEnumType(enumType as any);
      
      expect(protoEnum.name).toBe('Status');
      expect(protoEnum.values.UNSPECIFIED).toBe(0);
      expect(protoEnum.values.ACTIVE).toBeDefined();
      expect(protoEnum.values.INACTIVE).toBeDefined();
      expect(protoEnum.values.PENDING).toBeDefined();
    });

    test('should include UNSPECIFIED as first value', () => {
      const schema = buildSchema(`
        enum Role {
          ADMIN
          USER
        }
      `);
      
      const enumType = schema.getType('Role');
      if (!enumType || enumType.constructor.name !== 'GraphQLEnumType') {
        throw new Error('Invalid enum type');
      }
      
      const protoEnum = buildEnumType(enumType as any);
      
      expect(protoEnum.values.UNSPECIFIED).toBe(0);
      expect(protoEnum.values.ADMIN).toBeGreaterThan(0);
      expect(protoEnum.values.USER).toBeGreaterThan(0);
    });

    test('should assign sequential numbers', () => {
      const schema = buildSchema(`
        enum Priority {
          LOW
          MEDIUM
          HIGH
        }
      `);
      
      const enumType = schema.getType('Priority');
      if (!enumType || enumType.constructor.name !== 'GraphQLEnumType') {
        throw new Error('Invalid enum type');
      }
      
      const protoEnum = buildEnumType(enumType as any);
      
      expect(protoEnum.values.UNSPECIFIED).toBe(0);
      expect(protoEnum.values.LOW).toBe(1);
      expect(protoEnum.values.MEDIUM).toBe(2);
      expect(protoEnum.values.HIGH).toBe(3);
    });
  });

  describe('edge cases', () => {
    test('should handle empty variable definitions', () => {
      const schema = buildSchema(`
        type Query {
          ping: String
        }
      `);
      
      const message = buildRequestMessage('PingRequest', [], schema);
      
      expect(message.name).toBe('PingRequest');
      expect(message.fieldsArray).toHaveLength(0);
    });

    test('should handle complex variable types', () => {
      const schema = buildSchema(`
        type Query {
          search(filters: [[String!]!]): [Result]
        }
        
        type Result {
          id: ID!
        }
      `);
      
      const query = parse(`
        query Search($filters: [[String!]!]) {
          search(filters: $filters) {
            id
          }
        }
      `);
      
      const operation = query.definitions[0];
      if (operation.kind !== 'OperationDefinition') {
        throw new Error('Invalid operation');
      }
      
      // Should not throw
      const message = buildRequestMessage(
        'SearchRequest',
        operation.variableDefinitions || [],
        schema,
      );
      
      expect(message.name).toBe('SearchRequest');
    });
  });
});

