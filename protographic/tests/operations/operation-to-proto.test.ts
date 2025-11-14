import { describe, expect, test } from 'vitest';
import protobuf from 'protobufjs';
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

      expectValidProto(proto);
      expect(proto).toMatchInlineSnapshot(`
        "syntax = "proto3";
        package service.v1;

        import "google/protobuf/wrappers.proto";

        service DefaultService {
          rpc GetHello(GetHelloRequest) returns (GetHelloResponse) {}
        }

        message GetHelloRequest {
        }

        message GetHelloResponse {
          google.protobuf.StringValue hello = 1;
        }
        "
      `);
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
      expect(proto).toMatchInlineSnapshot(`
        "syntax = "proto3";
        package service.v1;

        import "google/protobuf/wrappers.proto";

        service DefaultService {
          rpc GetUser(GetUserRequest) returns (GetUserResponse) {}
        }

        message GetUserRequest {
          string id = 1;
        }

        message GetUserResponse {
          message User {
            string id = 1;
            google.protobuf.StringValue name = 2;
          }
          User user = 1;
        }
        "
      `);
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
      expect(proto).toMatchInlineSnapshot(`
        "syntax = "proto3";
        package service.v1;

        import "google/protobuf/wrappers.proto";

        service DefaultService {
          rpc GetUserProfile(GetUserProfileRequest) returns (GetUserProfileResponse) {}
        }

        message GetUserProfileRequest {
        }

        message GetUserProfileResponse {
          message User {
            message Profile {
              google.protobuf.StringValue bio = 1;
              google.protobuf.StringValue avatar = 2;
            }
            string id = 1;
            Profile profile = 2;
          }
          User user = 1;
        }
        "
      `);
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
      expect(proto).toMatchInlineSnapshot(`
        "syntax = "proto3";
        package service.v1;

        import "google/protobuf/wrappers.proto";

        service DefaultService {
          rpc GetUsers(GetUsersRequest) returns (GetUsersResponse) {}
        }

        message GetUsersRequest {
        }

        message GetUsersResponse {
          message Users {
            string id = 1;
            google.protobuf.StringValue name = 2;
          }
          repeated Users users = 1;
        }
        "
      `);
    });

    test('should reject multiple queries', () => {
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

      expect(() => compileOperationsToProto(operations, schema)).toThrow(
        'Multiple operations found in document: GetUser, GetPosts',
      );
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
      expect(proto).toMatchInlineSnapshot(`
        "syntax = "proto3";
        package service.v1;

        import "google/protobuf/wrappers.proto";

        service DefaultService {
          rpc OnMessageAdded(OnMessageAddedRequest) returns (stream OnMessageAddedResponse) {}
        }

        message OnMessageAddedRequest {
        }

        message OnMessageAddedResponse {
          message MessageAdded {
            string id = 1;
            google.protobuf.StringValue content = 2;
          }
          MessageAdded message_added = 1;
        }
        "
      `);
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
      expect(proto).toMatchInlineSnapshot(`
        "syntax = "proto3";
        package service.v1;

        import "google/protobuf/wrappers.proto";

        service DefaultService {
          rpc OnMessageAdded(OnMessageAddedRequest) returns (stream OnMessageAddedResponse) {}
        }

        message OnMessageAddedRequest {
          string channel_id = 1;
        }

        message OnMessageAddedResponse {
          message MessageAdded {
            string id = 1;
            google.protobuf.StringValue content = 2;
            string channel_id = 3;
          }
          MessageAdded message_added = 1;
        }
        "
      `);
    });

    test('should reject multiple subscriptions', () => {
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

      expect(() => compileOperationsToProto(operations, schema)).toThrow(
        'Multiple operations found in document: OnMessageAdded, OnUserStatusChanged',
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
      expect(proto).toMatchInlineSnapshot(`
        "syntax = "proto3";
        package service.v1;

        import "google/protobuf/wrappers.proto";

        service DefaultService {
          rpc OnPostAdded(OnPostAddedRequest) returns (stream OnPostAddedResponse) {}
        }

        message OnPostAddedRequest {
        }

        message OnPostAddedResponse {
          message PostAdded {
            message Author {
              string id = 1;
              google.protobuf.StringValue name = 2;
            }
            string id = 1;
            google.protobuf.StringValue title = 2;
            Author author = 3;
          }
          PostAdded post_added = 1;
        }
        "
      `);
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
        queryIdempotency: 'NO_SIDE_EFFECTS',
      });

      expectValidProto(proto);
      expect(proto).toMatchInlineSnapshot(`
        "syntax = "proto3";
        package service.v1;

        import "google/protobuf/wrappers.proto";

        service DefaultService {
          rpc OnMessageAdded(OnMessageAddedRequest) returns (stream OnMessageAddedResponse) {}
        }

        message OnMessageAddedRequest {
        }

        message OnMessageAddedResponse {
          message MessageAdded {
            string id = 1;
            google.protobuf.StringValue content = 2;
          }
          MessageAdded message_added = 1;
        }
        "
      `);
    });
  });

  describe('mixed operation types', () => {
    test('should reject queries, mutations, and subscriptions together', () => {
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

      expect(() => compileOperationsToProto(operations, schema)).toThrow(
        'Multiple operations found in document: GetMessages, AddMessage, OnMessageAdded',
      );
    });

    test('should reject mixed operations even with idempotency options', () => {
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

      expect(() =>
        compileOperationsToProto(operations, schema, {
          queryIdempotency: 'NO_SIDE_EFFECTS',
        }),
      ).toThrow('Multiple operations found in document: GetMessages, AddMessage, OnMessageAdded');
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
      expect(proto).toMatchInlineSnapshot(`
        "syntax = "proto3";
        package service.v1;

        import "google/protobuf/wrappers.proto";

        service DefaultService {
          rpc CreateUser(CreateUserRequest) returns (CreateUserResponse) {}
        }

        message CreateUserRequest {
          string name = 1;
        }

        message CreateUserResponse {
          message CreateUser {
            string id = 1;
            google.protobuf.StringValue name = 2;
          }
          CreateUser create_user = 1;
        }
        "
      `);
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
      expect(proto).toMatchInlineSnapshot(`
        "syntax = "proto3";
        package service.v1;

        import "google/protobuf/wrappers.proto";

        service DefaultService {
          rpc UpdateUser(UpdateUserRequest) returns (UpdateUserResponse) {}
        }

        message UpdateUserRequest {
          UserInput input = 1;
        }

        message UserInput {
          google.protobuf.StringValue name = 1;
          google.protobuf.StringValue email = 2;
        }

        message UpdateUserResponse {
          message UpdateUser {
            string id = 1;
            google.protobuf.StringValue name = 2;
          }
          UpdateUser update_user = 1;
        }
        "
      `);
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

    test('should reject multiple queries even with idempotency enabled', () => {
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

      expect(() =>
        compileOperationsToProto(operation, schema, {
          queryIdempotency: 'NO_SIDE_EFFECTS',
        }),
      ).toThrow('Multiple operations found in document: GetHello, GetUser');
    });

    test('should not add idempotency level to queries when omitted', () => {
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

      const { proto } = compileOperationsToProto(operation, schema);

      expectValidProto(proto);
      expect(proto).toMatchInlineSnapshot(`
        "syntax = "proto3";
        package service.v1;

        import "google/protobuf/wrappers.proto";

        service DefaultService {
          rpc GetHello(GetHelloRequest) returns (GetHelloResponse) {}
        }

        message GetHelloRequest {
        }

        message GetHelloResponse {
          google.protobuf.StringValue hello = 1;
        }
        "
      `);
    });

    test('should reject multiple mutations even when idempotency enabled', () => {
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

      expect(() =>
        compileOperationsToProto(operations, schema, {
          queryIdempotency: 'NO_SIDE_EFFECTS',
        }),
      ).toThrow('Multiple operations found in document: CreateUser, UpdateUser');
    });

    test('should reject mixed queries and mutations even with queryIdempotency enabled', () => {
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

      expect(() =>
        compileOperationsToProto(operations, schema, {
          queryIdempotency: 'NO_SIDE_EFFECTS',
        }),
      ).toThrow('Multiple operations found in document: GetUser, CreateUser');
    });

    test('should support DEFAULT idempotency level', () => {
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
        queryIdempotency: 'DEFAULT',
      });

      expectValidProto(proto);
      expect(proto).toMatchInlineSnapshot(`
        "syntax = "proto3";
        package service.v1;

        import "google/protobuf/wrappers.proto";

        service DefaultService {
          rpc GetHello(GetHelloRequest) returns (GetHelloResponse) {
            option idempotency_level = DEFAULT;
          }
        }

        message GetHelloRequest {
        }

        message GetHelloResponse {
          google.protobuf.StringValue hello = 1;
        }
        "
      `);
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
      expect(proto).toMatchInlineSnapshot(`
        "syntax = "proto3";
        package service.v1;

        import "google/protobuf/wrappers.proto";

        service DefaultService {
          rpc GetUserSettings(GetUserSettingsRequest) returns (GetUserSettingsResponse) {}
        }

        message GetUserSettingsRequest {
        }

        message GetUserSettingsResponse {
          message User {
            message Profile {
              message Settings {
                google.protobuf.StringValue theme = 1;
                google.protobuf.BoolValue notifications = 2;
              }
              Settings settings = 1;
            }
            string id = 1;
            Profile profile = 2;
          }
          User user = 1;
        }
        "
      `);
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
      expect(proto).toMatchInlineSnapshot(`
        "syntax = "proto3";
        package service.v1;

        import "google/protobuf/wrappers.proto";

        service DefaultService {
          rpc SearchUsers(SearchUsersRequest) returns (SearchUsersResponse) {}
        }

        message SearchUsersRequest {
          google.protobuf.StringValue name = 1;
          google.protobuf.StringValue email = 2;
          google.protobuf.Int32Value min_age = 3;
          google.protobuf.BoolValue active = 4;
        }

        message SearchUsersResponse {
          message SearchUsers {
            string id = 1;
            google.protobuf.StringValue name = 2;
          }
          repeated SearchUsers search_users = 1;
        }
        "
      `);
    });

    test('should reject mixed queries and mutations', () => {
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

      expect(() => compileOperationsToProto(operations, schema)).toThrow(
        'Multiple operations found in document: GetUser, CreateUser',
      );
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
    test('should reject anonymous operations', () => {
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

      expect(() => compileOperationsToProto(operation, schema)).toThrow('No named operations found in document');
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
      expect(proto).toMatchInlineSnapshot(`
        "syntax = "proto3";
        package service.v1;

        import "google/protobuf/wrappers.proto";

        service DefaultService {
          rpc Ping(PingRequest) returns (PingResponse) {}
        }

        message PingRequest {
        }

        message PingResponse {
          google.protobuf.StringValue ping = 1;
        }
        "
      `);
    });

    test('should reject root-level field aliases', () => {
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

      expect(() => compileOperationsToProto(operation, schema)).toThrow(
        'Root-level field alias "currentUser: user" is not supported',
      );
    });
  });

  describe('prefixOperationType option', () => {
    test('should prefix query operation with Query', () => {
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
          user {
            id
            name
          }
        }
      `;

      const { proto } = compileOperationsToProto(operation, schema, {
        prefixOperationType: true,
      });

      expectValidProto(proto);
      expect(proto).toMatchInlineSnapshot(`
        "syntax = "proto3";
        package service.v1;

        import "google/protobuf/wrappers.proto";

        service DefaultService {
          rpc QueryGetUser(QueryGetUserRequest) returns (QueryGetUserResponse) {}
        }

        message QueryGetUserRequest {
        }

        message QueryGetUserResponse {
          message User {
            string id = 1;
            google.protobuf.StringValue name = 2;
          }
          User user = 1;
        }
        "
      `);
    });

    test('should prefix mutation operation with Mutation', () => {
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

      const { proto } = compileOperationsToProto(operation, schema, {
        prefixOperationType: true,
      });

      expectValidProto(proto);
      expect(proto).toMatchInlineSnapshot(`
        "syntax = "proto3";
        package service.v1;

        import "google/protobuf/wrappers.proto";

        service DefaultService {
          rpc MutationCreateUser(MutationCreateUserRequest) returns (MutationCreateUserResponse) {}
        }

        message MutationCreateUserRequest {
          string name = 1;
        }

        message MutationCreateUserResponse {
          message CreateUser {
            string id = 1;
            google.protobuf.StringValue name = 2;
          }
          CreateUser create_user = 1;
        }
        "
      `);
    });

    test('should prefix subscription operation with Subscription', () => {
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
        prefixOperationType: true,
      });

      expectValidProto(proto);
      expect(proto).toMatchInlineSnapshot(`
        "syntax = "proto3";
        package service.v1;

        import "google/protobuf/wrappers.proto";

        service DefaultService {
          rpc SubscriptionOnMessageAdded(SubscriptionOnMessageAddedRequest) returns (stream SubscriptionOnMessageAddedResponse) {}
        }

        message SubscriptionOnMessageAddedRequest {
        }

        message SubscriptionOnMessageAddedResponse {
          message MessageAdded {
            string id = 1;
            google.protobuf.StringValue content = 2;
          }
          MessageAdded message_added = 1;
        }
        "
      `);
    });

    test('should not prefix when option is false', () => {
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
          user {
            id
            name
          }
        }
      `;

      const { proto } = compileOperationsToProto(operation, schema, {
        prefixOperationType: false,
      });

      expectValidProto(proto);
      expect(proto).toContain('rpc GetUser(GetUserRequest) returns (GetUserResponse)');
      expect(proto).not.toContain('QueryGetUser');
    });

    test('should not prefix when option is omitted', () => {
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
          user {
            id
            name
          }
        }
      `;

      const { proto } = compileOperationsToProto(operation, schema);

      expectValidProto(proto);
      expect(proto).toContain('rpc GetUser(GetUserRequest) returns (GetUserResponse)');
      expect(proto).not.toContain('QueryGetUser');
    });

    test('should work with queryIdempotency option', () => {
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
        prefixOperationType: true,
        queryIdempotency: 'NO_SIDE_EFFECTS',
      });

      expectValidProto(proto);
      expect(proto).toMatchInlineSnapshot(`
        "syntax = "proto3";
        package service.v1;

        import "google/protobuf/wrappers.proto";

        service DefaultService {
          rpc QueryGetHello(QueryGetHelloRequest) returns (QueryGetHelloResponse) {
            option idempotency_level = NO_SIDE_EFFECTS;
          }
        }

        message QueryGetHelloRequest {
        }

        message QueryGetHelloResponse {
          google.protobuf.StringValue hello = 1;
        }
        "
      `);
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
      const services = root.nestedArray.filter((n) => n instanceof protobuf.Service);
      expect(services.length).toBeGreaterThan(0);
    });
  });
});
