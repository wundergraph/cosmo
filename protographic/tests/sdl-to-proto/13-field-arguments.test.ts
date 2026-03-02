import { describe, expect, it } from 'vitest';
import { compileGraphQLToProto } from '../../src/index.js';
import { expectValidProto } from '../util.js';

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
      message ResolveUserPostsArgs {
        int32 limit = 1;
      }

      message ResolveUserPostsContext {
        string id = 1;
      }

      message ResolveUserPostsRequest {
        // context provides the resolver context for the field posts of type User.
        repeated ResolveUserPostsContext context = 1;
        // field_args provides the arguments for the resolver field posts of type User.
        ResolveUserPostsArgs field_args = 2;
      }

      message ResolveUserPostsResult {
        repeated Post posts = 1;
      }

      message ResolveUserPostsResponse {
        repeated ResolveUserPostsResult result = 1;
      }

      message ResolveUserHasPermissionArgs {
        string permission = 1;
      }

      message ResolveUserHasPermissionContext {
        string id = 1;
      }

      message ResolveUserHasPermissionRequest {
        // context provides the resolver context for the field hasPermission of type User.
        repeated ResolveUserHasPermissionContext context = 1;
        // field_args provides the arguments for the resolver field hasPermission of type User.
        ResolveUserHasPermissionArgs field_args = 2;
      }

      message ResolveUserHasPermissionResult {
        bool has_permission = 1;
      }

      message ResolveUserHasPermissionResponse {
        repeated ResolveUserHasPermissionResult result = 1;
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

  it('should correctly generate a context message with a list type', () => {
    const sdl = `
      type User {
          id: ID!
          name: String!
          posts: [Post!]!
          lastestPosts(withinDays: Int!): [Post!]! @connect__fieldResolver(context: "id name posts")
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
        rpc ResolveUserLastestPosts(ResolveUserLastestPostsRequest) returns (ResolveUserLastestPostsResponse) {}
      }

      // Request message for user operation.
      message QueryUserRequest {
        string id = 1;
      }
      // Response message for user operation.
      message QueryUserResponse {
        User user = 1;
      }
      message ResolveUserLastestPostsArgs {
        int32 within_days = 1;
      }

      message ResolveUserLastestPostsContext {
        string id = 1;
        string name = 2;
        repeated Post posts = 3;
      }

      message ResolveUserLastestPostsRequest {
        // context provides the resolver context for the field lastestPosts of type User.
        repeated ResolveUserLastestPostsContext context = 1;
        // field_args provides the arguments for the resolver field lastestPosts of type User.
        ResolveUserLastestPostsArgs field_args = 2;
      }

      message ResolveUserLastestPostsResult {
        repeated Post lastest_posts = 1;
      }

      message ResolveUserLastestPostsResponse {
        repeated ResolveUserLastestPostsResult result = 1;
      }

      message User {
        string id = 1;
        string name = 2;
        repeated Post posts = 3;
      }

      message Post {
        string id = 1;
        string title = 2;
      }"
    `);
  });

  it('should correctly generate a context message with a nullable list type and nested list type', () => {
    const sdl = `
      type User {
          id: ID!
          name: String!
          posts: [Post!]
          categories: [[Category!]!]!
          lastestPosts(withinDays: Int!): [Post!]! @connect__fieldResolver(context: "id name posts categories")
      }

      type Category {
        id: ID!
        name: String!
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
        rpc ResolveUserLastestPosts(ResolveUserLastestPostsRequest) returns (ResolveUserLastestPostsResponse) {}
      }

      // Wrapper message for a list of Category.
      message ListOfCategory {
        message List {
          repeated Category items = 1;
        }
        List list = 1;
      }
      // Wrapper message for a list of Category.
      message ListOfListOfCategory {
        message List {
          repeated ListOfCategory items = 1;
        }
        List list = 1;
      }
      // Wrapper message for a list of Post.
      message ListOfPost {
        message List {
          repeated Post items = 1;
        }
        List list = 1;
      }
      // Request message for user operation.
      message QueryUserRequest {
        string id = 1;
      }
      // Response message for user operation.
      message QueryUserResponse {
        User user = 1;
      }
      message ResolveUserLastestPostsArgs {
        int32 within_days = 1;
      }

      message ResolveUserLastestPostsContext {
        string id = 1;
        string name = 2;
        ListOfPost posts = 3;
        ListOfListOfCategory categories = 4;
      }

      message ResolveUserLastestPostsRequest {
        // context provides the resolver context for the field lastestPosts of type User.
        repeated ResolveUserLastestPostsContext context = 1;
        // field_args provides the arguments for the resolver field lastestPosts of type User.
        ResolveUserLastestPostsArgs field_args = 2;
      }

      message ResolveUserLastestPostsResult {
        repeated Post lastest_posts = 1;
      }

      message ResolveUserLastestPostsResponse {
        repeated ResolveUserLastestPostsResult result = 1;
      }

      message User {
        string id = 1;
        string name = 2;
        ListOfPost posts = 3;
        ListOfListOfCategory categories = 4;
      }

      message Category {
        string id = 1;
        string name = 2;
      }

      message Post {
        string id = 1;
        string title = 2;
      }"
    `);
  });

  it('should correctly include lists as response types', () => {
    const sdl = `
    type User {
        id: ID!
        posts(limit: Int!): [Post!]!
        comments(limit: Int!): [Comment!]
    }

    type Post {
        id: ID!
        title: String!
    }

    type Comment {
        id: ID!
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
        rpc ResolveUserComments(ResolveUserCommentsRequest) returns (ResolveUserCommentsResponse) {}
        rpc ResolveUserPosts(ResolveUserPostsRequest) returns (ResolveUserPostsResponse) {}
      }

      // Wrapper message for a list of Comment.
      message ListOfComment {
        message List {
          repeated Comment items = 1;
        }
        List list = 1;
      }
      // Request message for user operation.
      message QueryUserRequest {
        string id = 1;
      }
      // Response message for user operation.
      message QueryUserResponse {
        User user = 1;
      }
      message ResolveUserPostsArgs {
        int32 limit = 1;
      }

      message ResolveUserPostsContext {
        string id = 1;
      }

      message ResolveUserPostsRequest {
        // context provides the resolver context for the field posts of type User.
        repeated ResolveUserPostsContext context = 1;
        // field_args provides the arguments for the resolver field posts of type User.
        ResolveUserPostsArgs field_args = 2;
      }

      message ResolveUserPostsResult {
        repeated Post posts = 1;
      }

      message ResolveUserPostsResponse {
        repeated ResolveUserPostsResult result = 1;
      }

      message ResolveUserCommentsArgs {
        int32 limit = 1;
      }

      message ResolveUserCommentsContext {
        string id = 1;
      }

      message ResolveUserCommentsRequest {
        // context provides the resolver context for the field comments of type User.
        repeated ResolveUserCommentsContext context = 1;
        // field_args provides the arguments for the resolver field comments of type User.
        ResolveUserCommentsArgs field_args = 2;
      }

      message ResolveUserCommentsResult {
        ListOfComment comments = 1;
      }

      message ResolveUserCommentsResponse {
        repeated ResolveUserCommentsResult result = 1;
      }

      message User {
        string id = 1;
      }

      message Post {
        string id = 1;
        string title = 2;
      }

      message Comment {
        string id = 1;
        string content = 2;
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
      message ResolveUserPostArgs {
        bool upper = 1;
      }

      message ResolveUserPostContext {
        string id = 1;
      }

      message ResolveUserPostRequest {
        // context provides the resolver context for the field post of type User.
        repeated ResolveUserPostContext context = 1;
        // field_args provides the arguments for the resolver field post of type User.
        ResolveUserPostArgs field_args = 2;
      }

      message ResolveUserPostResult {
        Post post = 1;
      }

      message ResolveUserPostResponse {
        repeated ResolveUserPostResult result = 1;
      }

      message ResolvePostCommentArgs {
        bool upper = 1;
      }

      message ResolvePostCommentContext {
        string id = 1;
      }

      message ResolvePostCommentRequest {
        // context provides the resolver context for the field comment of type Post.
        repeated ResolvePostCommentContext context = 1;
        // field_args provides the arguments for the resolver field comment of type Post.
        ResolvePostCommentArgs field_args = 2;
      }

      message ResolvePostCommentResult {
        Comment comment = 1;
      }

      message ResolvePostCommentResponse {
        repeated ResolvePostCommentResult result = 1;
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
      message ResolveUserPostArgs {
        bool upper = 1;
      }

      message ResolveUserPostContext {
        string id = 1;
      }

      message ResolveUserPostRequest {
        // context provides the resolver context for the field post of type User.
        repeated ResolveUserPostContext context = 1;
        // field_args provides the arguments for the resolver field post of type User.
        ResolveUserPostArgs field_args = 2;
      }

      message ResolveUserPostResult {
        Post post = 1;
      }

      message ResolveUserPostResponse {
        repeated ResolveUserPostResult result = 1;
      }

      message ResolvePostCommentArgs {
        bool upper = 1;
      }

      message ResolvePostCommentContext {
        string id = 1;
      }

      message ResolvePostCommentRequest {
        // context provides the resolver context for the field comment of type Post.
        repeated ResolvePostCommentContext context = 1;
        // field_args provides the arguments for the resolver field comment of type Post.
        ResolvePostCommentArgs field_args = 2;
      }

      message ResolvePostCommentResult {
        Comment comment = 1;
      }

      message ResolvePostCommentResponse {
        repeated ResolvePostCommentResult result = 1;
      }

      message ResolvePostOtherCommentArgs {
        bool upper = 1;
      }

      message ResolvePostOtherCommentContext {
        string id = 1;
      }

      message ResolvePostOtherCommentRequest {
        // context provides the resolver context for the field otherComment of type Post.
        repeated ResolvePostOtherCommentContext context = 1;
        // field_args provides the arguments for the resolver field otherComment of type Post.
        ResolvePostOtherCommentArgs field_args = 2;
      }

      message ResolvePostOtherCommentResult {
        Comment other_comment = 1;
      }

      message ResolvePostOtherCommentResponse {
        repeated ResolvePostOtherCommentResult result = 1;
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
    type User {
        id: ID!
        name: String!
        post(upper: Boolean!): Post! @connect__fieldResolver(context: "id")
        posts(upper: Boolean!): [Post!]! @connect__fieldResolver(context: "id")
    }

    type Post {
        id: ID!
        comment(upper: Boolean!): Comment! @connect__fieldResolver(context: "id")
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
      message ResolveUserPostArgs {
        bool upper = 1;
      }

      message ResolveUserPostContext {
        string id = 1;
      }

      message ResolveUserPostRequest {
        // context provides the resolver context for the field post of type User.
        repeated ResolveUserPostContext context = 1;
        // field_args provides the arguments for the resolver field post of type User.
        ResolveUserPostArgs field_args = 2;
      }

      message ResolveUserPostResult {
        Post post = 1;
      }

      message ResolveUserPostResponse {
        repeated ResolveUserPostResult result = 1;
      }

      message ResolveUserPostsArgs {
        bool upper = 1;
      }

      message ResolveUserPostsContext {
        string id = 1;
      }

      message ResolveUserPostsRequest {
        // context provides the resolver context for the field posts of type User.
        repeated ResolveUserPostsContext context = 1;
        // field_args provides the arguments for the resolver field posts of type User.
        ResolveUserPostsArgs field_args = 2;
      }

      message ResolveUserPostsResult {
        repeated Post posts = 1;
      }

      message ResolveUserPostsResponse {
        repeated ResolveUserPostsResult result = 1;
      }

      message ResolvePostCommentArgs {
        bool upper = 1;
      }

      message ResolvePostCommentContext {
        string id = 1;
      }

      message ResolvePostCommentRequest {
        // context provides the resolver context for the field comment of type Post.
        repeated ResolvePostCommentContext context = 1;
        // field_args provides the arguments for the resolver field comment of type Post.
        ResolvePostCommentArgs field_args = 2;
      }

      message ResolvePostCommentResult {
        Comment comment = 1;
      }

      message ResolvePostCommentResponse {
        repeated ResolvePostCommentResult result = 1;
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

    type User {
        id: ID!
        name: String!
        post(upper: Boolean!): Post! @connect__fieldResolver(context: "id name")
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
      message ResolveUserPostArgs {
        bool upper = 1;
      }

      message ResolveUserPostContext {
        string id = 1;
        string name = 2;
      }

      message ResolveUserPostRequest {
        // context provides the resolver context for the field post of type User.
        repeated ResolveUserPostContext context = 1;
        // field_args provides the arguments for the resolver field post of type User.
        ResolveUserPostArgs field_args = 2;
      }

      message ResolveUserPostResult {
        Post post = 1;
      }

      message ResolveUserPostResponse {
        repeated ResolveUserPostResult result = 1;
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
  it('should correctly handle fields inside arrays', () => {
    const sdl = `
    scalar openfed__FieldSet

    type Category {
      id: ID!
      products: [Product!]!
    }

    type Product {
        id: ID!
        count(filters: ProductCountFilter): Int! @connect__fieldResolver(context: "id")
    }

    type ProductCountFilter {
      minPrice: Float
      maxPrice: Float
      inStock: Boolean
      searchTerm: String
    }

    type Query {
        categories: [Category!]!
    }
  `;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    expectValidProto(protoText);
    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      import "google/protobuf/wrappers.proto";

      // Service definition for DefaultService
      service DefaultService {
        rpc QueryCategories(QueryCategoriesRequest) returns (QueryCategoriesResponse) {}
        rpc ResolveProductCount(ResolveProductCountRequest) returns (ResolveProductCountResponse) {}
      }

      // Request message for categories operation.
      message QueryCategoriesRequest {
      }
      // Response message for categories operation.
      message QueryCategoriesResponse {
        repeated Category categories = 1;
      }
      message ResolveProductCountArgs {
        ProductCountFilter filters = 1;
      }

      message ResolveProductCountContext {
        string id = 1;
      }

      message ResolveProductCountRequest {
        // context provides the resolver context for the field count of type Product.
        repeated ResolveProductCountContext context = 1;
        // field_args provides the arguments for the resolver field count of type Product.
        ResolveProductCountArgs field_args = 2;
      }

      message ResolveProductCountResult {
        int32 count = 1;
      }

      message ResolveProductCountResponse {
        repeated ResolveProductCountResult result = 1;
      }

      message Category {
        string id = 1;
        repeated Product products = 2;
      }

      message Product {
        string id = 1;
      }

      message ProductCountFilter {
        google.protobuf.DoubleValue min_price = 1;
        google.protobuf.DoubleValue max_price = 2;
        google.protobuf.BoolValue in_stock = 3;
        google.protobuf.StringValue search_term = 4;
      }"
    `);
  });
  it('should raise an error if a field without a context is defined but no ID field is present', () => {
    const sdl = `
    type User {
        name: String!
        post(upper: Boolean!): Post! @connect__fieldResolver
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
        name(context: String!): String! @connect__fieldResolver
    }

    type Query {
        user(id: ID!): User
    }
  `;

    expect(() => compileGraphQLToProto(sdl)).throws(
      'Invalid field context for resolver. Multiple fields with type ID found - provide a context with the fields you want to use in the @connect__fieldResolver directive',
    );
  });
  it('should correctly convert camelCase field names to snake_case in context messages', () => {
    const sdl = `
    type User {
        id: ID!
        myLongFieldName: String!
        anotherVeryLongField: Int!
        post(upper: Boolean!): Post! @connect__fieldResolver(context: "id myLongFieldName anotherVeryLongField")
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
      message ResolveUserPostArgs {
        bool upper = 1;
      }

      message ResolveUserPostContext {
        string id = 1;
        string my_long_field_name = 2;
        int32 another_very_long_field = 3;
      }

      message ResolveUserPostRequest {
        // context provides the resolver context for the field post of type User.
        repeated ResolveUserPostContext context = 1;
        // field_args provides the arguments for the resolver field post of type User.
        ResolveUserPostArgs field_args = 2;
      }

      message ResolveUserPostResult {
        Post post = 1;
      }

      message ResolveUserPostResponse {
        repeated ResolveUserPostResult result = 1;
      }

      message User {
        string id = 1;
        string my_long_field_name = 2;
        int32 another_very_long_field = 3;
      }

      message Post {
        string id = 1;
        string title = 2;
      }"
    `);
  });
});
