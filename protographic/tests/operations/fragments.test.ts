import { describe, expect, test } from 'vitest';
import { compileOperationsToProto } from '../../src';
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

  describe('Nested Interface and Union Field Resolvers', () => {
    test('should handle interface field returning another interface', () => {
      const schema = `
        type Query {
          node(id: ID!): Node
        }
        
        interface Node {
          id: ID!
          relatedNode: Node
        }
        
        type User implements Node {
          id: ID!
          name: String
          email: String
          relatedNode: Node
        }
        
        type Post implements Node {
          id: ID!
          title: String
          content: String
          relatedNode: Node
        }
      `;

      const operation = `
        query GetNode($id: ID!) {
          node(id: $id) {
            id
            ... on User {
              name
              email
              relatedNode {
                id
                ... on User {
                  name
                }
                ... on Post {
                  title
                }
              }
            }
            ... on Post {
              title
              content
              relatedNode {
                id
                ... on User {
                  email
                }
                ... on Post {
                  content
                }
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
          rpc GetNode(GetNodeRequest) returns (GetNodeResponse) {}
        }

        message GetNodeRequest {
          string id = 1;
        }

        message GetNodeResponse {
          message Node {
            message RelatedNode {
              string id = 1;
              google.protobuf.StringValue name = 2;
              google.protobuf.StringValue title = 3;
            }
            string id = 1;
            google.protobuf.StringValue name = 2;
            google.protobuf.StringValue email = 3;
            RelatedNode related_node = 4;
            google.protobuf.StringValue title = 5;
            google.protobuf.StringValue content = 6;
          }
          Node node = 1;
        }
        "
      `);
    });

    test('should handle union field returning another union', () => {
      const schema = `
        type Query {
          search(query: String!): SearchResult
        }
        
        union SearchResult = User | Post | Comment
        
        type User {
          id: ID!
          name: String
          relatedContent: SearchResult
        }
        
        type Post {
          id: ID!
          title: String
          relatedContent: SearchResult
        }
        
        type Comment {
          id: ID!
          text: String
          relatedContent: SearchResult
        }
      `;

      const operation = `
        query Search($query: String!) {
          search(query: $query) {
            ... on User {
              id
              name
              relatedContent {
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
            ... on Post {
              id
              title
              relatedContent {
                ... on Comment {
                  id
                  text
                }
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
          rpc Search(SearchRequest) returns (SearchResponse) {}
        }

        message SearchRequest {
          string query = 1;
        }

        message SearchResponse {
          message Search {
            message RelatedContent {
              string id = 1;
              google.protobuf.StringValue name = 2;
              google.protobuf.StringValue title = 3;
            }
            string id = 1;
            google.protobuf.StringValue name = 2;
            RelatedContent related_content = 3;
            google.protobuf.StringValue title = 4;
          }
          Search search = 1;
        }
        "
      `);
    });

    test('should handle interface containing union field', () => {
      const schema = `
        type Query {
          node(id: ID!): Node
        }
        
        interface Node {
          id: ID!
          content: Content
        }
        
        union Content = TextContent | MediaContent
        
        type TextContent {
          text: String
          wordCount: Int
        }
        
        type MediaContent {
          url: String
          mediaType: String
        }
        
        type Article implements Node {
          id: ID!
          title: String
          content: Content
        }
        
        type Page implements Node {
          id: ID!
          slug: String
          content: Content
        }
      `;

      const operation = `
        query GetNode($id: ID!) {
          node(id: $id) {
            id
            ... on Article {
              title
              content {
                ... on TextContent {
                  text
                  wordCount
                }
                ... on MediaContent {
                  url
                  mediaType
                }
              }
            }
            ... on Page {
              slug
              content {
                ... on TextContent {
                  text
                }
                ... on MediaContent {
                  url
                }
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
          rpc GetNode(GetNodeRequest) returns (GetNodeResponse) {}
        }

        message GetNodeRequest {
          string id = 1;
        }

        message GetNodeResponse {
          message Node {
            message Content {
              google.protobuf.StringValue text = 1;
              google.protobuf.Int32Value word_count = 2;
              google.protobuf.StringValue url = 3;
              google.protobuf.StringValue media_type = 4;
            }
            string id = 1;
            google.protobuf.StringValue title = 2;
            Content content = 3;
            google.protobuf.StringValue slug = 4;
          }
          Node node = 1;
        }
        "
      `);
    });

    test('should handle union containing interface field', () => {
      const schema = `
        type Query {
          feed: [FeedItem]
        }
        
        union FeedItem = Post | Event
        
        interface Node {
          id: ID!
        }
        
        type Post {
          id: ID!
          title: String
          author: Node
        }
        
        type Event {
          id: ID!
          name: String
          organizer: Node
        }
        
        type User implements Node {
          id: ID!
          name: String
          email: String
        }
        
        type Organization implements Node {
          id: ID!
          name: String
          website: String
        }
      `;

      const operation = `
        query GetFeed {
          feed {
            ... on Post {
              id
              title
              author {
                id
                ... on User {
                  name
                  email
                }
                ... on Organization {
                  name
                  website
                }
              }
            }
            ... on Event {
              id
              name
              organizer {
                id
                ... on User {
                  name
                }
                ... on Organization {
                  name
                  website
                }
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
          rpc GetFeed(GetFeedRequest) returns (GetFeedResponse) {}
        }

        message GetFeedRequest {
        }

        message GetFeedResponse {
          message Feed {
            message Author {
              string id = 1;
              google.protobuf.StringValue name = 2;
              google.protobuf.StringValue email = 3;
              google.protobuf.StringValue website = 4;
            }
            message Organizer {
              string id = 1;
              google.protobuf.StringValue name = 2;
              google.protobuf.StringValue website = 3;
            }
            string id = 1;
            google.protobuf.StringValue title = 2;
            Author author = 3;
            google.protobuf.StringValue name = 4;
            Organizer organizer = 5;
          }
          repeated Feed feed = 1;
        }
        "
      `);
    });

    test('should handle deeply nested interface chains', () => {
      const schema = `
        type Query {
          root: Node
        }
        
        interface Node {
          id: ID!
          child: Node
        }
        
        type Level1 implements Node {
          id: ID!
          level: Int
          child: Node
        }
        
        type Level2 implements Node {
          id: ID!
          name: String
          child: Node
        }
        
        type Level3 implements Node {
          id: ID!
          value: String
          child: Node
        }
      `;

      const operation = `
        query GetRoot {
          root {
            id
            ... on Level1 {
              level
              child {
                id
                ... on Level2 {
                  name
                  child {
                    id
                    ... on Level3 {
                      value
                    }
                  }
                }
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
          rpc GetRoot(GetRootRequest) returns (GetRootResponse) {}
        }

        message GetRootRequest {
        }

        message GetRootResponse {
          message Root {
            message Child {
              message Child {
                string id = 1;
                google.protobuf.StringValue value = 4;
              }
              string id = 1;
              google.protobuf.StringValue name = 2;
              Child child = 3;
            }
            string id = 1;
            google.protobuf.Int32Value level = 2;
            Child child = 3;
          }
          Root root = 1;
        }
        "
      `);
    });

    test('should handle named fragments on nested interfaces', () => {
      const schema = `
        type Query {
          node(id: ID!): Node
        }
        
        interface Node {
          id: ID!
          related: Node
        }
        
        type User implements Node {
          id: ID!
          name: String
          related: Node
        }
        
        type Post implements Node {
          id: ID!
          title: String
          related: Node
        }
      `;

      const operation = `
        fragment NodeFields on Node {
          id
          ... on User {
            name
          }
          ... on Post {
            title
          }
        }
        
        query GetNode($id: ID!) {
          node(id: $id) {
            ...NodeFields
            related {
              ...NodeFields
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
          rpc GetNode(GetNodeRequest) returns (GetNodeResponse) {}
        }

        message GetNodeRequest {
          string id = 1;
        }

        message GetNodeResponse {
          message Node {
            message Related {
              string id = 1;
              google.protobuf.StringValue name = 2;
              google.protobuf.StringValue title = 3;
            }
            string id = 1;
            google.protobuf.StringValue name = 2;
            google.protobuf.StringValue title = 3;
            Related related = 4;
          }
          Node node = 1;
        }
        "
      `);
    });

    test('should handle named fragments on nested unions', () => {
      const schema = `
        type Query {
          search(query: String!): SearchResult
        }
        
        union SearchResult = User | Post
        
        type User {
          id: ID!
          name: String
          bestMatch: SearchResult
        }
        
        type Post {
          id: ID!
          title: String
          relatedPost: SearchResult
        }
      `;

      const operation = `
        fragment SearchFields on SearchResult {
          ... on User {
            id
            name
          }
          ... on Post {
            id
            title
          }
        }
        
        query Search($query: String!) {
          search(query: $query) {
            ...SearchFields
            ... on User {
              bestMatch {
                ...SearchFields
              }
            }
            ... on Post {
              relatedPost {
                ...SearchFields
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
          rpc Search(SearchRequest) returns (SearchResponse) {}
        }

        message SearchRequest {
          string query = 1;
        }

        message SearchResponse {
          message Search {
            message BestMatch {
              string id = 1;
              google.protobuf.StringValue name = 2;
              google.protobuf.StringValue title = 3;
            }
            message RelatedPost {
              string id = 1;
              google.protobuf.StringValue name = 2;
              google.protobuf.StringValue title = 3;
            }
            string id = 1;
            google.protobuf.StringValue name = 2;
            google.protobuf.StringValue title = 3;
            BestMatch best_match = 4;
            RelatedPost related_post = 5;
          }
          Search search = 1;
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
