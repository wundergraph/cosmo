import { describe, expect, test } from 'vitest';
import { compileOperationsToProto } from '../../src/operation-to-proto.js';

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

  describe('Reversibility Considerations', () => {
    test('should allow single operation for proto-to-graphql reversibility', () => {
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