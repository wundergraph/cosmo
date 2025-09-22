import { describe, expect, it } from 'vitest';
import { compileGraphQLToProto } from '../../src';
import { expectValidProto } from '../util';

describe('SDL to Proto Field Arguments', () => {
  it('should correctly include field arguments', () => {
    const sdl = `
      type User {
          id: ID!
          name: String!
          posts(limit: Int!): [Post!]!
          hasPermission(permission: String!): Boolean!
      }

      type Post {
          id: ID!
          title: String!
      }

      type Query {
          user(id: ID!): User
      }
    `;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    expectValidProto(protoText);

    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      // Service definition for DefaultService
      service DefaultService {
        rpc QueryUser(QueryUserRequest) returns (QueryUserResponse) {}
        rpc ResolveUserHasPermission(ResolveUserHasPermissionRequest) returns (ResolveUserHasPermissionResponse) {}
        rpc ResolveUserPosts(ResolveUserPostsRequest) returns (ResolveUserPostsResponse) {}
      }

      // Request message for user operation.
      message QueryUserRequest {
        string id = 1;
      }
      // Response message for user operation.
      message QueryUserResponse {
        User user = 1;
      }
      message UserPostsArgs {
        int32 limit = 1;
      }

      message ResolveUserPostsRequestKey {
        string user_id = 1;
        UserPostsArgs user_posts_args = 2;
      }

      message ResolveUserPostsRequest {
        repeated ResolveUserPostsRequestKey key = 1;
      }

      message ResolveUserPostsResponseResult {
        Post posts = 1;
      }

      message ResolveUserPostsResponse {
        repeated ResolveUserPostsResponseResult result = 1;
      }

      message UserHasPermissionArgs {
        string permission = 1;
      }

      message ResolveUserHasPermissionRequestKey {
        string user_id = 1;
        UserHasPermissionArgs user_has_permission_args = 2;
      }

      message ResolveUserHasPermissionRequest {
        repeated ResolveUserHasPermissionRequestKey key = 1;
      }

      message ResolveUserHasPermissionResponseResult {
        bool has_permission = 1;
      }

      message ResolveUserHasPermissionResponse {
        repeated ResolveUserHasPermissionResponseResult result = 1;
      }

      message User {
        string id = 1;
        string name = 2;
      }

      message Post {
        string id = 1;
        string title = 2;
      }"
    `);
  });
  it('should correctly include field arguments with nested types', () => {
    const sdl = `
    type User {
        id: ID!
        post(upper: Boolean!): Post!
    }

    type Post {
        id: ID!
        comment(upper: Boolean!): Comment!
    }

    type Comment {
        content: String!
    }

    type Query {
        user(id: ID!): User
    }
  `;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    expectValidProto(protoText);
    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      // Service definition for DefaultService
      service DefaultService {
        rpc QueryUser(QueryUserRequest) returns (QueryUserResponse) {}
        rpc ResolvePostComment(ResolvePostCommentRequest) returns (ResolvePostCommentResponse) {}
        rpc ResolveUserPost(ResolveUserPostRequest) returns (ResolveUserPostResponse) {}
      }

      // Request message for user operation.
      message QueryUserRequest {
        string id = 1;
      }
      // Response message for user operation.
      message QueryUserResponse {
        User user = 1;
      }
      message UserPostArgs {
        bool upper = 1;
      }

      message ResolveUserPostRequestKey {
        string user_id = 1;
        UserPostArgs user_post_args = 2;
      }

      message ResolveUserPostRequest {
        repeated ResolveUserPostRequestKey key = 1;
      }

      message ResolveUserPostResponseResult {
        Post post = 1;
      }

      message ResolveUserPostResponse {
        repeated ResolveUserPostResponseResult result = 1;
      }

      message PostCommentArgs {
        bool upper = 1;
      }

      message ResolvePostCommentRequestKey {
        string post_id = 1;
        PostCommentArgs post_comment_args = 2;
      }

      message ResolvePostCommentRequest {
        repeated ResolvePostCommentRequestKey key = 1;
      }

      message ResolvePostCommentResponseResult {
        Comment comment = 1;
      }

      message ResolvePostCommentResponse {
        repeated ResolvePostCommentResponseResult result = 1;
      }

      message User {
        string id = 1;
      }

      message Post {
        string id = 1;
      }

      message Comment {
        string content = 1;
      }"
    `);
  });
  it('should correctly include field arguments with nested types with multiple arguments', () => {
    const sdl = `
    type User {
        id: ID!
        post(upper: Boolean!): Post!
    }

    type Post {
        id: ID!
        comment(upper: Boolean!): Comment!
        otherComment(upper: Boolean!): Comment!
    }

    type Comment {
        content: String!
    }

    type Query {
        user(id: ID!): User
    }
  `;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    expectValidProto(protoText);
    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      // Service definition for DefaultService
      service DefaultService {
        rpc QueryUser(QueryUserRequest) returns (QueryUserResponse) {}
        rpc ResolvePostComment(ResolvePostCommentRequest) returns (ResolvePostCommentResponse) {}
        rpc ResolvePostOtherComment(ResolvePostOtherCommentRequest) returns (ResolvePostOtherCommentResponse) {}
        rpc ResolveUserPost(ResolveUserPostRequest) returns (ResolveUserPostResponse) {}
      }

      // Request message for user operation.
      message QueryUserRequest {
        string id = 1;
      }
      // Response message for user operation.
      message QueryUserResponse {
        User user = 1;
      }
      message UserPostArgs {
        bool upper = 1;
      }

      message ResolveUserPostRequestKey {
        string user_id = 1;
        UserPostArgs user_post_args = 2;
      }

      message ResolveUserPostRequest {
        repeated ResolveUserPostRequestKey key = 1;
      }

      message ResolveUserPostResponseResult {
        Post post = 1;
      }

      message ResolveUserPostResponse {
        repeated ResolveUserPostResponseResult result = 1;
      }

      message PostCommentArgs {
        bool upper = 1;
      }

      message ResolvePostCommentRequestKey {
        string post_id = 1;
        PostCommentArgs post_comment_args = 2;
      }

      message ResolvePostCommentRequest {
        repeated ResolvePostCommentRequestKey key = 1;
      }

      message ResolvePostCommentResponseResult {
        Comment comment = 1;
      }

      message ResolvePostCommentResponse {
        repeated ResolvePostCommentResponseResult result = 1;
      }

      message PostOtherCommentArgs {
        bool upper = 1;
      }

      message ResolvePostOtherCommentRequestKey {
        string post_id = 1;
        PostOtherCommentArgs post_other_comment_args = 2;
      }

      message ResolvePostOtherCommentRequest {
        repeated ResolvePostOtherCommentRequestKey key = 1;
      }

      message ResolvePostOtherCommentResponseResult {
        Comment other_comment = 1;
      }

      message ResolvePostOtherCommentResponse {
        repeated ResolvePostOtherCommentResponseResult result = 1;
      }

      message User {
        string id = 1;
      }

      message Post {
        string id = 1;
      }

      message Comment {
        string content = 1;
      }"
    `);
  });
  it('should correctly handle multiple same return types with different arguments and nested resolver types', () => {
    const sdl = `

    directive @resolved(context: openfed__FieldSet!) on FIELD_DEFINITION
    scalar openfed__FieldSet

    type User {
        id: ID!
        name: String!
        post(upper: Boolean!): Post! @resolved(context: "id")
        posts(upper: Boolean!): [Post!]! @resolved(context: "id")
    }

    type Post {
        id: ID!
        comment(upper: Boolean!): Comment! @resolved(context: "id")
    }

    type Comment {
        content: String!
    }

    type Query {
        user(id: ID!): User
    }
  `;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    expectValidProto(protoText);
    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      // Service definition for DefaultService
      service DefaultService {
        rpc QueryUser(QueryUserRequest) returns (QueryUserResponse) {}
        rpc ResolvePostComment(ResolvePostCommentRequest) returns (ResolvePostCommentResponse) {}
        rpc ResolveUserPost(ResolveUserPostRequest) returns (ResolveUserPostResponse) {}
        rpc ResolveUserPosts(ResolveUserPostsRequest) returns (ResolveUserPostsResponse) {}
      }

      // Request message for user operation.
      message QueryUserRequest {
        string id = 1;
      }
      // Response message for user operation.
      message QueryUserResponse {
        User user = 1;
      }
      message UserPostArgs {
        bool upper = 1;
      }

      message ResolveUserPostRequestKey {
        string user_id = 1;
        UserPostArgs user_post_args = 2;
      }

      message ResolveUserPostRequest {
        repeated ResolveUserPostRequestKey key = 1;
      }

      message ResolveUserPostResponseResult {
        Post post = 1;
      }

      message ResolveUserPostResponse {
        repeated ResolveUserPostResponseResult result = 1;
      }

      message UserPostsArgs {
        bool upper = 1;
      }

      message ResolveUserPostsRequestKey {
        string user_id = 1;
        UserPostsArgs user_posts_args = 2;
      }

      message ResolveUserPostsRequest {
        repeated ResolveUserPostsRequestKey key = 1;
      }

      message ResolveUserPostsResponseResult {
        Post posts = 1;
      }

      message ResolveUserPostsResponse {
        repeated ResolveUserPostsResponseResult result = 1;
      }

      message PostCommentArgs {
        bool upper = 1;
      }

      message ResolvePostCommentRequestKey {
        string post_id = 1;
        PostCommentArgs post_comment_args = 2;
      }

      message ResolvePostCommentRequest {
        repeated ResolvePostCommentRequestKey key = 1;
      }

      message ResolvePostCommentResponseResult {
        Comment comment = 1;
      }

      message ResolvePostCommentResponse {
        repeated ResolvePostCommentResponseResult result = 1;
      }

      message User {
        string id = 1;
        string name = 2;
      }

      message Post {
        string id = 1;
      }

      message Comment {
        string content = 1;
      }"
    `);
  });
  it('should correctly handle multiple same return types with different arguments and nested resolver types', () => {
    const sdl = `

    directive @parent(fields: openfed__FieldSet!) on FIELD_DEFINITION
    scalar openfed__FieldSet

    type User {
        id: ID!
        name: String!
        post(upper: Boolean!): Post! @resolved(context: "id name")
    }

    type Post {
        id: ID!
    }

    type Query {
        user(id: ID!): User
    }
  `;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    expectValidProto(protoText);
    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      // Service definition for DefaultService
      service DefaultService {
        rpc QueryUser(QueryUserRequest) returns (QueryUserResponse) {}
        rpc ResolveUserPost(ResolveUserPostRequest) returns (ResolveUserPostResponse) {}
      }

      // Request message for user operation.
      message QueryUserRequest {
        string id = 1;
      }
      // Response message for user operation.
      message QueryUserResponse {
        User user = 1;
      }
      message UserPostArgs {
        bool upper = 1;
      }

      message ResolveUserPostRequestKey {
        string user_id = 1;
        string user_name = 2;
        UserPostArgs user_post_args = 3;
      }

      message ResolveUserPostRequest {
        repeated ResolveUserPostRequestKey key = 1;
      }

      message ResolveUserPostResponseResult {
        Post post = 1;
      }

      message ResolveUserPostResponse {
        repeated ResolveUserPostResponseResult result = 1;
      }

      message User {
        string id = 1;
        string name = 2;
      }

      message Post {
        string id = 1;
      }"
    `);
  });
  it('should raise an error if a field without a context is defined but no ID field is present', () => {
    const sdl = `
    type User {
        name: String!
        post(upper: Boolean!): Post! @resolved
    }

    type Post {
        id: ID!
        title: String!
    }

    type Query {
        user(id: ID!): User
    }
  `;

    expect(() => compileGraphQLToProto(sdl)).throws('Invalid field context for resolver. No fields with type ID found');
  });
  it('should raise an error if no context is provided and multiple ID fields are present', () => {
    const sdl = `
    type User {
        id: ID!
        uuid: ID!
        name(context: String!): String! @resolved
    }

    type Query {
        user(id: ID!): User
    }
  `;

    expect(() => compileGraphQLToProto(sdl)).throws(
      'Invalid field context for resolver. Multiple fields with type ID found - provide a context with the fields you want to use in the @resolved directive',
    );
  });
});
