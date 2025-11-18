import { describe, expect, test } from 'vitest';
import { compileOperationsToProto } from '../../src/operation-to-proto';
import { expectValidProto, loadProtoFromText } from '../util';

describe('Enum Support', () => {
  describe('Enums in Query Variables', () => {
    test('should handle enum variable in query', () => {
      const schema = `
        type Query {
          users(status: UserStatus): [User]
        }
        
        enum UserStatus {
          ACTIVE
          INACTIVE
          PENDING
        }
        
        type User {
          id: ID!
          name: String
          status: UserStatus
        }
      `;

      const operation = `
        query GetUsers($status: UserStatus) {
          users(status: $status) {
            id
            name
            status
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
          rpc GetUsers(GetUsersRequest) returns (GetUsersResponse) {}
        }

        message GetUsersRequest {
          UserStatus status = 1;
        }

        message GetUsersResponse {
          message Users {
            string id = 1;
            google.protobuf.StringValue name = 2;
            UserStatus status = 3;
          }
          repeated Users users = 1;
        }

        enum UserStatus {
          USER_STATUS_UNSPECIFIED = 0;
          USER_STATUS_ACTIVE = 1;
          USER_STATUS_INACTIVE = 2;
          USER_STATUS_PENDING = 3;
        }
        "
      `);
    });

    test('should handle non-null enum variable', () => {
      const schema = `
        type Query {
          users(status: UserStatus!): [User]
        }
        
        enum UserStatus {
          ACTIVE
          INACTIVE
        }
        
        type User {
          id: ID!
          name: String
        }
      `;

      const operation = `
        query GetUsers($status: UserStatus!) {
          users(status: $status) {
            id
            name
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
          rpc GetUsers(GetUsersRequest) returns (GetUsersResponse) {}
        }

        message GetUsersRequest {
          UserStatus status = 1;
        }

        message GetUsersResponse {
          message Users {
            string id = 1;
            google.protobuf.StringValue name = 2;
          }
          repeated Users users = 1;
        }

        enum UserStatus {
          USER_STATUS_UNSPECIFIED = 0;
          USER_STATUS_ACTIVE = 1;
          USER_STATUS_INACTIVE = 2;
        }
        "
      `);
    });

    test('should handle list of enums', () => {
      const schema = `
        type Query {
          users(statuses: [UserStatus!]!): [User]
        }
        
        enum UserStatus {
          ACTIVE
          INACTIVE
        }
        
        type User {
          id: ID!
          name: String
        }
      `;

      const operation = `
        query GetUsers($statuses: [UserStatus!]!) {
          users(statuses: $statuses) {
            id
            name
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
          rpc GetUsers(GetUsersRequest) returns (GetUsersResponse) {}
        }

        message GetUsersRequest {
          repeated UserStatus statuses = 1;
        }

        message GetUsersResponse {
          message Users {
            string id = 1;
            google.protobuf.StringValue name = 2;
          }
          repeated Users users = 1;
        }

        enum UserStatus {
          USER_STATUS_UNSPECIFIED = 0;
          USER_STATUS_ACTIVE = 1;
          USER_STATUS_INACTIVE = 2;
        }
        "
      `);
    });
  });

  describe('Enums in Response Fields', () => {
    test('should handle enum field in response', () => {
      const schema = `
        type Query {
          user: User
        }
        
        type User {
          id: ID!
          name: String
          status: UserStatus
        }
        
        enum UserStatus {
          ACTIVE
          INACTIVE
          PENDING
        }
      `;

      const operation = `
        query GetUser {
          user {
            id
            name
            status
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
          rpc GetUser(GetUserRequest) returns (GetUserResponse) {}
        }

        message GetUserRequest {
        }

        message GetUserResponse {
          message User {
            string id = 1;
            google.protobuf.StringValue name = 2;
            UserStatus status = 3;
          }
          User user = 1;
        }

        enum UserStatus {
          USER_STATUS_UNSPECIFIED = 0;
          USER_STATUS_ACTIVE = 1;
          USER_STATUS_INACTIVE = 2;
          USER_STATUS_PENDING = 3;
        }
        "
      `);
    });

    test('should handle non-null enum field in response', () => {
      const schema = `
        type Query {
          user: User
        }
        
        type User {
          id: ID!
          status: UserStatus!
        }
        
        enum UserStatus {
          ACTIVE
          INACTIVE
        }
      `;

      const operation = `
        query GetUser {
          user {
            id
            status
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
          rpc GetUser(GetUserRequest) returns (GetUserResponse) {}
        }

        message GetUserRequest {
        }

        message GetUserResponse {
          message User {
            string id = 1;
            UserStatus status = 2;
          }
          User user = 1;
        }

        enum UserStatus {
          USER_STATUS_UNSPECIFIED = 0;
          USER_STATUS_ACTIVE = 1;
          USER_STATUS_INACTIVE = 2;
        }
        "
      `);
    });

    test('should handle list of enums in response', () => {
      const schema = `
        type Query {
          user: User
        }
        
        type User {
          id: ID!
          roles: [Role!]!
        }
        
        enum Role {
          ADMIN
          USER
          GUEST
        }
      `;

      const operation = `
        query GetUser {
          user {
            id
            roles
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
          rpc GetUser(GetUserRequest) returns (GetUserResponse) {}
        }

        message GetUserRequest {
        }

        message GetUserResponse {
          message User {
            string id = 1;
            repeated Role roles = 2;
          }
          User user = 1;
        }

        enum Role {
          ROLE_UNSPECIFIED = 0;
          ROLE_ADMIN = 1;
          ROLE_USER = 2;
          ROLE_GUEST = 3;
        }
        "
      `);
    });

    test('should handle nested object with enum field', () => {
      const schema = `
        type Query {
          user: User
        }
        
        type User {
          id: ID!
          profile: Profile
        }
        
        type Profile {
          visibility: Visibility
        }
        
        enum Visibility {
          PUBLIC
          PRIVATE
          FRIENDS_ONLY
        }
      `;

      const operation = `
        query GetUser {
          user {
            id
            profile {
              visibility
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
          rpc GetUser(GetUserRequest) returns (GetUserResponse) {}
        }

        message GetUserRequest {
        }

        message GetUserResponse {
          message User {
            message Profile {
              Visibility visibility = 1;
            }
            string id = 1;
            Profile profile = 2;
          }
          User user = 1;
        }

        enum Visibility {
          VISIBILITY_UNSPECIFIED = 0;
          VISIBILITY_PUBLIC = 1;
          VISIBILITY_PRIVATE = 2;
          VISIBILITY_FRIENDS_ONLY = 3;
        }
        "
      `);
    });
  });

  describe('Enums in Input Objects', () => {
    test('should handle enum in input object', () => {
      const schema = `
        type Query {
          ping: String
        }
        
        type Mutation {
          createUser(input: CreateUserInput!): User
        }
        
        input CreateUserInput {
          name: String!
          status: UserStatus
        }
        
        enum UserStatus {
          ACTIVE
          INACTIVE
        }
        
        type User {
          id: ID!
          name: String
        }
      `;

      const operation = `
        mutation CreateUser($input: CreateUserInput!) {
          createUser(input: $input) {
            id
            name
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
          rpc CreateUser(CreateUserRequest) returns (CreateUserResponse) {}
        }

        message CreateUserRequest {
          CreateUserInput input = 1;
        }

        message CreateUserInput {
          string name = 1;
          UserStatus status = 2;
        }

        message CreateUserResponse {
          message CreateUser {
            string id = 1;
            google.protobuf.StringValue name = 2;
          }
          CreateUser create_user = 1;
        }

        enum UserStatus {
          USER_STATUS_UNSPECIFIED = 0;
          USER_STATUS_ACTIVE = 1;
          USER_STATUS_INACTIVE = 2;
        }
        "
      `);
    });

    test('should handle nested input object with enum', () => {
      const schema = `
        type Query {
          ping: String
        }
        
        type Mutation {
          createUser(input: CreateUserInput!): User
        }
        
        input CreateUserInput {
          name: String!
          profile: ProfileInput
        }
        
        input ProfileInput {
          visibility: Visibility!
        }
        
        enum Visibility {
          PUBLIC
          PRIVATE
        }
        
        type User {
          id: ID!
          name: String
        }
      `;

      const operation = `
        mutation CreateUser($input: CreateUserInput!) {
          createUser(input: $input) {
            id
            name
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
          rpc CreateUser(CreateUserRequest) returns (CreateUserResponse) {}
        }

        message CreateUserRequest {
          CreateUserInput input = 1;
        }

        message CreateUserInput {
          string name = 1;
          ProfileInput profile = 2;
        }

        message ProfileInput {
          Visibility visibility = 1;
        }

        message CreateUserResponse {
          message CreateUser {
            string id = 1;
            google.protobuf.StringValue name = 2;
          }
          CreateUser create_user = 1;
        }

        enum Visibility {
          VISIBILITY_UNSPECIFIED = 0;
          VISIBILITY_PUBLIC = 1;
          VISIBILITY_PRIVATE = 2;
        }
        "
      `);
    });

    test('should handle list of enums in input object', () => {
      const schema = `
        type Query {
          ping: String
        }
        
        type Mutation {
          updateUser(input: UpdateUserInput!): User
        }
        
        input UpdateUserInput {
          id: ID!
          roles: [Role!]!
        }
        
        enum Role {
          ADMIN
          USER
        }
        
        type User {
          id: ID!
          name: String
        }
      `;

      const operation = `
        mutation UpdateUser($input: UpdateUserInput!) {
          updateUser(input: $input) {
            id
            name
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
          rpc UpdateUser(UpdateUserRequest) returns (UpdateUserResponse) {}
        }

        message UpdateUserRequest {
          UpdateUserInput input = 1;
        }

        message UpdateUserInput {
          string id = 1;
          repeated Role roles = 2;
        }

        message UpdateUserResponse {
          message UpdateUser {
            string id = 1;
            google.protobuf.StringValue name = 2;
          }
          UpdateUser update_user = 1;
        }

        enum Role {
          ROLE_UNSPECIFIED = 0;
          ROLE_ADMIN = 1;
          ROLE_USER = 2;
        }
        "
      `);
    });
  });

  describe('Multiple Enums', () => {
    test('should handle multiple different enums', () => {
      const schema = `
        type Query {
          users(status: UserStatus, role: Role): [User]
        }
        
        enum UserStatus {
          ACTIVE
          INACTIVE
        }
        
        enum Role {
          ADMIN
          USER
          GUEST
        }
        
        type User {
          id: ID!
          name: String
          status: UserStatus
          role: Role
        }
      `;

      const operation = `
        query GetUsers($status: UserStatus, $role: Role) {
          users(status: $status, role: $role) {
            id
            name
            status
            role
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
          rpc GetUsers(GetUsersRequest) returns (GetUsersResponse) {}
        }

        message GetUsersRequest {
          UserStatus status = 1;
          Role role = 2;
        }

        message GetUsersResponse {
          message Users {
            string id = 1;
            google.protobuf.StringValue name = 2;
            UserStatus status = 3;
            Role role = 4;
          }
          repeated Users users = 1;
        }

        enum UserStatus {
          USER_STATUS_UNSPECIFIED = 0;
          USER_STATUS_ACTIVE = 1;
          USER_STATUS_INACTIVE = 2;
        }

        enum Role {
          ROLE_UNSPECIFIED = 0;
          ROLE_ADMIN = 1;
          ROLE_USER = 2;
          ROLE_GUEST = 3;
        }
        "
      `);
    });

    test('should reject multiple operations even with shared enums', () => {
      const schema = `
        type Query {
          user: User
        }
        
        type Mutation {
          updateUser(status: UserStatus): User
        }
        
        enum UserStatus {
          ACTIVE
          INACTIVE
        }
        
        type User {
          id: ID!
          status: UserStatus
        }
      `;

      const operations = `
        query GetUser {
          user {
            id
            status
          }
        }
        
        mutation UpdateUser($status: UserStatus) {
          updateUser(status: $status) {
            id
            status
          }
        }
      `;

      expect(() => compileOperationsToProto(operations, schema)).toThrow(
        'Multiple operations found in document: GetUser, UpdateUser',
      );
    });
  });

  describe('Enum Edge Cases', () => {
    test('should handle enum with single value', () => {
      const schema = `
        type Query {
          user: User
        }
        
        type User {
          id: ID!
          singleton: SingleValue
        }
        
        enum SingleValue {
          ONLY_VALUE
        }
      `;

      const operation = `
        query GetUser {
          user {
            id
            singleton
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
          rpc GetUser(GetUserRequest) returns (GetUserResponse) {}
        }

        message GetUserRequest {
        }

        message GetUserResponse {
          message User {
            string id = 1;
            SingleValue singleton = 2;
          }
          User user = 1;
        }

        enum SingleValue {
          SINGLE_VALUE_UNSPECIFIED = 0;
          SINGLE_VALUE_ONLY_VALUE = 1;
        }
        "
      `);
    });

    test('should handle enum with many values', () => {
      const schema = `
        type Query {
          user: User
        }
        
        type User {
          id: ID!
          priority: Priority
        }
        
        enum Priority {
          P0
          P1
          P2
          P3
          P4
          P5
        }
      `;

      const operation = `
        query GetUser {
          user {
            id
            priority
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
          rpc GetUser(GetUserRequest) returns (GetUserResponse) {}
        }

        message GetUserRequest {
        }

        message GetUserResponse {
          message User {
            string id = 1;
            Priority priority = 2;
          }
          User user = 1;
        }

        enum Priority {
          PRIORITY_UNSPECIFIED = 0;
          PRIORITY_P0 = 1;
          PRIORITY_P1 = 2;
          PRIORITY_P2 = 3;
          PRIORITY_P3 = 4;
          PRIORITY_P4 = 5;
          PRIORITY_P5 = 6;
        }
        "
      `);
    });
  });

  describe('Enums with Fragments', () => {
    test('should handle enum in fragment', () => {
      const schema = `
        type Query {
          user: User
        }
        
        type User {
          id: ID!
          name: String
          status: UserStatus
        }
        
        enum UserStatus {
          ACTIVE
          INACTIVE
        }
      `;

      const operation = `
        fragment UserFields on User {
          id
          name
          status
        }
        
        query GetUser {
          user {
            ...UserFields
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
          rpc GetUser(GetUserRequest) returns (GetUserResponse) {}
        }

        message GetUserRequest {
        }

        message GetUserResponse {
          message User {
            string id = 1;
            google.protobuf.StringValue name = 2;
            UserStatus status = 3;
          }
          User user = 1;
        }

        enum UserStatus {
          USER_STATUS_UNSPECIFIED = 0;
          USER_STATUS_ACTIVE = 1;
          USER_STATUS_INACTIVE = 2;
        }
        "
      `);
    });
  });

  describe('Enum De-duplication', () => {
    test('should not duplicate enum when used in both request and response', () => {
      const schema = `
        type Query {
          users(status: UserStatus): [User]
        }
        
        enum UserStatus {
          ACTIVE
          INACTIVE
          PENDING
        }
        
        type User {
          id: ID!
          name: String
          status: UserStatus
        }
      `;

      const operation = `
        query GetUsers($status: UserStatus) {
          users(status: $status) {
            id
            name
            status
          }
        }
      `;

      const { proto } = compileOperationsToProto(operation, schema);

      expectValidProto(proto);
      
      // Count occurrences of "enum UserStatus" - should only appear once
      const enumDeclarations = proto.match(/enum UserStatus \{/g);
      expect(enumDeclarations).toHaveLength(1);
      
      expect(proto).toMatchInlineSnapshot(`
        "syntax = "proto3";
        package service.v1;

        import "google/protobuf/wrappers.proto";

        service DefaultService {
          rpc GetUsers(GetUsersRequest) returns (GetUsersResponse) {}
        }

        message GetUsersRequest {
          UserStatus status = 1;
        }

        message GetUsersResponse {
          message Users {
            string id = 1;
            google.protobuf.StringValue name = 2;
            UserStatus status = 3;
          }
          repeated Users users = 1;
        }

        enum UserStatus {
          USER_STATUS_UNSPECIFIED = 0;
          USER_STATUS_ACTIVE = 1;
          USER_STATUS_INACTIVE = 2;
          USER_STATUS_PENDING = 3;
        }
        "
      `);
    });

    test('should not duplicate enum when used in nested objects', () => {
      const schema = `
        type Query {
          user: User
        }
        
        type User {
          id: ID!
          profile: Profile
          settings: Settings
        }
        
        type Profile {
          visibility: Visibility
        }
        
        type Settings {
          defaultVisibility: Visibility
        }
        
        enum Visibility {
          PUBLIC
          PRIVATE
          FRIENDS_ONLY
        }
      `;

      const operation = `
        query GetUser {
          user {
            id
            profile {
              visibility
            }
            settings {
              defaultVisibility
            }
          }
        }
      `;

      const { proto } = compileOperationsToProto(operation, schema);

      expectValidProto(proto);
      
      // Count occurrences of "enum Visibility" - should only appear once
      const enumDeclarations = proto.match(/enum Visibility \{/g);
      expect(enumDeclarations).toHaveLength(1);
      
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
              Visibility visibility = 1;
            }
            message Settings {
              Visibility default_visibility = 1;
            }
            string id = 1;
            Profile profile = 2;
            Settings settings = 3;
          }
          User user = 1;
        }

        enum Visibility {
          VISIBILITY_UNSPECIFIED = 0;
          VISIBILITY_PUBLIC = 1;
          VISIBILITY_PRIVATE = 2;
          VISIBILITY_FRIENDS_ONLY = 3;
        }
        "
      `);
    });
  });

  describe('Enums in Subscriptions', () => {
    test('should handle enum in subscription', () => {
      const schema = `
        type Query {
          ping: String
        }
        
        type Subscription {
          userStatusChanged(userId: ID!): UserStatusUpdate
        }
        
        type UserStatusUpdate {
          userId: ID!
          newStatus: UserStatus!
        }
        
        enum UserStatus {
          ONLINE
          OFFLINE
          AWAY
        }
      `;

      const operation = `
        subscription OnUserStatusChanged($userId: ID!) {
          userStatusChanged(userId: $userId) {
            userId
            newStatus
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
          rpc OnUserStatusChanged(OnUserStatusChangedRequest) returns (stream OnUserStatusChangedResponse) {}
        }

        message OnUserStatusChangedRequest {
          string user_id = 1;
        }

        message OnUserStatusChangedResponse {
          message UserStatusChanged {
            string user_id = 1;
            UserStatus new_status = 2;
          }
          UserStatusChanged user_status_changed = 1;
        }

        enum UserStatus {
          USER_STATUS_UNSPECIFIED = 0;
          USER_STATUS_ONLINE = 1;
          USER_STATUS_OFFLINE = 2;
          USER_STATUS_AWAY = 3;
        }
        "
      `);
    });
  });
});
