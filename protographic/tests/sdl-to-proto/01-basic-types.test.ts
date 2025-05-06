import { describe, expect, test } from 'vitest';
import { compileGraphQLToProto } from '../../src';
import { expectValidProto } from '../util';

describe('SDL to Proto - Basic Types', () => {
  test('should convert scalar types correctly', () => {
    const sdl = `
      type Query {
        stringField: String
        intField: Int
        floatField: Float
        booleanField: Boolean
        idField: ID
      }
    `;

    const protoText = compileGraphQLToProto(sdl);

    // Validate Proto definition
    expectValidProto(protoText);

    // Check that all required components are present
    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      option go_package = "cosmo/pkg/proto/service.v1;servicev1";

      service DefaultService {
        rpc QueryStringField(QueryStringFieldRequest) returns (QueryStringFieldResponse) {}
        rpc QueryIntField(QueryIntFieldRequest) returns (QueryIntFieldResponse) {}
        rpc QueryFloatField(QueryFloatFieldRequest) returns (QueryFloatFieldResponse) {}
        rpc QueryBooleanField(QueryBooleanFieldRequest) returns (QueryBooleanFieldResponse) {}
        rpc QueryIdField(QueryIdFieldRequest) returns (QueryIdFieldResponse) {}
      }

      message QueryStringFieldRequest {
      }
      message QueryStringFieldResponse {
          string string_field = 1;
      }
      message QueryIntFieldRequest {
      }
      message QueryIntFieldResponse {
          int32 int_field = 1;
      }
      message QueryFloatFieldRequest {
      }
      message QueryFloatFieldResponse {
          double float_field = 1;
      }
      message QueryBooleanFieldRequest {
      }
      message QueryBooleanFieldResponse {
          bool boolean_field = 1;
      }
      message QueryIdFieldRequest {
      }
      message QueryIdFieldResponse {
          string id_field = 1;
      }"
    `);
  });

  test('should convert non-null types correctly', () => {
    const sdl = `
      type Query {
        requiredString: String!
        requiredInt: Int!
      }
    `;

    const protoText = compileGraphQLToProto(sdl);

    // Validate Proto definition
    expectValidProto(protoText);

    // Check that all required components are present
    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      option go_package = "cosmo/pkg/proto/service.v1;servicev1";

      service DefaultService {
        rpc QueryRequiredString(QueryRequiredStringRequest) returns (QueryRequiredStringResponse) {}
        rpc QueryRequiredInt(QueryRequiredIntRequest) returns (QueryRequiredIntResponse) {}
      }

      message QueryRequiredStringRequest {
      }
      message QueryRequiredStringResponse {
          string required_string = 1;
      }
      message QueryRequiredIntRequest {
      }
      message QueryRequiredIntResponse {
          int32 required_int = 1;
      }"
    `);
  });

  test('should convert list types correctly', () => {
    const sdl = `
      type Query {
        stringList: [String]
        intList: [Int]!
        requiredStrings: [String!]!
      }
    `;

    const protoText = compileGraphQLToProto(sdl);

    // Validate Proto definition
    expectValidProto(protoText);

    // Check that all required components are present
    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      option go_package = "cosmo/pkg/proto/service.v1;servicev1";

      service DefaultService {
        rpc QueryStringList(QueryStringListRequest) returns (QueryStringListResponse) {}
        rpc QueryIntList(QueryIntListRequest) returns (QueryIntListResponse) {}
        rpc QueryRequiredStrings(QueryRequiredStringsRequest) returns (QueryRequiredStringsResponse) {}
      }

      message QueryStringListRequest {
      }
      message QueryStringListResponse {
          repeated string string_list = 1;
      }
      message QueryIntListRequest {
      }
      message QueryIntListResponse {
          repeated int32 int_list = 1;
      }
      message QueryRequiredStringsRequest {
      }
      message QueryRequiredStringsResponse {
          repeated string required_strings = 1;
      }"
    `);
  });

  test('should convert simple object types correctly', () => {
    const sdl = `
      type User {
        id: ID!
        name: String!
        age: Int
      }
      
      type Query {
        user: User
      }
    `;

    const protoText = compileGraphQLToProto(sdl);

    // Validate Proto definition
    expectValidProto(protoText);

    // Check that all required components are present
    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      option go_package = "cosmo/pkg/proto/service.v1;servicev1";

      service DefaultService {
        rpc QueryUser(QueryUserRequest) returns (QueryUserResponse) {}
      }

      message QueryUserRequest {
      }
      message QueryUserResponse {
          User user = 1;
      }

      message User {
        string id = 1;
        string name = 2;
        int32 age = 3;
      }"
    `);
  });

  test('should convert query with arguments correctly', () => {
    const sdl = `
      type User {
        id: ID!
        name: String!
      }
      type Query {
        user(id: ID!): User
        filteredUsers(limit: Int!, offset: Int, nameFilter: String): [User]
      }
    `;

    const protoText = compileGraphQLToProto(sdl);

    // Validate Proto definition
    expectValidProto(protoText);

    // Check that all required components are present
    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      option go_package = "cosmo/pkg/proto/service.v1;servicev1";

      service DefaultService {
        rpc QueryUser(QueryUserRequest) returns (QueryUserResponse) {}
        rpc QueryFilteredUsers(QueryFilteredUsersRequest) returns (QueryFilteredUsersResponse) {}
      }

      message QueryUserRequest {
          string id = 1;
      }
      message QueryUserResponse {
          User user = 1;
      }
      message QueryFilteredUsersRequest {
          int32 limit = 1;
          int32 offset = 2;
          string name_filter = 3;
      }
      message QueryFilteredUsersResponse {
          repeated User filtered_users = 1;
      }

      message User {
        string id = 1;
        string name = 2;
      }"
    `);
  });

  test('should respect custom go_package option', () => {
    const sdl = `
      type Query {
        hello: String
      }
    `;

    const customGoPackage = 'github.com/example/mypackage;mypackage';
    const protoText = compileGraphQLToProto(sdl, 'CustomService', 'custom.v1', customGoPackage);

    // Validate Proto definition
    expectValidProto(protoText);

    // Check that the custom go_package is used
    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package custom.v1;

      option go_package = "github.com/example/mypackage;mypackage";

      service CustomService {
        rpc QueryHello(QueryHelloRequest) returns (QueryHelloResponse) {}
      }

      message QueryHelloRequest {
      }
      message QueryHelloResponse {
          string hello = 1;
      }"
    `);
  });
});
