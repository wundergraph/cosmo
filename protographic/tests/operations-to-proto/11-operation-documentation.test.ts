import { describe, expect, test } from 'vitest';
import { OperationToProtoVisitor } from '../../src/operations-to-proto-visitor';
import { expectValidProto } from '../util';

const SDL = `
  type Query {
    """
    Retrieves a single employee by their unique identifier.
    Returns null if no employee is found with the given ID.
    """
    employee(id: Int!): Employee
    
    """
    Retrieves all employees in the system.
    This operation may return a large dataset and should be used with caution.
    """
    employees: [Employee]
    
    """
    Searches for employees based on various criteria.
    Supports filtering by department, skills, and availability.
    """
    findEmployees(criteria: SearchInput): [Employee!]!
  }

  type Mutation {
    """
    Updates an employee's tag information.
    This operation requires admin privileges.
    
    @param id - The unique identifier of the employee
    @param tag - The new tag value to assign
    @returns The updated employee record
    """
    updateEmployeeTag(id: Int!, tag: String!): Employee
    
    """
    Creates a new employee record in the system.
    All required fields must be provided.
    
    Validation rules:
    - Email must be unique
    - Department must be valid
    - Start date cannot be in the future
    """
    createEmployee(input: CreateEmployeeInput!): Employee!
  }

  """
  Represents an employee in the organization.
  Contains personal details, role information, and system metadata.
  """
  type Employee {
    """Unique identifier for the employee"""
    id: Int!
    
    """Display tag or badge identifier"""
    tag: String!
    
    """Employee's role and department information"""
    role: RoleType!
    
    """Personal and contact details"""
    details: Details
    
    """Optional notes about the employee"""
    notes: String
    
    """Timestamp of last update"""
    updatedAt: String!
    
    """Employee's start date with the company"""
    startDate: String!
    
    """Current availability status"""
    isAvailable: Boolean!
  }

  """
  Personal and contact information for an employee.
  All fields are optional except for the employee's name.
  """
  type Details {
    """Employee's first name"""
    forename: String!
    
    """Employee's last name"""
    surname: String!
    
    """Primary email address"""
    email: String
    
    """Phone number (optional)"""
    phone: String
    
    """Whether the employee has children"""
    hasChildren: Boolean!
    
    """Marital status"""
    maritalStatus: MaritalStatus
  }

  """
  Interface for role types within the organization.
  """
  interface RoleType {
    """Departments this role belongs to"""
    departments: [Department!]!
    
    """Job titles associated with this role"""
    title: [String!]!
  }

  """
  Engineering role type.
  """
  type Engineer implements RoleType {
    departments: [Department!]!
    title: [String!]!
    
    """Type of engineering specialization"""
    engineerType: EngineerType!
  }

  """
  Marketing role type.
  """
  type Marketer implements RoleType {
    departments: [Department!]!
    title: [String!]!
  }

  """
  Employee departments within the organization.
  """
  enum Department {
    """Software engineering and development"""
    ENGINEERING
    
    """Marketing and communications"""
    MARKETING
    
    """Operations and administration"""
    OPERATIONS
  }

  """
  Marital status options.
  """
  enum MaritalStatus {
    """Currently married"""
    MARRIED
    
    """Engaged to be married"""
    ENGAGED
    
    """Single/unmarried"""
    SINGLE
  }

  """
  Engineering specialization types.
  """
  enum EngineerType {
    """Backend systems and APIs"""
    BACKEND
    
    """Frontend user interfaces"""
    FRONTEND
    
    """Full-stack development"""
    FULLSTACK
  }

  """
  Input for creating a new employee.
  """
  input CreateEmployeeInput {
    """Employee's display tag"""
    tag: String!
    
    """Personal details"""
    details: DetailsInput!
    
    """Start date (YYYY-MM-DD format)"""
    startDate: String!
    
    """Optional notes"""
    notes: String
  }

  """
  Input for employee personal details.
  """
  input DetailsInput {
    """First name"""
    forename: String!
    
    """Last name"""
    surname: String!
    
    """Email address"""
    email: String
    
    """Phone number"""
    phone: String
    
    """Whether employee has children"""
    hasChildren: Boolean!
    
    """Marital status"""
    maritalStatus: MaritalStatus
  }

  """
  Search criteria for finding employees.
  """
  input SearchInput {
    """Filter by department"""
    department: Department
    
    """Filter by availability status"""
    isAvailable: Boolean
    
    """Text search in name or tag"""
    searchText: String
  }
`;

