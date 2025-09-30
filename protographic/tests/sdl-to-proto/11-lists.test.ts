import { describe, expect, it } from 'vitest';
import { compileGraphQLToProto } from '../../src';
import { expectValidProto } from '../util';

describe('SDL to Proto Lists', () => {
  it('should correctly generate protobuf for types with a single non nullable list', () => {
    const sdl = `
        type User {
            id: ID!
            firstName: String!
            middleNames: [String]!
            lastName: String!
            friends: [User!]!
        }
        
        type Query {
            getUser: User!
        }`;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    expectValidProto(protoText);

    expect(protoText).toMatchInlineSnapshot(`
          "syntax = "proto3";
          package service.v1;

          // Service definition for DefaultService
          service DefaultService {
            rpc QueryGetUser(QueryGetUserRequest) returns (QueryGetUserResponse) {}
          }

          // Request message for getUser operation.
          message QueryGetUserRequest {
          }
          // Response message for getUser operation.
          message QueryGetUserResponse {
            User get_user = 1;
          }

          message User {
            string id = 1;
            string first_name = 2;
            repeated string middle_names = 3;
            string last_name = 4;
            repeated User friends = 5;
          }"
        `);
  });

  it('should correctly generate protobuf for types with a single nullable list', () => {
    const sdl = `
        type User {
            id: ID!
            firstName: String!
            middleNames: [String]
            lastName: String!
            friends: [User!]
        }

        type Query {
            getUser: User!
        }`;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    expectValidProto(protoText);

    expect(protoText).toMatchInlineSnapshot(`
          "syntax = "proto3";
          package service.v1;

          // Service definition for DefaultService
          service DefaultService {
            rpc QueryGetUser(QueryGetUserRequest) returns (QueryGetUserResponse) {}
          }

          // Wrapper message for a list of String.
          message ListOfString {
            repeated string items = 1;
          }

          // Wrapper message for a list of User.
          message ListOfUser {
            repeated User items = 1;
          }

          // Request message for getUser operation.
          message QueryGetUserRequest {
          }
          // Response message for getUser operation.
          message QueryGetUserResponse {
            User get_user = 1;
          }

          message User {
            string id = 1;
            string first_name = 2;
            ListOfString middle_names = 3;
            string last_name = 4;
            ListOfUser friends = 5;
          }"
        `);
  });

  it('should correctly generate protobuf for types with a nested non nullable list', () => {
    const sdl = `
        type User {
            middleNames: [[String]!]!
            middleNames2: [[String]]!
            friends: [[User!]!]!
        }

        type Query {
            getUser: User!
        }`;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    expectValidProto(protoText);

    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      // Service definition for DefaultService
      service DefaultService {
        rpc QueryGetUser(QueryGetUserRequest) returns (QueryGetUserResponse) {}
      }

      // Wrapper message for a list of String.
      message ListOfListOfString {
        message List {
          repeated ListOfString items = 1;
        }
        List list = 1;
      }

      // Wrapper message for a list of User.
      message ListOfListOfUser {
        message List {
          repeated ListOfUser items = 1;
        }
        List list = 1;
      }

      // Wrapper message for a list of String.
      message ListOfString {
        repeated string items = 1;
      }

      // Wrapper message for a list of User.
      message ListOfUser {
        repeated User items = 1;
      }

      // Request message for getUser operation.
      message QueryGetUserRequest {
      }
      // Response message for getUser operation.
      message QueryGetUserResponse {
        User get_user = 1;
      }

      message User {
        ListOfListOfString middle_names = 1;
        ListOfListOfString middle_names_2 = 2;
        ListOfListOfUser friends = 3;
      }"
    `);
  });

  it('should correctly generate protobuf for types with a nested nullable list', () => {
    const sdl = `
        type User {
            middleNames: [[String]!]
            middleNames2: [[String]]
            friends: [[User!]!]
        }

        type Query {
            getUser: User!
        }`;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    expectValidProto(protoText);

    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      // Service definition for DefaultService
      service DefaultService {
        rpc QueryGetUser(QueryGetUserRequest) returns (QueryGetUserResponse) {}
      }

      // Wrapper message for a list of String.
      message ListOfListOfString {
        message List {
          repeated ListOfString items = 1;
        }
        List list = 1;
      }

      // Wrapper message for a list of User.
      message ListOfListOfUser {
        message List {
          repeated ListOfUser items = 1;
        }
        List list = 1;
      }

      // Wrapper message for a list of String.
      message ListOfString {
        repeated string items = 1;
      }

      // Wrapper message for a list of User.
      message ListOfUser {
        repeated User items = 1;
      }

      // Request message for getUser operation.
      message QueryGetUserRequest {
      }
      // Response message for getUser operation.
      message QueryGetUserResponse {
        User get_user = 1;
      }

      message User {
        ListOfListOfString middle_names = 1;
        ListOfListOfString middle_names_2 = 2;
        ListOfListOfUser friends = 3;
      }"
    `);
  });

  it('should correctly generate protobuf for types with mixed nullable, non nullable, nested and non nested lists', () => {
    const sdl = `
        type User {
            firstNames: [String]!
            lastNames: [String!]
            middleNames: [[String]!]
            middleNames2: [[String]]
            friends: [[User!]!]
            friends2: [User!]!
        }

        type Query {
            getUser: User!
        }`;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    expectValidProto(protoText);

    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      // Service definition for DefaultService
      service DefaultService {
        rpc QueryGetUser(QueryGetUserRequest) returns (QueryGetUserResponse) {}
      }

      // Wrapper message for a list of String.
      message ListOfListOfString {
        message List {
          repeated ListOfString items = 1;
        }
        List list = 1;
      }

      // Wrapper message for a list of User.
      message ListOfListOfUser {
        message List {
          repeated ListOfUser items = 1;
        }
        List list = 1;
      }

      // Wrapper message for a list of String.
      message ListOfString {
        repeated string items = 1;
      }

      // Wrapper message for a list of User.
      message ListOfUser {
        repeated User items = 1;
      }

      // Request message for getUser operation.
      message QueryGetUserRequest {
      }
      // Response message for getUser operation.
      message QueryGetUserResponse {
        User get_user = 1;
      }

      message User {
        repeated string first_names = 1;
        ListOfString last_names = 2;
        ListOfListOfString middle_names = 3;
        ListOfListOfString middle_names_2 = 4;
        ListOfListOfUser friends = 5;
        repeated User friends_2 = 6;
      }"
    `);
  });

  it('should correctly generate protobuf for lists with enums', () => {
    const sdl = `
        enum Status {
            ACTIVE
            INACTIVE
            PENDING
        }

        type User {
            id: ID!
            statuses: [Status!]!
            previousStatuses: [Status]
            statusHistory: [[Status!]!]!
            statusGroups: [[Status]]
        }

        type Query {
            getUser: User!
        }`;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    expectValidProto(protoText);

    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      // Service definition for DefaultService
      service DefaultService {
        rpc QueryGetUser(QueryGetUserRequest) returns (QueryGetUserResponse) {}
      }

      // Wrapper message for a list of Status.
      message ListOfListOfStatus {
        message List {
          repeated ListOfStatus items = 1;
        }
        List list = 1;
      }

      // Wrapper message for a list of Status.
      message ListOfStatus {
        repeated Status items = 1;
      }

      // Request message for getUser operation.
      message QueryGetUserRequest {
      }
      // Response message for getUser operation.
      message QueryGetUserResponse {
        User get_user = 1;
      }

      message User {
        string id = 1;
        repeated Status statuses = 2;
        ListOfStatus previous_statuses = 3;
        ListOfListOfStatus status_history = 4;
        ListOfListOfStatus status_groups = 5;
      }

      enum Status {
        STATUS_UNSPECIFIED = 0;
        STATUS_ACTIVE = 1;
        STATUS_INACTIVE = 2;
        STATUS_PENDING = 3;
      }"
    `);
  });

  it('should correctly generate protobuf for lists with interfaces', () => {
    const sdl = `
        interface Node {
            id: ID!
        }

        type User implements Node {
            id: ID!
            name: String!
        }

        type Post implements Node {
            id: ID!
            title: String!
        }

        type Timeline {
            items: [Node!]!
            optionalItems: [Node]
            nestedItems: [[Node!]!]!
            optionalNestedItems: [[Node]]
        }

        type Query {
            getTimeline: Timeline!
        }`;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    expectValidProto(protoText);

    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      // Service definition for DefaultService
      service DefaultService {
        rpc QueryGetTimeline(QueryGetTimelineRequest) returns (QueryGetTimelineResponse) {}
      }

      // Wrapper message for a list of Node.
      message ListOfListOfNode {
        message List {
          repeated ListOfNode items = 1;
        }
        List list = 1;
      }

      // Wrapper message for a list of Node.
      message ListOfNode {
        repeated Node items = 1;
      }

      // Request message for getTimeline operation.
      message QueryGetTimelineRequest {
      }
      // Response message for getTimeline operation.
      message QueryGetTimelineResponse {
        Timeline get_timeline = 1;
      }

      message Timeline {
        repeated Node items = 1;
        ListOfNode optional_items = 2;
        ListOfListOfNode nested_items = 3;
        ListOfListOfNode optional_nested_items = 4;
      }

      message Node {
        oneof instance {
        User user = 1;
        Post post = 2;
        }
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

  it('should correctly generate protobuf for lists with unions', () => {
    const sdl = `
        type User {
            id: ID!
            name: String!
        }

        type Post {
            id: ID!
            title: String!
        }

        union SearchResult = User | Post

        type SearchResults {
            results: [SearchResult!]!
            optionalResults: [SearchResult]
            nestedResults: [[SearchResult!]!]!
            optionalNestedResults: [[SearchResult]]
        }

        type Query {
            search: SearchResults!
        }`;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    expectValidProto(protoText);

    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      // Service definition for DefaultService
      service DefaultService {
        rpc QuerySearch(QuerySearchRequest) returns (QuerySearchResponse) {}
      }

      // Wrapper message for a list of SearchResult.
      message ListOfListOfSearchResult {
        message List {
          repeated ListOfSearchResult items = 1;
        }
        List list = 1;
      }

      // Wrapper message for a list of SearchResult.
      message ListOfSearchResult {
        repeated SearchResult items = 1;
      }

      // Request message for search operation.
      message QuerySearchRequest {
      }
      // Response message for search operation.
      message QuerySearchResponse {
        SearchResults search = 1;
      }

      message SearchResults {
        repeated SearchResult results = 1;
        ListOfSearchResult optional_results = 2;
        ListOfListOfSearchResult nested_results = 3;
        ListOfListOfSearchResult optional_nested_results = 4;
      }

      message User {
        string id = 1;
        string name = 2;
      }

      message Post {
        string id = 1;
        string title = 2;
      }

      message SearchResult {
        oneof value {
        User user = 1;
        Post post = 2;
        }
      }"
    `);
  });

  it('should correctly generate protobuf for lists with scalars and custom scalars', () => {
    const sdl = `
        scalar DateTime
        scalar JSON

        type User {
            id: ID!
            tags: [String!]!
            optionalTags: [String]
            scores: [Int!]!
            optionalScores: [Int]
            ratings: [Float!]!
            optionalRatings: [Float]
            timestamps: [DateTime!]!
            optionalTimestamps: [DateTime]
            metadata: [JSON!]!
            optionalMetadata: [JSON]
            nestedTags: [[String!]!]!
            nestedOptionalTags: [[String]]
        }

        type Query {
            getUser: User!
        }`;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    expectValidProto(protoText);

    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      // Service definition for DefaultService
      service DefaultService {
        rpc QueryGetUser(QueryGetUserRequest) returns (QueryGetUserResponse) {}
      }

      // Wrapper message for a list of DateTime.
      message ListOfDateTime {
        repeated string items = 1;
      }

      // Wrapper message for a list of Float.
      message ListOfFloat {
        repeated double items = 1;
      }

      // Wrapper message for a list of Int.
      message ListOfInt {
        repeated int32 items = 1;
      }

      // Wrapper message for a list of JSON.
      message ListOfJSON {
        repeated string items = 1;
      }

      // Wrapper message for a list of String.
      message ListOfListOfString {
        message List {
          repeated ListOfString items = 1;
        }
        List list = 1;
      }

      // Wrapper message for a list of String.
      message ListOfString {
        repeated string items = 1;
      }

      // Request message for getUser operation.
      message QueryGetUserRequest {
      }
      // Response message for getUser operation.
      message QueryGetUserResponse {
        User get_user = 1;
      }

      message User {
        string id = 1;
        repeated string tags = 2;
        ListOfString optional_tags = 3;
        repeated int32 scores = 4;
        ListOfInt optional_scores = 5;
        repeated double ratings = 6;
        ListOfFloat optional_ratings = 7;
        repeated string timestamps = 8;
        ListOfDateTime optional_timestamps = 9;
        repeated string metadata = 10;
        ListOfJSON optional_metadata = 11;
        ListOfListOfString nested_tags = 12;
        ListOfListOfString nested_optional_tags = 13;
      }"
    `);
  });

  it('should correctly generate protobuf for deeply nested lists', () => {
    const sdl = `
        type User {
            id: ID!
            name: String!
        }

        type Matrix {
            level1: [[[String!]!]!]!
            level2: [[[User!]!]!]!
            level3: [[[[String]]]]
            level4: [[[[[User!]!]!]!]!]!
        }

        type Query {
            getMatrix: Matrix!
        }`;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    expectValidProto(protoText);

    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      // Service definition for DefaultService
      service DefaultService {
        rpc QueryGetMatrix(QueryGetMatrixRequest) returns (QueryGetMatrixResponse) {}
      }

      // Wrapper message for a list of User.
      message ListOfListOfListOfListOfListOfUser {
        message List {
          repeated ListOfListOfListOfListOfUser items = 1;
        }
        List list = 1;
      }

      // Wrapper message for a list of String.
      message ListOfListOfListOfListOfString {
        message List {
          repeated ListOfListOfListOfString items = 1;
        }
        List list = 1;
      }

      // Wrapper message for a list of User.
      message ListOfListOfListOfListOfUser {
        message List {
          repeated ListOfListOfListOfUser items = 1;
        }
        List list = 1;
      }

      // Wrapper message for a list of String.
      message ListOfListOfListOfString {
        message List {
          repeated ListOfListOfString items = 1;
        }
        List list = 1;
      }

      // Wrapper message for a list of User.
      message ListOfListOfListOfUser {
        message List {
          repeated ListOfListOfUser items = 1;
        }
        List list = 1;
      }

      // Wrapper message for a list of String.
      message ListOfListOfString {
        message List {
          repeated ListOfString items = 1;
        }
        List list = 1;
      }

      // Wrapper message for a list of User.
      message ListOfListOfUser {
        message List {
          repeated ListOfUser items = 1;
        }
        List list = 1;
      }

      // Wrapper message for a list of String.
      message ListOfString {
        repeated string items = 1;
      }

      // Wrapper message for a list of User.
      message ListOfUser {
        repeated User items = 1;
      }

      // Request message for getMatrix operation.
      message QueryGetMatrixRequest {
      }
      // Response message for getMatrix operation.
      message QueryGetMatrixResponse {
        Matrix get_matrix = 1;
      }

      message Matrix {
        ListOfListOfListOfString level_1 = 1;
        ListOfListOfListOfUser level_2 = 2;
        ListOfListOfListOfListOfString level_3 = 3;
        ListOfListOfListOfListOfListOfUser level_4 = 4;
      }

      message User {
        string id = 1;
        string name = 2;
      }"
    `);
  });

  it('should correctly generate protobuf for lists with input types in mutations', () => {
    const sdl = `
        input CreateUserInput {
            name: String!
            tags: [String!]!
            optionalTags: [String]
        }

        input UpdateUserInput {
            id: ID!
            name: String
            addTags: [String!]
            removeTags: [String]
        }

        type User {
            id: ID!
            name: String!
            tags: [String!]!
        }

        type Mutation {
            createUser(input: CreateUserInput!): User!
            createUsers(inputs: [CreateUserInput!]!): [User!]!
            updateUsers(inputs: [UpdateUserInput!]!): [User!]!
            bulkUpdate(updates: [[UpdateUserInput!]!]!): [User!]!
        }

        type Query {
            getUser: User!
        }`;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    expectValidProto(protoText);

    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      import "google/protobuf/wrappers.proto";

      // Service definition for DefaultService
      service DefaultService {
        rpc MutationBulkUpdate(MutationBulkUpdateRequest) returns (MutationBulkUpdateResponse) {}
        rpc MutationCreateUser(MutationCreateUserRequest) returns (MutationCreateUserResponse) {}
        rpc MutationCreateUsers(MutationCreateUsersRequest) returns (MutationCreateUsersResponse) {}
        rpc MutationUpdateUsers(MutationUpdateUsersRequest) returns (MutationUpdateUsersResponse) {}
        rpc QueryGetUser(QueryGetUserRequest) returns (QueryGetUserResponse) {}
      }

      // Wrapper message for a list of UpdateUserInput.
      message ListOfListOfUpdateUserInput {
        message List {
          repeated ListOfUpdateUserInput items = 1;
        }
        List list = 1;
      }

      // Wrapper message for a list of String.
      message ListOfString {
        repeated string items = 1;
      }

      // Wrapper message for a list of UpdateUserInput.
      message ListOfUpdateUserInput {
        repeated UpdateUserInput items = 1;
      }

      // Request message for getUser operation.
      message QueryGetUserRequest {
      }
      // Response message for getUser operation.
      message QueryGetUserResponse {
        User get_user = 1;
      }
      // Request message for createUser operation.
      message MutationCreateUserRequest {
        CreateUserInput input = 1;
      }
      // Response message for createUser operation.
      message MutationCreateUserResponse {
        User create_user = 1;
      }
      // Request message for createUsers operation.
      message MutationCreateUsersRequest {
        repeated CreateUserInput inputs = 1;
      }
      // Response message for createUsers operation.
      message MutationCreateUsersResponse {
        repeated User create_users = 1;
      }
      // Request message for updateUsers operation.
      message MutationUpdateUsersRequest {
        repeated UpdateUserInput inputs = 1;
      }
      // Response message for updateUsers operation.
      message MutationUpdateUsersResponse {
        repeated User update_users = 1;
      }
      // Request message for bulkUpdate operation.
      message MutationBulkUpdateRequest {
        ListOfListOfUpdateUserInput updates = 1;
      }
      // Response message for bulkUpdate operation.
      message MutationBulkUpdateResponse {
        repeated User bulk_update = 1;
      }

      message User {
        string id = 1;
        string name = 2;
        repeated string tags = 3;
      }

      message CreateUserInput {
        string name = 1;
        repeated string tags = 2;
        ListOfString optional_tags = 3;
      }

      message UpdateUserInput {
        string id = 1;
        google.protobuf.StringValue name = 2;
        ListOfString add_tags = 3;
        ListOfString remove_tags = 4;
      }"
    `);
  });

  it('should correctly generate protobuf for mixed complex lists with all types', () => {
    const sdl = `
        enum Priority {
            LOW
            MEDIUM
            HIGH
        }

        scalar DateTime

        interface Node {
            id: ID!
        }

        type User implements Node {
            id: ID!
            name: String!
        }

        type Task implements Node {
            id: ID!
            title: String!
        }

        union Item = User | Task

        input FilterInput {
            priorities: [Priority!]
            userIds: [ID]
        }

        type ComplexType {
            # Simple lists
            strings: [String!]!
            optionalStrings: [String]
            
            # Enum lists
            priorities: [Priority!]!
            optionalPriorities: [Priority]
            
            # Interface lists
            nodes: [Node!]!
            optionalNodes: [Node]
            
            # Union lists
            items: [Item!]!
            optionalItems: [Item]
            
            # Nested lists
            nestedStrings: [[String!]!]!
            nestedOptionalStrings: [[String]]
            nestedPriorities: [[Priority!]!]!
            nestedOptionalPriorities: [[Priority]]
            
            # Complex nested
            deepNestedItems: [[[Item!]!]!]!
            mixedNested: [[[[Priority]]]]
        }

        type Query {
            getComplex(filter: FilterInput): ComplexType!
        }`;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    expectValidProto(protoText);

    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      // Service definition for DefaultService
      service DefaultService {
        rpc QueryGetComplex(QueryGetComplexRequest) returns (QueryGetComplexResponse) {}
      }

      // Wrapper message for a list of ID.
      message ListOfID {
        repeated string items = 1;
      }

      // Wrapper message for a list of Item.
      message ListOfItem {
        repeated Item items = 1;
      }

      // Wrapper message for a list of Item.
      message ListOfListOfItem {
        message List {
          repeated ListOfItem items = 1;
        }
        List list = 1;
      }

      // Wrapper message for a list of Item.
      message ListOfListOfListOfItem {
        message List {
          repeated ListOfListOfItem items = 1;
        }
        List list = 1;
      }

      // Wrapper message for a list of Priority.
      message ListOfListOfListOfListOfPriority {
        message List {
          repeated ListOfListOfListOfPriority items = 1;
        }
        List list = 1;
      }

      // Wrapper message for a list of Priority.
      message ListOfListOfListOfPriority {
        message List {
          repeated ListOfListOfPriority items = 1;
        }
        List list = 1;
      }

      // Wrapper message for a list of Priority.
      message ListOfListOfPriority {
        message List {
          repeated ListOfPriority items = 1;
        }
        List list = 1;
      }

      // Wrapper message for a list of String.
      message ListOfListOfString {
        message List {
          repeated ListOfString items = 1;
        }
        List list = 1;
      }

      // Wrapper message for a list of Node.
      message ListOfNode {
        repeated Node items = 1;
      }

      // Wrapper message for a list of Priority.
      message ListOfPriority {
        repeated Priority items = 1;
      }

      // Wrapper message for a list of String.
      message ListOfString {
        repeated string items = 1;
      }

      // Request message for getComplex operation.
      message QueryGetComplexRequest {
        FilterInput filter = 1;
      }
      // Response message for getComplex operation.
      message QueryGetComplexResponse {
        ComplexType get_complex = 1;
      }

      message FilterInput {
        ListOfPriority priorities = 1;
        ListOfID user_ids = 2;
      }

      message ComplexType {
        repeated string strings = 1;
        ListOfString optional_strings = 2;
        repeated Priority priorities = 3;
        ListOfPriority optional_priorities = 4;
        repeated Node nodes = 5;
        ListOfNode optional_nodes = 6;
        repeated Item items = 7;
        ListOfItem optional_items = 8;
        ListOfListOfString nested_strings = 9;
        ListOfListOfString nested_optional_strings = 10;
        ListOfListOfPriority nested_priorities = 11;
        ListOfListOfPriority nested_optional_priorities = 12;
        ListOfListOfListOfItem deep_nested_items = 13;
        ListOfListOfListOfListOfPriority mixed_nested = 14;
      }

      enum Priority {
        PRIORITY_UNSPECIFIED = 0;
        PRIORITY_LOW = 1;
        PRIORITY_MEDIUM = 2;
        PRIORITY_HIGH = 3;
      }

      message Node {
        oneof instance {
        User user = 1;
        Task task = 2;
        }
      }

      message User {
        string id = 1;
        string name = 2;
      }

      message Task {
        string id = 1;
        string title = 2;
      }

      message Item {
        oneof value {
        User user = 1;
        Task task = 2;
        }
      }"
    `);
  });

  it('should correctly generate protobuf for edge cases with empty lists and optional nesting', () => {
    const sdl = `
        type User {
            id: ID!
        }

        type EdgeCases {
            # Various nullable combinations
            case1: [String!]
            case2: [String]!
            case3: [String]
            
            # Nested nullable combinations
            case4: [[String!]!]
            case5: [[String!]]!
            case6: [[String!]]
            case7: [[String]!]!
            case8: [[String]!]
            case9: [[String]]!
            case10: [[String]]
            
            # With objects
            users1: [User!]
            users2: [User]!
            users3: [User]
            nestedUsers1: [[User!]!]
            nestedUsers2: [[User!]]
            nestedUsers3: [[User]!]
            nestedUsers4: [[User]]
        }

        type Query {
            getEdgeCases: EdgeCases!
        }`;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    expectValidProto(protoText);

    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      // Service definition for DefaultService
      service DefaultService {
        rpc QueryGetEdgeCases(QueryGetEdgeCasesRequest) returns (QueryGetEdgeCasesResponse) {}
      }

      // Wrapper message for a list of String.
      message ListOfListOfString {
        message List {
          repeated ListOfString items = 1;
        }
        List list = 1;
      }

      // Wrapper message for a list of User.
      message ListOfListOfUser {
        message List {
          repeated ListOfUser items = 1;
        }
        List list = 1;
      }

      // Wrapper message for a list of String.
      message ListOfString {
        repeated string items = 1;
      }

      // Wrapper message for a list of User.
      message ListOfUser {
        repeated User items = 1;
      }

      // Request message for getEdgeCases operation.
      message QueryGetEdgeCasesRequest {
      }
      // Response message for getEdgeCases operation.
      message QueryGetEdgeCasesResponse {
        EdgeCases get_edge_cases = 1;
      }

      message EdgeCases {
        ListOfString case_1 = 1;
        repeated string case_2 = 2;
        ListOfString case_3 = 3;
        ListOfListOfString case_4 = 4;
        ListOfListOfString case_5 = 5;
        ListOfListOfString case_6 = 6;
        ListOfListOfString case_7 = 7;
        ListOfListOfString case_8 = 8;
        ListOfListOfString case_9 = 9;
        ListOfListOfString case_10 = 10;
        ListOfUser users_1 = 11;
        repeated User users_2 = 12;
        ListOfUser users_3 = 13;
        ListOfListOfUser nested_users_1 = 14;
        ListOfListOfUser nested_users_2 = 15;
        ListOfListOfUser nested_users_3 = 16;
        ListOfListOfUser nested_users_4 = 17;
      }

      message User {
        string id = 1;
      }"
    `);
  });

  it('should correctly generate protobuf for recursive types with lists', () => {
    const sdl = `
        type User {
            id: ID!
            name: String!
            friends: [User!]!
            optionalFriends: [User]
            nestedFriendGroups: [[User!]!]!
            optionalNestedFriendGroups: [[User]]
        }

        type Comment {
            id: ID!
            content: String!
            author: User!
            replies: [Comment!]!
            optionalReplies: [Comment]
            nestedReplies: [[Comment!]!]!
        }

        type Category {
            id: ID!
            name: String!
            parent: Category
            children: [Category!]!
            optionalChildren: [Category]
            subCategories: [[Category!]!]!
            relatedCategories: [Category]
        }

        type Query {
            getUser: User!
            getComment: Comment!
            getCategory: Category!
        }`;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    expectValidProto(protoText);

    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      // Service definition for DefaultService
      service DefaultService {
        rpc QueryGetCategory(QueryGetCategoryRequest) returns (QueryGetCategoryResponse) {}
        rpc QueryGetComment(QueryGetCommentRequest) returns (QueryGetCommentResponse) {}
        rpc QueryGetUser(QueryGetUserRequest) returns (QueryGetUserResponse) {}
      }

      // Wrapper message for a list of Category.
      message ListOfCategory {
        repeated Category items = 1;
      }

      // Wrapper message for a list of Comment.
      message ListOfComment {
        repeated Comment items = 1;
      }

      // Wrapper message for a list of Category.
      message ListOfListOfCategory {
        message List {
          repeated ListOfCategory items = 1;
        }
        List list = 1;
      }

      // Wrapper message for a list of Comment.
      message ListOfListOfComment {
        message List {
          repeated ListOfComment items = 1;
        }
        List list = 1;
      }

      // Wrapper message for a list of User.
      message ListOfListOfUser {
        message List {
          repeated ListOfUser items = 1;
        }
        List list = 1;
      }

      // Wrapper message for a list of User.
      message ListOfUser {
        repeated User items = 1;
      }

      // Request message for getUser operation.
      message QueryGetUserRequest {
      }
      // Response message for getUser operation.
      message QueryGetUserResponse {
        User get_user = 1;
      }
      // Request message for getComment operation.
      message QueryGetCommentRequest {
      }
      // Response message for getComment operation.
      message QueryGetCommentResponse {
        Comment get_comment = 1;
      }
      // Request message for getCategory operation.
      message QueryGetCategoryRequest {
      }
      // Response message for getCategory operation.
      message QueryGetCategoryResponse {
        Category get_category = 1;
      }

      message User {
        string id = 1;
        string name = 2;
        repeated User friends = 3;
        ListOfUser optional_friends = 4;
        ListOfListOfUser nested_friend_groups = 5;
        ListOfListOfUser optional_nested_friend_groups = 6;
      }

      message Comment {
        string id = 1;
        string content = 2;
        User author = 3;
        repeated Comment replies = 4;
        ListOfComment optional_replies = 5;
        ListOfListOfComment nested_replies = 6;
      }

      message Category {
        string id = 1;
        string name = 2;
        Category parent = 3;
        repeated Category children = 4;
        ListOfCategory optional_children = 5;
        ListOfListOfCategory sub_categories = 6;
        ListOfCategory related_categories = 7;
      }"
    `);
  });

  it('should correctly generate protobuf for complex input types with lists', () => {
    const sdl = `
        input TagInput {
            name: String!
            weight: Float
        }

        input UserFilterInput {
            ids: [ID!]
            optionalIds: [ID]
            tags: [TagInput!]!
            optionalTags: [TagInput]
            nestedTags: [[TagInput!]!]!
            optionalNestedTags: [[TagInput]]
            names: [String!]
            scores: [Int]
            ratings: [Float!]
        }

        input SortInput {
            field: String!
            direction: String!
        }

        input PaginationInput {
            limit: Int
            offset: Int
        }

        input SearchInput {
            query: String!
            filters: [UserFilterInput!]!
            optionalFilters: [UserFilterInput]
            nestedFilters: [[UserFilterInput!]!]!
            sorts: [SortInput!]
            pagination: PaginationInput
        }

        type User {
            id: ID!
            name: String!
            tags: [String!]!
        }

        type SearchResult {
            users: [User!]!
            total: Int!
        }

        type Query {
            searchUsers(input: SearchInput!): SearchResult!
        }

        type Mutation {
            updateUsers(updates: [UserFilterInput!]!): [User!]!
            bulkSearch(searches: [SearchInput!]!): [SearchResult!]!
        }`;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    expectValidProto(protoText);

    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      import "google/protobuf/wrappers.proto";

      // Service definition for DefaultService
      service DefaultService {
        rpc MutationBulkSearch(MutationBulkSearchRequest) returns (MutationBulkSearchResponse) {}
        rpc MutationUpdateUsers(MutationUpdateUsersRequest) returns (MutationUpdateUsersResponse) {}
        rpc QuerySearchUsers(QuerySearchUsersRequest) returns (QuerySearchUsersResponse) {}
      }

      // Wrapper message for a list of Float.
      message ListOfFloat {
        repeated double items = 1;
      }

      // Wrapper message for a list of ID.
      message ListOfID {
        repeated string items = 1;
      }

      // Wrapper message for a list of Int.
      message ListOfInt {
        repeated int32 items = 1;
      }

      // Wrapper message for a list of TagInput.
      message ListOfListOfTagInput {
        message List {
          repeated ListOfTagInput items = 1;
        }
        List list = 1;
      }

      // Wrapper message for a list of UserFilterInput.
      message ListOfListOfUserFilterInput {
        message List {
          repeated ListOfUserFilterInput items = 1;
        }
        List list = 1;
      }

      // Wrapper message for a list of SortInput.
      message ListOfSortInput {
        repeated SortInput items = 1;
      }

      // Wrapper message for a list of String.
      message ListOfString {
        repeated string items = 1;
      }

      // Wrapper message for a list of TagInput.
      message ListOfTagInput {
        repeated TagInput items = 1;
      }

      // Wrapper message for a list of UserFilterInput.
      message ListOfUserFilterInput {
        repeated UserFilterInput items = 1;
      }

      // Request message for searchUsers operation.
      message QuerySearchUsersRequest {
        SearchInput input = 1;
      }
      // Response message for searchUsers operation.
      message QuerySearchUsersResponse {
        SearchResult search_users = 1;
      }
      // Request message for updateUsers operation.
      message MutationUpdateUsersRequest {
        repeated UserFilterInput updates = 1;
      }
      // Response message for updateUsers operation.
      message MutationUpdateUsersResponse {
        repeated User update_users = 1;
      }
      // Request message for bulkSearch operation.
      message MutationBulkSearchRequest {
        repeated SearchInput searches = 1;
      }
      // Response message for bulkSearch operation.
      message MutationBulkSearchResponse {
        repeated SearchResult bulk_search = 1;
      }

      message SearchInput {
        string query = 1;
        repeated UserFilterInput filters = 2;
        ListOfUserFilterInput optional_filters = 3;
        ListOfListOfUserFilterInput nested_filters = 4;
        ListOfSortInput sorts = 5;
        PaginationInput pagination = 6;
      }

      message SearchResult {
        repeated User users = 1;
        int32 total = 2;
      }

      message UserFilterInput {
        ListOfID ids = 1;
        ListOfID optional_ids = 2;
        repeated TagInput tags = 3;
        ListOfTagInput optional_tags = 4;
        ListOfListOfTagInput nested_tags = 5;
        ListOfListOfTagInput optional_nested_tags = 6;
        ListOfString names = 7;
        ListOfInt scores = 8;
        ListOfFloat ratings = 9;
      }

      message User {
        string id = 1;
        string name = 2;
        repeated string tags = 3;
      }

      message TagInput {
        string name = 1;
        google.protobuf.DoubleValue weight = 2;
      }

      message SortInput {
        string field = 1;
        string direction = 2;
      }

      message PaginationInput {
        google.protobuf.Int32Value limit = 1;
        google.protobuf.Int32Value offset = 2;
      }"
    `);
  });

  it('should correctly generate protobuf for recursive input types', () => {
    const sdl = `
        input CategoryInput {
            id: ID!
            name: String!
            parentId: ID
            children: [CategoryInput!]
            optionalChildren: [CategoryInput]
            nestedChildren: [[CategoryInput!]!]
        }

        input CommentInput {
            id: ID!
            content: String!
            authorId: ID!
            replies: [CommentInput!]!
            optionalReplies: [CommentInput]
            nestedReplies: [[CommentInput!]!]!
        }

        input FilterNodeInput {
            field: String!
            value: String!
            operator: String!
            children: [FilterNodeInput!]
            optionalChildren: [FilterNodeInput]
            andConditions: [[FilterNodeInput!]!]
            orConditions: [[FilterNodeInput]]
        }

        type Category {
            id: ID!
            name: String!
        }

        type Comment {
            id: ID!
            content: String!
        }

        type FilterResult {
            matched: Boolean!
            count: Int!
        }

        type Query {
            getCategory: Category!
        }

        type Mutation {
            createCategory(input: CategoryInput!): Category!
            createCategories(inputs: [CategoryInput!]!): [Category!]!
            createComment(input: CommentInput!): Comment!
            createComments(inputs: [CommentInput!]!): [Comment!]!
            applyFilter(filter: FilterNodeInput!): FilterResult!
            applyFilters(filters: [FilterNodeInput!]!): [FilterResult!]!
            complexFilter(filters: [[FilterNodeInput!]!]!): FilterResult!
        }`;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    expectValidProto(protoText);

    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      import "google/protobuf/wrappers.proto";

      // Service definition for DefaultService
      service DefaultService {
        rpc MutationApplyFilter(MutationApplyFilterRequest) returns (MutationApplyFilterResponse) {}
        rpc MutationApplyFilters(MutationApplyFiltersRequest) returns (MutationApplyFiltersResponse) {}
        rpc MutationComplexFilter(MutationComplexFilterRequest) returns (MutationComplexFilterResponse) {}
        rpc MutationCreateCategories(MutationCreateCategoriesRequest) returns (MutationCreateCategoriesResponse) {}
        rpc MutationCreateCategory(MutationCreateCategoryRequest) returns (MutationCreateCategoryResponse) {}
        rpc MutationCreateComment(MutationCreateCommentRequest) returns (MutationCreateCommentResponse) {}
        rpc MutationCreateComments(MutationCreateCommentsRequest) returns (MutationCreateCommentsResponse) {}
        rpc QueryGetCategory(QueryGetCategoryRequest) returns (QueryGetCategoryResponse) {}
      }

      // Wrapper message for a list of CategoryInput.
      message ListOfCategoryInput {
        repeated CategoryInput items = 1;
      }

      // Wrapper message for a list of CommentInput.
      message ListOfCommentInput {
        repeated CommentInput items = 1;
      }

      // Wrapper message for a list of FilterNodeInput.
      message ListOfFilterNodeInput {
        repeated FilterNodeInput items = 1;
      }

      // Wrapper message for a list of CategoryInput.
      message ListOfListOfCategoryInput {
        message List {
          repeated ListOfCategoryInput items = 1;
        }
        List list = 1;
      }

      // Wrapper message for a list of CommentInput.
      message ListOfListOfCommentInput {
        message List {
          repeated ListOfCommentInput items = 1;
        }
        List list = 1;
      }

      // Wrapper message for a list of FilterNodeInput.
      message ListOfListOfFilterNodeInput {
        message List {
          repeated ListOfFilterNodeInput items = 1;
        }
        List list = 1;
      }

      // Request message for getCategory operation.
      message QueryGetCategoryRequest {
      }
      // Response message for getCategory operation.
      message QueryGetCategoryResponse {
        Category get_category = 1;
      }
      // Request message for createCategory operation.
      message MutationCreateCategoryRequest {
        CategoryInput input = 1;
      }
      // Response message for createCategory operation.
      message MutationCreateCategoryResponse {
        Category create_category = 1;
      }
      // Request message for createCategories operation.
      message MutationCreateCategoriesRequest {
        repeated CategoryInput inputs = 1;
      }
      // Response message for createCategories operation.
      message MutationCreateCategoriesResponse {
        repeated Category create_categories = 1;
      }
      // Request message for createComment operation.
      message MutationCreateCommentRequest {
        CommentInput input = 1;
      }
      // Response message for createComment operation.
      message MutationCreateCommentResponse {
        Comment create_comment = 1;
      }
      // Request message for createComments operation.
      message MutationCreateCommentsRequest {
        repeated CommentInput inputs = 1;
      }
      // Response message for createComments operation.
      message MutationCreateCommentsResponse {
        repeated Comment create_comments = 1;
      }
      // Request message for applyFilter operation.
      message MutationApplyFilterRequest {
        FilterNodeInput filter = 1;
      }
      // Response message for applyFilter operation.
      message MutationApplyFilterResponse {
        FilterResult apply_filter = 1;
      }
      // Request message for applyFilters operation.
      message MutationApplyFiltersRequest {
        repeated FilterNodeInput filters = 1;
      }
      // Response message for applyFilters operation.
      message MutationApplyFiltersResponse {
        repeated FilterResult apply_filters = 1;
      }
      // Request message for complexFilter operation.
      message MutationComplexFilterRequest {
        ListOfListOfFilterNodeInput filters = 1;
      }
      // Response message for complexFilter operation.
      message MutationComplexFilterResponse {
        FilterResult complex_filter = 1;
      }

      message Category {
        string id = 1;
        string name = 2;
      }

      message CategoryInput {
        string id = 1;
        string name = 2;
        google.protobuf.StringValue parent_id = 3;
        ListOfCategoryInput children = 4;
        ListOfCategoryInput optional_children = 5;
        ListOfListOfCategoryInput nested_children = 6;
      }

      message CommentInput {
        string id = 1;
        string content = 2;
        string author_id = 3;
        repeated CommentInput replies = 4;
        ListOfCommentInput optional_replies = 5;
        ListOfListOfCommentInput nested_replies = 6;
      }

      message Comment {
        string id = 1;
        string content = 2;
      }

      message FilterNodeInput {
        string field = 1;
        string value = 2;
        string operator = 3;
        ListOfFilterNodeInput children = 4;
        ListOfFilterNodeInput optional_children = 5;
        ListOfListOfFilterNodeInput and_conditions = 6;
        ListOfListOfFilterNodeInput or_conditions = 7;
      }

      message FilterResult {
        bool matched = 1;
        int32 count = 2;
      }"
    `);
  });

  it('should correctly generate protobuf for mixed recursive and non-recursive types with complex list nesting', () => {
    const sdl = `
        enum Status {
            ACTIVE
            INACTIVE
            PENDING
        }

        scalar DateTime

        input MetadataInput {
            key: String!
            value: String!
            tags: [String!]
            nestedData: [MetadataInput]
        }

        input TreeNodeInput {
            id: ID!
            value: String!
            status: Status!
            metadata: [MetadataInput!]
            children: [TreeNodeInput!]
            optionalChildren: [TreeNodeInput]
            nestedChildren: [[TreeNodeInput!]!]
            siblingGroups: [[[TreeNodeInput]]]
        }

        type TreeNode {
            id: ID!
            value: String!
            status: Status!
            children: [TreeNode!]!
            optionalChildren: [TreeNode]
            nestedChildren: [[TreeNode!]!]!
            parent: TreeNode
            ancestors: [TreeNode!]!
            descendants: [[TreeNode]]
        }

        type ProcessingResult {
            nodes: [TreeNode!]!
            errors: [String]
            warnings: [[String]]
            metadata: [String!]!
        }

        type Query {
            getTree: TreeNode!
        }

        type Mutation {
            processTree(input: TreeNodeInput!): ProcessingResult!
            processTrees(inputs: [TreeNodeInput!]!): [ProcessingResult!]!
            bulkProcess(batches: [[TreeNodeInput!]!]!): ProcessingResult!
            complexProcess(data: [[[TreeNodeInput]]]!): [ProcessingResult]
        }`;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    expectValidProto(protoText);

    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      // Service definition for DefaultService
      service DefaultService {
        rpc MutationBulkProcess(MutationBulkProcessRequest) returns (MutationBulkProcessResponse) {}
        rpc MutationComplexProcess(MutationComplexProcessRequest) returns (MutationComplexProcessResponse) {}
        rpc MutationProcessTree(MutationProcessTreeRequest) returns (MutationProcessTreeResponse) {}
        rpc MutationProcessTrees(MutationProcessTreesRequest) returns (MutationProcessTreesResponse) {}
        rpc QueryGetTree(QueryGetTreeRequest) returns (QueryGetTreeResponse) {}
      }

      // Wrapper message for a list of TreeNodeInput.
      message ListOfListOfListOfTreeNodeInput {
        message List {
          repeated ListOfListOfTreeNodeInput items = 1;
        }
        List list = 1;
      }

      // Wrapper message for a list of String.
      message ListOfListOfString {
        message List {
          repeated ListOfString items = 1;
        }
        List list = 1;
      }

      // Wrapper message for a list of TreeNode.
      message ListOfListOfTreeNode {
        message List {
          repeated ListOfTreeNode items = 1;
        }
        List list = 1;
      }

      // Wrapper message for a list of TreeNodeInput.
      message ListOfListOfTreeNodeInput {
        message List {
          repeated ListOfTreeNodeInput items = 1;
        }
        List list = 1;
      }

      // Wrapper message for a list of MetadataInput.
      message ListOfMetadataInput {
        repeated MetadataInput items = 1;
      }

      // Wrapper message for a list of ProcessingResult.
      message ListOfProcessingResult {
        repeated ProcessingResult items = 1;
      }

      // Wrapper message for a list of String.
      message ListOfString {
        repeated string items = 1;
      }

      // Wrapper message for a list of TreeNode.
      message ListOfTreeNode {
        repeated TreeNode items = 1;
      }

      // Wrapper message for a list of TreeNodeInput.
      message ListOfTreeNodeInput {
        repeated TreeNodeInput items = 1;
      }

      // Request message for getTree operation.
      message QueryGetTreeRequest {
      }
      // Response message for getTree operation.
      message QueryGetTreeResponse {
        TreeNode get_tree = 1;
      }
      // Request message for processTree operation.
      message MutationProcessTreeRequest {
        TreeNodeInput input = 1;
      }
      // Response message for processTree operation.
      message MutationProcessTreeResponse {
        ProcessingResult process_tree = 1;
      }
      // Request message for processTrees operation.
      message MutationProcessTreesRequest {
        repeated TreeNodeInput inputs = 1;
      }
      // Response message for processTrees operation.
      message MutationProcessTreesResponse {
        repeated ProcessingResult process_trees = 1;
      }
      // Request message for bulkProcess operation.
      message MutationBulkProcessRequest {
        ListOfListOfTreeNodeInput batches = 1;
      }
      // Response message for bulkProcess operation.
      message MutationBulkProcessResponse {
        ProcessingResult bulk_process = 1;
      }
      // Request message for complexProcess operation.
      message MutationComplexProcessRequest {
        ListOfListOfListOfTreeNodeInput data = 1;
      }
      // Response message for complexProcess operation.
      message MutationComplexProcessResponse {
        ListOfProcessingResult complex_process = 1;
      }

      message TreeNode {
        string id = 1;
        string value = 2;
        Status status = 3;
        repeated TreeNode children = 4;
        ListOfTreeNode optional_children = 5;
        ListOfListOfTreeNode nested_children = 6;
        TreeNode parent = 7;
        repeated TreeNode ancestors = 8;
        ListOfListOfTreeNode descendants = 9;
      }

      message TreeNodeInput {
        string id = 1;
        string value = 2;
        Status status = 3;
        ListOfMetadataInput metadata = 4;
        ListOfTreeNodeInput children = 5;
        ListOfTreeNodeInput optional_children = 6;
        ListOfListOfTreeNodeInput nested_children = 7;
        ListOfListOfListOfTreeNodeInput sibling_groups = 8;
      }

      message ProcessingResult {
        repeated TreeNode nodes = 1;
        ListOfString errors = 2;
        ListOfListOfString warnings = 3;
        repeated string metadata = 4;
      }

      enum Status {
        STATUS_UNSPECIFIED = 0;
        STATUS_ACTIVE = 1;
        STATUS_INACTIVE = 2;
        STATUS_PENDING = 3;
      }

      message MetadataInput {
        string key = 1;
        string value = 2;
        ListOfString tags = 3;
        ListOfMetadataInput nested_data = 4;
      }"
    `);
  });
});
