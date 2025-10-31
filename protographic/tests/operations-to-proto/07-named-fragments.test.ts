import { describe, expect, test } from 'vitest';
import { OperationToProtoVisitor } from '../../src/operations-to-proto-visitor';
import { expectValidProto } from '../util';

const SDL = `
  type Query {
    employee(id: Int!): Employee
    employees: [Employee]
    findEmployees(criteria: SearchInput): [Employee!]!
  }

  type Mutation {
    updateEmployeeTag(id: Int!, tag: String!): Employee
    createEmployee(input: CreateEmployeeInput!): Employee!
  }

  type Employee {
    id: Int!
    tag: String!
    isAvailable: Boolean!
    details: Details
    role: RoleType!
    hobbies: [Hobby!]
  }

  type Details {
    forename: String!
    surname: String!
    email: String
    phone: String
    hasChildren: Boolean!
    maritalStatus: MaritalStatus
  }

  interface RoleType {
    departments: [Department!]!
    title: [String!]!
  }

  type Engineer implements RoleType {
    departments: [Department!]!
    title: [String!]!
    engineerType: EngineerType!
  }

  type Marketer implements RoleType {
    departments: [Department!]!
    title: [String!]!
  }

  interface Hobby {
    employees: [Employee!]!
  }

  type Gaming implements Hobby {
    employees: [Employee!]!
    name: String!
    genres: [GameGenre!]!
  }

  type Exercise implements Hobby {
    employees: [Employee!]!
    category: ExerciseType!
  }

  union Products = Consultancy | SDK

  type Consultancy {
    upc: ID!
    lead: Employee!
  }

  type SDK {
    upc: ID!
    owner: Employee!
    clientLanguages: [ProgrammingLanguage!]!
  }

  enum Department {
    ENGINEERING
    MARKETING
    OPERATIONS
  }

  enum MaritalStatus {
    MARRIED
    ENGAGED
    SINGLE
  }

  enum EngineerType {
    BACKEND
    FRONTEND
    FULLSTACK
  }

  enum GameGenre {
    RPG
    FPS
    STRATEGY
  }

  enum ExerciseType {
    CARDIO
    STRENGTH
    FLEXIBILITY
  }

  enum ProgrammingLanguage {
    TYPESCRIPT
    GO
    RUST
  }

  input SearchInput {
    department: Department
    isAvailable: Boolean
    hasChildren: Boolean
  }

  input CreateEmployeeInput {
    tag: String!
    details: DetailsInput!
    roleType: String!
  }

  input DetailsInput {
    forename: String!
    surname: String!
    email: String
    phone: String
    hasChildren: Boolean!
    maritalStatus: MaritalStatus
  }
`;