describe('Operations to Proto - Documentation Preservation', () => {
  describe('Query Documentation', () => {
    test.skip('should preserve GraphQL field documentation in proto comments', () => {
      const operation = {
        name: 'GetEmployeeWithDocs',
        content: `
          query GetEmployeeWithDocs($id: Int!) {
            employee(id: $id) {
              id
              tag
              details {
                forename
                surname
                email
              }
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should preserve field documentation as proto comments
      expect(proto).toContain('// Unique identifier for the employee');
      expect(proto).toContain('// Display tag or badge identifier');
      expect(proto).toContain('// Employee\'s first name');
      expect(proto).toContain('// Employee\'s last name');
      expect(proto).toContain('// Primary email address');
    });

    test.skip('should preserve operation documentation in service method comments', () => {
      const operation = {
        name: 'GetAllEmployees',
        content: `
          query GetAllEmployees {
            employees {
              id
              tag
              isAvailable
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should preserve operation documentation
      expect(proto).toContain('// Retrieves all employees in the system.');
      expect(proto).toContain('// This operation may return a large dataset and should be used with caution.');
      expect(proto).toContain('rpc GetAllEmployees(GetAllEmployeesRequest) returns (GetAllEmployeesResponse) {}');
    });

    test.skip('should preserve complex documentation with multiple paragraphs', () => {
      const operation = {
        name: 'FindEmployees',
        content: `
          query FindEmployees($criteria: SearchInput) {
            findEmployees(criteria: $criteria) {
              id
              tag
              role {
                departments
                title
              }
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should preserve multi-line documentation
      expect(proto).toContain('// Searches for employees based on various criteria.');
      expect(proto).toContain('// Supports filtering by department, skills, and availability.');
    });
  });

  describe('Mutation Documentation', () => {
    test.skip('should preserve mutation documentation with parameter descriptions', () => {
      const operation = {
        name: 'UpdateEmployeeTag',
        content: `
          mutation UpdateEmployeeTag($id: Int!, $tag: String!) {
            updateEmployeeTag(id: $id, tag: $tag) {
              id
              tag
              updatedAt
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should preserve detailed mutation documentation
      expect(proto).toContain('// Updates an employee\'s tag information.');
      expect(proto).toContain('// This operation requires admin privileges.');
      expect(proto).toContain('// @param id - The unique identifier of the employee');
      expect(proto).toContain('// @param tag - The new tag value to assign');
      expect(proto).toContain('// @returns The updated employee record');
    });

    test.skip('should preserve complex mutation documentation with validation rules', () => {
      const operation = {
        name: 'CreateEmployee',
        content: `
          mutation CreateEmployee($input: CreateEmployeeInput!) {
            createEmployee(input: $input) {
              id
              tag
              details {
                forename
                surname
                email
              }
              startDate
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should preserve validation rules and complex documentation
      expect(proto).toContain('// Creates a new employee record in the system.');
      expect(proto).toContain('// All required fields must be provided.');
      expect(proto).toContain('// Validation rules:');
      expect(proto).toContain('// - Email must be unique');
      expect(proto).toContain('// - Department must be valid');
      expect(proto).toContain('// - Start date cannot be in the future');
    });
  });

  describe('Type Documentation', () => {
    test.skip('should preserve type-level documentation in message comments', () => {
      const operation = {
        name: 'GetEmployeeInfo',
        content: `
          query GetEmployeeInfo($id: Int!) {
            employee(id: $id) {
              id
              tag
              details {
                forename
                surname
                hasChildren
                maritalStatus
              }
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should preserve type documentation
      expect(proto).toContain('// Represents an employee in the organization.');
      expect(proto).toContain('// Contains personal details, role information, and system metadata.');
      expect(proto).toContain('// Personal and contact information for an employee.');
      expect(proto).toContain('// All fields are optional except for the employee\'s name.');
    });

    test.skip('should preserve enum documentation and value descriptions', () => {
      const operation = {
        name: 'GetEmployeesByDepartment',
        content: `
          query GetEmployeesByDepartment($dept: Department!) {
            findEmployees(criteria: { department: $dept }) {
              id
              tag
              role {
                departments
              }
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should preserve enum documentation
      expect(proto).toContain('// Employee departments within the organization.');
      expect(proto).toContain('enum Department {');
      expect(proto).toContain('// Software engineering and development');
      expect(proto).toContain('DEPARTMENT_ENGINEERING = 1;');
      expect(proto).toContain('// Marketing and communications');
      expect(proto).toContain('DEPARTMENT_MARKETING = 2;');
      expect(proto).toContain('// Operations and administration');
      expect(proto).toContain('DEPARTMENT_OPERATIONS = 3;');
    });
  });

  describe('Input Type Documentation', () => {
    test.skip('should preserve input type documentation in proto messages', () => {
      const operation = {
        name: 'CreateEmployeeWithDetails',
        content: `
          mutation CreateEmployeeWithDetails($input: CreateEmployeeInput!) {
            createEmployee(input: $input) {
              id
              tag
              details {
                forename
                surname
                email
                hasChildren
                maritalStatus
              }
              startDate
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should preserve input type documentation
      expect(proto).toContain('// Input for creating a new employee.');
      expect(proto).toContain('message CreateEmployeeInput {');
      expect(proto).toContain('// Employee\'s display tag');
      expect(proto).toContain('// Personal details');
      expect(proto).toContain('// Start date (YYYY-MM-DD format)');
      expect(proto).toContain('// Optional notes');

      // Should preserve nested input documentation
      expect(proto).toContain('// Input for employee personal details.');
      expect(proto).toContain('message DetailsInput {');
      expect(proto).toContain('// First name');
      expect(proto).toContain('// Last name');
      expect(proto).toContain('// Whether employee has children');
    });
  });

  describe('Documentation Formatting and Edge Cases', () => {
    test.skip('should handle documentation with special characters', () => {
      const sdlWithSpecialChars = `
        type Query {
          """
          Special test: "quotes", 'apostrophes', & ampersands, <tags>, and @mentions.
          Also handles: newlines, tabs	, and unicode: 🚀 ✨ 💻
          """
          specialTest: String
        }
      `;

      const operation = {
        name: 'SpecialCharsTest',
        content: `
          query SpecialCharsTest {
            specialTest
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(sdlWithSpecialChars, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should properly escape special characters in comments
      expect(proto).toContain('// Special test: "quotes", \'apostrophes\', & ampersands, <tags>, and @mentions.');
      expect(proto).toContain('// Also handles: newlines, tabs	, and unicode: 🚀 ✨ 💻');
    });

    test.skip('should handle empty or missing documentation gracefully', () => {
      const sdlWithoutDocs = `
        type Query {
          undocumentedField: String
          employee(id: Int!): Employee
        }
        
        type Employee {
          id: Int!
          name: String
        }
      `;

      const operation = {
        name: 'UndocumentedTest',
        content: `
          query UndocumentedTest {
            undocumentedField
            employee(id: 1) {
              id
              name
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(sdlWithoutDocs, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should generate valid proto without documentation comments
      expect(proto).toContain('rpc UndocumentedTest(UndocumentedTestRequest) returns (UndocumentedTestResponse) {}');
      expect(proto).toContain('string undocumented_field = 1;');
      expect(proto).toContain('int32 id = 1;');
      expect(proto).toContain('string name = 2;');
    });

    test.skip('should preserve documentation order and structure', () => {
      const operation = {
        name: 'DocumentationOrderTest',
        content: `
          query DocumentationOrderTest($id: Int!) {
            employee(id: $id) {
              id
              tag
              details {
                forename
                surname
                email
                phone
              }
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should maintain documentation structure and field order
      const lines = proto.split('\n');
      const idCommentIndex = lines.findIndex(line => line.includes('// Unique identifier for the employee'));
      const idFieldIndex = lines.findIndex(line => line.includes('int32 id = 1;'));
      const tagCommentIndex = lines.findIndex(line => line.includes('// Display tag or badge identifier'));
      const tagFieldIndex = lines.findIndex(line => line.includes('string tag = 2;'));

      expect(idCommentIndex).toBeLessThan(idFieldIndex);
      expect(tagCommentIndex).toBeLessThan(tagFieldIndex);
      expect(idFieldIndex).toBeLessThan(tagFieldIndex);
    });
  });

  describe('Documentation Integration with Proto Features', () => {
    test.skip('should preserve documentation when using wrapper types', () => {
      const operation = {
        name: 'WrapperTypesWithDocs',
        content: `
          query WrapperTypesWithDocs {
            employee(id: 1) {
              details {
                email
                phone
                maritalStatus
              }
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should preserve documentation even with wrapper types
      expect(proto).toContain('// Primary email address');
      expect(proto).toContain('google.protobuf.StringValue email = 1;');
      expect(proto).toContain('// Phone number (optional)');
      expect(proto).toContain('google.protobuf.StringValue phone = 2;');
      expect(proto).toContain('// Marital status');
      expect(proto).toContain('MaritalStatus marital_status = 3;');
    });

    test.skip('should preserve documentation with repeated fields', () => {
      const operation = {
        name: 'RepeatedFieldsWithDocs',
        content: `
          query RepeatedFieldsWithDocs($id: Int!) {
            employee(id: $id) {
              role {
                departments
                title
              }
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should preserve documentation for repeated fields
      expect(proto).toContain('// Departments this role belongs to');
      expect(proto).toContain('repeated Department departments = 1;');
      expect(proto).toContain('// Job titles associated with this role');
      expect(proto).toContain('repeated string title = 2;');
    });
  });
});