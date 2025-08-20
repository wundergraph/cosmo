import { describe, expect, test } from 'vitest';
import { compileGraphQLToProto } from '../../src';
import { expectValidProto } from '../util';

describe('SDL to Proto - Complex Types', () => {
  test('should convert enum types correctly', () => {
    const sdl = `
      enum UserRole {
        ADMIN
        EDITOR
        VIEWER
      }
      
      type User {
        id: ID!
        role: UserRole!
      }
      
      type Query {
        usersByRole(role: UserRole): [User]
      }
    `;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    // Validate Proto definition
    expectValidProto(protoText);

    // Check that all required components are present
    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      import "google/protobuf/descriptor.proto";

      extend google.protobuf.FieldOptions {
        bool is_required = 50000;
      }

      // Service definition for DefaultService
      service DefaultService {
        rpc QueryUsersByRole(QueryUsersByRoleRequest) returns (QueryUsersByRoleResponse) {}
      }

      // Wrapper message for a list of User.
      message ListOfUser {
        message List {
          repeated User items = 1;
        }
        List list = 1;
      }
      // Request message for usersByRole operation.
      message QueryUsersByRoleRequest {
        UserRole role = 1;
      }
      // Response message for usersByRole operation.
      message QueryUsersByRoleResponse {
        ListOfUser users_by_role = 1;
      }

      message User {
        string id = 1 [(is_required) = true];
        UserRole role = 2 [(is_required) = true];
      }

      enum UserRole {
        USER_ROLE_UNSPECIFIED = 0;
        USER_ROLE_ADMIN = 1;
        USER_ROLE_EDITOR = 2;
        USER_ROLE_VIEWER = 3;
      }"
    `);
  });

  test('should convert input types correctly', () => {
    const sdl = `
      input UserInput {
        name: String!
        email: String!
        age: Int
      }
      
      type User {
        id: ID!
        name: String!
        email: String!
        age: Int
      }
      
      type Mutation {
        createUser(input: UserInput!): User
      }
      
      type Query {
        dummy: String
      }
    `;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    // Validate Proto definition
    expectValidProto(protoText);

    // Check that all required components are present
    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      import "google/protobuf/descriptor.proto";
      import "google/protobuf/wrappers.proto";

      extend google.protobuf.FieldOptions {
        bool is_required = 50000;
      }

      // Service definition for DefaultService
      service DefaultService {
        rpc MutationCreateUser(MutationCreateUserRequest) returns (MutationCreateUserResponse) {}
        rpc QueryDummy(QueryDummyRequest) returns (QueryDummyResponse) {}
      }

      // Request message for dummy operation.
      message QueryDummyRequest {
      }
      // Response message for dummy operation.
      message QueryDummyResponse {
        google.protobuf.StringValue dummy = 1;
      }
      // Request message for createUser operation.
      message MutationCreateUserRequest {
        UserInput input = 1;
      }
      // Response message for createUser operation.
      message MutationCreateUserResponse {
        User create_user = 1;
      }

      message UserInput {
        string name = 1 [(is_required) = true];
        string email = 2 [(is_required) = true];
        google.protobuf.Int32Value age = 3;
      }

      message User {
        string id = 1 [(is_required) = true];
        string name = 2 [(is_required) = true];
        string email = 3 [(is_required) = true];
        google.protobuf.Int32Value age = 4;
      }"
    `);
  });

  test('should convert nested object types correctly', () => {
    const sdl = `
      type Address {
        street: String!
        city: String!
        country: String!
        zipCode: String!
      }
      
      type User {
        id: ID!
        name: String!
        homeAddress: Address!
        workAddress: Address
      }
      
      type Query {
        user(id: ID!): User
      }
    `;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    // Validate Proto definition
    expectValidProto(protoText);

    // Check that all required components are present
    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      import "google/protobuf/descriptor.proto";

      extend google.protobuf.FieldOptions {
        bool is_required = 50000;
      }

      // Service definition for DefaultService
      service DefaultService {
        rpc QueryUser(QueryUserRequest) returns (QueryUserResponse) {}
      }

      // Request message for user operation.
      message QueryUserRequest {
        string id = 1;
      }
      // Response message for user operation.
      message QueryUserResponse {
        User user = 1;
      }

      message User {
        string id = 1 [(is_required) = true];
        string name = 2 [(is_required) = true];
        Address home_address = 3 [(is_required) = true];
        Address work_address = 4;
      }

      message Address {
        string street = 1 [(is_required) = true];
        string city = 2 [(is_required) = true];
        string country = 3 [(is_required) = true];
        string zip_code = 4 [(is_required) = true];
      }"
    `);
  });

  test('should convert types with circular references', () => {
    const sdl = `
      type TreeNode {
        id: ID!
        value: String!
        parent: TreeNode
        children: [TreeNode!]
      }
      
      type Query {
        rootNode: TreeNode
        node(id: ID!): TreeNode
      }
    `;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    // Validate Proto definition
    expectValidProto(protoText);

    // Check that all required components are present
    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      import "google/protobuf/descriptor.proto";

      extend google.protobuf.FieldOptions {
        bool is_required = 50000;
      }

      // Service definition for DefaultService
      service DefaultService {
        rpc QueryNode(QueryNodeRequest) returns (QueryNodeResponse) {}
        rpc QueryRootNode(QueryRootNodeRequest) returns (QueryRootNodeResponse) {}
      }

      // Wrapper message for a list of TreeNode.
      message ListOfTreeNode {
        message List {
          repeated TreeNode items = 1;
        }
        List list = 1;
      }
      // Request message for rootNode operation.
      message QueryRootNodeRequest {
      }
      // Response message for rootNode operation.
      message QueryRootNodeResponse {
        TreeNode root_node = 1;
      }
      // Request message for node operation.
      message QueryNodeRequest {
        string id = 1;
      }
      // Response message for node operation.
      message QueryNodeResponse {
        TreeNode node = 1;
      }

      message TreeNode {
        string id = 1 [(is_required) = true];
        string value = 2 [(is_required) = true];
        TreeNode parent = 3;
        ListOfTreeNode children = 4;
      }"
    `);
  });

  test('should convert complex nested input types correctly', () => {
    const sdl = `
      input AddressInput {
        street: String!
        city: String!
        country: String!
        zipCode: String
      }
      
      input UserFilterInput {
        nameContains: String
        minAge: Int
        maxAge: Int
        addresses: [AddressInput!]
      }
      
      type User {
        id: ID!
        name: String!
        age: Int!
      }
      
      type Query {
        users(filter: UserFilterInput): [User]
      }
    `;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    // Validate Proto definition
    expectValidProto(protoText);

    // Check that all required components are present
    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      import "google/protobuf/descriptor.proto";
      import "google/protobuf/wrappers.proto";

      extend google.protobuf.FieldOptions {
        bool is_required = 50000;
      }

      // Service definition for DefaultService
      service DefaultService {
        rpc QueryUsers(QueryUsersRequest) returns (QueryUsersResponse) {}
      }

      // Wrapper message for a list of AddressInput.
      message ListOfAddressInput {
        message List {
          repeated AddressInput items = 1;
        }
        List list = 1;
      }
      // Wrapper message for a list of User.
      message ListOfUser {
        message List {
          repeated User items = 1;
        }
        List list = 1;
      }
      // Request message for users operation.
      message QueryUsersRequest {
        UserFilterInput filter = 1;
      }
      // Response message for users operation.
      message QueryUsersResponse {
        ListOfUser users = 1;
      }

      message UserFilterInput {
        google.protobuf.StringValue name_contains = 1;
        google.protobuf.Int32Value min_age = 2;
        google.protobuf.Int32Value max_age = 3;
        ListOfAddressInput addresses = 4;
      }

      message User {
        string id = 1 [(is_required) = true];
        string name = 2 [(is_required) = true];
        int32 age = 3 [(is_required) = true];
      }

      message AddressInput {
        string street = 1 [(is_required) = true];
        string city = 2 [(is_required) = true];
        string country = 3 [(is_required) = true];
        google.protobuf.StringValue zip_code = 4;
      }"
    `);
  });
});
