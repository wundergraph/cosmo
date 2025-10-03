import { describe, expect, test } from 'vitest';
import { OperationToProtoVisitor } from '../../src/operations-to-proto-visitor';
import { expectValidProto, loadProtoFromText, getServiceMethods } from '../util';

describe('Operations to Proto - Basic Operations', () => {
  const schema = `
    type Query {
      employee(id: Int!): Employee
      employees: [Employee]
      products: [Products!]!
    }

    type Mutation {
      updateEmployeeTag(id: Int!, tag: String!): Employee
      updateAvailability(employeeID: Int!, isAvailable: Boolean!): Employee!
    }

    type Employee {
      id: Int!
      tag: String!
      isAvailable: Boolean!
    }

    union Products = Consultancy | SDK

    type Consultancy {
      upc: ID!
      lead: Employee!
    }

    type SDK {
      upc: ID!
      owner: Employee!
    }
  `;

  test('should convert simple query operation correctly', () => {
    const operations = [
      {
        name: 'GetEmployee',
        content: `
          query GetEmployee($id: Int!) {
            employee(id: $id) {
              id
              tag
              isAvailable
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

    // Check that all required components are present
    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package employee.v1;

      // Service definition for EmployeeService
      service EmployeeService {
        rpc GetEmployee(GetEmployeeRequest) returns (GetEmployeeResponse) {}
      }

      // Request message for GetEmployee operation.
      message GetEmployeeRequest {
        int32 id = 1;
      }

      // Response message for GetEmployee operation.
      message GetEmployeeResponse {
        GetEmployeeEmployee employee = 1;
      }

      message GetEmployeeEmployee {
        int32 id = 1;
        string tag = 2;
        bool is_available = 3;
      }"
    `);
  });

  test('should convert simple mutation operation correctly', () => {
    const operations = [
      {
        name: 'UpdateEmployeeTag',
        content: `
          mutation UpdateEmployeeTag($id: Int!, $tag: String!) {
            updateEmployeeTag(id: $id, tag: $tag) {
              id
              tag
              isAvailable
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

    // Check that all required components are present
    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package employee.v1;

      // Service definition for EmployeeService
      service EmployeeService {
        rpc UpdateEmployeeTag(UpdateEmployeeTagRequest) returns (UpdateEmployeeTagResponse) {}
      }

      // Request message for UpdateEmployeeTag operation.
      message UpdateEmployeeTagRequest {
        int32 id = 1;
        string tag = 2;
      }

      // Response message for UpdateEmployeeTag operation.
      message UpdateEmployeeTagResponse {
        UpdateEmployeeTagUpdateEmployeeTag update_employee_tag = 1;
      }

      message UpdateEmployeeTagUpdateEmployeeTag {
        int32 id = 1;
        string tag = 2;
        bool is_available = 3;
      }"
    `);
  });

  test('should convert query operation without variables', () => {
    const operations = [
      {
        name: 'GetAllEmployees',
        content: `
          query GetAllEmployees {
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

    // Check that all required components are present
    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package employee.v1;

      // Service definition for EmployeeService
      service EmployeeService {
        rpc GetAllEmployees(GetAllEmployeesRequest) returns (GetAllEmployeesResponse) {}
      }

      // Request message for GetAllEmployees operation.
      message GetAllEmployeesRequest {}

      // Response message for GetAllEmployees operation.
      message GetAllEmployeesResponse {
        repeated GetAllEmployeesEmployees employees = 1;
      }

      message GetAllEmployeesEmployees {
        int32 id = 1;
        string tag = 2;
      }"
    `);
  });

  test('should handle multiple operations in single visitor', () => {
    const operations = [
      {
        name: 'GetEmployee',
        content: `
          query GetEmployee($id: Int!) {
            employee(id: $id) {
              id
              tag
            }
          }
        `
      },
      {
        name: 'UpdateTag',
        content: `
          mutation UpdateTag($id: Int!, $tag: String!) {
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

    // Parse the proto to verify service methods
    const root = loadProtoFromText(protoText);
    const methods = getServiceMethods(root, 'EmployeeService');

    // Verify both operations are present
    expect(methods).toContain('GetEmployee');
    expect(methods).toContain('UpdateTag');

    // Check that both request and response messages are generated
    expect(protoText).toContain('message GetEmployeeRequest');
    expect(protoText).toContain('message GetEmployeeResponse');
    expect(protoText).toContain('message UpdateTagRequest');
    expect(protoText).toContain('message UpdateTagResponse');
  });

  test('should respect custom service and package names', () => {
    const operations = [
      {
        name: 'GetEmployee',
        content: `
          query GetEmployee($id: Int!) {
            employee(id: $id) {
              id
            }
          }
        `
      }
    ];

    const visitor = new OperationToProtoVisitor(schema, operations, {
      serviceName: 'CustomEmployeeService',
      packageName: 'custom.employee.v2',
      goPackage: 'github.com/example/employee;employee'
    });

    const protoText = visitor.visit();

    // Validate Proto definition
    expectValidProto(protoText);

    // Check custom options are applied
    expect(protoText).toContain('package custom.employee.v2;');
    expect(protoText).toContain('option go_package = "github.com/example/employee;employee";');
    expect(protoText).toContain('service CustomEmployeeService {');
  });

  test('should handle operations with list return types', () => {
    const simpleListSchema = `
      type Query {
        employees: [Employee]
      }
      
      type Employee {
        id: Int!
        tag: String!
      }
    `;

    const operations = [
      {
        name: 'GetEmployees',
        content: `
          query GetEmployees {
            employees {
              id
              tag
            }
          }
        `
      }
    ];

    const visitor = new OperationToProtoVisitor(simpleListSchema, operations, {
      serviceName: 'EmployeeService',
      packageName: 'employee.v1'
    });

    const protoText = visitor.visit();

    // Validate Proto definition
    expectValidProto(protoText);

    // Should contain repeated field for list return type
    expect(protoText).toContain('repeated GetEmployeesEmployees employees = 1;');
  });

  test('should handle nullable vs non-nullable fields correctly', () => {
    const schemaWithNullability = `
      type Query {
        employee(id: Int!): Employee
      }

      type Employee {
        id: Int!
        tag: String!
        optionalField: String
        requiredField: String!
      }
    `;

    const operations = [
      {
        name: 'GetEmployeeWithNullability',
        content: `
          query GetEmployeeWithNullability($id: Int!) {
            employee(id: $id) {
              id
              tag
              optionalField
              requiredField
            }
          }
        `
      }
    ];

    const visitor = new OperationToProtoVisitor(schemaWithNullability, operations, {
      serviceName: 'EmployeeService',
      packageName: 'employee.v1'
    });

    const protoText = visitor.visit();

    // Validate Proto definition
    expectValidProto(protoText);

    // Should use wrapper types for nullable fields
    expect(protoText).toContain('import "google/protobuf/wrappers.proto";');
    expect(protoText).toContain('google.protobuf.StringValue optional_field');
    expect(protoText).toContain('string required_field');
  });

  test('should add idempotency option to query operations when enabled', () => {
    const operations = [
      {
        name: 'GetEmployee',
        content: `
          query GetEmployee($id: Int!) {
            employee(id: $id) {
              id
              tag
            }
          }
        `
      },
      {
        name: 'UpdateEmployee',
        content: `
          mutation UpdateEmployee($id: Int!, $tag: String!) {
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
      packageName: 'employee.v1',
      markQueriesIdempotent: true
    });

    const protoText = visitor.visit();

    // Validate Proto definition
    expectValidProto(protoText);

    // Query should have idempotency option when enabled
    expect(protoText).toContain('rpc GetEmployee(GetEmployeeRequest) returns (GetEmployeeResponse) {\n    option idempotency_level = NO_SIDE_EFFECTS;\n  }');
    
    // Mutation should NOT have idempotency option
    expect(protoText).toContain('rpc UpdateEmployee(UpdateEmployeeRequest) returns (UpdateEmployeeResponse) {}');
    
    // Verify the idempotency option is not applied to mutations
    expect(protoText).not.toContain('UpdateEmployee(UpdateEmployeeRequest) returns (UpdateEmployeeResponse) {\n    option idempotency_level = NO_SIDE_EFFECTS;');
  });

  test('should not add idempotency option to query operations when disabled', () => {
    const operations = [
      {
        name: 'GetEmployee',
        content: `
          query GetEmployee($id: Int!) {
            employee(id: $id) {
              id
              tag
            }
          }
        `
      }
    ];

    const visitor = new OperationToProtoVisitor(schema, operations, {
      serviceName: 'EmployeeService',
      packageName: 'employee.v1',
      markQueriesIdempotent: false
    });

    const protoText = visitor.visit();

    // Validate Proto definition
    expectValidProto(protoText);

    // Query should NOT have idempotency option when disabled
    expect(protoText).toContain('rpc GetEmployee(GetEmployeeRequest) returns (GetEmployeeResponse) {}');
    expect(protoText).not.toContain('option idempotency_level = NO_SIDE_EFFECTS;');
  });

  test('should not add idempotency option to query operations by default', () => {
    const operations = [
      {
        name: 'GetEmployee',
        content: `
          query GetEmployee($id: Int!) {
            employee(id: $id) {
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

    // Query should NOT have idempotency option by default
    expect(protoText).toContain('rpc GetEmployee(GetEmployeeRequest) returns (GetEmployeeResponse) {}');
    expect(protoText).not.toContain('option idempotency_level = NO_SIDE_EFFECTS;');
  });
});