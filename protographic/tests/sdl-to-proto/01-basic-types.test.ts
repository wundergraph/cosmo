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

      import "google/protobuf/wrappers.proto";

      // Service definition for DefaultService
      service DefaultService {
        rpc QueryBooleanField(QueryBooleanFieldRequest) returns (QueryBooleanFieldResponse) {}
        rpc QueryFloatField(QueryFloatFieldRequest) returns (QueryFloatFieldResponse) {}
        rpc QueryIdField(QueryIdFieldRequest) returns (QueryIdFieldResponse) {}
        rpc QueryIntField(QueryIntFieldRequest) returns (QueryIntFieldResponse) {}
        rpc QueryStringField(QueryStringFieldRequest) returns (QueryStringFieldResponse) {}
      }

      // Request message for stringField operation.
      message QueryStringFieldRequest {
      }
      // Response message for stringField operation.
      message QueryStringFieldResponse {
        google.protobuf.StringValue string_field = 1;
      }
      // Request message for intField operation.
      message QueryIntFieldRequest {
      }
      // Response message for intField operation.
      message QueryIntFieldResponse {
        google.protobuf.Int32Value int_field = 1;
      }
      // Request message for floatField operation.
      message QueryFloatFieldRequest {
      }
      // Response message for floatField operation.
      message QueryFloatFieldResponse {
        google.protobuf.DoubleValue float_field = 1;
      }
      // Request message for booleanField operation.
      message QueryBooleanFieldRequest {
      }
      // Response message for booleanField operation.
      message QueryBooleanFieldResponse {
        google.protobuf.BoolValue boolean_field = 1;
      }
      // Request message for idField operation.
      message QueryIdFieldRequest {
      }
      // Response message for idField operation.
      message QueryIdFieldResponse {
        google.protobuf.StringValue id_field = 1;
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

      // Service definition for DefaultService
      service DefaultService {
        rpc QueryRequiredInt(QueryRequiredIntRequest) returns (QueryRequiredIntResponse) {}
        rpc QueryRequiredString(QueryRequiredStringRequest) returns (QueryRequiredStringResponse) {}
      }

      // Request message for requiredString operation.
      message QueryRequiredStringRequest {
      }
      // Response message for requiredString operation.
      message QueryRequiredStringResponse {
        string required_string = 1;
      }
      // Request message for requiredInt operation.
      message QueryRequiredIntRequest {
      }
      // Response message for requiredInt operation.
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

      // Service definition for DefaultService
      service DefaultService {
        rpc QueryIntList(QueryIntListRequest) returns (QueryIntListResponse) {}
        rpc QueryRequiredStrings(QueryRequiredStringsRequest) returns (QueryRequiredStringsResponse) {}
        rpc QueryStringList(QueryStringListRequest) returns (QueryStringListResponse) {}
      }

      // Request message for stringList operation.
      message QueryStringListRequest {
      }
      // Response message for stringList operation.
      message QueryStringListResponse {
        repeated string string_list = 1;
      }
      // Request message for intList operation.
      message QueryIntListRequest {
      }
      // Response message for intList operation.
      message QueryIntListResponse {
        repeated int32 int_list = 1;
      }
      // Request message for requiredStrings operation.
      message QueryRequiredStringsRequest {
      }
      // Response message for requiredStrings operation.
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

      import "google/protobuf/wrappers.proto";

      // Service definition for DefaultService
      service DefaultService {
        rpc QueryUser(QueryUserRequest) returns (QueryUserResponse) {}
      }

      // Request message for user operation.
      message QueryUserRequest {
      }
      // Response message for user operation.
      message QueryUserResponse {
        User user = 1;
      }

      message User {
        string id = 1;
        string name = 2;
        google.protobuf.Int32Value age = 3;
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

      import "google/protobuf/wrappers.proto";

      // Service definition for DefaultService
      service DefaultService {
        rpc QueryFilteredUsers(QueryFilteredUsersRequest) returns (QueryFilteredUsersResponse) {}
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
      // Request message for filteredUsers operation.
      message QueryFilteredUsersRequest {
        int32 limit = 1;
        google.protobuf.Int32Value offset = 2;
        google.protobuf.StringValue name_filter = 3;
      }
      // Response message for filteredUsers operation.
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

      import "google/protobuf/wrappers.proto";

      // Service definition for CustomService
      service CustomService {
        rpc QueryHello(QueryHelloRequest) returns (QueryHelloResponse) {}
      }

      // Request message for hello operation.
      message QueryHelloRequest {
      }
      // Response message for hello operation.
      message QueryHelloResponse {
        google.protobuf.StringValue hello = 1;
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

      import "google/protobuf/wrappers.proto";

      // Service definition for DefaultService
      service DefaultService {
        rpc MutationField2(MutationField2Request) returns (MutationField2Response) {}
        rpc QueryField1(QueryField1Request) returns (QueryField1Response) {}
      }

      // Request message for field1 operation.
      message QueryField1Request {
      }
      // Response message for field1 operation.
      message QueryField1Response {
        google.protobuf.StringValue field_1 = 1;
      }
      // Request message for field2 operation.
      message MutationField2Request {
        google.protobuf.StringValue input = 1;
      }
      // Response message for field2 operation.
      message MutationField2Response {
        google.protobuf.Int32Value field_2 = 1;
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

      // Service definition for DefaultService
      service DefaultService {
        rpc QueryCategoriesByKinds(QueryCategoriesByKindsRequest) returns (QueryCategoriesByKindsResponse) {}
        rpc QueryFilterItems(QueryFilterItemsRequest) returns (QueryFilterItemsResponse) {}
      }

      // Request message for categoriesByKinds operation.
      message QueryCategoriesByKindsRequest {
        repeated CategoryKind kinds = 1;
      }
      // Response message for categoriesByKinds operation.
      message QueryCategoriesByKindsResponse {
        repeated Category categories_by_kinds = 1;
      }
      // Request message for filterItems operation.
      message QueryFilterItemsRequest {
        repeated string ids = 1;
        repeated string tags = 2;
      }
      // Response message for filterItems operation.
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

      // Service definition for DefaultService
      service DefaultService {
        rpc QueryGetMatrix(QueryGetMatrixRequest) returns (QueryGetMatrixResponse) {}
        rpc QueryProcessMatrix(QueryProcessMatrixRequest) returns (QueryProcessMatrixResponse) {}
        rpc QueryTransformData(QueryTransformDataRequest) returns (QueryTransformDataResponse) {}
      }

      // Wrapper message for a list of Float.
      message FloatList {
        repeated double result = 1;
      }

      // Wrapper message for a list of Int.
      message IntList {
        repeated int32 result = 1;
      }

      // Wrapper message for a list of Point.
      message PointList {
        repeated Point result = 1;
      }

      // Request message for getMatrix operation.
      message QueryGetMatrixRequest {
      }
      // Response message for getMatrix operation.
      message QueryGetMatrixResponse {
        Matrix get_matrix = 1;
      }
      // Request message for processMatrix operation.
      message QueryProcessMatrixRequest {
        repeated FloatList matrix = 1;
      }
      // Response message for processMatrix operation.
      message QueryProcessMatrixResponse {
        repeated IntList process_matrix = 1;
      }
      // Request message for transformData operation.
      message QueryTransformDataRequest {
        repeated PointList points = 1;
      }
      // Response message for transformData operation.
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

  test('should convert nullable scalar types to wrapper types', () => {
    const sdl = `
      type Query {
        nullableString: String
        nullableInt: Int
        nullableFloat: Float
        nullableBoolean: Boolean
        nullableId: ID
      }
    `;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    // Validate Proto definition
    expectValidProto(protoText);

    // Full snapshot to ensure overall structure is correct
    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      import "google/protobuf/wrappers.proto";

      // Service definition for DefaultService
      service DefaultService {
        rpc QueryNullableBoolean(QueryNullableBooleanRequest) returns (QueryNullableBooleanResponse) {}
        rpc QueryNullableFloat(QueryNullableFloatRequest) returns (QueryNullableFloatResponse) {}
        rpc QueryNullableId(QueryNullableIdRequest) returns (QueryNullableIdResponse) {}
        rpc QueryNullableInt(QueryNullableIntRequest) returns (QueryNullableIntResponse) {}
        rpc QueryNullableString(QueryNullableStringRequest) returns (QueryNullableStringResponse) {}
      }

      // Request message for nullableString operation.
      message QueryNullableStringRequest {
      }
      // Response message for nullableString operation.
      message QueryNullableStringResponse {
        google.protobuf.StringValue nullable_string = 1;
      }
      // Request message for nullableInt operation.
      message QueryNullableIntRequest {
      }
      // Response message for nullableInt operation.
      message QueryNullableIntResponse {
        google.protobuf.Int32Value nullable_int = 1;
      }
      // Request message for nullableFloat operation.
      message QueryNullableFloatRequest {
      }
      // Response message for nullableFloat operation.
      message QueryNullableFloatResponse {
        google.protobuf.DoubleValue nullable_float = 1;
      }
      // Request message for nullableBoolean operation.
      message QueryNullableBooleanRequest {
      }
      // Response message for nullableBoolean operation.
      message QueryNullableBooleanResponse {
        google.protobuf.BoolValue nullable_boolean = 1;
      }
      // Request message for nullableId operation.
      message QueryNullableIdRequest {
      }
      // Response message for nullableId operation.
      message QueryNullableIdResponse {
        google.protobuf.StringValue nullable_id = 1;
      }"
    `);
  });

  test('should use wrapper types in nested and recursive scenarios', () => {
    const sdl = `
      type User {
        id: ID!
        name: String!
        email: String
        profile: UserProfile
        friends: [User]
      }

      type UserProfile {
        bio: String
        age: Int
        isVerified: Boolean
        socialLinks: SocialLinks
      }

      type SocialLinks {
        twitter: String
        linkedin: String
        website: String
      }

      type TreeNode {
        id: ID!
        value: String
        weight: Float
        isLeaf: Boolean!
        children: [TreeNode]
        parent: TreeNode
      }

      type Query {
        user(id: ID!): User
        tree(id: ID!): TreeNode
      }

      input UserInput {
        name: String!
        email: String
        profile: UserProfileInput
      }

      input UserProfileInput {
        bio: String
        age: Int
        isVerified: Boolean
      }

      type Mutation {
        createUser(input: UserInput!): User
        updateTreeNode(id: ID!, value: String, weight: Float): TreeNode
      }
    `;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    // Validate Proto definition
    expectValidProto(protoText);

    // Full snapshot to ensure wrapper types are used correctly in nested and recursive scenarios
    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      import "google/protobuf/wrappers.proto";

      // Service definition for DefaultService
      service DefaultService {
        rpc MutationCreateUser(MutationCreateUserRequest) returns (MutationCreateUserResponse) {}
        rpc MutationUpdateTreeNode(MutationUpdateTreeNodeRequest) returns (MutationUpdateTreeNodeResponse) {}
        rpc QueryTree(QueryTreeRequest) returns (QueryTreeResponse) {}
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
      // Request message for tree operation.
      message QueryTreeRequest {
        string id = 1;
      }
      // Response message for tree operation.
      message QueryTreeResponse {
        TreeNode tree = 1;
      }
      // Request message for createUser operation.
      message MutationCreateUserRequest {
        UserInput input = 1;
      }
      // Response message for createUser operation.
      message MutationCreateUserResponse {
        User create_user = 1;
      }
      // Request message for updateTreeNode operation.
      message MutationUpdateTreeNodeRequest {
        string id = 1;
        google.protobuf.StringValue value = 2;
        google.protobuf.DoubleValue weight = 3;
      }
      // Response message for updateTreeNode operation.
      message MutationUpdateTreeNodeResponse {
        TreeNode update_tree_node = 1;
      }

      message User {
        string id = 1;
        string name = 2;
        google.protobuf.StringValue email = 3;
        UserProfile profile = 4;
        repeated User friends = 5;
      }

      message TreeNode {
        string id = 1;
        google.protobuf.StringValue value = 2;
        google.protobuf.DoubleValue weight = 3;
        bool is_leaf = 4;
        repeated TreeNode children = 5;
        TreeNode parent = 6;
      }

      message UserInput {
        string name = 1;
        google.protobuf.StringValue email = 2;
        UserProfileInput profile = 3;
      }

      message UserProfile {
        google.protobuf.StringValue bio = 1;
        google.protobuf.Int32Value age = 2;
        google.protobuf.BoolValue is_verified = 3;
        SocialLinks social_links = 4;
      }

      message SocialLinks {
        google.protobuf.StringValue twitter = 1;
        google.protobuf.StringValue linkedin = 2;
        google.protobuf.StringValue website = 3;
      }

      message UserProfileInput {
        google.protobuf.StringValue bio = 1;
        google.protobuf.Int32Value age = 2;
        google.protobuf.BoolValue is_verified = 3;
      }"
    `);
  });
});
