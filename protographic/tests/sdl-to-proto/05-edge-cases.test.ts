import { describe, expect, test } from 'vitest';
import { compileGraphQLToProto } from '../../src';
import { expectValidProto } from '../util';

describe('SDL to Proto - Edge Cases and Error Handling', () => {
  test('should handle empty schema correctly', () => {
    const sdl = `
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

      option go_package = "cosmo/pkg/proto/service.v1;servicev1";

      service DefaultService {
        rpc QueryDummy(QueryDummyRequest) returns (QueryDummyResponse) {}
      }

      message QueryDummyRequest {
      }
      message QueryDummyResponse {
          string dummy = 1;
      }"
    `);
  });

  test('should handle schema with only scalar fields correctly', () => {
    const sdl = `
      type Query {
        string: String
        int: Int
        float: Float
        boolean: Boolean
        id: ID
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
        rpc QueryBoolean(QueryBooleanRequest) returns (QueryBooleanResponse) {}
        rpc QueryFloat(QueryFloatRequest) returns (QueryFloatResponse) {}
        rpc QueryId(QueryIdRequest) returns (QueryIdResponse) {}
        rpc QueryInt(QueryIntRequest) returns (QueryIntResponse) {}
        rpc QueryString(QueryStringRequest) returns (QueryStringResponse) {}
      }

      message QueryStringRequest {
      }
      message QueryStringResponse {
          string string = 1;
      }
      message QueryIntRequest {
      }
      message QueryIntResponse {
          int32 int = 1;
      }
      message QueryFloatRequest {
      }
      message QueryFloatResponse {
          double float = 1;
      }
      message QueryBooleanRequest {
      }
      message QueryBooleanResponse {
          bool boolean = 1;
      }
      message QueryIdRequest {
      }
      message QueryIdResponse {
          string id = 1;
      }"
    `);
  });

  test('should handle type names that would be reserved in Proto', () => {
    const sdl = `
      type MessageType {
        id: ID!
        content: String!
      }
      
      type ServiceType {
        id: ID!
        name: String!
      }
      
      enum EnumValues {
        ONE
        TWO
      }
      
      type Query {
        messageType(id: ID!): MessageType
        serviceType(id: ID!): ServiceType
        enumValue(type: EnumValues!): String
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
        rpc QueryEnumValue(QueryEnumValueRequest) returns (QueryEnumValueResponse) {}
        rpc QueryMessageType(QueryMessageTypeRequest) returns (QueryMessageTypeResponse) {}
        rpc QueryServiceType(QueryServiceTypeRequest) returns (QueryServiceTypeResponse) {}
      }

      message QueryMessageTypeRequest {
          string id = 1;
      }
      message QueryMessageTypeResponse {
          MessageType message_type = 1;
      }
      message QueryServiceTypeRequest {
          string id = 1;
      }
      message QueryServiceTypeResponse {
          ServiceType service_type = 1;
      }
      message QueryEnumValueRequest {
          EnumValues type = 1;
      }
      message QueryEnumValueResponse {
          string enum_value = 1;
      }

      message MessageType {
        string id = 1;
        string content = 2;
      }

      message ServiceType {
        string id = 1;
        string name = 2;
      }

      enum EnumValues {
        ENUM_VALUES_UNSPECIFIED = 0;
        ENUM_VALUES_ONE = 1;
        ENUM_VALUES_TWO = 2;
      }"
    `);
  });

  test('should handle field names that would be reserved in Proto', () => {
    const sdl = `
      type User {
        id: ID!
        message: String
        service: String
        enum: String
        syntax: String
        package: String
        option: String
        import: String
        reserved: String
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

      option go_package = "cosmo/pkg/proto/service.v1;servicev1";

      service DefaultService {
        rpc QueryUser(QueryUserRequest) returns (QueryUserResponse) {}
      }

      message QueryUserRequest {
          string id = 1;
      }
      message QueryUserResponse {
          User user = 1;
      }

      message User {
        string id = 1;
        string message = 2;
        string service = 3;
        string enum = 4;
        string syntax = 5;
        string package = 6;
        string option = 7;
        string import = 8;
        string reserved = 9;
      }"
    `);
  });

  test('should handle complex schema with various features correctly', () => {
    const sdl = `
      directive @key(fields: String!) on OBJECT | INTERFACE
      directive @deprecated(reason: String) on FIELD_DEFINITION | ENUM_VALUE
      
      scalar DateTime
      scalar JSON
      
      interface Node {
        id: ID!
      }
      
      type User implements Node @key(fields: "id") {
        id: ID!
        name: String!
        email: String!
        createdAt: DateTime!
        metadata: JSON
        status: UserStatus!
        posts: [Post!]
        profile: UserProfile
      }
      
      enum UserStatus {
        ACTIVE
        INACTIVE
        BANNED
      }
      
      type UserProfile {
        bio: String
        avatarUrl: String
        location: String
        website: String
      }
      
      type Post implements Node @key(fields: "id") {
        id: ID!
        title: String!
        content: String!
        author: User!
        tags: [String!]
        createdAt: DateTime!
        updatedAt: DateTime
        status: PostStatus!
        comments: [Comment!]
      }
      
      enum PostStatus {
        DRAFT
        PUBLISHED
        ARCHIVED
      }
      
      type Comment implements Node {
        id: ID!
        post: Post!
        author: User!
        content: String!
        createdAt: DateTime!
        updatedAt: DateTime
      }
      
      union SearchResult = User | Post | Comment
      
      input UserInput {
        name: String!
        email: String!
      }
      
      input PostInput {
        title: String!
        content: String!
        tags: [String!]
        status: PostStatus = DRAFT
      }
      
      input CommentInput {
        postId: ID!
        content: String!
      }
      
      input SearchInput {
        query: String!
        limit: Int = 10
        offset: Int = 0
        types: [String!]
      }
      
      type Query {
        user(id: ID!): User
        users(limit: Int = 10, offset: Int = 0): [User!]!
        post(id: ID!): Post
        posts(limit: Int = 10, offset: Int = 0, status: PostStatus): [Post!]!
        comment(id: ID!): Comment
        comments(postId: ID!, limit: Int = 10, offset: Int = 0): [Comment!]!
        search(input: SearchInput!): [SearchResult!]!
        node(id: ID!): Node
        _entities(representations: [_Any!]!): [_Entity]!
      }
      
      type Mutation {
        createUser(input: UserInput!): User!
        createPost(authorId: ID!, input: PostInput!): Post!
        createComment(authorId: ID!, input: CommentInput!): Comment!
        updatePost(id: ID!, input: PostInput!): Post
        deletePost(id: ID!): Boolean!
      }
      
      scalar _Any
      union _Entity = User | Post
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
        rpc LookupPostById(LookupPostByIdRequest) returns (LookupPostByIdResponse) {}
        rpc LookupUserById(LookupUserByIdRequest) returns (LookupUserByIdResponse) {}
        rpc MutationCreateComment(MutationCreateCommentRequest) returns (MutationCreateCommentResponse) {}
        rpc MutationCreatePost(MutationCreatePostRequest) returns (MutationCreatePostResponse) {}
        rpc MutationCreateUser(MutationCreateUserRequest) returns (MutationCreateUserResponse) {}
        rpc MutationDeletePost(MutationDeletePostRequest) returns (MutationDeletePostResponse) {}
        rpc MutationUpdatePost(MutationUpdatePostRequest) returns (MutationUpdatePostResponse) {}
        rpc QueryComment(QueryCommentRequest) returns (QueryCommentResponse) {}
        rpc QueryComments(QueryCommentsRequest) returns (QueryCommentsResponse) {}
        rpc QueryNode(QueryNodeRequest) returns (QueryNodeResponse) {}
        rpc QueryPost(QueryPostRequest) returns (QueryPostResponse) {}
        rpc QueryPosts(QueryPostsRequest) returns (QueryPostsResponse) {}
        rpc QuerySearch(QuerySearchRequest) returns (QuerySearchResponse) {}
        rpc QueryUser(QueryUserRequest) returns (QueryUserResponse) {}
        rpc QueryUsers(QueryUsersRequest) returns (QueryUsersResponse) {}
      }

      message LookupUserByIdRequestKey {
          string id = 1;
      }

      message LookupUserByIdRequest {
          repeated LookupUserByIdRequestKey keys = 1;
      }

      message LookupUserByIdResponse {
          repeated User result = 1;
      }

      message LookupPostByIdRequestKey {
          string id = 1;
      }

      message LookupPostByIdRequest {
          repeated LookupPostByIdRequestKey keys = 1;
      }

      message LookupPostByIdResponse {
          repeated Post result = 1;
      }

      message QueryUserRequest {
          string id = 1;
      }
      message QueryUserResponse {
          User user = 1;
      }
      message QueryUsersRequest {
          int32 limit = 1;
          int32 offset = 2;
      }
      message QueryUsersResponse {
          repeated User users = 1;
      }
      message QueryPostRequest {
          string id = 1;
      }
      message QueryPostResponse {
          Post post = 1;
      }
      message QueryPostsRequest {
          int32 limit = 1;
          int32 offset = 2;
          PostStatus status = 3;
      }
      message QueryPostsResponse {
          repeated Post posts = 1;
      }
      message QueryCommentRequest {
          string id = 1;
      }
      message QueryCommentResponse {
          Comment comment = 1;
      }
      message QueryCommentsRequest {
          string post_id = 1;
          int32 limit = 2;
          int32 offset = 3;
      }
      message QueryCommentsResponse {
          repeated Comment comments = 1;
      }
      message QuerySearchRequest {
          SearchInput input = 1;
      }
      message QuerySearchResponse {
          repeated SearchResult search = 1;
      }
      message QueryNodeRequest {
          string id = 1;
      }
      message QueryNodeResponse {
          Node node = 1;
      }
      message MutationCreateUserRequest {
          UserInput input = 1;
      }
      message MutationCreateUserResponse {
          User create_user = 1;
      }
      message MutationCreatePostRequest {
          string author_id = 1;
          PostInput input = 2;
      }
      message MutationCreatePostResponse {
          Post create_post = 1;
      }
      message MutationCreateCommentRequest {
          string author_id = 1;
          CommentInput input = 2;
      }
      message MutationCreateCommentResponse {
          Comment create_comment = 1;
      }
      message MutationUpdatePostRequest {
          string id = 1;
          PostInput input = 2;
      }
      message MutationUpdatePostResponse {
          Post update_post = 1;
      }
      message MutationDeletePostRequest {
          string id = 1;
      }
      message MutationDeletePostResponse {
          bool delete_post = 1;
      }

      message User {
        string id = 1;
        string name = 2;
        string email = 3;
        string created_at = 4;
        string metadata = 5;
        UserStatus status = 6;
        repeated Post posts = 7;
        UserProfile profile = 8;
      }

      message Post {
        string id = 1;
        string title = 2;
        string content = 3;
        User author = 4;
        repeated string tags = 5;
        string created_at = 6;
        string updated_at = 7;
        PostStatus status = 8;
        repeated Comment comments = 9;
      }

      message Comment {
        string id = 1;
        Post post = 2;
        User author = 3;
        string content = 4;
        string created_at = 5;
        string updated_at = 6;
      }

      message SearchInput {
        string query = 1;
        int32 limit = 2;
        int32 offset = 3;
        repeated string types = 4;
      }

      message SearchResult {
        oneof value {
          User user = 1;
          Post post = 2;
          Comment comment = 3;
        }
      }

      message Node {
        oneof instance {
          User user = 1;
          Post post = 2;
          Comment comment = 3;
        }
      }

      message UserInput {
        string name = 1;
        string email = 2;
      }

      message PostInput {
        string title = 1;
        string content = 2;
        repeated string tags = 3;
        PostStatus status = 4;
      }

      message CommentInput {
        string post_id = 1;
        string content = 2;
      }

      enum UserStatus {
        USER_STATUS_UNSPECIFIED = 0;
        USER_STATUS_ACTIVE = 1;
        USER_STATUS_INACTIVE = 2;
        USER_STATUS_BANNED = 3;
      }

      message UserProfile {
        string bio = 1;
        string avatar_url = 2;
        string location = 3;
        string website = 4;
      }

      enum PostStatus {
        POST_STATUS_UNSPECIFIED = 0;
        POST_STATUS_DRAFT = 1;
        POST_STATUS_PUBLISHED = 2;
        POST_STATUS_ARCHIVED = 3;
      }"
    `);
  });
});
