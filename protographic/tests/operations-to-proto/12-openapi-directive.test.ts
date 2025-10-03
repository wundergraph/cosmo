import { describe, expect, test } from 'vitest';
import { OperationToProtoVisitor } from '../../src/operations-to-proto-visitor';
import { expectValidProto } from '../util';

const SDL = `
  type Query {
    employee(id: Int!): Employee
    employees: [Employee]
    searchEmployees(query: String!): [Employee!]!
  }

  type Mutation {
    updateEmployee(id: Int!, name: String!): Employee
    deleteEmployee(id: Int!): Boolean!
  }

  type Employee {
    id: Int!
    name: String!
    email: String
    department: String!
  }
`;

describe('Operations to Proto - OpenAPI Directive', () => {
  describe('Basic OpenAPI Metadata', () => {
    test('should include gnostic options for operation with @openapi directive', () => {
      const operations = [
        {
          name: 'GetEmployee',
          content: `
            query GetEmployee($id: Int!) @openapi(
              operationId: "getEmployeeById"
              summary: "Get employee by ID"
              description: "Retrieves a single employee by their unique identifier"
              tags: ["employees", "query"]
            ) {
              employee(id: $id) {
                id
                name
                email
              }
            }
          `,
        },
      ];

      const visitor = new OperationToProtoVisitor(SDL, operations, {
        serviceName: 'EmployeeService',
        packageName: 'employee.v1',
      });

      const protoText = visitor.visit();
      expectValidProto(protoText);

      // Should include gnostic import
      expect(protoText).toContain('import "gnostic/openapi/v3/annotations.proto";');

      // Should include combined gnostic option
      expect(protoText).toContain('option (gnostic.openapi.v3.operation) = {');
      expect(protoText).toContain('operation_id: "getEmployeeById"');
      expect(protoText).toContain('summary: "Get employee by ID"');
      expect(protoText).toContain('description: "Retrieves a single employee by their unique identifier"');
      expect(protoText).toContain('tags: ["employees", "query"]');
    });

    test('should handle operations without @openapi directive', () => {
      const operations = [
        {
          name: 'GetEmployee',
          content: `
            query GetEmployee($id: Int!) {
              employee(id: $id) {
                id
                name
              }
            }
          `,
        },
      ];

      const visitor = new OperationToProtoVisitor(SDL, operations, {
        serviceName: 'EmployeeService',
        packageName: 'employee.v1',
      });

      const protoText = visitor.visit();
      expectValidProto(protoText);

      // Should NOT include gnostic import or options
      expect(protoText).not.toContain('gnostic');
      expect(protoText).not.toContain('operation_id');
    });

    test('should handle partial OpenAPI metadata', () => {
      const operations = [
        {
          name: 'GetEmployee',
          content: `
            query GetEmployee($id: Int!) @openapi(
              operationId: "getEmployee"
              summary: "Get employee"
            ) {
              employee(id: $id) {
                id
                name
              }
            }
          `,
        },
      ];

      const visitor = new OperationToProtoVisitor(SDL, operations, {
        serviceName: 'EmployeeService',
        packageName: 'employee.v1',
      });

      const protoText = visitor.visit();
      expectValidProto(protoText);

      // Should include only provided fields
      expect(protoText).toContain('operation_id: "getEmployee"');
      expect(protoText).toContain('summary: "Get employee"');
      expect(protoText).not.toContain('description:');
      expect(protoText).not.toContain('tags:');
    });

    test('should handle operationId only', () => {
      const operations = [
        {
          name: 'GetEmployee',
          content: `
            query GetEmployee($id: Int!) @openapi(
              operationId: "getEmployeeById"
            ) {
              employee(id: $id) {
                id
                name
              }
            }
          `,
        },
      ];

      const visitor = new OperationToProtoVisitor(SDL, operations, {
        serviceName: 'EmployeeService',
        packageName: 'employee.v1',
      });

      const protoText = visitor.visit();
      expectValidProto(protoText);

      expect(protoText).toContain('operation_id: "getEmployeeById"');
      expect(protoText).not.toContain('summary:');
      expect(protoText).not.toContain('description:');
    });
  });

  describe('String Escaping', () => {
    test('should properly escape multi-line descriptions', () => {
      const operations = [
        {
          name: 'GetEmployee',
          content: `
            query GetEmployee($id: Int!) @openapi(
              description: "Line 1\\nLine 2\\nLine 3"
            ) {
              employee(id: $id) {
                id
              }
            }
          `,
        },
      ];

      const visitor = new OperationToProtoVisitor(SDL, operations, {
        serviceName: 'EmployeeService',
        packageName: 'employee.v1',
      });

      const protoText = visitor.visit();
      expectValidProto(protoText);

      expect(protoText).toContain('description: "Line 1\\nLine 2\\nLine 3"');
    });

    test('should escape quotes in strings', () => {
      const operations = [
        {
          name: 'GetEmployee',
          content: `
            query GetEmployee($id: Int!) @openapi(
              description: "Get \\"employee\\" by ID"
            ) {
              employee(id: $id) {
                id
              }
            }
          `,
        },
      ];

      const visitor = new OperationToProtoVisitor(SDL, operations, {
        serviceName: 'EmployeeService',
        packageName: 'employee.v1',
      });

      const protoText = visitor.visit();
      expectValidProto(protoText);

      expect(protoText).toContain('description: "Get \\"employee\\" by ID"');
    });

    test('should escape backslashes in strings', () => {
      const operations = [
        {
          name: 'GetEmployee',
          content: `
            query GetEmployee($id: Int!) @openapi(
              description: "Path: C:\\\\Users\\\\employee"
            ) {
              employee(id: $id) {
                id
              }
            }
          `,
        },
      ];

      const visitor = new OperationToProtoVisitor(SDL, operations, {
        serviceName: 'EmployeeService',
        packageName: 'employee.v1',
      });

      const protoText = visitor.visit();
      expectValidProto(protoText);

      expect(protoText).toContain('description: "Path: C:\\\\Users\\\\employee"');
    });

    test('should handle complex multi-line descriptions with special characters', () => {
      const operations = [
        {
          name: 'GetEmployee',
          content: `
            query GetEmployee($id: Int!) @openapi(
              description: "Retrieves an employee.\\n\\nParameters:\\n- id: Employee ID\\n\\nReturns:\\n- Employee object or null"
            ) {
              employee(id: $id) {
                id
                name
              }
            }
          `,
        },
      ];

      const visitor = new OperationToProtoVisitor(SDL, operations, {
        serviceName: 'EmployeeService',
        packageName: 'employee.v1',
      });

      const protoText = visitor.visit();
      expectValidProto(protoText);

      expect(protoText).toContain('description: "Retrieves an employee.\\n\\nParameters:\\n- id: Employee ID\\n\\nReturns:\\n- Employee object or null"');
    });
  });

  describe('Multiple Operations', () => {
    test('should handle multiple operations with different metadata', () => {
      const operations = [
        {
          name: 'GetEmployee',
          content: `
            query GetEmployee($id: Int!) @openapi(
              operationId: "getEmployee"
              summary: "Get single employee"
              tags: ["employees"]
            ) {
              employee(id: $id) {
                id
                name
              }
            }
          `,
        },
        {
          name: 'ListEmployees',
          content: `
            query ListEmployees @openapi(
              operationId: "listEmployees"
              summary: "List all employees"
              tags: ["employees", "list"]
            ) {
              employees {
                id
                name
              }
            }
          `,
        },
      ];

      const visitor = new OperationToProtoVisitor(SDL, operations, {
        serviceName: 'EmployeeService',
        packageName: 'employee.v1',
      });

      const protoText = visitor.visit();
      expectValidProto(protoText);

      // Both operations should have their own gnostic options
      expect(protoText).toContain('operation_id: "getEmployee"');
      expect(protoText).toContain('summary: "Get single employee"');
      expect(protoText).toContain('tags: ["employees"]');

      expect(protoText).toContain('operation_id: "listEmployees"');
      expect(protoText).toContain('summary: "List all employees"');
      expect(protoText).toContain('tags: ["employees", "list"]');
    });

    test('should handle mix of operations with and without @openapi directive', () => {
      const operations = [
        {
          name: 'GetEmployee',
          content: `
            query GetEmployee($id: Int!) @openapi(
              operationId: "getEmployee"
              tags: ["employees"]
            ) {
              employee(id: $id) {
                id
                name
              }
            }
          `,
        },
        {
          name: 'ListEmployees',
          content: `
            query ListEmployees {
              employees {
                id
                name
              }
            }
          `,
        },
      ];

      const visitor = new OperationToProtoVisitor(SDL, operations, {
        serviceName: 'EmployeeService',
        packageName: 'employee.v1',
      });

      const protoText = visitor.visit();
      expectValidProto(protoText);

      // First operation should have gnostic options
      expect(protoText).toContain('operation_id: "getEmployee"');

      // Should have both RPC methods
      expect(protoText).toContain('rpc GetEmployee(GetEmployeeRequest) returns (GetEmployeeResponse)');
      expect(protoText).toContain('rpc ListEmployees(ListEmployeesRequest) returns (ListEmployeesResponse)');
    });
  });

  describe('Mutation Operations', () => {
    test('should handle mutations with OpenAPI metadata', () => {
      const operations = [
        {
          name: 'UpdateEmployee',
          content: `
            mutation UpdateEmployee($id: Int!, $name: String!) @openapi(
              operationId: "updateEmployee"
              summary: "Update employee name"
              description: "Updates the name of an existing employee"
              tags: ["employees", "mutation"]
            ) {
              updateEmployee(id: $id, name: $name) {
                id
                name
              }
            }
          `,
        },
      ];

      const visitor = new OperationToProtoVisitor(SDL, operations, {
        serviceName: 'EmployeeService',
        packageName: 'employee.v1',
      });

      const protoText = visitor.visit();
      expectValidProto(protoText);

      expect(protoText).toContain('operation_id: "updateEmployee"');
      expect(protoText).toContain('summary: "Update employee name"');
      expect(protoText).toContain('description: "Updates the name of an existing employee"');
      expect(protoText).toContain('tags: ["employees", "mutation"]');
    });

    test('should handle delete mutation with deprecated flag', () => {
      const operations = [
        {
          name: 'DeleteEmployee',
          content: `
            mutation DeleteEmployee($id: Int!) @openapi(
              operationId: "deleteEmployee"
              summary: "Delete employee"
              deprecated: true
            ) {
              deleteEmployee(id: $id)
            }
          `,
        },
      ];

      const visitor = new OperationToProtoVisitor(SDL, operations, {
        serviceName: 'EmployeeService',
        packageName: 'employee.v1',
      });

      const protoText = visitor.visit();
      expectValidProto(protoText);

      expect(protoText).toContain('operation_id: "deleteEmployee"');
      expect(protoText).toContain('deprecated: true');
    });
  });

  describe('Tags Handling', () => {
    test('should handle single tag', () => {
      const operations = [
        {
          name: 'GetEmployee',
          content: `
            query GetEmployee($id: Int!) @openapi(
              tags: ["employees"]
            ) {
              employee(id: $id) {
                id
              }
            }
          `,
        },
      ];

      const visitor = new OperationToProtoVisitor(SDL, operations, {
        serviceName: 'EmployeeService',
        packageName: 'employee.v1',
      });

      const protoText = visitor.visit();
      expectValidProto(protoText);

      expect(protoText).toContain('tags: ["employees"]');
    });

    test('should handle multiple tags', () => {
      const operations = [
        {
          name: 'SearchEmployees',
          content: `
            query SearchEmployees($query: String!) @openapi(
              tags: ["employees", "search", "query"]
            ) {
              searchEmployees(query: $query) {
                id
                name
              }
            }
          `,
        },
      ];

      const visitor = new OperationToProtoVisitor(SDL, operations, {
        serviceName: 'EmployeeService',
        packageName: 'employee.v1',
      });

      const protoText = visitor.visit();
      expectValidProto(protoText);

      expect(protoText).toContain('tags: ["employees", "search", "query"]');
    });

    test('should handle tags with special characters', () => {
      const operations = [
        {
          name: 'GetEmployee',
          content: `
            query GetEmployee($id: Int!) @openapi(
              tags: ["employees-api", "v1.0", "public_api"]
            ) {
              employee(id: $id) {
                id
              }
            }
          `,
        },
      ];

      const visitor = new OperationToProtoVisitor(SDL, operations, {
        serviceName: 'EmployeeService',
        packageName: 'employee.v1',
      });

      const protoText = visitor.visit();
      expectValidProto(protoText);

      expect(protoText).toContain('tags: ["employees-api", "v1.0", "public_api"]');
    });
  });

  describe('Combined Options Format', () => {
    test('should generate single combined option statement', () => {
      const operations = [
        {
          name: 'GetEmployee',
          content: `
            query GetEmployee($id: Int!) @openapi(
              operationId: "getEmployee"
              summary: "Get employee"
              description: "Retrieves employee by ID"
              tags: ["employees"]
              deprecated: true
            ) {
              employee(id: $id) {
                id
                name
              }
            }
          `,
        },
      ];

      const visitor = new OperationToProtoVisitor(SDL, operations, {
        serviceName: 'EmployeeService',
        packageName: 'employee.v1',
      });

      const protoText = visitor.visit();
      expectValidProto(protoText);

      // Should have single option statement with all fields
      const optionMatch = protoText.match(/option \(gnostic\.openapi\.v3\.operation\) = \{[^}]+\}/s);
      expect(optionMatch).toBeTruthy();

      const optionContent = optionMatch![0];
      expect(optionContent).toContain('operation_id: "getEmployee"');
      expect(optionContent).toContain('summary: "Get employee"');
      expect(optionContent).toContain('description: "Retrieves employee by ID"');
      expect(optionContent).toContain('tags: ["employees"]');
      expect(optionContent).toContain('deprecated: true');
    });

    test('should not have multiple separate option statements', () => {
      const operations = [
        {
          name: 'GetEmployee',
          content: `
            query GetEmployee($id: Int!) @openapi(
              operationId: "getEmployee"
              summary: "Get employee"
              description: "Retrieves employee"
            ) {
              employee(id: $id) {
                id
              }
            }
          `,
        },
      ];

      const visitor = new OperationToProtoVisitor(SDL, operations, {
        serviceName: 'EmployeeService',
        packageName: 'employee.v1',
      });

      const protoText = visitor.visit();
      expectValidProto(protoText);

      // Count occurrences of option statements for this operation
      const optionMatches = protoText.match(/option \(gnostic\.openapi\.v3\.operation\)/g);
      expect(optionMatches?.length).toBe(1);
    });
  });

  describe('Edge Cases', () => {
    test('should filter out empty strings in metadata', () => {
      const operations = [
        {
          name: 'GetEmployee',
          content: `
            query GetEmployee($id: Int!) @openapi(
              operationId: "getEmployee"
              summary: ""
              description: ""
            ) {
              employee(id: $id) {
                id
              }
            }
          `,
        },
      ];

      const visitor = new OperationToProtoVisitor(SDL, operations, {
        serviceName: 'EmployeeService',
        packageName: 'employee.v1',
      });

      const protoText = visitor.visit();
      expectValidProto(protoText);

      // Empty strings should be filtered out, only operationId should remain
      expect(protoText).toContain('operation_id: "getEmployee"');
      expect(protoText).not.toContain('summary: ""');
      expect(protoText).not.toContain('description: ""');
    });

    test('should handle very long descriptions', () => {
      const longDescription = 'A'.repeat(1000);
      const operations = [
        {
          name: 'GetEmployee',
          content: `
            query GetEmployee($id: Int!) @openapi(
              description: "${longDescription}"
            ) {
              employee(id: $id) {
                id
              }
            }
          `,
        },
      ];

      const visitor = new OperationToProtoVisitor(SDL, operations, {
        serviceName: 'EmployeeService',
        packageName: 'employee.v1',
      });

      const protoText = visitor.visit();
      expectValidProto(protoText);

      expect(protoText).toContain(`description: "${longDescription}"`);
    });

    test('should handle operation with no variables but with OpenAPI metadata', () => {
      const operations = [
        {
          name: 'ListEmployees',
          content: `
            query ListEmployees @openapi(
              operationId: "listAllEmployees"
              summary: "List all employees"
            ) {
              employees {
                id
                name
              }
            }
          `,
        },
      ];

      const visitor = new OperationToProtoVisitor(SDL, operations, {
        serviceName: 'EmployeeService',
        packageName: 'employee.v1',
      });

      const protoText = visitor.visit();
      expectValidProto(protoText);

      expect(protoText).toContain('operation_id: "listAllEmployees"');
      expect(protoText).toContain('summary: "List all employees"');
      expect(protoText).toContain('message ListEmployeesRequest {}');
    });
  });

  describe('Gnostic Import Management', () => {
    test('should only include gnostic import when at least one operation has @openapi', () => {
      const operations = [
        {
          name: 'GetEmployee',
          content: `
            query GetEmployee($id: Int!) @openapi(
              operationId: "getEmployee"
            ) {
              employee(id: $id) {
                id
              }
            }
          `,
        },
        {
          name: 'ListEmployees',
          content: `
            query ListEmployees {
              employees {
                id
              }
            }
          `,
        },
      ];

      const visitor = new OperationToProtoVisitor(SDL, operations, {
        serviceName: 'EmployeeService',
        packageName: 'employee.v1',
      });

      const protoText = visitor.visit();
      expectValidProto(protoText);

      // Should include gnostic import only once
      const importMatches = protoText.match(/import "gnostic\/openapi\/v3\/annotations\.proto";/g);
      expect(importMatches?.length).toBe(1);
    });

    test('should not include gnostic import when no operations have @openapi', () => {
      const operations = [
        {
          name: 'GetEmployee',
          content: `
            query GetEmployee($id: Int!) {
              employee(id: $id) {
                id
              }
            }
          `,
        },
        {
          name: 'ListEmployees',
          content: `
            query ListEmployees {
              employees {
                id
              }
            }
          `,
        },
      ];

      const visitor = new OperationToProtoVisitor(SDL, operations, {
        serviceName: 'EmployeeService',
        packageName: 'employee.v1',
      });

      const protoText = visitor.visit();
      expectValidProto(protoText);

      expect(protoText).not.toContain('gnostic');
    });
  });
});