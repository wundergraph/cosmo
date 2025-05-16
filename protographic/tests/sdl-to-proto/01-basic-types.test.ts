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

    const { proto: protoText } = compileGraphQLToProto(sdl);

    // Validate Proto definition
    expectValidProto(protoText);

    // Check that all required components are present
    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      option go_package = "cosmo/pkg/proto/service.v1;servicev1";

      service DefaultService {
        rpc QueryBooleanField(QueryBooleanFieldRequest) returns (QueryBooleanFieldResponse) {}
        rpc QueryFloatField(QueryFloatFieldRequest) returns (QueryFloatFieldResponse) {}
        rpc QueryIdField(QueryIdFieldRequest) returns (QueryIdFieldResponse) {}
        rpc QueryIntField(QueryIntFieldRequest) returns (QueryIntFieldResponse) {}
        rpc QueryStringField(QueryStringFieldRequest) returns (QueryStringFieldResponse) {}
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

    const { proto: protoText } = compileGraphQLToProto(sdl);

    // Validate Proto definition
    expectValidProto(protoText);

    // Check that all required components are present
    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      option go_package = "cosmo/pkg/proto/service.v1;servicev1";

      service DefaultService {
        rpc QueryRequiredInt(QueryRequiredIntRequest) returns (QueryRequiredIntResponse) {}
        rpc QueryRequiredString(QueryRequiredStringRequest) returns (QueryRequiredStringResponse) {}
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

    const { proto: protoText } = compileGraphQLToProto(sdl);

    // Validate Proto definition
    expectValidProto(protoText);

    // Check that all required components are present
    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      option go_package = "cosmo/pkg/proto/service.v1;servicev1";

      service DefaultService {
        rpc QueryIntList(QueryIntListRequest) returns (QueryIntListResponse) {}
        rpc QueryRequiredStrings(QueryRequiredStringsRequest) returns (QueryRequiredStringsResponse) {}
        rpc QueryStringList(QueryStringListRequest) returns (QueryStringListResponse) {}
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

    const { proto: protoText } = compileGraphQLToProto(sdl);

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

    const { proto: protoText } = compileGraphQLToProto(sdl);

    // Validate Proto definition
    expectValidProto(protoText);

    // Check that all required components are present
    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      option go_package = "cosmo/pkg/proto/service.v1;servicev1";

      service DefaultService {
        rpc QueryFilteredUsers(QueryFilteredUsersRequest) returns (QueryFilteredUsersResponse) {}
        rpc QueryUser(QueryUserRequest) returns (QueryUserResponse) {}
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
    const { proto: protoText } = compileGraphQLToProto(sdl, {
      serviceName: 'CustomService',
      packageName: 'custom.v1',
      goPackage: customGoPackage,
    });

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

  test('should not create messages for root operation types', () => {
    const sdl = `
      type Query {
        field1: String
      }
      
      type Mutation {
        field2(input: String): Int
      }
    `;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    // Validate Proto definition
    expectValidProto(protoText);

    // Snapshot the output to ensure stability
    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      option go_package = "cosmo/pkg/proto/service.v1;servicev1";

      service DefaultService {
        rpc MutationField2(MutationField2Request) returns (MutationField2Response) {}
        rpc QueryField1(QueryField1Request) returns (QueryField1Response) {}
      }

      message QueryField1Request {
      }
      message QueryField1Response {
          string field_1 = 1;
      }
      message MutationField2Request {
          string input = 1;
      }
      message MutationField2Response {
          int32 field_2 = 1;
      }"
    `);
  });

  test('should handle list arguments correctly', () => {
    const sdl = `
      enum CategoryKind {
        BOOK
        ELECTRONICS
        FURNITURE
        OTHER
      }
      
      type Category {
        id: ID!
        name: String!
        kind: CategoryKind!
      }
      
      type Query {
        categoriesByKinds(kinds: [CategoryKind!]!): [Category!]!
        filterItems(ids: [ID!], tags: [String]): [String]
      }
    `;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    // Validate Proto definition
    expectValidProto(protoText);

    // Check that list arguments have the 'repeated' keyword
    expect(protoText).toContain('repeated CategoryKind kinds = ');
    expect(protoText).toContain('repeated string ids = ');
    expect(protoText).toContain('repeated string tags = ');

    // Full snapshot to ensure overall structure is correct
    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      option go_package = "cosmo/pkg/proto/service.v1;servicev1";

      service DefaultService {
        rpc QueryCategoriesByKinds(QueryCategoriesByKindsRequest) returns (QueryCategoriesByKindsResponse) {}
        rpc QueryFilterItems(QueryFilterItemsRequest) returns (QueryFilterItemsResponse) {}
      }

      message QueryCategoriesByKindsRequest {
          repeated CategoryKind kinds = 1;
      }
      message QueryCategoriesByKindsResponse {
          repeated Category categories_by_kinds = 1;
      }
      message QueryFilterItemsRequest {
          repeated string ids = 1;
          repeated string tags = 2;
      }
      message QueryFilterItemsResponse {
          repeated string filter_items = 1;
      }

      message Category {
        string id = 1;
        string name = 2;
        CategoryKind kind = 3;
      }

      enum CategoryKind {
        CATEGORY_KIND_UNSPECIFIED = 0;
        CATEGORY_KIND_BOOK = 1;
        CATEGORY_KIND_ELECTRONICS = 2;
        CATEGORY_KIND_FURNITURE = 3;
        CATEGORY_KIND_OTHER = 4;
      }"
    `);
  });

  test('should handle nested list types correctly', () => {
    const sdl = `
      type Matrix {
        values: [[Int!]!]!
        labels: [String!]!
      }
      
      type Query {
        getMatrix: Matrix
        processMatrix(matrix: [[Float!]!]!): [[Int!]!]!
        transformData(points: [[Point!]]): [String]
      }
      
      type Point {
        x: Float!
        y: Float!
      }
    `;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    // Validate Proto definition
    expectValidProto(protoText);

    // Full snapshot to ensure overall structure is correct
    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      option go_package = "cosmo/pkg/proto/service.v1;servicev1";

      service DefaultService {
        rpc QueryGetMatrix(QueryGetMatrixRequest) returns (QueryGetMatrixResponse) {}
        rpc QueryProcessMatrix(QueryProcessMatrixRequest) returns (QueryProcessMatrixResponse) {}
        rpc QueryTransformData(QueryTransformDataRequest) returns (QueryTransformDataResponse) {}
      }

      message FloatList {
        repeated double result = 1;
      }

      message IntList {
        repeated int32 result = 1;
      }

      message PointList {
        repeated Point result = 1;
      }

      message QueryGetMatrixRequest {
      }
      message QueryGetMatrixResponse {
          Matrix get_matrix = 1;
      }
      message QueryProcessMatrixRequest {
          repeated FloatList matrix = 1;
      }
      message QueryProcessMatrixResponse {
          repeated IntList process_matrix = 1;
      }
      message QueryTransformDataRequest {
          repeated PointList points = 1;
      }
      message QueryTransformDataResponse {
          repeated string transform_data = 1;
      }

      message Matrix {
        repeated IntList values = 1;
        repeated string labels = 2;
      }

      message Point {
        double x = 1;
        double y = 2;
      }"
    `);
  });
});
