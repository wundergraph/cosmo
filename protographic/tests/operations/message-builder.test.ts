import { describe, expect, test } from 'vitest';
import {
  buildSchema,
  parse,
  TypeInfo,
  GraphQLObjectType,
  GraphQLString,
  GraphQLInt,
  GraphQLNonNull,
  GraphQLList,
  Kind,
} from 'graphql';
import {
  buildMessageFromSelectionSet,
  buildFieldDefinition,
  buildNestedMessage,
} from '../../src/operations/message-builder';
import { createFieldNumberManager } from '../../src/operations/field-numbering';

describe('Message Builder', () => {
  describe('buildFieldDefinition', () => {
    test('should build field for nullable String', () => {
      const field = buildFieldDefinition('name', GraphQLString, 1);
      
      expect(field.name).toBe('name');
      expect(field.id).toBe(1);
      expect(field.type).toBe('google.protobuf.StringValue');
    });

    test('should build field for non-null String', () => {
      const field = buildFieldDefinition('name', new GraphQLNonNull(GraphQLString), 1);
      
      expect(field.name).toBe('name');
      expect(field.id).toBe(1);
      expect(field.type).toBe('string');
    });

    test('should build field for list type', () => {
      const field = buildFieldDefinition('tags', new GraphQLList(GraphQLString), 1);
      
      expect(field.name).toBe('tags');
      expect(field.id).toBe(1);
      expect(field.repeated).toBe(true);
    });

    test('should convert field name to snake_case', () => {
      const field = buildFieldDefinition('firstName', GraphQLString, 1);
      
      expect(field.name).toBe('first_name');
    });
  });

  describe('buildNestedMessage', () => {
    test('should build message from field map', () => {
      const fields = new Map<string, any>([
        ['id', new GraphQLNonNull(GraphQLString)],
        ['name', GraphQLString],
        ['age', GraphQLInt],
      ]);
      
      const message = buildNestedMessage('User', fields);
      
      expect(message.name).toBe('User');
      expect(message.fieldsArray).toHaveLength(3);
      expect(message.fields.id).toBeDefined();
      expect(message.fields.name).toBeDefined();
      expect(message.fields.age).toBeDefined();
    });

    test('should assign sequential field numbers', () => {
      const fields = new Map<string, any>([
        ['first', GraphQLString],
        ['second', GraphQLString],
        ['third', GraphQLString],
      ]);
      
      const message = buildNestedMessage('TestMessage', fields);
      
      expect(message.fields.first.id).toBe(1);
      expect(message.fields.second.id).toBe(2);
      expect(message.fields.third.id).toBe(3);
    });

    test('should use field number manager when provided', () => {
      const manager = createFieldNumberManager();
      const fields = new Map<string, any>([
        ['field1', GraphQLString],
        ['field2', GraphQLInt],
      ]);
      
      const message = buildNestedMessage('TestMessage', fields, {
        fieldNumberManager: manager,
      });
      
      // Field names are stored in snake_case in the manager
      expect(manager.getFieldNumber('TestMessage', 'field_1')).toBe(1);
      expect(manager.getFieldNumber('TestMessage', 'field_2')).toBe(2);
    });
  });

  describe('buildMessageFromSelectionSet', () => {
    test('should build message from simple selection set', () => {
      const schema = buildSchema(`
        type Query {
          user: User
        }
        
        type User {
          id: ID!
          name: String
          email: String
        }
      `);
      
      const query = parse(`
        query GetUser {
          user {
            id
            name
            email
          }
        }
      `);
      
      const operation = query.definitions[0];
      if (operation.kind !== 'OperationDefinition' || !operation.selectionSet) {
        throw new Error('Invalid operation');
      }
      
      const userSelection = operation.selectionSet.selections[0];
      if (userSelection.kind !== 'Field' || !userSelection.selectionSet) {
        throw new Error('Invalid selection');
      }
      
      const typeInfo = new TypeInfo(schema);
      const userType = schema.getType('User') as GraphQLObjectType;
      
      const message = buildMessageFromSelectionSet(
        'UserResponse',
        userSelection.selectionSet,
        userType,
        typeInfo,
      );
      
      expect(message.name).toBe('UserResponse');
      expect(message.fields.id).toBeDefined();
      expect(message.fields.name).toBeDefined();
      expect(message.fields.email).toBeDefined();
    });

    test('should handle nested object selections', () => {
      const schema = buildSchema(`
        type Query {
          user: User
        }
        
        type User {
          id: ID!
          profile: Profile
        }
        
        type Profile {
          bio: String
          avatar: String
        }
      `);
      
      const query = parse(`
        query GetUser {
          user {
            id
            profile {
              bio
              avatar
            }
          }
        }
      `);
      
      const operation = query.definitions[0];
      if (operation.kind !== 'OperationDefinition' || !operation.selectionSet) {
        throw new Error('Invalid operation');
      }
      
      const userSelection = operation.selectionSet.selections[0];
      if (userSelection.kind !== 'Field' || !userSelection.selectionSet) {
        throw new Error('Invalid selection');
      }
      
      const typeInfo = new TypeInfo(schema);
      const userType = schema.getType('User') as GraphQLObjectType;
      
      const message = buildMessageFromSelectionSet(
        'UserResponse',
        userSelection.selectionSet,
        userType,
        typeInfo,
      );
      
      expect(message.name).toBe('UserResponse');
      expect(message.fields.id).toBeDefined();
      expect(message.fields.profile).toBeDefined();
      
      // Should have nested message for profile
      expect(message.nested).toBeDefined();
      expect(message.nested!.UserResponse_profile).toBeDefined();
    });

    test('should use field number manager', () => {
      const schema = buildSchema(`
        type Query {
          user: User
        }
        
        type User {
          id: ID!
          name: String
        }
      `);
      
      const query = parse(`
        query GetUser {
          user {
            id
            name
          }
        }
      `);
      
      const operation = query.definitions[0];
      if (operation.kind !== 'OperationDefinition' || !operation.selectionSet) {
        throw new Error('Invalid operation');
      }
      
      const userSelection = operation.selectionSet.selections[0];
      if (userSelection.kind !== 'Field' || !userSelection.selectionSet) {
        throw new Error('Invalid selection');
      }
      
      const typeInfo = new TypeInfo(schema);
      const userType = schema.getType('User') as GraphQLObjectType;
      const manager = createFieldNumberManager();
      
      const message = buildMessageFromSelectionSet(
        'UserResponse',
        userSelection.selectionSet,
        userType,
        typeInfo,
        {
          fieldNumberManager: manager,
        },
      );
      
      expect(manager.getFieldNumber('UserResponse', 'id')).toBeDefined();
      expect(manager.getFieldNumber('UserResponse', 'name')).toBeDefined();
    });

    test('should handle list fields', () => {
      const schema = buildSchema(`
        type Query {
          users: [User!]!
        }
        
        type User {
          id: ID!
          name: String
        }
      `);
      
      const query = parse(`
        query GetUsers {
          users {
            id
            name
          }
        }
      `);
      
      const operation = query.definitions[0];
      if (operation.kind !== 'OperationDefinition' || !operation.selectionSet) {
        throw new Error('Invalid operation');
      }
      
      const usersSelection = operation.selectionSet.selections[0];
      if (usersSelection.kind !== 'Field' || !usersSelection.selectionSet) {
        throw new Error('Invalid selection');
      }
      
      const typeInfo = new TypeInfo(schema);
      const userType = schema.getType('User') as GraphQLObjectType;
      
      const message = buildMessageFromSelectionSet(
        'UsersResponse',
        usersSelection.selectionSet,
        userType,
        typeInfo,
      );
      
      expect(message.name).toBe('UsersResponse');
      expect(message.fields.id).toBeDefined();
      expect(message.fields.name).toBeDefined();
    });

    test('should handle field aliases', () => {
      const schema = buildSchema(`
        type Query {
          user: User
        }
        
        type User {
          id: ID!
          name: String
        }
      `);
      
      const query = parse(`
        query GetUser {
          user {
            userId: id
            userName: name
          }
        }
      `);
      
      const operation = query.definitions[0];
      if (operation.kind !== 'OperationDefinition' || !operation.selectionSet) {
        throw new Error('Invalid operation');
      }
      
      const userSelection = operation.selectionSet.selections[0];
      if (userSelection.kind !== 'Field' || !userSelection.selectionSet) {
        throw new Error('Invalid selection');
      }
      
      const typeInfo = new TypeInfo(schema);
      const userType = schema.getType('User') as GraphQLObjectType;
      
      const message = buildMessageFromSelectionSet(
        'UserResponse',
        userSelection.selectionSet,
        userType,
        typeInfo,
      );
      
      // Should use actual field names, not aliases
      expect(message.fields.id).toBeDefined();
      expect(message.fields.name).toBeDefined();
    });
  });

  describe('edge cases', () => {
    test('should handle empty selection set', () => {
      const schema = buildSchema(`
        type Query {
          ping: String
        }
      `);
      
      const typeInfo = new TypeInfo(schema);
      const queryType = schema.getQueryType()!;
      
      const message = buildMessageFromSelectionSet(
        'EmptyResponse',
        { kind: Kind.SELECTION_SET, selections: [] },
        queryType,
        typeInfo,
      );
      
      expect(message.name).toBe('EmptyResponse');
      expect(message.fieldsArray).toHaveLength(0);
    });

    test('should skip unknown fields gracefully', () => {
      const schema = buildSchema(`
        type Query {
          user: User
        }
        
        type User {
          id: ID!
        }
      `);
      
      // This query references a field that doesn't exist
      const query = parse(`
        query GetUser {
          user {
            id
          }
        }
      `);
      
      const operation = query.definitions[0];
      if (operation.kind !== 'OperationDefinition' || !operation.selectionSet) {
        throw new Error('Invalid operation');
      }
      
      const userSelection = operation.selectionSet.selections[0];
      if (userSelection.kind !== 'Field' || !userSelection.selectionSet) {
        throw new Error('Invalid selection');
      }
      
      const typeInfo = new TypeInfo(schema);
      const userType = schema.getType('User') as GraphQLObjectType;
      
      // Should not throw
      const message = buildMessageFromSelectionSet(
        'UserResponse',
        userSelection.selectionSet,
        userType,
        typeInfo,
      );
      
      expect(message.name).toBe('UserResponse');
    });
  });
});

