import { describe, expect, test } from 'vitest';
import { buildSchema, parse, TypeInfo, GraphQLObjectType, Kind } from 'graphql';
import { buildMessageFromSelectionSet } from '../../src/operations/message-builder.js';
import { compileOperationsToProto } from '../../src/operation-to-proto.js';
import { expectValidProto } from '../util.js';

describe('Fragment Support', () => {
  describe('Named Fragments (Fragment Spreads)', () => {
    test('should handle simple fragment spread', () => {
      const schema = `
        type Query {
          user: User
        }
        
        type User {
          id: ID!
          name: String
          email: String
        }
      `;

      const operation = `
        fragment UserFields on User {
          id
          name
          email
        }
        
        query GetUser {
          user {
            ...UserFields
          }
        }
      `;

      const { proto, root } = compileOperationsToProto(operation, schema);

      expectValidProto(proto);

      // Validate the complete proto structure with inline snapshot
      expect(proto).toMatchInlineSnapshot(`
        "syntax = "proto3";
        package service.v1;

        import "google/protobuf/wrappers.proto";

        service DefaultService {
          rpc GetUser(GetUserRequest) returns (GetUserResponse) {}
        }

        message GetUserRequest {
        }

        message GetUserResponse {
          message User {
            string id = 1;
            google.protobuf.StringValue name = 2;
            google.protobuf.StringValue email = 3;
          }
          User user = 1;
        }
        "
      `);
    });

    test('should handle multiple fragment spreads', () => {
      const schema = `
        type Query {
          user: User
        }
        
        type User {
          id: ID!
          name: String
          email: String
          age: Int
          active: Boolean
        }
      `;

      const operation = `
        fragment BasicInfo on User {
          id
          name
        }
        
        fragment ContactInfo on User {
          email
        }
        
        fragment StatusInfo on User {
          age
          active
        }
        
        query GetUser {
          user {
            ...BasicInfo
            ...ContactInfo
            ...StatusInfo
          }
        }
      `;

      const { proto, root } = compileOperationsToProto(operation, schema);

      expectValidProto(proto);

      // Validate the complete proto structure with inline snapshot
      expect(proto).toMatchInlineSnapshot(`
        "syntax = "proto3";
        package service.v1;

        import "google/protobuf/wrappers.proto";

        service DefaultService {
          rpc GetUser(GetUserRequest) returns (GetUserResponse) {}
        }

        message GetUserRequest {
        }

        message GetUserResponse {
          message User {
            string id = 1;
            google.protobuf.StringValue name = 2;
            google.protobuf.StringValue email = 3;
            google.protobuf.Int32Value age = 4;
            google.protobuf.BoolValue active = 5;
          }
          User user = 1;
        }
        "
      `);
    });

    test('should handle nested fragment spreads (fragment within fragment)', () => {
      const schema = `
        type Query {
          user: User
        }
        
        type User {
          id: ID!
          name: String
          profile: Profile
        }
        
        type Profile {
          bio: String
          avatar: String
        }
      `;

      const operation = `
        fragment ProfileInfo on Profile {
          bio
          avatar
        }
        
        fragment UserWithProfile on User {
          id
          name
          profile {
            ...ProfileInfo
          }
        }
        
        query GetUser {
          user {
            ...UserWithProfile
          }
        }
      `;

      const { proto, root } = compileOperationsToProto(operation, schema);

      expectValidProto(proto);

      // Validate the complete proto structure with inline snapshot
      expect(proto).toMatchInlineSnapshot(`
        "syntax = "proto3";
        package service.v1;

        import "google/protobuf/wrappers.proto";

        service DefaultService {
          rpc GetUser(GetUserRequest) returns (GetUserResponse) {}
        }

        message GetUserRequest {
        }

        message GetUserResponse {
          message User {
            message Profile {
              google.protobuf.StringValue bio = 1;
              google.protobuf.StringValue avatar = 2;
            }
            string id = 1;
            google.protobuf.StringValue name = 2;
            Profile profile = 3;
          }
          User user = 1;
        }
        "
      `);
    });

    test('should handle fragment referencing another fragment', () => {
      const schema = `
        type Query {
          user: User
        }
        
        type User {
          id: ID!
          name: String
          email: String
        }
      `;

      const operation = `
        fragment BasicFields on User {
          id
          name
        }
        
        fragment ExtendedFields on User {
          ...BasicFields
          email
        }
        
        query GetUser {
          user {
            ...ExtendedFields
          }
        }
      `;

      const { proto, root } = compileOperationsToProto(operation, schema);

      expectValidProto(proto);

      // Validate the complete proto structure with inline snapshot
      expect(proto).toMatchInlineSnapshot(`
        "syntax = "proto3";
        package service.v1;

        import "google/protobuf/wrappers.proto";

        service DefaultService {
          rpc GetUser(GetUserRequest) returns (GetUserResponse) {}
        }

        message GetUserRequest {
        }

        message GetUserResponse {
          message User {
            string id = 1;
            google.protobuf.StringValue name = 2;
            google.protobuf.StringValue email = 3;
          }
          User user = 1;
        }
        "
      `);
    });

    test('should handle fragments mixed with regular fields', () => {
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
        fragment UserContact on User {
          email
        }
        
        query GetUser {
          user {
            id
            ...UserContact
            age
          }
        }
      `;

      const { proto, root } = compileOperationsToProto(operation, schema);

      expectValidProto(proto);

      // Validate the complete proto structure with inline snapshot
      expect(proto).toMatchInlineSnapshot(`
        "syntax = "proto3";
        package service.v1;

        import "google/protobuf/wrappers.proto";

        service DefaultService {
          rpc GetUser(GetUserRequest) returns (GetUserResponse) {}
        }

        message GetUserRequest {
        }

        message GetUserResponse {
          message User {
            string id = 1;
            google.protobuf.StringValue email = 2;
            google.protobuf.Int32Value age = 3;
          }
          User user = 1;
        }
        "
      `);
    });

    test('should handle same fragment used multiple times', () => {
      const schema = `
        type Query {
          user: User
          admin: User
        }
        
        type User {
          id: ID!
          name: String
        }
      `;

      const operation = `
        fragment UserFields on User {
          id
          name
        }
        
        query GetUsers {
          user {
            ...UserFields
          }
          admin {
            ...UserFields
          }
        }
      `;

      const { proto, root } = compileOperationsToProto(operation, schema);

      expectValidProto(proto);

      // Validate the complete proto structure with inline snapshot
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
          message User {
            string id = 1;
            google.protobuf.StringValue name = 2;
          }
          message Admin {
            string id = 1;
            google.protobuf.StringValue name = 2;
          }
          User user = 1;
          Admin admin = 2;
        }
        "
      `);
    });

    test('should handle fragments in mutations', () => {
      const schema = `
        type Mutation {
          createUser(name: String!): User
        }
        
        type User {
          id: ID!
          name: String
          createdAt: String
        }
      `;

      const operation = `
        fragment NewUserFields on User {
          id
          name
          createdAt
        }
        
        mutation CreateUser($name: String!) {
          createUser(name: $name) {
            ...NewUserFields
          }
        }
      `;

      const { proto, root } = compileOperationsToProto(operation, schema);

      expectValidProto(proto);

      // Validate the complete proto structure with inline snapshot
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
            google.protobuf.StringValue created_at = 3;
          }
          CreateUser create_user = 1;
        }
        "
      `);
    });
  });

  describe('Inline Fragments', () => {
    test('should handle inline fragment on concrete type', () => {
      const schema = `
        type Query {
          user: User
        }
        
        type User {
          id: ID!
          name: String
          email: String
        }
      `;

      const operation = `
        query GetUser {
          user {
            id
            ... on User {
              name
              email
            }
          }
        }
      `;

      const { proto, root } = compileOperationsToProto(operation, schema);

      expectValidProto(proto);

      // Validate the complete proto structure with inline snapshot
      expect(proto).toMatchInlineSnapshot(`
        "syntax = "proto3";
        package service.v1;

        import "google/protobuf/wrappers.proto";

        service DefaultService {
          rpc GetUser(GetUserRequest) returns (GetUserResponse) {}
        }

        message GetUserRequest {
        }

        message GetUserResponse {
          message User {
            string id = 1;
            google.protobuf.StringValue name = 2;
            google.protobuf.StringValue email = 3;
          }
          User user = 1;
        }
        "
      `);
    });

    test('should handle inline fragment on interface', () => {
      const schema = `
        type Query {
          node(id: ID!): Node
        }
        
        interface Node {
          id: ID!
        }
        
        type User implements Node {
          id: ID!
          name: String
          email: String
        }
        
        type Post implements Node {
          id: ID!
          title: String
          content: String
        }
      `;

      const operation = `
        query GetNode($id: ID!) {
          node(id: $id) {
            id
            ... on User {
              name
              email
            }
            ... on Post {
              title
              content
            }
          }
        }
      `;

      const { proto, root } = compileOperationsToProto(operation, schema);

      expectValidProto(proto);

      // Validate the complete proto structure with inline snapshot
      expect(proto).toMatchInlineSnapshot(`
        "syntax = "proto3";
        package service.v1;

        import "google/protobuf/wrappers.proto";

        service DefaultService {
          rpc GetNode(GetNodeRequest) returns (GetNodeResponse) {}
        }

        message GetNodeRequest {
          string id = 1;
        }

        message GetNodeResponse {
          message Node {
            string id = 1;
            google.protobuf.StringValue name = 2;
            google.protobuf.StringValue email = 3;
            google.protobuf.StringValue title = 4;
            google.protobuf.StringValue content = 5;
          }
          Node node = 1;
        }
        "
      `);
    });

    test('should handle inline fragment on union', () => {
      const schema = `
        type Query {
          search(query: String!): [SearchResult]
        }
        
        union SearchResult = User | Post
        
        type User {
          id: ID!
          name: String
        }
        
        type Post {
          id: ID!
          title: String
        }
      `;

      const operation = `
        query Search($query: String!) {
          search(query: $query) {
            ... on User {
              id
              name
            }
            ... on Post {
              id
              title
            }
          }
        }
      `;

      const { proto, root } = compileOperationsToProto(operation, schema);

      expectValidProto(proto);

      // Validate the complete proto structure with inline snapshot
      expect(proto).toMatchInlineSnapshot(`
        "syntax = "proto3";
        package service.v1;

        import "google/protobuf/wrappers.proto";

        service DefaultService {
          rpc Search(SearchRequest) returns (SearchResponse) {}
        }

        message SearchRequest {
          string query = 1;
        }

        message SearchResponse {
          message Search {
            string id = 1;
            google.protobuf.StringValue name = 2;
            google.protobuf.StringValue title = 3;
          }
          repeated Search search = 1;
        }
        "
      `);
    });

    test('should handle nested inline fragments', () => {
      const schema = `
        type Query {
          node(id: ID!): Node
        }
        
        interface Node {
          id: ID!
        }
        
        type User implements Node {
          id: ID!
          name: String
          profile: Profile
        }
        
        type Profile {
          bio: String
          settings: Settings
        }
        
        type Settings {
          theme: String
        }
      `;

      const operation = `
        query GetNode($id: ID!) {
          node(id: $id) {
            id
            ... on User {
              name
              profile {
                bio
                ... on Profile {
                  settings {
                    theme
                  }
                }
              }
            }
          }
        }
      `;

      const { proto, root } = compileOperationsToProto(operation, schema);

      expectValidProto(proto);

      // Validate the complete proto structure with inline snapshot
      expect(proto).toMatchInlineSnapshot(`
        "syntax = "proto3";
        package service.v1;

        import "google/protobuf/wrappers.proto";

        service DefaultService {
          rpc GetNode(GetNodeRequest) returns (GetNodeResponse) {}
        }

        message GetNodeRequest {
          string id = 1;
        }

        message GetNodeResponse {
          message Node {
            message Profile {
              message Settings {
                google.protobuf.StringValue theme = 1;
              }
              google.protobuf.StringValue bio = 1;
              Settings settings = 2;
            }
            string id = 1;
            google.protobuf.StringValue name = 2;
            Profile profile = 3;
          }
          Node node = 1;
        }
        "
      `);
    });

    test('should handle inline fragment without type condition', () => {
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
            ... {
              name
            }
          }
        }
      `;

      const { proto, root } = compileOperationsToProto(operation, schema);

      expectValidProto(proto);

      // Validate the complete proto structure with inline snapshot
      expect(proto).toMatchInlineSnapshot(`
        "syntax = "proto3";
        package service.v1;

        import "google/protobuf/wrappers.proto";

        service DefaultService {
          rpc GetUser(GetUserRequest) returns (GetUserResponse) {}
        }

        message GetUserRequest {
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
  });

  describe('Mixed Fragment Types', () => {
    test('should handle both named and inline fragments together', () => {
      const schema = `
        type Query {
          node(id: ID!): Node
        }
        
        interface Node {
          id: ID!
        }
        
        type User implements Node {
          id: ID!
          name: String
          email: String
          age: Int
        }
        
        type Post implements Node {
          id: ID!
          title: String
          author: User
        }
      `;

      const operation = `
        fragment UserBasics on User {
          name
          email
        }
        
        query GetNode($id: ID!) {
          node(id: $id) {
            id
            ... on User {
              ...UserBasics
              age
            }
            ... on Post {
              title
              author {
                ...UserBasics
              }
            }
          }
        }
      `;

      const { proto, root } = compileOperationsToProto(operation, schema);

      expectValidProto(proto);

      // Validate the complete proto structure with inline snapshot
      expect(proto).toMatchInlineSnapshot(`
        "syntax = "proto3";
        package service.v1;

        import "google/protobuf/wrappers.proto";

        service DefaultService {
          rpc GetNode(GetNodeRequest) returns (GetNodeResponse) {}
        }

        message GetNodeRequest {
          string id = 1;
        }

        message GetNodeResponse {
          message Node {
            message Author {
              google.protobuf.StringValue name = 1;
              google.protobuf.StringValue email = 2;
            }
            string id = 1;
            google.protobuf.StringValue name = 2;
            google.protobuf.StringValue email = 3;
            google.protobuf.Int32Value age = 4;
            google.protobuf.StringValue title = 5;
            Author author = 6;
          }
          Node node = 1;
        }
        "
      `);
    });

    test('should handle fragment spread inside inline fragment', () => {
      const schema = `
        type Query {
          node(id: ID!): Node
        }
        
        interface Node {
          id: ID!
        }
        
        type User implements Node {
          id: ID!
          name: String
          email: String
        }
      `;

      const operation = `
        fragment UserDetails on User {
          name
          email
        }
        
        query GetNode($id: ID!) {
          node(id: $id) {
            id
            ... on User {
              ...UserDetails
            }
          }
        }
      `;

      const { proto, root } = compileOperationsToProto(operation, schema);

      expectValidProto(proto);

      // Validate the complete proto structure with inline snapshot
      expect(proto).toMatchInlineSnapshot(`
        "syntax = "proto3";
        package service.v1;

        import "google/protobuf/wrappers.proto";

        service DefaultService {
          rpc GetNode(GetNodeRequest) returns (GetNodeResponse) {}
        }

        message GetNodeRequest {
          string id = 1;
        }

        message GetNodeResponse {
          message Node {
            string id = 1;
            google.protobuf.StringValue name = 2;
            google.protobuf.StringValue email = 3;
          }
          Node node = 1;
        }
        "
      `);
    });

    test('should handle inline fragment inside named fragment', () => {
      const schema = `
        type Query {
          user: User
        }
        
        type User {
          id: ID!
          name: String
          account: Account
        }
        
        union Account = FreeAccount | PremiumAccount
        
        type FreeAccount {
          plan: String
        }
        
        type PremiumAccount {
          plan: String
          features: [String]
        }
      `;

      const operation = `
        fragment UserWithAccount on User {
          id
          name
          account {
            ... on FreeAccount {
              plan
            }
            ... on PremiumAccount {
              plan
              features
            }
          }
        }
        
        query GetUser {
          user {
            ...UserWithAccount
          }
        }
      `;

      const { proto, root } = compileOperationsToProto(operation, schema);

      expectValidProto(proto);

      // Validate the complete proto structure with inline snapshot
      expect(proto).toMatchInlineSnapshot(`
        "syntax = "proto3";
        package service.v1;

        import "google/protobuf/wrappers.proto";

        service DefaultService {
          rpc GetUser(GetUserRequest) returns (GetUserResponse) {}
        }

        message GetUserRequest {
        }

        message GetUserResponse {
          message User {
            message Account {
              google.protobuf.StringValue plan = 1;
              repeated google.protobuf.StringValue features = 2;
            }
            string id = 1;
            google.protobuf.StringValue name = 2;
            Account account = 3;
          }
          User user = 1;
        }
        "
      `);
    });

    test('should handle complex nested fragment composition', () => {
      const schema = `
        type Query {
          user: User
        }
        
        type User {
          id: ID!
          name: String
          posts: [Post]
        }
        
        type Post {
          id: ID!
          title: String
          comments: [Comment]
        }
        
        type Comment {
          id: ID!
          text: String
          author: User
        }
      `;

      const operation = `
        fragment AuthorInfo on User {
          id
          name
        }
        
        fragment CommentInfo on Comment {
          id
          text
          author {
            ...AuthorInfo
          }
        }
        
        fragment PostInfo on Post {
          id
          title
          comments {
            ...CommentInfo
          }
        }
        
        query GetUser {
          user {
            ...AuthorInfo
            posts {
              ...PostInfo
            }
          }
        }
      `;

      const { proto, root } = compileOperationsToProto(operation, schema);

      expectValidProto(proto);

      // Validate the complete proto structure with inline snapshot
      expect(proto).toMatchInlineSnapshot(`
        "syntax = "proto3";
        package service.v1;

        import "google/protobuf/wrappers.proto";

        service DefaultService {
          rpc GetUser(GetUserRequest) returns (GetUserResponse) {}
        }

        message GetUserRequest {
        }

        message GetUserResponse {
          message User {
            message Posts {
              message Comments {
                message Author {
                  string id = 1;
                  google.protobuf.StringValue name = 2;
                }
                string id = 1;
                google.protobuf.StringValue text = 2;
                Author author = 3;
              }
              string id = 1;
              google.protobuf.StringValue title = 2;
              repeated Comments comments = 3;
            }
            string id = 1;
            google.protobuf.StringValue name = 2;
            repeated Posts posts = 3;
          }
          User user = 1;
        }
        "
      `);
    });
  });

  describe('Edge Cases', () => {
    test('should handle duplicate fields from fragments gracefully', () => {
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
        fragment UserIdField on User {
          id
        }
        
        fragment UserNameField on User {
          id
          name
        }
        
        query GetUser {
          user {
            id
            ...UserIdField
            ...UserNameField
          }
        }
      `;

      const { proto, root } = compileOperationsToProto(operation, schema);

      expectValidProto(proto);

      // Validate the complete proto structure with inline snapshot
      expect(proto).toMatchInlineSnapshot(`
        "syntax = "proto3";
        package service.v1;

        import "google/protobuf/wrappers.proto";

        service DefaultService {
          rpc GetUser(GetUserRequest) returns (GetUserResponse) {}
        }

        message GetUserRequest {
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

    test('should handle __typename field in fragments', () => {
      const schema = `
        type Query {
          user: User
        }
        
        type User {
          id: ID!
          name: String
          email: String
        }
      `;

      const operation = `
        fragment UserFields on User {
          __typename
          id
          name
          email
        }
        
        query GetUser {
          user {
            ...UserFields
          }
        }
      `;

      const { proto, root } = compileOperationsToProto(operation, schema);

      expectValidProto(proto);

      // Validate the complete proto structure with inline snapshot
      expect(proto).toMatchInlineSnapshot(`
        "syntax = "proto3";
        package service.v1;

        import "google/protobuf/wrappers.proto";

        service DefaultService {
          rpc GetUser(GetUserRequest) returns (GetUserResponse) {}
        }

        message GetUserRequest {
        }

        message GetUserResponse {
          message User {
            string id = 2;
            google.protobuf.StringValue name = 3;
            google.protobuf.StringValue email = 4;
          }
          User user = 1;
        }
        "
      `);
    });

    test('should handle fragments with aliases', () => {
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
        fragment UserFields on User {
          userId: id
          userName: name
        }
        
        query GetUser {
          user {
            ...UserFields
          }
        }
      `;

      const { proto, root } = compileOperationsToProto(operation, schema);

      expectValidProto(proto);

      // Validate the complete proto structure with inline snapshot
      expect(proto).toMatchInlineSnapshot(`
        "syntax = "proto3";
        package service.v1;

        import "google/protobuf/wrappers.proto";

        service DefaultService {
          rpc GetUser(GetUserRequest) returns (GetUserResponse) {}
        }

        message GetUserRequest {
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
  });
});
