import { bench, describe } from 'vitest';
import { OperationToProtoVisitor } from '../../src/operations-to-proto-visitor';

describe('Operations to Proto - Benchmarks', () => {
  const schema = `
    type Query {
      employee(id: Int!): Employee
      employees: [Employee]
      findEmployees(criteria: SearchInput): [Employee!]!
      teammates(team: Department!): [Employee!]!
    }

    type Mutation {
      updateEmployeeTag(id: Int!, tag: String!): Employee
      updateAvailability(employeeID: Int!, isAvailable: Boolean!): Employee!
      updateMood(employeeID: Int!, mood: Mood!): Employee!
    }

    type Employee {
      id: Int!
      tag: String!
      isAvailable: Boolean!
      currentMood: Mood!
      details: Details
      hobbies: [Hobby!]
    }

    type Details {
      forename: String!
      surname: String!
      location: Country!
      pastLocations: [City!]!
      hasChildren: Boolean!
      maritalStatus: MaritalStatus
      nationality: Nationality!
      pets: [Pet]
    }

    type Country {
      key: CountryKey!
    }

    type CountryKey {
      name: String!
    }

    type City {
      type: String!
      name: String!
      country: Country
    }

    enum Department {
      ENGINEERING
      MARKETING
      OPERATIONS
    }

    enum Mood {
      HAPPY
      SAD
    }

    enum MaritalStatus {
      ENGAGED
      MARRIED
    }

    enum Nationality {
      AMERICAN
      DUTCH
      ENGLISH
      GERMAN
      INDIAN
      SPANISH
      UKRAINIAN
    }

    input SearchInput {
      hasPets: Boolean
      nationality: Nationality
      nested: NestedSearchInput
    }

    input NestedSearchInput {
      maritalStatus: MaritalStatus
      hasChildren: Boolean
    }

    interface Hobby {
      employees: [Employee!]!
    }

    interface Pet {
      name: String!
    }

    type Gaming implements Hobby {
      employees: [Employee!]!
      name: String!
    }

    type Cat implements Pet {
      name: String!
      type: String!
    }
  `;

  const simpleOperations = [
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

  const complexOperations = [
    {
      name: 'GetEmployeeWithDetails',
      content: `
        query GetEmployeeWithDetails($id: Int!) {
          employee(id: $id) {
            id
            tag
            isAvailable
            currentMood
            details {
              forename
              surname
              location {
                key {
                  name
                }
              }
              pastLocations {
                type
                name
                country {
                  key {
                    name
                  }
                }
              }
              hasChildren
              maritalStatus
              nationality
              pets {
                name
                ... on Cat {
                  type
                }
              }
            }
            hobbies {
              employees {
                id
                tag
              }
              ... on Gaming {
                name
              }
            }
          }
        }
      `
    }
  ];

  const multipleOperations = [
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
      name: 'GetEmployees',
      content: `
        query GetEmployees {
          employees {
            id
            tag
            isAvailable
          }
        }
      `
    },
    {
      name: 'FindEmployees',
      content: `
        query FindEmployees($criteria: SearchInput) {
          findEmployees(criteria: $criteria) {
            id
            tag
            details {
              nationality
              maritalStatus
            }
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
    },
    {
      name: 'UpdateMood',
      content: `
        mutation UpdateMood($employeeID: Int!, $mood: Mood!) {
          updateMood(employeeID: $employeeID, mood: $mood) {
            id
            currentMood
          }
        }
      `
    }
  ];

  bench('simple operation conversion', () => {
    const visitor = new OperationToProtoVisitor(schema, simpleOperations, {
      serviceName: 'EmployeeService',
      packageName: 'employee.v1'
    });
    visitor.visit();
  });

  bench('complex operation conversion', () => {
    const visitor = new OperationToProtoVisitor(schema, complexOperations, {
      serviceName: 'EmployeeService',
      packageName: 'employee.v1'
    });
    visitor.visit();
  });

  bench('multiple operations conversion', () => {
    const visitor = new OperationToProtoVisitor(schema, multipleOperations, {
      serviceName: 'EmployeeService',
      packageName: 'employee.v1'
    });
    visitor.visit();
  });

  bench('operation conversion with proto lock', () => {
    // First generate lock data
    const visitor1 = new OperationToProtoVisitor(schema, multipleOperations, {
      serviceName: 'EmployeeService',
      packageName: 'employee.v1'
    });
    visitor1.visit();
    const lockData = visitor1.getGeneratedLockData();

    // Benchmark with lock data
    const visitor2 = new OperationToProtoVisitor(schema, multipleOperations, {
      serviceName: 'EmployeeService',
      packageName: 'employee.v1',
      lockData: lockData || undefined
    });
    visitor2.visit();
  });

  bench('operation validation', () => {
    const visitor = new OperationToProtoVisitor(schema, multipleOperations, {
      serviceName: 'EmployeeService',
      packageName: 'employee.v1'
    });
    // Only run validation, not full conversion
    try {
      visitor.visit();
    } catch (error) {
      // Expected for benchmark
    }
  });
});