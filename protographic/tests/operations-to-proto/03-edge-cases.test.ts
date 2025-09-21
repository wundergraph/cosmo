import { describe, expect, test } from 'vitest';
import { OperationToProtoVisitor } from '../../src/operations-to-proto-visitor';
import { expectValidProto } from '../util';

describe('Operations to Proto - Edge Cases and Validation', () => {
  const schema = `
    type Query {
      employee(id: Int!): Employee
      employees: [Employee]
    }

    type Mutation {
      updateEmployeeTag(id: Int!, tag: String!): Employee
    }

    type Employee {
      id: Int!
      tag: String!
      isAvailable: Boolean!
      details: Details
    }

    type Details {
      forename: String!
      surname: String!
    }
  `;

  test('should throw error for operations without OperationDefinition', () => {
    const operations = [
      {
        name: 'InvalidOperation',
        content: `
          # This is just a comment, no operation definition
          fragment EmployeeFragment on Employee {
            id
            tag
          }
        `
      }
    ];

    const visitor = new OperationToProtoVisitor(schema, operations);

    expect(() => visitor.visit()).toThrow(
      'No OperationDefinition found in document for operation "InvalidOperation"'
    );
  });

  test('should throw error for multiple operations in single document', () => {
    const operations = [
      {
        name: 'MultipleOperations',
        content: `
          query GetEmployee($id: Int!) {
            employee(id: $id) {
              id
            }
          }

          mutation UpdateEmployee($id: Int!, $tag: String!) {
            updateEmployeeTag(id: $id, tag: $tag) {
              id
            }
          }
        `
      }
    ];

    const visitor = new OperationToProtoVisitor(schema, operations);

    expect(() => visitor.visit()).toThrow(
      'Multiple OperationDefinitions found in document for operation "MultipleOperations"'
    );
  });

  test('should throw error for fields not in schema', () => {
    const operations = [
      {
        name: 'InvalidField',
        content: `
          query InvalidField($id: Int!) {
            employee(id: $id) {
              id
              nonExistentField
            }
          }
        `
      }
    ];

    const visitor = new OperationToProtoVisitor(schema, operations);

    expect(() => visitor.visit()).toThrow(
      "Field 'nonExistentField' not found on type 'Employee'"
    );
  });

  test('should throw error for invalid operation type in schema', () => {
    const schemaWithoutMutation = `
      type Query {
        employee(id: Int!): Employee
      }

      type Employee {
        id: Int!
        tag: String!
      }
    `;

    const operations = [
      {
        name: 'InvalidMutation',
        content: `
          mutation InvalidMutation($id: Int!, $tag: String!) {
            updateEmployeeTag(id: $id, tag: $tag) {
              id
            }
          }
        `
      }
    ];

    const visitor = new OperationToProtoVisitor(schemaWithoutMutation, operations);

    expect(() => visitor.visit()).toThrow('Schema does not define Mutation type');
  });

  test('should handle fragment spreads correctly', () => {
    const operations = [
      {
        name: 'WithFragmentSpread',
        content: `
          query WithFragmentSpread($id: Int!) {
            employee(id: $id) {
              ...EmployeeFragment
            }
          }

          fragment EmployeeFragment on Employee {
            id
            tag
          }
        `
      }
    ];

    const visitor = new OperationToProtoVisitor(schema, operations);

    const protoText = visitor.visit();
    
    // Should now support fragment spreads and generate valid proto
    expectValidProto(protoText);
    
    // Should contain the expanded fields from the fragment
    expect(protoText).toContain('int32 id = 1;');
    expect(protoText).toContain('string tag = 2;');
    
    // Should generate proper service method
    expect(protoText).toContain('rpc WithFragmentSpread(WithFragmentSpreadRequest)');
  });

  test('should throw error for inline fragments', () => {
    const operations = [
      {
        name: 'WithInlineFragment',
        content: `
          query WithInlineFragment($id: Int!) {
            employee(id: $id) {
              id
              ... on Employee {
                tag
              }
            }
          }
        `
      }
    ];

    const visitor = new OperationToProtoVisitor(schema, operations);

    const protoText = visitor.visit();
    
    // Should now support inline fragments and generate oneof fields
    expectValidProto(protoText);
    expect(protoText).toContain('oneof type_specific');
  });

  test('should handle operations with no variables', () => {
    const operations = [
      {
        name: 'NoVariables',
        content: `
          query NoVariables {
            employees {
              id
              tag
            }
          }
        `
      }
    ];

    const visitor = new OperationToProtoVisitor(schema, operations, {
      serviceName: 'EmployeeService',
      packageName: 'employee.v1'
    });

    const protoText = visitor.visit();

    // Validate Proto definition
    expectValidProto(protoText);

    // Should generate empty request message
    expect(protoText).toContain('message NoVariablesRequest {}');
  });

  test('should handle operations with no selection set fields', () => {
    const scalarSchema = `
      type Query {
        count: Int!
        message: String
      }
    `;

    const operations = [
      {
        name: 'ScalarOnly',
        content: `
          query ScalarOnly {
            count
            message
          }
        `
      }
    ];

    const visitor = new OperationToProtoVisitor(scalarSchema, operations, {
      serviceName: 'ScalarService',
      packageName: 'scalar.v1'
    });

    const protoText = visitor.visit();

    // Validate Proto definition
    expectValidProto(protoText);

    // Should handle scalar fields correctly
    expect(protoText).toContain('int32 count = 1;');
    expect(protoText).toContain('google.protobuf.StringValue message = 2;');
  });

  test('should handle deeply nested selections without errors', () => {
    const deepSchema = `
      type Query {
        level1: Level1
      }

      type Level1 {
        field: String!
        level2: Level2
      }

      type Level2 {
        field: String!
        level3: Level3
      }

      type Level3 {
        field: String!
        level4: Level4
      }

      type Level4 {
        field: String!
        level5: Level5
      }

      type Level5 {
        field: String!
      }
    `;

    const operations = [
      {
        name: 'DeepNesting',
        content: `
          query DeepNesting {
            level1 {
              field
              level2 {
                field
                level3 {
                  field
                  level4 {
                    field
                    level5 {
                      field
                    }
                  }
                }
              }
            }
          }
        `
      }
    ];

    const visitor = new OperationToProtoVisitor(deepSchema, operations, {
      serviceName: 'DeepService',
      packageName: 'deep.v1'
    });

    const protoText = visitor.visit();

    // Validate Proto definition
    expectValidProto(protoText);

    // Should generate all nested message types
    expect(protoText).toContain('message DeepNestingLevel1');
    expect(protoText).toContain('message DeepNestingLevel1Level2');
    expect(protoText).toContain('message DeepNestingLevel1Level2Level3');
    expect(protoText).toContain('message DeepNestingLevel1Level2Level3Level4');
    expect(protoText).toContain('message DeepNestingLevel1Level2Level3Level4Level5');
  });

  test('should handle operations with circular references', () => {
    const circularSchema = `
      type Query {
        user: User
      }

      type User {
        id: Int!
        name: String!
        friends: [User]
        bestFriend: User
      }
    `;

    const operations = [
      {
        name: 'CircularReference',
        content: `
          query CircularReference {
            user {
              id
              name
              friends {
                id
                name
                bestFriend {
                  id
                  name
                }
              }
              bestFriend {
                id
                name
              }
            }
          }
        `
      }
    ];

    const visitor = new OperationToProtoVisitor(circularSchema, operations, {
      serviceName: 'UserService',
      packageName: 'user.v1'
    });

    const protoText = visitor.visit();

    // Validate Proto definition
    expectValidProto(protoText);

    // Should handle circular references by generating separate message types
    expect(protoText).toContain('message CircularReferenceUser');
    expect(protoText).toContain('message CircularReferenceUserFriends');
    expect(protoText).toContain('message CircularReferenceUserFriendsBestFriend');
    expect(protoText).toContain('message CircularReferenceUserBestFriend');
  });

  test('should handle empty operation names gracefully', () => {
    const operations = [
      {
        name: 'UnnamedOperation',
        content: `
          query {
            employees {
              id
            }
          }
        `
      }
    ];

    const visitor = new OperationToProtoVisitor(schema, operations, {
      serviceName: 'EmployeeService',
      packageName: 'employee.v1'
    });

    const protoText = visitor.visit();

    // Validate Proto definition
    expectValidProto(protoText);

    // Should use the provided name when operation name is missing
    expect(protoText).toContain('rpc UnnamedOperation(UnnamedOperationRequest)');
    expect(protoText).toContain('message UnnamedOperationRequest');
    expect(protoText).toContain('message UnnamedOperationResponse');
  });

  test('should handle operations with special characters in names', () => {
    const operations = [
      {
        name: 'Operation_With_Underscores',
        content: `
          query Operation_With_Underscores {
            employees {
              id
            }
          }
        `
      }
    ];

    const visitor = new OperationToProtoVisitor(schema, operations, {
      serviceName: 'EmployeeService',
      packageName: 'employee.v1'
    });

    const protoText = visitor.visit();

    // Validate Proto definition
    expectValidProto(protoText);

    // Should handle underscores in operation names
    expect(protoText).toContain('rpc Operation_With_Underscores');
    expect(protoText).toContain('message Operation_With_UnderscoresRequest');
    expect(protoText).toContain('message Operation_With_UnderscoresResponse');
  });

  test('should validate field selections against nested types', () => {
    const operations = [
      {
        name: 'InvalidNestedField',
        content: `
          query InvalidNestedField($id: Int!) {
            employee(id: $id) {
              id
              details {
                forename
                invalidNestedField
              }
            }
          }
        `
      }
    ];

    const visitor = new OperationToProtoVisitor(schema, operations);

    expect(() => visitor.visit()).toThrow(
      "Field 'invalidNestedField' not found on type 'Details'"
    );
  });

  test('should handle operations with only mutations', () => {
    const operations = [
      {
        name: 'OnlyMutation',
        content: `
          mutation OnlyMutation($id: Int!, $tag: String!) {
            updateEmployeeTag(id: $id, tag: $tag) {
              id
              tag
            }
          }
        `
      }
    ];

    const visitor = new OperationToProtoVisitor(schema, operations, {
      serviceName: 'EmployeeService',
      packageName: 'employee.v1'
    });

    const protoText = visitor.visit();

    // Validate Proto definition
    expectValidProto(protoText);

    // Should generate mutation service method
    expect(protoText).toContain('rpc OnlyMutation(OnlyMutationRequest)');
    expect(protoText).toContain('message OnlyMutationRequest');
    expect(protoText).toContain('message OnlyMutationResponse');
  });
});