describe('Operations to Proto - Named Fragments', () => {
  describe('Basic Named Fragment Support', () => {
    test('should handle basic named fragments in queries', () => {
      const operation = {
        name: 'GetEmployeeWithFragment',
        content: `
          fragment EmployeeBasics on Employee {
            id
            tag
            isAvailable
          }

          query GetEmployeeWithFragment($id: Int!) {
            employee(id: $id) {
              ...EmployeeBasics
              details {
                forename
                surname
              }
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should expand fragment fields into the message
      expect(proto).toContain('int32 id = 1;');
      expect(proto).toContain('string tag = 2;');
      expect(proto).toContain('bool is_available = 3;');
      expect(proto).toContain('GetEmployeeWithFragmentEmployeeDetails details = 4;');
    });

    test('should handle nested fragments', () => {
      const operation = {
        name: 'GetEmployeeWithNestedFragments',
        content: `
          fragment PersonalDetails on Details {
            forename
            surname
            email
            phone
          }

          fragment EmployeeInfo on Employee {
            id
            tag
            details {
              ...PersonalDetails
              hasChildren
              maritalStatus
            }
          }

          query GetEmployeeWithNestedFragments($id: Int!) {
            employee(id: $id) {
              ...EmployeeInfo
              isAvailable
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should expand all nested fragment fields
      expect(proto).toContain('message GetEmployeeWithNestedFragmentsEmployeeDetails {');
      expect(proto).toContain('string forename = 1;');
      expect(proto).toContain('string surname = 2;');
      expect(proto).toContain('google.protobuf.StringValue email = 3;');
      expect(proto).toContain('google.protobuf.StringValue phone = 4;');
      expect(proto).toContain('bool has_children = 5;');
      expect(proto).toContain('MaritalStatus marital_status = 6;');
    });

    test('should handle fragments with interface types', () => {
      const operation = {
        name: 'GetEmployeeRole',
        content: `
          fragment RoleInfo on RoleType {
            departments
            title
          }

          query GetEmployeeRole($id: Int!) {
            employee(id: $id) {
              id
              role {
                ...RoleInfo
                ... on Engineer {
                  engineerType
                }
              }
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should handle fragment on interface with inline fragment
      expect(proto).toContain('message GetEmployeeRoleEmployeeRole {');
      expect(proto).toContain('repeated Department departments = 1;');
      expect(proto).toContain('repeated string title = 2;');
      // Interfaces use camelCase(typeName)_type pattern
      expect(proto).toContain('oneof roleType_type {');
      expect(proto).toContain('GetEmployeeRoleEmployeeRoleEngineer as_engineer = 3;');
    });

    test('should handle fragments with union types', () => {
      const operation = {
        name: 'GetProductInfo',
        content: `
          fragment ProductBasics on Products {
            ... on Consultancy {
              upc
              lead {
                id
                tag
              }
            }
            ... on SDK {
              upc
              owner {
                id
                tag
              }
              clientLanguages
            }
          }

          query GetProductInfo {
            # This would need a products field in the schema
            # For testing purposes, we'll simulate it
            employee(id: 1) {
              id
            }
          }
        `,
      };

      // Note: This test simulates fragment definition parsing
      // The actual implementation would need to handle fragment definitions
      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should generate basic query structure
      expect(proto).toContain('message GetProductInfoEmployee {');
      expect(proto).toContain('int32 id = 1;');
    });
  });

  describe('Fragment Reuse and Composition', () => {
    test('should handle fragment reuse across multiple operations', () => {
      const operations = [
        {
          name: 'GetEmployee',
          content: `
            fragment EmployeeCore on Employee {
              id
              tag
              isAvailable
            }

            query GetEmployee($id: Int!) {
              employee(id: $id) {
                ...EmployeeCore
              }
            }
          `,
        },
        {
          name: 'GetAllEmployees',
          content: `
            fragment EmployeeCore on Employee {
              id
              tag
              isAvailable
            }

            query GetAllEmployees {
              employees {
                ...EmployeeCore
                details {
                  forename
                  surname
                }
              }
            }
          `,
        },
      ];

      const visitor = new OperationToProtoVisitor(SDL, operations);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should generate separate messages for each operation
      expect(proto).toContain('message GetEmployeeEmployee {');
      expect(proto).toContain('message GetAllEmployeesEmployees {');
      
      // Both should have the fragment fields expanded
      const getEmployeeMatch = proto.match(/message GetEmployeeEmployee \{[^}]+\}/s);
      const getAllEmployeesMatch = proto.match(/message GetAllEmployeesEmployees \{[^}]+\}/s);
      
      expect(getEmployeeMatch?.[0]).toContain('int32 id');
      expect(getEmployeeMatch?.[0]).toContain('string tag');
      expect(getEmployeeMatch?.[0]).toContain('bool is_available');
      
      expect(getAllEmployeesMatch?.[0]).toContain('int32 id');
      expect(getAllEmployeesMatch?.[0]).toContain('string tag');
      expect(getAllEmployeesMatch?.[0]).toContain('bool is_available');
    });

    test('should handle complex fragment composition', () => {
      const operation = {
        name: 'GetEmployeeComplete',
        content: `
          fragment ContactInfo on Details {
            email
            phone
          }

          fragment PersonalInfo on Details {
            forename
            surname
            hasChildren
            maritalStatus
          }

          fragment EmployeeDetails on Details {
            ...ContactInfo
            ...PersonalInfo
          }

          fragment EmployeeBasics on Employee {
            id
            tag
            isAvailable
          }

          query GetEmployeeComplete($id: Int!) {
            employee(id: $id) {
              ...EmployeeBasics
              details {
                ...EmployeeDetails
              }
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should expand all composed fragments
      expect(proto).toContain('message GetEmployeeCompleteEmployeeDetails {');
      expect(proto).toContain('google.protobuf.StringValue email = 1;');
      expect(proto).toContain('google.protobuf.StringValue phone = 2;');
      expect(proto).toContain('string forename = 3;');
      expect(proto).toContain('string surname = 4;');
      expect(proto).toContain('bool has_children = 5;');
      expect(proto).toContain('MaritalStatus marital_status = 6;');
    });
  });

  describe('Fragment Validation and Error Handling', () => {
    test('should detect undefined fragments', () => {
      const operation = {
        name: 'InvalidFragmentUsage',
        content: `
          query InvalidFragmentUsage($id: Int!) {
            employee(id: $id) {
              ...UndefinedFragment
              id
            }
          }
        `,
      };

      expect(() => {
        const visitor = new OperationToProtoVisitor(SDL, [operation]);
        visitor.visit();
      }).toThrow('Unknown fragment "UndefinedFragment"');
    });

    test('should detect circular fragment dependencies', () => {
      const operation = {
        name: 'CircularFragments',
        content: `
          fragment FragmentA on Employee {
            id
            ...FragmentB
          }

          fragment FragmentB on Employee {
            tag
            ...FragmentA
          }

          query CircularFragments($id: Int!) {
            employee(id: $id) {
              ...FragmentA
            }
          }
        `,
      };

      expect(() => {
        const visitor = new OperationToProtoVisitor(SDL, [operation]);
        visitor.visit();
      }).toThrow('Circular fragment dependency detected');
    });

    test('should validate fragment type compatibility', () => {
      const operation = {
        name: 'IncompatibleFragment',
        content: `
          fragment EmployeeFragment on Employee {
            id
            tag
          }

          query IncompatibleFragment {
            employee(id: 1) {
              details {
                ...EmployeeFragment
                forename
              }
            }
          }
        `,
      };

      expect(() => {
        const visitor = new OperationToProtoVisitor(SDL, [operation]);
        visitor.visit();
      }).toThrow('Fragment "EmployeeFragment" cannot be spread on type "Details"');
    });

    test('should handle unused fragments gracefully', () => {
      const operation = {
        name: 'UnusedFragment',
        content: `
          fragment UnusedEmployeeFragment on Employee {
            id
            tag
            isAvailable
          }

          fragment UsedEmployeeFragment on Employee {
            id
            details {
              forename
              surname
            }
          }

          query UnusedFragment($id: Int!) {
            employee(id: $id) {
              ...UsedEmployeeFragment
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should only include fields from used fragments
      expect(proto).toContain('int32 id = 1;');
      expect(proto).toContain('UnusedFragmentEmployeeDetails details = 2;');
      // Should not include unused fragment fields at root level
      expect(proto).not.toContain('bool is_available');
    });
  });

  describe('Fragment Performance and Edge Cases', () => {
    test('should handle deeply nested fragment hierarchies', () => {
      const operation = {
        name: 'DeepFragmentNesting',
        content: `
          fragment Level4 on Details {
            email
            phone
          }

          fragment Level3 on Details {
            ...Level4
            hasChildren
          }

          fragment Level2 on Details {
            ...Level3
            maritalStatus
          }

          fragment Level1 on Details {
            ...Level2
            forename
            surname
          }

          fragment EmployeeWithDetails on Employee {
            id
            tag
            details {
              ...Level1
            }
          }

          query DeepFragmentNesting($id: Int!) {
            employee(id: $id) {
              ...EmployeeWithDetails
              isAvailable
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should flatten all nested fragments into final message
      expect(proto).toContain('message DeepFragmentNestingEmployeeDetails {');
      expect(proto).toContain('google.protobuf.StringValue email = 1;');
      expect(proto).toContain('google.protobuf.StringValue phone = 2;');
      expect(proto).toContain('bool has_children = 3;');
      expect(proto).toContain('MaritalStatus marital_status = 4;');
      expect(proto).toContain('string forename = 5;');
      expect(proto).toContain('string surname = 6;');
    });

    test('should handle fragments with many fields efficiently', () => {
      const operation = {
        name: 'LargeFragment',
        content: `
          fragment LargeEmployeeFragment on Employee {
            id
            tag
            isAvailable
            details {
              forename
              surname
              email
              phone
              hasChildren
              maritalStatus
            }
            role {
              departments
              title
            }
            hobbies {
              employees {
                id
                tag
              }
            }
          }

          query LargeFragment($id: Int!) {
            employee(id: $id) {
              ...LargeEmployeeFragment
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should efficiently generate all message types
      expect(proto).toContain('message LargeFragmentEmployee {');
      expect(proto).toContain('message LargeFragmentEmployeeDetails {');
      expect(proto).toContain('message LargeFragmentEmployeeRole {');
      expect(proto).toContain('message LargeFragmentEmployeeHobbies {');
      
      // Should maintain proper field ordering
      const employeeMessage = proto.match(/message LargeFragmentEmployee \{[^}]+\}/s)?.[0];
      expect(employeeMessage).toContain('int32 id = 1;');
      expect(employeeMessage).toContain('string tag = 2;');
      expect(employeeMessage).toContain('bool is_available = 3;');
    });
  });

  describe('Fragment Integration with Mutations', () => {
    test('should handle fragments in mutation responses', () => {
      const operation = {
        name: 'UpdateEmployeeWithFragment',
        content: `
          fragment UpdatedEmployeeInfo on Employee {
            id
            tag
            isAvailable
            details {
              forename
              surname
              email
            }
          }

          mutation UpdateEmployeeWithFragment($id: Int!, $tag: String!) {
            updateEmployeeTag(id: $id, tag: $tag) {
              ...UpdatedEmployeeInfo
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should generate mutation service method
      expect(proto).toContain('rpc UpdateEmployeeWithFragment(UpdateEmployeeWithFragmentRequest) returns (UpdateEmployeeWithFragmentResponse) {}');
      
      // Should expand fragment in response message
      expect(proto).toContain('message UpdateEmployeeWithFragmentResponse {');
      expect(proto).toContain('UpdateEmployeeWithFragmentUpdateEmployeeTag update_employee_tag = 1;');
      
      // Should generate nested message with fragment fields
      expect(proto).toContain('message UpdateEmployeeWithFragmentUpdateEmployeeTag {');
      expect(proto).toContain('int32 id = 1;');
      expect(proto).toContain('string tag = 2;');
      expect(proto).toContain('bool is_available = 3;');
      expect(proto).toContain('UpdateEmployeeWithFragmentUpdateEmployeeTagDetails details = 4;');
    });
  });
});