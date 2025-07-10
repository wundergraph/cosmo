import { describe, expect, test } from 'vitest';
import { compileGraphQLToProto } from '../../src';
import { expectValidProto } from '../util';

describe('SDL to Proto - Edge Cases and Error Handling', () => {
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

      import "google/protobuf/wrappers.proto";

      // Service definition for DefaultService
      service DefaultService {
        rpc QueryBoolean(QueryBooleanRequest) returns (QueryBooleanResponse) {}
        rpc QueryFloat(QueryFloatRequest) returns (QueryFloatResponse) {}
        rpc QueryId(QueryIdRequest) returns (QueryIdResponse) {}
        rpc QueryInt(QueryIntRequest) returns (QueryIntResponse) {}
        rpc QueryString(QueryStringRequest) returns (QueryStringResponse) {}
      }

      // Request message for string operation.
      message QueryStringRequest {
      }
      // Response message for string operation.
      message QueryStringResponse {
        google.protobuf.StringValue string = 1;
      }
      // Request message for int operation.
      message QueryIntRequest {
      }
      // Response message for int operation.
      message QueryIntResponse {
        google.protobuf.Int32Value int = 1;
      }
      // Request message for float operation.
      message QueryFloatRequest {
      }
      // Response message for float operation.
      message QueryFloatResponse {
        google.protobuf.DoubleValue float = 1;
      }
      // Request message for boolean operation.
      message QueryBooleanRequest {
      }
      // Response message for boolean operation.
      message QueryBooleanResponse {
        google.protobuf.BoolValue boolean = 1;
      }
      // Request message for id operation.
      message QueryIdRequest {
      }
      // Response message for id operation.
      message QueryIdResponse {
        google.protobuf.StringValue id = 1;
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

      import "google/protobuf/wrappers.proto";

      // Service definition for DefaultService
      service DefaultService {
        rpc QueryEnumValue(QueryEnumValueRequest) returns (QueryEnumValueResponse) {}
        rpc QueryMessageType(QueryMessageTypeRequest) returns (QueryMessageTypeResponse) {}
        rpc QueryServiceType(QueryServiceTypeRequest) returns (QueryServiceTypeResponse) {}
      }

      // Request message for messageType operation.
      message QueryMessageTypeRequest {
        string id = 1;
      }
      // Response message for messageType operation.
      message QueryMessageTypeResponse {
        MessageType message_type = 1;
      }
      // Request message for serviceType operation.
      message QueryServiceTypeRequest {
        string id = 1;
      }
      // Response message for serviceType operation.
      message QueryServiceTypeResponse {
        ServiceType service_type = 1;
      }
      // Request message for enumValue operation.
      message QueryEnumValueRequest {
        EnumValues type = 1;
      }
      // Response message for enumValue operation.
      message QueryEnumValueResponse {
        google.protobuf.StringValue enum_value = 1;
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

      import "google/protobuf/wrappers.proto";

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
        string id = 1;
        google.protobuf.StringValue message = 2;
        google.protobuf.StringValue service = 3;
        google.protobuf.StringValue enum = 4;
        google.protobuf.StringValue syntax = 5;
        google.protobuf.StringValue package = 6;
        google.protobuf.StringValue option = 7;
        google.protobuf.StringValue import = 8;
        google.protobuf.StringValue reserved = 9;
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

      import "google/protobuf/wrappers.proto";

      // Service definition for DefaultService
      service DefaultService {
        // Lookup Post entity by id
        rpc LookupPostById(LookupPostByIdRequest) returns (LookupPostByIdResponse) {}
        // Lookup User entity by id
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

      // Key message for User entity lookup
      message LookupUserByIdRequestKey {
        // Key field for User entity lookup.
        string id = 1;
      }

      // Request message for User entity lookup.
      message LookupUserByIdRequest {
        /*
         * List of keys to look up User entities.
         * Order matters - each key maps to one entity in LookupUserByIdResponse.
         */
        repeated LookupUserByIdRequestKey keys = 1;
      }

      // Response message for User entity lookup.
      message LookupUserByIdResponse {
        /*
         * List of User entities in the same order as the keys in LookupUserByIdRequest.
         * Always return the same number of entities as keys. Use null for entities that cannot be found.
         * 
         * Example:
         *   LookupUserByIdRequest:
         *     keys:
         *       - id: 1
         *       - id: 2
         *   LookupUserByIdResponse:
         *     result:
         *       - id: 1 # User with id 1 found
         *       - null  # User with id 2 not found
         */
        repeated User result = 1;
      }

      // Key message for Post entity lookup
      message LookupPostByIdRequestKey {
        // Key field for Post entity lookup.
        string id = 1;
      }

      // Request message for Post entity lookup.
      message LookupPostByIdRequest {
        /*
         * List of keys to look up Post entities.
         * Order matters - each key maps to one entity in LookupPostByIdResponse.
         */
        repeated LookupPostByIdRequestKey keys = 1;
      }

      // Response message for Post entity lookup.
      message LookupPostByIdResponse {
        /*
         * List of Post entities in the same order as the keys in LookupPostByIdRequest.
         * Always return the same number of entities as keys. Use null for entities that cannot be found.
         * 
         * Example:
         *   LookupUserByIdRequest:
         *     keys:
         *       - id: 1
         *       - id: 2
         *   LookupUserByIdResponse:
         *     result:
         *       - id: 1 # User with id 1 found
         *       - null  # User with id 2 not found
         */
        repeated Post result = 1;
      }

      // Request message for user operation.
      message QueryUserRequest {
        string id = 1;
      }
      // Response message for user operation.
      message QueryUserResponse {
        User user = 1;
      }
      // Request message for users operation.
      message QueryUsersRequest {
        google.protobuf.Int32Value limit = 1;
        google.protobuf.Int32Value offset = 2;
      }
      // Response message for users operation.
      message QueryUsersResponse {
        repeated User users = 1;
      }
      // Request message for post operation.
      message QueryPostRequest {
        string id = 1;
      }
      // Response message for post operation.
      message QueryPostResponse {
        Post post = 1;
      }
      // Request message for posts operation.
      message QueryPostsRequest {
        google.protobuf.Int32Value limit = 1;
        google.protobuf.Int32Value offset = 2;
        PostStatus status = 3;
      }
      // Response message for posts operation.
      message QueryPostsResponse {
        repeated Post posts = 1;
      }
      // Request message for comment operation.
      message QueryCommentRequest {
        string id = 1;
      }
      // Response message for comment operation.
      message QueryCommentResponse {
        Comment comment = 1;
      }
      // Request message for comments operation.
      message QueryCommentsRequest {
        string post_id = 1;
        google.protobuf.Int32Value limit = 2;
        google.protobuf.Int32Value offset = 3;
      }
      // Response message for comments operation.
      message QueryCommentsResponse {
        repeated Comment comments = 1;
      }
      // Request message for search operation.
      message QuerySearchRequest {
        SearchInput input = 1;
      }
      // Response message for search operation.
      message QuerySearchResponse {
        repeated SearchResult search = 1;
      }
      // Request message for node operation.
      message QueryNodeRequest {
        string id = 1;
      }
      // Response message for node operation.
      message QueryNodeResponse {
        Node node = 1;
      }
      // Request message for createUser operation.
      message MutationCreateUserRequest {
        UserInput input = 1;
      }
      // Response message for createUser operation.
      message MutationCreateUserResponse {
        User create_user = 1;
      }
      // Request message for createPost operation.
      message MutationCreatePostRequest {
        string author_id = 1;
        PostInput input = 2;
      }
      // Response message for createPost operation.
      message MutationCreatePostResponse {
        Post create_post = 1;
      }
      // Request message for createComment operation.
      message MutationCreateCommentRequest {
        string author_id = 1;
        CommentInput input = 2;
      }
      // Response message for createComment operation.
      message MutationCreateCommentResponse {
        Comment create_comment = 1;
      }
      // Request message for updatePost operation.
      message MutationUpdatePostRequest {
        string id = 1;
        PostInput input = 2;
      }
      // Response message for updatePost operation.
      message MutationUpdatePostResponse {
        Post update_post = 1;
      }
      // Request message for deletePost operation.
      message MutationDeletePostRequest {
        string id = 1;
      }
      // Response message for deletePost operation.
      message MutationDeletePostResponse {
        bool delete_post = 1;
      }

      message User {
        string id = 1;
        string name = 2;
        string email = 3;
        string created_at = 4;
        google.protobuf.StringValue metadata = 5;
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
        google.protobuf.StringValue updated_at = 7;
        PostStatus status = 8;
        repeated Comment comments = 9;
      }

      message Comment {
        string id = 1;
        Post post = 2;
        User author = 3;
        string content = 4;
        string created_at = 5;
        google.protobuf.StringValue updated_at = 6;
      }

      message SearchInput {
        string query = 1;
        google.protobuf.Int32Value limit = 2;
        google.protobuf.Int32Value offset = 3;
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
        google.protobuf.StringValue bio = 1;
        google.protobuf.StringValue avatar_url = 2;
        google.protobuf.StringValue location = 3;
        google.protobuf.StringValue website = 4;
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
