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
      expect(proto).toContain('rpc GetHello');
      expect(proto).toContain('message GetHelloRequest');
      expect(proto).toContain('message GetHelloResponse');
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

      expect(proto).toContain('message GetUserRequest');
      expect(proto).toContain('string id = 1');
      expect(proto).toContain('message GetUserResponse');
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

      expect(proto).toContain('message GetUserProfileResponse');
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

      expect(proto).toContain('message GetUsersResponse');
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

      expect(proto).toContain('rpc GetUser');
      expect(proto).toContain('rpc GetPosts');
      expect(proto).toContain('message GetUserRequest');
      expect(proto).toContain('message GetUserResponse');
      expect(proto).toContain('message GetPostsRequest');
      expect(proto).toContain('message GetPostsResponse');
    });
  });

  describe('subscription operations', () => {
    test('should convert subscription to server streaming RPC', () => {
      const schema = `
        type Query {
          ping: String
        }
        
        type Subscription {
          messageAdded: Message
        }
        
        type Message {
          id: ID!
          content: String
        }
      `;

      const operation = `
        subscription OnMessageAdded {
          messageAdded {
            id
            content
          }
        }
      `;

      const { proto, root } = compileOperationsToProto(operation, schema);

      expectValidProto(proto);

      // Should have server streaming (stream keyword before response)
      expect(proto).toContain('rpc OnMessageAdded(OnMessageAddedRequest) returns (stream OnMessageAddedResponse)');
      expect(proto).toContain('message OnMessageAddedRequest');
      expect(proto).toContain('message OnMessageAddedResponse');
    });

    test('should handle subscription with variables', () => {
      const schema = `
        type Query {
          ping: String
        }
        
        type Subscription {
          messageAdded(channelId: ID!): Message
        }
        
        type Message {
          id: ID!
          content: String
          channelId: ID!
        }
      `;

      const operation = `
        subscription OnMessageAdded($channelId: ID!) {
          messageAdded(channelId: $channelId) {
            id
            content
            channelId
          }
        }
      `;

      const { proto, root } = compileOperationsToProto(operation, schema);

      expectValidProto(proto);

      // Should be server streaming
      expect(proto).toContain('rpc OnMessageAdded(OnMessageAddedRequest) returns (stream OnMessageAddedResponse)');
      // Should have variable in request
      expect(proto).toContain('message OnMessageAddedRequest');
      expect(proto).toContain('string channel_id = 1');
    });

    test('should handle multiple subscriptions', () => {
      const schema = `
        type Query {
          ping: String
        }
        
        type Subscription {
          messageAdded: Message
          userStatusChanged: UserStatus
        }
        
        type Message {
          id: ID!
          content: String
        }
        
        type UserStatus {
          userId: ID!
          online: Boolean
        }
      `;

      const operations = `
        subscription OnMessageAdded {
          messageAdded {
            id
            content
          }
        }
        
        subscription OnUserStatusChanged {
          userStatusChanged {
            userId
            online
          }
        }
      `;

      const { proto, root } = compileOperationsToProto(operations, schema);

      expectValidProto(proto);

      // Both should be server streaming
      expect(proto).toContain('rpc OnMessageAdded(OnMessageAddedRequest) returns (stream OnMessageAddedResponse)');
      expect(proto).toContain(
        'rpc OnUserStatusChanged(OnUserStatusChangedRequest) returns (stream OnUserStatusChangedResponse)',
      );
    });

    test('should handle subscription with nested selections', () => {
      const schema = `
        type Query {
          ping: String
        }
        
        type Subscription {
          postAdded: Post
        }
        
        type Post {
          id: ID!
          title: String
          author: User
        }
        
        type User {
          id: ID!
          name: String
        }
      `;

      const operation = `
        subscription OnPostAdded {
          postAdded {
            id
            title
            author {
              id
              name
            }
          }
        }
      `;

      const { proto, root } = compileOperationsToProto(operation, schema);

      expectValidProto(proto);

      // Should be server streaming
      expect(proto).toContain('rpc OnPostAdded(OnPostAddedRequest) returns (stream OnPostAddedResponse)');
      expect(proto).toContain('message OnPostAddedResponse');
    });

    test('should not add idempotency level to subscriptions', () => {
      const schema = `
        type Query {
          ping: String
        }
        
        type Subscription {
          messageAdded: Message
        }
        
        type Message {
          id: ID!
          content: String
        }
      `;

      const operation = `
        subscription OnMessageAdded {
          messageAdded {
            id
            content
          }
        }
      `;

      const { proto } = compileOperationsToProto(operation, schema, {
        queryNoSideEffects: true,
      });

      expectValidProto(proto);

      // Should be server streaming but no idempotency level
      expect(proto).toContain('rpc OnMessageAdded(OnMessageAddedRequest) returns (stream OnMessageAddedResponse) {}');
      expect(proto).not.toContain('idempotency_level');
    });
  });

  describe('mixed operation types', () => {
    test('should handle queries, mutations, and subscriptions together', () => {
      const schema = `
        type Query {
          messages: [Message]
        }
        
        type Mutation {
          addMessage(content: String!): Message
        }
        
        type Subscription {
          messageAdded: Message
        }
        
        type Message {
          id: ID!
          content: String
        }
      `;

      const operations = `
        query GetMessages {
          messages {
            id
            content
          }
        }
        
        mutation AddMessage($content: String!) {
          addMessage(content: $content) {
            id
            content
          }
        }
        
        subscription OnMessageAdded {
          messageAdded {
            id
            content
          }
        }
      `;

      const { proto } = compileOperationsToProto(operations, schema);

      expectValidProto(proto);

      // Query should be unary
      expect(proto).toContain('rpc GetMessages(GetMessagesRequest) returns (GetMessagesResponse)');
      // Mutation should be unary
      expect(proto).toContain('rpc AddMessage(AddMessageRequest) returns (AddMessageResponse)');
      // Subscription should be server streaming
      expect(proto).toContain('rpc OnMessageAdded(OnMessageAddedRequest) returns (stream OnMessageAddedResponse)');
    });

    test('should apply idempotency only to queries when mixed with subscriptions', () => {
      const schema = `
        type Query {
          messages: [Message]
        }
        
        type Mutation {
          addMessage(content: String!): Message
        }
        
        type Subscription {
          messageAdded: Message
        }
        
        type Message {
          id: ID!
          content: String
        }
      `;

      const operations = `
        query GetMessages {
          messages {
            id
            content
          }
        }
        
        mutation AddMessage($content: String!) {
          addMessage(content: $content) {
            id
            content
          }
        }
        
        subscription OnMessageAdded {
          messageAdded {
            id
            content
          }
        }
      `;

      const { proto } = compileOperationsToProto(operations, schema, {
        queryNoSideEffects: true,
      });

      expectValidProto(proto);

      // Query should have idempotency level
      expect(proto).toContain('rpc GetMessages(GetMessagesRequest) returns (GetMessagesResponse) {');
      expect(proto).toContain('option idempotency_level = NO_SIDE_EFFECTS;');

      // Mutation should not have idempotency level
      expect(proto).toContain('rpc AddMessage(AddMessageRequest) returns (AddMessageResponse) {}');

      // Subscription should be streaming but no idempotency level
      expect(proto).toContain('rpc OnMessageAdded(OnMessageAddedRequest) returns (stream OnMessageAddedResponse) {}');

      // Only one idempotency option (for the query)
      const matches = proto.match(/option idempotency_level = NO_SIDE_EFFECTS;/g);
      expect(matches).toHaveLength(1);
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

      expect(proto).toContain('rpc CreateUser');
      expect(proto).toContain('message CreateUserRequest');
      expect(proto).toContain('message CreateUserResponse');
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

      expect(proto).toContain('rpc UpdateUser');
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

    test('should include java_package option', () => {
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
        javaPackage: 'com.example.api',
      });

      expectValidProto(proto);
      expect(proto).toContain('option java_package = "com.example.api"');
    });

    test('should include java_outer_classname option', () => {
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
        javaOuterClassname: 'ApiProto',
      });

      expectValidProto(proto);
      expect(proto).toContain('option java_outer_classname = "ApiProto"');
    });

    test('should include java_multiple_files option', () => {
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
        javaMultipleFiles: true,
      });

      expectValidProto(proto);
      expect(proto).toContain('option java_multiple_files = true');
    });

    test('should include csharp_namespace option', () => {
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
        csharpNamespace: 'Example.Api',
      });

      expectValidProto(proto);
      expect(proto).toContain('option csharp_namespace = "Example.Api"');
    });

    test('should include ruby_package option', () => {
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
        rubyPackage: 'Example::Api',
      });

      expectValidProto(proto);
      expect(proto).toContain('option ruby_package = "Example::Api"');
    });

    test('should include php_namespace option', () => {
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
        phpNamespace: 'Example\\Api',
      });

      expectValidProto(proto);
      expect(proto).toContain('option php_namespace = "Example\\Api"');
    });

    test('should include php_metadata_namespace option', () => {
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
        phpMetadataNamespace: 'Example\\Api\\Metadata',
      });

      expectValidProto(proto);
      expect(proto).toContain('option php_metadata_namespace = "Example\\Api\\Metadata"');
    });

    test('should include objc_class_prefix option', () => {
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
        objcClassPrefix: 'EA',
      });

      expectValidProto(proto);
      expect(proto).toContain('option objc_class_prefix = "EA"');
    });

    test('should include swift_prefix option', () => {
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
        swiftPrefix: 'ExampleApi',
      });

      expectValidProto(proto);
      expect(proto).toContain('option swift_prefix = "ExampleApi"');
    });

    test('should include multiple language options', () => {
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
        goPackage: 'github.com/example/api',
        javaPackage: 'com.example.api',
        javaOuterClassname: 'ApiProto',
        javaMultipleFiles: true,
        csharpNamespace: 'Example.Api',
        rubyPackage: 'Example::Api',
        phpNamespace: 'Example\\Api',
        swiftPrefix: 'EA',
      });

      expectValidProto(proto);
      expect(proto).toContain('option go_package = "github.com/example/api"');
      expect(proto).toContain('option java_package = "com.example.api"');
      expect(proto).toContain('option java_outer_classname = "ApiProto"');
      expect(proto).toContain('option java_multiple_files = true');
      expect(proto).toContain('option csharp_namespace = "Example.Api"');
      expect(proto).toContain('option ruby_package = "Example::Api"');
      expect(proto).toContain('option php_namespace = "Example\\Api"');
      expect(proto).toContain('option swift_prefix = "EA"');
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

    test('should add NO_SIDE_EFFECTS idempotency level to queries when enabled', () => {
      const schema = `
        type Query {
          hello: String
          user: User
        }
        
        type User {
          id: ID!
          name: String
        }
      `;

      const operation = `
        query GetHello {
          hello
        }
        
        query GetUser {
          user {
            id
            name
          }
        }
      `;

      const { proto } = compileOperationsToProto(operation, schema, {
        queryNoSideEffects: true,
      });

      expectValidProto(proto);

      // Both query methods should have idempotency level
      expect(proto).toContain('rpc GetHello(GetHelloRequest) returns (GetHelloResponse) {');
      expect(proto).toContain('option idempotency_level = NO_SIDE_EFFECTS;');
      expect(proto).toContain('rpc GetUser(GetUserRequest) returns (GetUserResponse) {');

      // Count occurrences - should have idempotency option for each query
      const matches = proto.match(/option idempotency_level = NO_SIDE_EFFECTS;/g);
      expect(matches).toHaveLength(2);
    });

    test('should not add idempotency level to queries when disabled', () => {
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
        queryNoSideEffects: false,
      });

      expectValidProto(proto);

      // Should use single-line format without options
      expect(proto).toContain('rpc GetHello(GetHelloRequest) returns (GetHelloResponse) {}');
      expect(proto).not.toContain('idempotency_level');
    });

    test('should not add idempotency level to mutations even when enabled', () => {
      const schema = `
        type Query {
          ping: String
        }
        
        type Mutation {
          createUser(name: String!): User
          updateUser(id: ID!, name: String!): User
        }
        
        type User {
          id: ID!
          name: String
        }
      `;

      const operations = `
        mutation CreateUser($name: String!) {
          createUser(name: $name) {
            id
            name
          }
        }
        
        mutation UpdateUser($id: ID!, $name: String!) {
          updateUser(id: $id, name: $name) {
            id
            name
          }
        }
      `;

      const { proto } = compileOperationsToProto(operations, schema, {
        queryNoSideEffects: true,
      });

      expectValidProto(proto);

      // Mutations should not have idempotency level
      expect(proto).toContain('rpc CreateUser(CreateUserRequest) returns (CreateUserResponse) {}');
      expect(proto).toContain('rpc UpdateUser(UpdateUserRequest) returns (UpdateUserResponse) {}');
      expect(proto).not.toContain('idempotency_level');
    });

    test('should handle mixed queries and mutations with queryNoSideEffects enabled', () => {
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

      const { proto } = compileOperationsToProto(operations, schema, {
        queryNoSideEffects: true,
      });

      expectValidProto(proto);

      // Query should have idempotency level
      expect(proto).toContain('rpc GetUser(GetUserRequest) returns (GetUserResponse) {');
      expect(proto).toContain('option idempotency_level = NO_SIDE_EFFECTS;');

      // Mutation should not
      expect(proto).toContain('rpc CreateUser(CreateUserRequest) returns (CreateUserResponse) {}');

      // Only one idempotency option (for the query)
      const matches = proto.match(/option idempotency_level = NO_SIDE_EFFECTS;/g);
      expect(matches).toHaveLength(1);
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

      expect(proto).toContain('message GetUserSettingsResponse');
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

      expect(proto).toContain('message SearchUsersRequest');
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

      expect(proto).toContain('rpc GetUser');
      expect(proto).toContain('rpc CreateUser');
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

      expect(proto).toContain('message PingResponse');
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
      expect(proto).toContain('message GetUserResponse');
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
