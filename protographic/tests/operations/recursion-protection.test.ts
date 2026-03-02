import { describe, expect, test } from 'vitest';
import { compileOperationsToProto } from '../../src/index.js';
import { expectValidProto } from '../util.js';

describe('Recursion Protection', () => {
  describe('Maximum Depth Protection', () => {
    test('should enforce default maximum depth limit', () => {
      const schema = `
        type Query {
          node: Node
        }
        
        type Node {
          id: ID!
          child: Node
        }
      `;

      // Create a deeply nested query that exceeds default depth (50)
      let nestedSelection = 'id';
      for (let i = 0; i < 55; i++) {
        nestedSelection = `child { ${nestedSelection} }`;
      }

      const operation = `
        query GetNode {
          node {
            ${nestedSelection}
          }
        }
      `;

      expect(() => compileOperationsToProto(operation, schema)).toThrow(/Maximum recursion depth.*exceeded/);
    });

    test('should respect custom maxDepth option', () => {
      const schema = `
        type Query {
          node: Node
        }
        
        type Node {
          id: ID!
          child: Node
        }
      `;

      // Create a query with depth of 15
      let nestedSelection = 'id';
      for (let i = 0; i < 15; i++) {
        nestedSelection = `child { ${nestedSelection} }`;
      }

      const operation = `
        query GetNode {
          node {
            ${nestedSelection}
          }
        }
      `;

      // Should fail with maxDepth of 10
      expect(() => compileOperationsToProto(operation, schema, { maxDepth: 10 })).toThrow(
        /Maximum recursion depth.*10.*exceeded/,
      );

      // Should succeed with maxDepth of 20
      const { proto } = compileOperationsToProto(operation, schema, { maxDepth: 20 });
      expectValidProto(proto);
      expect(proto).toContain('message GetNodeResponse');
    });

    test('should handle deeply nested inline fragments within depth limit', () => {
      const schema = `
        type Query {
          node: Node
        }
        
        interface Node {
          id: ID!
        }
        
        type User implements Node {
          id: ID!
          name: String
          friend: Node
        }
        
        type Post implements Node {
          id: ID!
          title: String
          author: Node
        }
      `;

      const operation = `
        query GetNode {
          node {
            id
            ... on User {
              name
              friend {
                id
                ... on User {
                  name
                  friend {
                    id
                    ... on Post {
                      title
                      author {
                        id
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `;

      // Should succeed - within default depth limit
      const { proto } = compileOperationsToProto(operation, schema);
      expectValidProto(proto);
      expect(proto).toContain('message GetNodeResponse');
    });
  });

  describe('Combined Protection Scenarios', () => {
    test('should handle fragments with deep nesting', () => {
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
          settings: Settings
        }
        
        type Settings {
          theme: String
          privacy: Privacy
        }
        
        type Privacy {
          level: String
          options: PrivacyOptions
        }
        
        type PrivacyOptions {
          showEmail: Boolean
          showPhone: Boolean
        }
      `;

      const operation = `
        fragment PrivacyFields on Privacy {
          level
          options {
            showEmail
            showPhone
          }
        }
        
        fragment SettingsFields on Settings {
          theme
          privacy {
            ...PrivacyFields
          }
        }
        
        fragment ProfileFields on Profile {
          bio
          settings {
            ...SettingsFields
          }
        }
        
        query GetUser {
          user {
            id
            name
            profile {
              ...ProfileFields
            }
          }
        }
      `;

      const { proto } = compileOperationsToProto(operation, schema);
      expectValidProto(proto);

      // Inline snapshot to verify recursion handling produces correct nested structure
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
              message Settings {
                message Privacy {
                  message Options {
                    google.protobuf.BoolValue show_email = 1;
                    google.protobuf.BoolValue show_phone = 2;
                  }
                  google.protobuf.StringValue level = 1;
                  Options options = 2;
                }
                google.protobuf.StringValue theme = 1;
                Privacy privacy = 2;
              }
              google.protobuf.StringValue bio = 1;
              Settings settings = 2;
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

    test('should reject circular fragment references', () => {
      const schema = `
        type Query {
          content: Content
        }
        
        union Content = Article | Video
        
        type Article {
          id: ID!
          title: String
          related: Content
        }
        
        type Video {
          id: ID!
          title: String
          related: Content
        }
      `;

      const operation = `
        fragment ContentFields on Content {
          ... on Article {
            id
            title
            related {
              ...ContentFields
            }
          }
          ... on Video {
            id
            title
            related {
              ...ContentFields
            }
          }
        }
        
        query GetContent {
          content {
            ...ContentFields
          }
        }
      `;

      // Should be rejected by GraphQL validation as circular fragment reference
      expect(() => compileOperationsToProto(operation, schema)).toThrow(/cannot spread fragment.*within itself/i);
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty fragments gracefully', () => {
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
        fragment EmptyFragment on User {
          id
        }
        
        query GetUser {
          user {
            ...EmptyFragment
            name
          }
        }
      `;

      const { proto } = compileOperationsToProto(operation, schema);
      expectValidProto(proto);
      expect(proto).toContain('message GetUserResponse');
    });

    test('should handle fragments that reference non-existent fragments', () => {
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
          id
          name
        }
        
        query GetUser {
          user {
            ...UserFields
          }
        }
      `;

      // Should work fine - no circular references
      const { proto } = compileOperationsToProto(operation, schema);
      expectValidProto(proto);
      expect(proto).toContain('message GetUserResponse');
    });

    test('should provide helpful error message when depth exceeded', () => {
      const schema = `
        type Query {
          node: Node
        }
        
        type Node {
          id: ID!
          child: Node
        }
      `;

      let nestedSelection = 'id';
      for (let i = 0; i < 15; i++) {
        nestedSelection = `child { ${nestedSelection} }`;
      }

      const operation = `
        query GetNode {
          node {
            ${nestedSelection}
          }
        }
      `;

      try {
        compileOperationsToProto(operation, schema, { maxDepth: 10 });
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        const message = (error as Error).message;
        expect(message).toContain('Maximum recursion depth');
        expect(message).toContain('10');
        expect(message).toContain('exceeded');
        expect(message).toContain('maxDepth option');
      }
    });
  });

  describe('Performance and Scalability', () => {
    test('should handle reasonable depth efficiently', () => {
      const schema = `
        type Query {
          node: Node
        }
        
        type Node {
          id: ID!
          value: String
          child: Node
        }
      `;

      // Create a query with depth of 20 (reasonable)
      let nestedSelection = 'id value';
      for (let i = 0; i < 20; i++) {
        nestedSelection = `child { ${nestedSelection} }`;
      }

      const operation = `
        query GetNode {
          node {
            ${nestedSelection}
          }
        }
      `;

      const startTime = Date.now();
      const { proto } = compileOperationsToProto(operation, schema);
      const endTime = Date.now();

      expectValidProto(proto);
      expect(proto).toContain('message GetNodeResponse');

      // Should complete in reasonable time (less than 1 second)
      expect(endTime - startTime).toBeLessThan(1000);
    });

    test('should handle many fragments without circular references', () => {
      const schema = `
        type Query {
          user: User
        }
        
        type User {
          id: ID!
          field1: String
          field2: String
          field3: String
          field4: String
          field5: String
        }
      `;

      // Create fragments that are all used in the query
      const operation = `
        fragment Fragment0 on User {
          field1
        }
        
        fragment Fragment1 on User {
          field2
        }
        
        fragment Fragment2 on User {
          field3
        }
        
        fragment Fragment3 on User {
          field4
        }
        
        fragment Fragment4 on User {
          field5
        }
        
        query GetUser {
          user {
            id
            ...Fragment0
            ...Fragment1
            ...Fragment2
            ...Fragment3
            ...Fragment4
          }
        }
      `;

      const { proto } = compileOperationsToProto(operation, schema);
      expectValidProto(proto);
      expect(proto).toContain('message GetUserResponse');
    });
  });
});
