import { describe, expect, test } from 'vitest';
import { compileOperationsToProto } from '../../src/operation-to-proto';
import { expectValidProto } from '../util';

describe('Operation to Proto - Integration Tests', () => {
  describe('query operations', () => {
    test('should convert simple query to proto', () => {
      const schema = `
        type Query {
          hello: String
        }
      `;
      
      const operation = `
        query GetHello {
          hello
        }
      `;
      
      const { proto, root } = compileOperationsToProto(operation, schema);
      
      // Validate proto
      expectValidProto(proto);
      
      // Check structure
      expect(proto).toContain('syntax = "proto3"');
      expect(proto).toContain('package service.v1');
      expect(proto).toContain('service DefaultService');
      expect(proto).toContain('rpc QueryGetHello');
      expect(proto).toContain('message QueryGetHelloRequest');
      expect(proto).toContain('message QueryGetHelloResponse');
    });

    test('should handle query with variables', () => {
      const schema = `
        type Query {
          user(id: ID!): User
        }
        
        type User {
          id: ID!
          name: String
        }
      `;
      
      const operation = `
        query GetUser($id: ID!) {
          user(id: $id) {
            id
            name
          }
        }
      `;
      
      const { proto, root } = compileOperationsToProto(operation, schema);
      
      expectValidProto(proto);
      
      expect(proto).toContain('message QueryGetUserRequest');
      expect(proto).toContain('string id = 1');
      expect(proto).toContain('message QueryGetUserResponse');
    });

    test('should handle nested selections', () => {
      const schema = `
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
      `;
      
      const operation = `
        query GetUserProfile {
          user {
            id
            profile {
              bio
              avatar
            }
          }
        }
      `;
      
      const { proto, root } = compileOperationsToProto(operation, schema);
      
      expectValidProto(proto);
      
      expect(proto).toContain('message QueryGetUserProfileResponse');
      // Should have nested message for profile
      expect(proto).toMatch(/message.*profile/i);
    });

    test('should handle list types', () => {
      const schema = `
        type Query {
          users: [User!]!
        }
        
        type User {
          id: ID!
          name: String
        }
      `;
      
      const operation = `
        query GetUsers {
          users {
            id
            name
          }
        }
      `;
      
      const { proto, root } = compileOperationsToProto(operation, schema);
      
      expectValidProto(proto);
      
      expect(proto).toContain('message QueryGetUsersResponse');
    });

    test('should handle multiple queries', () => {
      const schema = `
        type Query {
          user: User
          posts: [Post]
        }
        
        type User {
          id: ID!
          name: String
        }
        
        type Post {
          id: ID!
          title: String
        }
      `;
      
      const operations = `
        query GetUser {
          user {
            id
            name
          }
        }
        
        query GetPosts {
          posts {
            id
            title
          }
        }
      `;
      
      const { proto, root } = compileOperationsToProto(operations, schema);
      
      expectValidProto(proto);
      
      expect(proto).toContain('rpc QueryGetUser');
      expect(proto).toContain('rpc QueryGetPosts');
      expect(proto).toContain('message QueryGetUserRequest');
      expect(proto).toContain('message QueryGetUserResponse');
      expect(proto).toContain('message QueryGetPostsRequest');
      expect(proto).toContain('message QueryGetPostsResponse');
    });
  });

  describe('mutation operations', () => {
    test('should convert mutation to proto', () => {
      const schema = `
        type Query {
          ping: String
        }
        
        type Mutation {
          createUser(name: String!): User
        }
        
        type User {
          id: ID!
          name: String
        }
      `;
      
      const operation = `
        mutation CreateUser($name: String!) {
          createUser(name: $name) {
            id
            name
          }
        }
      `;
      
      const { proto, root } = compileOperationsToProto(operation, schema);
      
      expectValidProto(proto);
      
      expect(proto).toContain('rpc MutationCreateUser');
      expect(proto).toContain('message MutationCreateUserRequest');
      expect(proto).toContain('message MutationCreateUserResponse');
      expect(proto).toContain('string name = 1');
    });

    test('should handle mutation with input object', () => {
      const schema = `
        type Query {
          ping: String
        }
        
        type Mutation {
          updateUser(input: UserInput!): User
        }
        
        input UserInput {
          name: String
          email: String
        }
        
        type User {
          id: ID!
          name: String
        }
      `;
      
      const operation = `
        mutation UpdateUser($input: UserInput!) {
          updateUser(input: $input) {
            id
            name
          }
        }
      `;
      
      const { proto, root } = compileOperationsToProto(operation, schema);
      
      expectValidProto(proto);
      
      expect(proto).toContain('rpc MutationUpdateUser');
      expect(proto).toContain('UserInput input = 1');
    });
  });

  describe('custom options', () => {
    test('should use custom service name', () => {
      const schema = `
        type Query {
          hello: String
        }
      `;
      
      const operation = `
        query GetHello {
          hello
        }
      `;
      
      const { proto } = compileOperationsToProto(operation, schema, {
        serviceName: 'CustomService',
      });
      
      expect(proto).toContain('service CustomService');
    });

    test('should use custom package name', () => {
      const schema = `
        type Query {
          hello: String
        }
      `;
      
      const operation = `
        query GetHello {
          hello
        }
      `;
      
      const { proto } = compileOperationsToProto(operation, schema, {
        packageName: 'custom.api.v1',
      });
      
      expect(proto).toContain('package custom.api.v1');
    });

    test('should include go_package option', () => {
      const schema = `
        type Query {
          hello: String
        }
      `;
      
      const operation = `
        query GetHello {
          hello
        }
      `;
      
      const { proto } = compileOperationsToProto(operation, schema, {
        goPackage: 'github.com/example/api/v1',
      });
      
      expect(proto).toContain('option go_package = "github.com/example/api/v1"');
    });

    test('should support includeComments option', () => {
      const schema = `
        type Query {
          """Get a friendly greeting"""
          hello: String
        }
      `;
      
      const operation = `
        query GetHello {
          hello
        }
      `;
      
      const { proto } = compileOperationsToProto(operation, schema, {
        includeComments: true,
      });
      
      expectValidProto(proto);
      // Comments should be present
      expect(proto).toContain('//');
    });
  });

  describe('complex scenarios', () => {
    test('should handle deeply nested selections', () => {
      const schema = `
        type Query {
          user: User
        }
        
        type User {
          id: ID!
          profile: Profile
        }
        
        type Profile {
          settings: Settings
        }
        
        type Settings {
          theme: String
          notifications: Boolean
        }
      `;
      
      const operation = `
        query GetUserSettings {
          user {
            id
            profile {
              settings {
                theme
                notifications
              }
            }
          }
        }
      `;
      
      const { proto, root } = compileOperationsToProto(operation, schema);
      
      expectValidProto(proto);
      
      expect(proto).toContain('message QueryGetUserSettingsResponse');
    });

    test('should handle operations with multiple variables', () => {
      const schema = `
        type Query {
          searchUsers(
            name: String
            email: String
            minAge: Int
            active: Boolean
          ): [User]
        }
        
        type User {
          id: ID!
          name: String
        }
      `;
      
      const operation = `
        query SearchUsers(
          $name: String
          $email: String
          $minAge: Int
          $active: Boolean
        ) {
          searchUsers(
            name: $name
            email: $email
            minAge: $minAge
            active: $active
          ) {
            id
            name
          }
        }
      `;
      
      const { proto, root } = compileOperationsToProto(operation, schema);
      
      expectValidProto(proto);
      
      expect(proto).toContain('message QuerySearchUsersRequest');
      expect(proto).toMatch(/name.*=.*1/);
      expect(proto).toMatch(/email.*=.*2/);
      expect(proto).toMatch(/min_age.*=.*3/);
      expect(proto).toMatch(/active.*=.*4/);
    });

    test('should handle mixed queries and mutations', () => {
      const schema = `
        type Query {
          user: User
        }
        
        type Mutation {
          createUser(name: String!): User
        }
        
        type User {
          id: ID!
          name: String
        }
      `;
      
      const operations = `
        query GetUser {
          user {
            id
            name
          }
        }
        
        mutation CreateUser($name: String!) {
          createUser(name: $name) {
            id
            name
          }
        }
      `;
      
      const { proto, root } = compileOperationsToProto(operations, schema);
      
      expectValidProto(proto);
      
      expect(proto).toContain('rpc QueryGetUser');
      expect(proto).toContain('rpc MutationCreateUser');
    });

    test('should produce consistent field numbering', () => {
      const schema = `
        type Query {
          user: User
        }
        
        type User {
          id: ID!
          name: String
          email: String
          age: Int
        }
      `;
      
      const operation = `
        query GetUser {
          user {
            id
            name
            email
            age
          }
        }
      `;
      
      const { proto: proto1 } = compileOperationsToProto(operation, schema);
      const { proto: proto2 } = compileOperationsToProto(operation, schema);
      
      // Should produce identical output
      expect(proto1).toBe(proto2);
    });
  });

  describe('edge cases', () => {
    test('should skip anonymous operations', () => {
      const schema = `
        type Query {
          hello: String
        }
      `;
      
      const operation = `
        {
          hello
        }
      `;
      
      const { proto, root } = compileOperationsToProto(operation, schema);
      
      // Should still be valid proto but with no operations
      expect(proto).toContain('syntax = "proto3"');
      expect(proto).toContain('service DefaultService');
      // Service should be empty or have no methods
    });

    test('should handle empty selection sets', () => {
      const schema = `
        type Query {
          ping: String
        }
      `;
      
      const operation = `
        query Ping {
          ping
        }
      `;
      
      const { proto, root } = compileOperationsToProto(operation, schema);
      
      expectValidProto(proto);
      
      expect(proto).toContain('message QueryPingResponse');
    });

    test('should handle field aliases', () => {
      const schema = `
        type Query {
          user: User
        }
        
        type User {
          id: ID!
          name: String
        }
      `;
      
      const operation = `
        query GetUser {
          currentUser: user {
            userId: id
            fullName: name
          }
        }
      `;
      
      const { proto, root } = compileOperationsToProto(operation, schema);
      
      expectValidProto(proto);
      
      // Should use actual field names, not aliases
      expect(proto).toContain('message QueryGetUserResponse');
    });
  });

  describe('return values', () => {
    test('should return both proto text and root object', () => {
      const schema = `
        type Query {
          hello: String
        }
      `;
      
      const operation = `
        query GetHello {
          hello
        }
      `;
      
      const result = compileOperationsToProto(operation, schema);
      
      expect(result).toHaveProperty('proto');
      expect(result).toHaveProperty('root');
      expect(typeof result.proto).toBe('string');
      expect(result.root).toBeDefined();
    });

    test('should have valid protobufjs root object', () => {
      const schema = `
        type Query {
          hello: String
        }
      `;
      
      const operation = `
        query GetHello {
          hello
        }
      `;
      
      const { root } = compileOperationsToProto(operation, schema);
      
      // Root should have nested types
      expect(root.nestedArray).toBeDefined();
      expect(root.nestedArray.length).toBeGreaterThan(0);
      
      // Should have a service
      const services = root.nestedArray.filter((n: any) => n.constructor.name === 'Service');
      expect(services.length).toBeGreaterThan(0);
    });
  });
});

