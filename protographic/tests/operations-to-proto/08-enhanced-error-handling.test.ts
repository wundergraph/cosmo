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
  }

  type Details {
    forename: String!
    surname: String!
    email: String
    hasChildren: Boolean!
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

  enum Department {
    ENGINEERING
    MARKETING
    OPERATIONS
  }

  enum EngineerType {
    BACKEND
    FRONTEND
    FULLSTACK
  }

  input SearchInput {
    department: Department
    isAvailable: Boolean
  }

  input CreateEmployeeInput {
    tag: String!
    details: DetailsInput!
  }

  input DetailsInput {
    forename: String!
    surname: String!
    email: String
    hasChildren: Boolean!
  }
`;

describe('Operations to Proto - Enhanced Error Handling', () => {
  describe('Schema Validation Errors', () => {
    test.skip('should provide detailed error for non-existent fields', () => {
      const operation = {
        name: 'InvalidFieldQuery',
        content: `
          query InvalidFieldQuery($id: Int!) {
            employee(id: $id) {
              id
              nonExistentField
              tag
            }
          }
        `,
      };

      expect(() => {
        const visitor = new OperationToProtoVisitor(SDL, [operation]);
        visitor.visit();
      }).toThrow(/Field 'nonExistentField' not found on type 'Employee'/);
    });

    test.skip('should provide helpful suggestions for similar field names', () => {
      const operation = {
        name: 'TypoFieldQuery',
        content: `
          query TypoFieldQuery($id: Int!) {
            employee(id: $id) {
              id
              tage  # typo for 'tag'
            }
          }
        `,
      };

      expect(() => {
        const visitor = new OperationToProtoVisitor(SDL, [operation]);
        visitor.visit();
      }).toThrow(/Field 'tage' not found on type 'Employee'. Did you mean 'tag'\?/);
    });

    test.skip('should validate nested field access on scalars', () => {
      const operation = {
        name: 'InvalidNestedAccess',
        content: `
          query InvalidNestedAccess($id: Int!) {
            employee(id: $id) {
              id {
                # Cannot access fields on Int scalar
                value
              }
            }
          }
        `,
      };

      expect(() => {
        const visitor = new OperationToProtoVisitor(SDL, [operation]);
        visitor.visit();
      }).toThrow(/Cannot query field "value" on type "Int". Scalar types cannot have sub-selections/);
    });

    test.skip('should validate required selection sets on object types', () => {
      const operation = {
        name: 'MissingSelectionSet',
        content: `
          query MissingSelectionSet($id: Int!) {
            employee(id: $id) {
              id
              details  # Missing selection set for object type
            }
          }
        `,
      };

      expect(() => {
        const visitor = new OperationToProtoVisitor(SDL, [operation]);
        visitor.visit();
      }).toThrow(/Field "details" of type "Details" must have a selection set/);
    });
  });

  describe('Variable Validation Errors', () => {
    test.skip('should validate variable type compatibility', () => {
      const operation = {
        name: 'InvalidVariableType',
        content: `
          query InvalidVariableType($id: String!) {
            employee(id: $id) {  # expects Int!, got String!
              id
              tag
            }
          }
        `,
      };

      expect(() => {
        const visitor = new OperationToProtoVisitor(SDL, [operation]);
        visitor.visit();
      }).toThrow(/Variable "\$id" of type "String!" used in position expecting type "Int!"/);
    });

    test.skip('should validate required variables', () => {
      const operation = {
        name: 'MissingRequiredVariable',
        content: `
          query MissingRequiredVariable($optionalVar: String) {
            employee(id: 1) {  # hardcoded instead of using required variable
              id
              tag
            }
          }
        `,
      };

      // This should pass validation but warn about unused variable
      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();
      expectValidProto(proto);
    });

    test.skip('should validate unused variables', () => {
      const operation = {
        name: 'UnusedVariable',
        content: `
          query UnusedVariable($id: Int!, $unusedVar: String) {
            employee(id: $id) {
              id
              tag
            }
          }
        `,
      };

      expect(() => {
        const visitor = new OperationToProtoVisitor(SDL, [operation]);
        visitor.visit();
      }).toThrow(/Variable "\$unusedVar" is never used/);
    });

    test.skip('should validate variable nullability', () => {
      const operation = {
        name: 'NullabilityMismatch',
        content: `
          query NullabilityMismatch($criteria: SearchInput!) {
            findEmployees(criteria: $criteria) {  # expects SearchInput (nullable), got SearchInput!
              id
              tag
            }
          }
        `,
      };

      // This should actually be valid - non-null can be used where nullable is expected
      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();
      expectValidProto(proto);
    });
  });

  describe('Operation Structure Validation', () => {
    test.skip('should validate operation name uniqueness', () => {
      const operations = [
        {
          name: 'DuplicateOperation',
          content: `
            query DuplicateOperation {
              employees {
                id
                tag
              }
            }
          `,
        },
        {
          name: 'DuplicateOperation',
          content: `
            query DuplicateOperation($id: Int!) {
              employee(id: $id) {
                id
                tag
              }
            }
          `,
        },
      ];

      expect(() => {
        const visitor = new OperationToProtoVisitor(SDL, operations);
        visitor.visit();
      }).toThrow(/Duplicate operation name "DuplicateOperation"/);
    });

    test.skip('should validate operation definition presence', () => {
      const operation = {
        name: 'EmptyDocument',
        content: `
          # Just a comment, no operation
        `,
      };

      expect(() => {
        const visitor = new OperationToProtoVisitor(SDL, [operation]);
        visitor.visit();
      }).toThrow(/No OperationDefinition found in document for operation "EmptyDocument"/);
    });

    test.skip('should validate single operation per document', () => {
      const operation = {
        name: 'MultipleOperations',
        content: `
          query FirstQuery {
            employees {
              id
            }
          }

          query SecondQuery {
            employee(id: 1) {
              tag
            }
          }
        `,
      };

      expect(() => {
        const visitor = new OperationToProtoVisitor(SDL, [operation]);
        visitor.visit();
      }).toThrow(/Multiple OperationDefinitions found in document for operation "MultipleOperations"/);
    });

    test.skip('should validate operation type against schema', () => {
      const schemaWithoutSubscription = `
        type Query {
          employee(id: Int!): Employee
        }

        type Employee {
          id: Int!
          tag: String!
        }
      `;

      const operation = {
        name: 'InvalidSubscription',
        content: `
          subscription InvalidSubscription {
            # Schema doesn't define Subscription type
            employeeUpdates {
              id
              tag
            }
          }
        `,
      };

      expect(() => {
        const visitor = new OperationToProtoVisitor(schemaWithoutSubscription, [operation]);
        visitor.visit();
      }).toThrow(/Schema does not define subscription type/);
    });
  });

  describe('Input Validation Errors', () => {
    test.skip('should validate input object field types', () => {
      const operation = {
        name: 'InvalidInputField',
        content: `
          mutation InvalidInputField {
            createEmployee(input: {
              tag: "test"
              details: {
                forename: "John"
                surname: "Doe"
                hasChildren: "yes"  # should be Boolean, not String
              }
            }) {
              id
              tag
            }
          }
        `,
      };

      expect(() => {
        const visitor = new OperationToProtoVisitor(SDL, [operation]);
        visitor.visit();
      }).toThrow(/Expected type "Boolean!", found "yes"/);
    });

    test.skip('should validate required input fields', () => {
      const operation = {
        name: 'MissingRequiredInput',
        content: `
          mutation MissingRequiredInput {
            createEmployee(input: {
              tag: "test"
              # missing required 'details' field
            }) {
              id
              tag
            }
          }
        `,
      };

      expect(() => {
        const visitor = new OperationToProtoVisitor(SDL, [operation]);
        visitor.visit();
      }).toThrow(/Field "details" of required type "DetailsInput!" was not provided/);
    });

    test.skip('should validate unknown input fields', () => {
      const operation = {
        name: 'UnknownInputField',
        content: `
          mutation UnknownInputField {
            createEmployee(input: {
              tag: "test"
              unknownField: "value"
              details: {
                forename: "John"
                surname: "Doe"
                hasChildren: true
              }
            }) {
              id
              tag
            }
          }
        `,
      };

      expect(() => {
        const visitor = new OperationToProtoVisitor(SDL, [operation]);
        visitor.visit();
      }).toThrow(/Field "unknownField" is not defined by type "CreateEmployeeInput"/);
    });
  });

  describe('Enum Validation Errors', () => {
    test.skip('should validate enum values', () => {
      const operation = {
        name: 'InvalidEnumValue',
        content: `
          query InvalidEnumValue {
            findEmployees(criteria: {
              department: INVALID_DEPARTMENT
              isAvailable: true
            }) {
              id
              tag
            }
          }
        `,
      };

      expect(() => {
        const visitor = new OperationToProtoVisitor(SDL, [operation]);
        visitor.visit();
      }).toThrow(/Value "INVALID_DEPARTMENT" does not exist in "Department" enum/);
    });

    test.skip('should suggest similar enum values', () => {
      const operation = {
        name: 'TypoEnumValue',
        content: `
          query TypoEnumValue {
            findEmployees(criteria: {
              department: ENGINERING  # typo for ENGINEERING
              isAvailable: true
            }) {
              id
              tag
            }
          }
        `,
      };

      expect(() => {
        const visitor = new OperationToProtoVisitor(SDL, [operation]);
        visitor.visit();
      }).toThrow(/Value "ENGINERING" does not exist in "Department" enum. Did you mean "ENGINEERING"\?/);
    });
  });

  describe('Fragment Validation Errors', () => {
    test.skip('should validate fragment type conditions', () => {
      const operation = {
        name: 'InvalidFragmentType',
        content: `
          query InvalidFragmentType($id: Int!) {
            employee(id: $id) {
              id
              ... on Details {  # Cannot use Details fragment on Employee
                forename
                surname
              }
            }
          }
        `,
      };

      expect(() => {
        const visitor = new OperationToProtoVisitor(SDL, [operation]);
        visitor.visit();
      }).toThrow(/Fragment cannot be spread here as objects of type "Employee" can never be of type "Details"/);
    });

    test.skip('should validate named fragment definitions', () => {
      const operation = {
        name: 'UndefinedFragment',
        content: `
          query UndefinedFragment($id: Int!) {
            employee(id: $id) {
              ...UndefinedEmployeeFragment
              id
            }
          }
        `,
      };

      expect(() => {
        const visitor = new OperationToProtoVisitor(SDL, [operation]);
        visitor.visit();
      }).toThrow(/Unknown fragment "UndefinedEmployeeFragment"/);
    });

    test.skip('should detect circular fragment dependencies', () => {
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
      }).toThrow(/Circular fragment dependency detected: FragmentA -> FragmentB -> FragmentA/);
    });
  });

  describe('Error Recovery and Suggestions', () => {
    test.skip('should provide context in error messages', () => {
      const operation = {
        name: 'ContextualError',
        content: `
          query ContextualError($id: Int!) {
            employee(id: $id) {
              id
              details {
                forename
                invalidField  # Error should show path context
                surname
              }
            }
          }
        `,
      };

      expect(() => {
        const visitor = new OperationToProtoVisitor(SDL, [operation]);
        visitor.visit();
      }).toThrow(/Field 'invalidField' not found on type 'Details' at path 'employee.details.invalidField'/);
    });

    test.skip('should suggest corrections for common mistakes', () => {
      const operation = {
        name: 'CommonMistakes',
        content: `
          query CommonMistakes($id: Int!) {
            employe(id: $id) {  # typo for 'employee'
              id
              tag
            }
          }
        `,
      };

      expect(() => {
        const visitor = new OperationToProtoVisitor(SDL, [operation]);
        visitor.visit();
      }).toThrow(/Field 'employe' not found on type 'Query'. Did you mean 'employee'\?/);
    });

    test.skip('should handle multiple errors gracefully', () => {
      const operation = {
        name: 'MultipleErrors',
        content: `
          query MultipleErrors($wrongType: String!) {
            employee(id: $wrongType) {  # Type error
              id
              nonExistentField          # Field error
              details {
                invalidNestedField      # Nested field error
              }
            }
          }
        `,
      };

      expect(() => {
        const visitor = new OperationToProtoVisitor(SDL, [operation]);
        visitor.visit();
      }).toThrow(); // Should throw with the first encountered error
    });

    test.skip('should provide helpful error for interface implementation issues', () => {
      const operation = {
        name: 'InterfaceImplementationError',
        content: `
          query InterfaceImplementationError($id: Int!) {
            employee(id: $id) {
              role {
                departments
                title
                ... on Engineer {
                  nonExistentEngineerField
                }
              }
            }
          }
        `,
      };

      expect(() => {
        const visitor = new OperationToProtoVisitor(SDL, [operation]);
        visitor.visit();
      }).toThrow(/Field 'nonExistentEngineerField' not found on type 'Engineer'/);
    });
  });

  describe('Performance Error Handling', () => {
    test.skip('should detect potentially expensive operations', () => {
      const operation = {
        name: 'ExpensiveOperation',
        content: `
          query ExpensiveOperation {
            employees {
              id
              details {
                forename
                surname
              }
              role {
                departments
                title
              }
            }
          }
        `,
      };

      // This should pass but could warn about potential performance issues
      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();
      expectValidProto(proto);
    });

    test.skip('should handle deeply nested selections gracefully', () => {
      const deepSchema = `
        type Query {
          level1: Level1
        }
        type Level1 { level2: Level2 }
        type Level2 { level3: Level3 }
        type Level3 { level4: Level4 }
        type Level4 { level5: Level5 }
        type Level5 { value: String }
      `;

      const operation = {
        name: 'DeepNesting',
        content: `
          query DeepNesting {
            level1 {
              level2 {
                level3 {
                  level4 {
                    level5 {
                      value
                    }
                  }
                }
              }
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(deepSchema, [operation]);
      const proto = visitor.visit();
      expectValidProto(proto);
    });
  });
});