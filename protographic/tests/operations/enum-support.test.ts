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

      // Should contain enum definition
      expect(proto).toContain('enum UserStatus {');
      expect(proto).toContain('UNSPECIFIED = 0;');
      expect(proto).toContain('ACTIVE = 1;');
      expect(proto).toContain('INACTIVE = 2;');
      expect(proto).toContain('PENDING = 3;');

      // Should use enum in request message
      expect(proto).toContain('UserStatus status = 1;');

      // Should use enum in response message
      expect(proto).toMatch(/UserStatus status/);
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

      // Should contain enum definition
      expect(proto).toContain('enum UserStatus {');

      // Should use enum in request (non-null)
      expect(proto).toContain('UserStatus status = 1;');
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

      // Should contain enum definition
      expect(proto).toContain('enum UserStatus {');

      // Should use repeated enum in request
      expect(proto).toContain('repeated UserStatus statuses = 1;');
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

      // Should contain enum definition
      expect(proto).toContain('enum UserStatus {');
      expect(proto).toContain('ACTIVE = 1;');
      expect(proto).toContain('INACTIVE = 2;');
      expect(proto).toContain('PENDING = 3;');

      // Should use enum in response message
      expect(proto).toMatch(/UserStatus status/);
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

      // Should contain enum definition
      expect(proto).toContain('enum UserStatus {');

      // Should use enum in response
      expect(proto).toMatch(/UserStatus status/);
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

      // Should contain enum definition
      expect(proto).toContain('enum Role {');

      // Should use repeated enum in response
      expect(proto).toContain('repeated Role roles');
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

      // Should contain enum definition
      expect(proto).toContain('enum Visibility {');
      expect(proto).toContain('PUBLIC = 1;');
      expect(proto).toContain('PRIVATE = 2;');
      expect(proto).toContain('FRIENDS_ONLY = 3;');
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

      // Should contain enum definition
      expect(proto).toContain('enum UserStatus {');
      expect(proto).toContain('UNSPECIFIED = 0;');
      expect(proto).toContain('ACTIVE = 1;');
      expect(proto).toContain('INACTIVE = 2;');

      // Should contain input message with enum field
      expect(proto).toContain('message CreateUserInput {');
      expect(proto).toMatch(/UserStatus status/);
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

      // Should contain enum definition
      expect(proto).toContain('enum Visibility {');

      // Should contain both input messages
      expect(proto).toContain('message CreateUserInput {');
      expect(proto).toContain('message ProfileInput {');

      // ProfileInput should use enum
      expect(proto).toMatch(/Visibility visibility/);
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

      // Should contain enum definition
      expect(proto).toContain('enum Role {');

      // Should use repeated enum in input
      expect(proto).toContain('repeated Role roles');
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

      // Should contain both enum definitions
      expect(proto).toContain('enum UserStatus {');
      expect(proto).toContain('enum Role {');

      // Should use both enums in request
      expect(proto).toMatch(/UserStatus status/);
      expect(proto).toMatch(/Role role/);
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
        'Multiple operations found in document: GetUser, UpdateUser'
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

      // Should contain enum with UNSPECIFIED and single value
      expect(proto).toContain('enum SingleValue {');
      expect(proto).toContain('UNSPECIFIED = 0;');
      expect(proto).toContain('ONLY_VALUE = 1;');
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

      // Should contain all enum values with sequential numbers
      expect(proto).toContain('enum Priority {');
      expect(proto).toContain('UNSPECIFIED = 0;');
      expect(proto).toContain('P0 = 1;');
      expect(proto).toContain('P1 = 2;');
      expect(proto).toContain('P2 = 3;');
      expect(proto).toContain('P3 = 4;');
      expect(proto).toContain('P4 = 5;');
      expect(proto).toContain('P5 = 6;');
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

      // Should contain enum definition
      expect(proto).toContain('enum UserStatus {');

      // Should use enum in response
      expect(proto).toMatch(/UserStatus status/);
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

      // Should contain enum definition
      expect(proto).toContain('enum UserStatus {');
      expect(proto).toContain('ONLINE = 1;');
      expect(proto).toContain('OFFLINE = 2;');
      expect(proto).toContain('AWAY = 3;');

      // Should be server streaming
      expect(proto).toContain('returns (stream OnUserStatusChangedResponse)');
    });
  });
});
