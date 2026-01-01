import { describe, expect, test } from 'vitest';
import { compileOperationsToProto } from '../../src';

describe('Operation Validation', () => {
  const schema = `
    type Query {
      user: User
      post: Post
    }
    
    type User {
      id: ID!
      name: String
    }
    
    type Post {
      id: ID!
      title: String
    }
  `;

  describe('Single Operation Requirement', () => {
    test('should accept a single named operation', () => {
      const operation = `
        query GetUser {
          user {
            id
            name
          }
        }
      `;

      expect(() => {
        compileOperationsToProto(operation, schema);
      }).not.toThrow();
    });

    test('should reject multiple named operations', () => {
      const operation = `
        query GetUser {
          user {
            id
            name
          }
        }
        
        query GetPost {
          post {
            id
            title
          }
        }
      `;

      expect(() => {
        compileOperationsToProto(operation, schema);
      }).toThrow(/Multiple operations found in document: GetUser, GetPost/);
    });

    test('should reject document with no named operations', () => {
      const operation = `
        {
          user {
            id
          }
        }
      `;

      expect(() => {
        compileOperationsToProto(operation, schema);
      }).toThrow(/No named operations found in document/);
    });

    test('should accept single operation with fragments', () => {
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

      expect(() => {
        compileOperationsToProto(operation, schema);
      }).not.toThrow();
    });

    test('should reject multiple operations even with fragments', () => {
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
        
        query GetPost {
          post {
            id
            title
          }
        }
      `;

      expect(() => {
        compileOperationsToProto(operation, schema);
      }).toThrow(/Multiple operations found in document/);
    });

    test('should accept mutation as single operation', () => {
      const mutationSchema = `
        type Mutation {
          createUser(name: String!): User
        }
        
        type User {
          id: ID!
          name: String
        }
      `;

      const operation = `
        mutation CreateUser($name: String!) {
          createUser(name: $name) {
            id
            name
          }
        }
      `;

      expect(() => {
        compileOperationsToProto(operation, mutationSchema);
      }).not.toThrow();
    });

    test('should reject mixed operation types', () => {
      const mixedSchema = `
        type Query {
          user: User
        }
        
        type Mutation {
          createUser(name: String!): User
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
          }
        }
        
        mutation CreateUser($name: String!) {
          createUser(name: $name) {
            id
          }
        }
      `;

      expect(() => {
        compileOperationsToProto(operation, mixedSchema);
      }).toThrow(/Multiple operations found in document: GetUser, CreateUser/);
    });
  });

  describe('Proto Schema Consistency', () => {
    test('should allow single operation for deterministic proto schema generation', () => {
      const operation = `
        query GetUser {
          user {
            id
            name
          }
        }
      `;

      const result = compileOperationsToProto(operation, schema);

      // Verify the proto can be generated
      expect(result.proto).toContain('rpc GetUser');
      expect(result.proto).toContain('message GetUserRequest');
      expect(result.proto).toContain('message GetUserResponse');
    });
  });

  describe('Operation Name PascalCase Validation', () => {
    test('should accept PascalCase operation names', () => {
      const operation = `
        query GetUser {
          user {
            id
            name
          }
        }
      `;

      expect(() => {
        compileOperationsToProto(operation, schema);
      }).not.toThrow();
    });

    test('should accept PascalCase with numbers', () => {
      const operation = `
        query GetUser123 {
          user {
            id
            name
          }
        }
      `;

      expect(() => {
        compileOperationsToProto(operation, schema);
      }).not.toThrow();
    });

    test('should reject camelCase operation names', () => {
      const operation = `
        query getUser {
          user {
            id
            name
          }
        }
      `;

      expect(() => {
        compileOperationsToProto(operation, schema);
      }).toThrow(/Operation name "getUser" must start with an uppercase letter/);
    });

    test('should reject snake_case operation names', () => {
      const operation = `
        query get_user {
          user {
            id
            name
          }
        }
      `;

      expect(() => {
        compileOperationsToProto(operation, schema);
      }).toThrow(/Operation name "get_user" must start with an uppercase letter/);
    });

    test('should accept all-UPPERCASE operation names', () => {
      const operation = `
        query GETUSER {
          user {
            id
            name
          }
        }
      `;

      expect(() => {
        compileOperationsToProto(operation, schema);
      }).not.toThrow();
    });

    test('should accept operation names with only uppercase and numbers', () => {
      const operation = `
        query GET123USER {
          user {
            id
            name
          }
        }
      `;

      expect(() => {
        compileOperationsToProto(operation, schema);
      }).not.toThrow();
    });

    test('should provide helpful error message for camelCase', () => {
      const operation = `
        query getUserById {
          user {
            id
          }
        }
      `;

      expect(() => {
        compileOperationsToProto(operation, schema);
      }).toThrow(/must start with an uppercase letter.*Examples: GetUser, CreatePost, HRService, GETUSER/);
    });

    test('should validate mutation operation names', () => {
      const mutationSchema = `
        type Mutation {
          createUser(name: String!): User
        }
        
        type User {
          id: ID!
          name: String
        }
      `;

      const operation = `
        mutation createUser($name: String!) {
          createUser(name: $name) {
            id
            name
          }
        }
      `;

      expect(() => {
        compileOperationsToProto(operation, mutationSchema);
      }).toThrow(/Operation name "createUser" must start with an uppercase letter/);
    });

    test('should validate subscription operation names', () => {
      const subscriptionSchema = `
        type Query {
          ping: String
        }
        
        type Subscription {
          messageAdded: Message
        }
        
        type Message {
          id: ID!
          content: String
        }
      `;

      const operation = `
        subscription onMessageAdded {
          messageAdded {
            id
            content
          }
        }
      `;

      expect(() => {
        compileOperationsToProto(operation, subscriptionSchema);
      }).toThrow(/Operation name "onMessageAdded" must start with an uppercase letter/);
    });
  });

  describe('Root-Level Field Aliases', () => {
    test('should reject root-level field aliases', () => {
      const operation = `
        query GetUser {
          myUser: user {
            id
            name
          }
        }
      `;

      expect(() => {
        compileOperationsToProto(operation, schema);
      }).toThrow(/Root-level field alias "myUser: user" is not supported/);
    });

    test('should reject multiple root-level aliases', () => {
      const operation = `
        query GetData {
          myUser: user {
            id
          }
          myPost: post {
            id
          }
        }
      `;

      expect(() => {
        compileOperationsToProto(operation, schema);
      }).toThrow(/Root-level field alias "myUser: user" is not supported/);
    });

    test('should allow nested field aliases', () => {
      const operation = `
        query GetUser {
          user {
            userId: id
            userName: name
          }
        }
      `;

      // Nested aliases are allowed
      expect(() => {
        compileOperationsToProto(operation, schema);
      }).not.toThrow();
    });

    test('should allow root fields without aliases', () => {
      const operation = `
        query GetUserAndPost {
          user {
            id
            name
          }
          post {
            id
            title
          }
        }
      `;

      expect(() => {
        compileOperationsToProto(operation, schema);
      }).not.toThrow();
    });

    test('should reject root alias even with fragments', () => {
      const operation = `
        fragment UserFields on User {
          id
          name
        }
        
        query GetUser {
          myUser: user {
            ...UserFields
          }
        }
      `;

      expect(() => {
        compileOperationsToProto(operation, schema);
      }).toThrow(/Root-level field alias "myUser: user" is not supported/);
    });
  });
});
