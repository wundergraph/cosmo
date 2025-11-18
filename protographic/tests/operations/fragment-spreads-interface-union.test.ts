import { describe, expect, test } from 'vitest';
import { compileOperationsToProto } from '../../src/operation-to-proto.js';
import { expectValidProto } from '../util.js';

describe('Fragment Spreads on Interfaces and Unions', () => {
  describe('Fragment Spreads on Interfaces', () => {
    test('should handle fragment spread defined on interface type', () => {
      const schema = `
        type Query {
          employees: [Employee]
        }
        
        interface Employee {
          id: ID!
          name: String
          details: EmployeeDetails
        }
        
        type EmployeeDetails {
          forename: String
          surname: String
          pets: [Animal]
        }
        
        interface Animal {
          class: String
          gender: String
        }
        
        type Dog implements Animal {
          class: String
          gender: String
          breed: String
        }
        
        type Cat implements Animal {
          class: String
          gender: String
          indoor: Boolean
        }
        
        type FullTimeEmployee implements Employee {
          id: ID!
          name: String
          details: EmployeeDetails
          salary: Int
        }
        
        type PartTimeEmployee implements Employee {
          id: ID!
          name: String
          details: EmployeeDetails
          hourlyRate: Float
        }
      `;

      const operation = `
        fragment AnimalFields on Animal {
          class
          gender
        }
        
        query GetEmployees {
          employees {
            details {
              forename
              surname
              pets {
                ...AnimalFields
              }
            }
          }
        }
      `;

      const { proto } = compileOperationsToProto(operation, schema);

      expectValidProto(proto);

      expect(proto).toMatchInlineSnapshot(`
        "syntax = "proto3";
        package service.v1;

        import "google/protobuf/wrappers.proto";

        service DefaultService {
          rpc GetEmployees(GetEmployeesRequest) returns (GetEmployeesResponse) {}
        }

        message GetEmployeesRequest {
        }

        message GetEmployeesResponse {
          message Employees {
            message Details {
              message Pets {
                google.protobuf.StringValue class = 1;
                google.protobuf.StringValue gender = 2;
              }
              google.protobuf.StringValue forename = 1;
              google.protobuf.StringValue surname = 2;
              repeated Pets pets = 3;
            }
            Details details = 1;
          }
          repeated Employees employees = 1;
        }
        "
      `);
    });

    test('should handle fragment spread on interface with inline fragments', () => {
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
        fragment NodeFields on Node {
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
        
        query GetNode($id: ID!) {
          node(id: $id) {
            ...NodeFields
          }
        }
      `;

      const { proto } = compileOperationsToProto(operation, schema);

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

    test('should handle nested fragment spreads on interfaces', () => {
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
          relatedNode: Node
        }
        
        type Post implements Node {
          id: ID!
          title: String
          relatedNode: Node
        }
      `;

      const operation = `
        fragment NodeBasics on Node {
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
            ...NodeBasics
            relatedNode {
              ...NodeBasics
            }
          }
        }
      `;

      const { proto } = compileOperationsToProto(operation, schema);

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
            google.protobuf.StringValue title = 3;
            RelatedNode related_node = 4;
          }
          Node node = 1;
        }
        "
      `);
    });

    test('should handle fragment spread on interface with only interface fields', () => {
      const schema = `
        type Query {
          searchable(query: String!): Searchable
        }
        
        interface Searchable {
          id: ID!
          searchScore: Float
        }
        
        type Article implements Searchable {
          id: ID!
          searchScore: Float
          title: String
          content: String
        }
        
        type Video implements Searchable {
          id: ID!
          searchScore: Float
          title: String
          duration: Int
        }
      `;

      const operation = `
        fragment SearchableFields on Searchable {
          id
          searchScore
        }
        
        query Search($query: String!) {
          searchable(query: $query) {
            ...SearchableFields
          }
        }
      `;

      const { proto } = compileOperationsToProto(operation, schema);

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
          message Searchable {
            string id = 1;
            google.protobuf.DoubleValue search_score = 2;
          }
          Searchable searchable = 1;
        }
        "
      `);
    });
  });

  describe('Fragment Spreads on Unions', () => {
    test('should handle fragment spread defined on union type', () => {
      const schema = `
        type Query {
          search(query: String!): [SearchResult]
        }
        
        union SearchResult = User | Post | Comment
        
        type User {
          id: ID!
          name: String
          email: String
        }
        
        type Post {
          id: ID!
          title: String
          content: String
        }
        
        type Comment {
          id: ID!
          text: String
          author: String
        }
      `;

      const operation = `
        fragment SearchResultFields on SearchResult {
          ... on User {
            id
            name
            email
          }
          ... on Post {
            id
            title
            content
          }
          ... on Comment {
            id
            text
            author
          }
        }
        
        query Search($query: String!) {
          search(query: $query) {
            ...SearchResultFields
          }
        }
      `;

      const { proto } = compileOperationsToProto(operation, schema);

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
            string id = 1;
            google.protobuf.StringValue name = 2;
            google.protobuf.StringValue email = 3;
            google.protobuf.StringValue title = 4;
            google.protobuf.StringValue content = 5;
            google.protobuf.StringValue text = 6;
            google.protobuf.StringValue author = 7;
          }
          repeated Search search = 1;
        }
        "
      `);
    });

    test('should handle nested fragment spreads on unions', () => {
      const schema = `
        type Query {
          feed: [FeedItem]
        }
        
        union FeedItem = Post | Event
        
        type Post {
          id: ID!
          title: String
          relatedContent: FeedItem
        }
        
        type Event {
          id: ID!
          name: String
          relatedContent: FeedItem
        }
      `;

      const operation = `
        fragment FeedItemFields on FeedItem {
          ... on Post {
            id
            title
          }
          ... on Event {
            id
            name
          }
        }
        
        query GetFeed {
          feed {
            ...FeedItemFields
            ... on Post {
              relatedContent {
                ...FeedItemFields
              }
            }
            ... on Event {
              relatedContent {
                ...FeedItemFields
              }
            }
          }
        }
      `;

      const { proto } = compileOperationsToProto(operation, schema);

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
            message RelatedContent {
              string id = 1;
              google.protobuf.StringValue title = 2;
              google.protobuf.StringValue name = 3;
            }
            string id = 1;
            google.protobuf.StringValue title = 2;
            google.protobuf.StringValue name = 3;
            RelatedContent related_content = 4;
          }
          repeated Feed feed = 1;
        }
        "
      `);
    });

    test('should handle fragment spread on union with partial type coverage', () => {
      const schema = `
        type Query {
          content: Content
        }
        
        union Content = Article | Video | Image
        
        type Article {
          id: ID!
          title: String
          text: String
        }
        
        type Video {
          id: ID!
          title: String
          url: String
        }
        
        type Image {
          id: ID!
          url: String
          caption: String
        }
      `;

      const operation = `
        fragment MediaContent on Content {
          ... on Video {
            id
            title
            url
          }
          ... on Image {
            id
            url
            caption
          }
        }
        
        query GetContent {
          content {
            ...MediaContent
          }
        }
      `;

      const { proto } = compileOperationsToProto(operation, schema);

      expectValidProto(proto);

      expect(proto).toMatchInlineSnapshot(`
        "syntax = "proto3";
        package service.v1;

        import "google/protobuf/wrappers.proto";

        service DefaultService {
          rpc GetContent(GetContentRequest) returns (GetContentResponse) {}
        }

        message GetContentRequest {
        }

        message GetContentResponse {
          message Content {
            string id = 1;
            google.protobuf.StringValue title = 2;
            google.protobuf.StringValue url = 3;
            google.protobuf.StringValue caption = 4;
          }
          Content content = 1;
        }
        "
      `);
    });
  });

  describe('Mixed Interface and Union Fragment Spreads', () => {
    test('should handle fragment spread on interface containing union field', () => {
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
        fragment ContentFields on Content {
          ... on TextContent {
            text
            wordCount
          }
          ... on MediaContent {
            url
            mediaType
          }
        }
        
        fragment NodeWithContent on Node {
          id
          content {
            ...ContentFields
          }
        }
        
        query GetNode($id: ID!) {
          node(id: $id) {
            ...NodeWithContent
            ... on Article {
              title
            }
            ... on Page {
              slug
            }
          }
        }
      `;

      const { proto } = compileOperationsToProto(operation, schema);

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
            Content content = 2;
            google.protobuf.StringValue title = 3;
            google.protobuf.StringValue slug = 4;
          }
          Node node = 1;
        }
        "
      `);
    });

    test('should handle fragment spread on union containing interface field', () => {
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
        fragment NodeFields on Node {
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
        
        fragment FeedItemFields on FeedItem {
          ... on Post {
            id
            title
            author {
              ...NodeFields
            }
          }
          ... on Event {
            id
            name
            organizer {
              ...NodeFields
            }
          }
        }
        
        query GetFeed {
          feed {
            ...FeedItemFields
          }
        }
      `;

      const { proto } = compileOperationsToProto(operation, schema);

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
              google.protobuf.StringValue email = 3;
              google.protobuf.StringValue website = 4;
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

    test('should handle complex nested fragment spreads with interfaces and unions', () => {
      const schema = `
        type Query {
          timeline: [TimelineItem]
        }
        
        union TimelineItem = Post | Comment | Share
        
        interface Node {
          id: ID!
          author: Author
        }
        
        union Author = User | Bot
        
        type User {
          id: ID!
          name: String
          verified: Boolean
        }
        
        type Bot {
          id: ID!
          name: String
          botType: String
        }
        
        type Post implements Node {
          id: ID!
          author: Author
          content: String
        }
        
        type Comment implements Node {
          id: ID!
          author: Author
          text: String
        }
        
        type Share implements Node {
          id: ID!
          author: Author
          originalPost: Post
        }
      `;

      const operation = `
        fragment AuthorFields on Author {
          ... on User {
            id
            name
            verified
          }
          ... on Bot {
            id
            name
            botType
          }
        }
        
        fragment NodeFields on Node {
          id
          author {
            ...AuthorFields
          }
        }
        
        fragment TimelineItemFields on TimelineItem {
          ... on Post {
            ...NodeFields
            content
          }
          ... on Comment {
            ...NodeFields
            text
          }
          ... on Share {
            ...NodeFields
            originalPost {
              ...NodeFields
              content
            }
          }
        }
        
        query GetTimeline {
          timeline {
            ...TimelineItemFields
          }
        }
      `;

      const { proto } = compileOperationsToProto(operation, schema);

      expectValidProto(proto);

      expect(proto).toMatchInlineSnapshot(`
        "syntax = "proto3";
        package service.v1;

        import "google/protobuf/wrappers.proto";

        service DefaultService {
          rpc GetTimeline(GetTimelineRequest) returns (GetTimelineResponse) {}
        }

        message GetTimelineRequest {
        }

        message GetTimelineResponse {
          message Timeline {
            message Author {
              string id = 1;
              google.protobuf.StringValue name = 2;
              google.protobuf.BoolValue verified = 3;
              google.protobuf.StringValue bot_type = 4;
            }
            message OriginalPost {
              message Author {
                string id = 1;
                google.protobuf.StringValue name = 2;
                google.protobuf.BoolValue verified = 3;
                google.protobuf.StringValue bot_type = 4;
              }
              string id = 1;
              Author author = 2;
              google.protobuf.StringValue content = 3;
            }
            string id = 1;
            Author author = 2;
            google.protobuf.StringValue content = 3;
            google.protobuf.StringValue text = 4;
            OriginalPost original_post = 5;
          }
          repeated Timeline timeline = 1;
        }
        "
      `);
    });
  });
});
