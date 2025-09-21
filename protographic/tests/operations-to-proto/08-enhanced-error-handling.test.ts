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
    test('should provide detailed error for non-existent fields', () => {
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

    test('should provide helpful suggestions for similar field names', () => {
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

  });

  describe('Operation Structure Validation', () => {
    test('should validate operation name uniqueness', () => {
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

    test('should validate operation definition presence', () => {
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

    test('should validate single operation per document', () => {
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

    test('should validate operation type against schema', () => {
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

  describe('Fragment Validation Errors', () => {
    test('should validate fragment type conditions', () => {
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

    test('should validate named fragment definitions', () => {
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
      }).toThrow(/Circular fragment dependency detected: FragmentA -> FragmentB -> FragmentA/);
    });
  });

  describe('Performance Error Handling', () => {

    test('should handle deeply nested selections gracefully', () => {
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