import { describe, expect, test } from 'vitest';
import { OperationToProtoVisitor } from '../../src/operations-to-proto-visitor';
import { expectValidProto, loadProtoFromText, getFieldNumbersFromMessage } from '../util';

describe('Operations to Proto - Complex Operations', () => {
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

  test('should handle deeply nested object selections', () => {
    const operations = [
      {
        name: 'GetEmployeeWithDetails',
        content: `
          query GetEmployeeWithDetails($id: Int!) {
            employee(id: $id) {
              id
              tag
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
              }
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

    // Should generate nested message types
    expect(protoText).toContain('message GetEmployeeWithDetailsEmployee');
    expect(protoText).toContain('message GetEmployeeWithDetailsEmployeeDetails');
    expect(protoText).toContain('message GetEmployeeWithDetailsEmployeeDetailsLocation');
    expect(protoText).toContain('message GetEmployeeWithDetailsEmployeeDetailsLocationKey');
    expect(protoText).toContain('message GetEmployeeWithDetailsEmployeeDetailsPastLocations');
    expect(protoText).toContain('message GetEmployeeWithDetailsEmployeeDetailsPastLocationsCountry');
    expect(protoText).toContain('message GetEmployeeWithDetailsEmployeeDetailsPastLocationsCountryKey');

    // Should handle repeated fields correctly
    expect(protoText).toContain('repeated GetEmployeeWithDetailsEmployeeDetailsPastLocations past_locations');
  });

  test('should handle complex input types with nested structures', () => {
    const operations = [
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
                hasChildren
              }
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

    // Should generate input message types (operations visitor doesn't include comments)
    expect(protoText).toContain('message SearchInput {');
    expect(protoText).toContain('message NestedSearchInput {');

    // Should use the input types in request message
    expect(protoText).toContain('SearchInput criteria = 1;');

    // Parse the proto to verify field structure
    const root = loadProtoFromText(protoText);
    const searchInputFields = getFieldNumbersFromMessage(root, 'SearchInput');
    const nestedSearchInputFields = getFieldNumbersFromMessage(root, 'NestedSearchInput');

    // Verify input message fields
    expect(searchInputFields['has_pets']).toBeDefined();
    expect(searchInputFields['nationality']).toBeDefined();
    expect(searchInputFields['nested']).toBeDefined();

    expect(nestedSearchInputFields['marital_status']).toBeDefined();
    expect(nestedSearchInputFields['has_children']).toBeDefined();
  });

  test('should handle operations with enum variables and fields', () => {
    const operations = [
      {
        name: 'GetTeammates',
        content: `
          query GetTeammates($team: Department!) {
            teammates(team: $team) {
              id
              tag
              currentMood
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

    const visitor = new OperationToProtoVisitor(schema, operations, {
      serviceName: 'EmployeeService',
      packageName: 'employee.v1'
    });

    const protoText = visitor.visit();

    // Validate Proto definition
    expectValidProto(protoText);

    // Should generate enum definitions
    expect(protoText).toContain('enum Department {');
    expect(protoText).toContain('enum Mood {');
    expect(protoText).toContain('DEPARTMENT_UNSPECIFIED = 0;');
    expect(protoText).toContain('MOOD_UNSPECIFIED = 0;');
    expect(protoText).toContain('DEPARTMENT_ENGINEERING');
    expect(protoText).toContain('DEPARTMENT_MARKETING');
    expect(protoText).toContain('DEPARTMENT_OPERATIONS');
    expect(protoText).toContain('MOOD_HAPPY');
    expect(protoText).toContain('MOOD_SAD');

    // Should use enum types in request messages
    expect(protoText).toContain('Department team = 1;');
    expect(protoText).toContain('Mood mood = 2;');

    // Should use enum types in response messages
    expect(protoText).toContain('Mood current_mood');
  });

  test.skip('should handle interface and union types in selections - inline fragments not supported yet', () => {
    const operations = [
      {
        name: 'GetEmployeeHobbies',
        content: `
          query GetEmployeeHobbies($id: Int!) {
            employee(id: $id) {
              id
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

    const visitor = new OperationToProtoVisitor(schema, operations, {
      serviceName: 'EmployeeService',
      packageName: 'employee.v1'
    });

    // This should throw because inline fragments are not supported
    expect(() => visitor.visit()).toThrow('Inline fragments are not currently supported');
  });

  test('should handle multiple variables with different types', () => {
    const operations = [
      {
        name: 'ComplexQuery',
        content: `
          query ComplexQuery(
            $id: Int!
            $tag: String
            $isAvailable: Boolean
            $mood: Mood
            $team: Department!
          ) {
            employee(id: $id) {
              id
              tag
              isAvailable
              currentMood
            }
            teammates(team: $team) {
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

    // Parse the proto to verify request message structure
    const root = loadProtoFromText(protoText);
    const requestFields = getFieldNumbersFromMessage(root, 'ComplexQueryRequest');

    // Should have all variables as fields
    expect(requestFields['id']).toBeDefined();
    expect(requestFields['tag']).toBeDefined();
    expect(requestFields['is_available']).toBeDefined();
    expect(requestFields['mood']).toBeDefined();
    expect(requestFields['team']).toBeDefined();

    // Should generate enum definitions
    expect(protoText).toContain('enum Department {');
    expect(protoText).toContain('enum Mood {');

    // Should use wrapper types for nullable variables
    expect(protoText).toContain('import "google/protobuf/wrappers.proto";');
    expect(protoText).toContain('google.protobuf.StringValue tag');
    expect(protoText).toContain('google.protobuf.BoolValue is_available');

    // Should use direct types for non-null variables
    expect(protoText).toContain('int32 id = 1;');
    expect(protoText).toContain('Department team');
  });

  test('should handle operations with list variables', () => {
    const schemaWithListArgs = `
      type Query {
        employeesByIds(ids: [Int!]!): [Employee]
        employeesByTags(tags: [String]): [Employee]
      }

      type Employee {
        id: Int!
        tag: String!
      }
    `;

    const operations = [
      {
        name: 'GetEmployeesByIds',
        content: `
          query GetEmployeesByIds($ids: [Int!]!) {
            employeesByIds(ids: $ids) {
              id
              tag
            }
          }
        `
      },
      {
        name: 'GetEmployeesByTags',
        content: `
          query GetEmployeesByTags($tags: [String]) {
            employeesByTags(tags: $tags) {
              id
              tag
            }
          }
        `
      }
    ];

    const visitor = new OperationToProtoVisitor(schemaWithListArgs, operations, {
      serviceName: 'EmployeeService',
      packageName: 'employee.v1'
    });

    const protoText = visitor.visit();

    // Validate Proto definition
    expectValidProto(protoText);

    // Should use repeated for list variables
    expect(protoText).toContain('repeated int32 ids = 1;');
    expect(protoText).toContain('repeated string tags = 1;');
  });

  test('should handle operations with deeply nested input types', () => {
    const complexSchema = `
      type Query {
        searchEmployees(filter: EmployeeFilter): [Employee]
      }

      type Employee {
        id: Int!
        name: String!
      }

      input EmployeeFilter {
        basic: BasicFilter
        advanced: AdvancedFilter
      }

      input BasicFilter {
        name: String
        active: Boolean
      }

      input AdvancedFilter {
        location: LocationFilter
        skills: [String]
      }

      input LocationFilter {
        country: String
        city: String
        remote: Boolean
      }
    `;

    const operations = [
      {
        name: 'SearchEmployees',
        content: `
          query SearchEmployees($filter: EmployeeFilter) {
            searchEmployees(filter: $filter) {
              id
              name
            }
          }
        `
      }
    ];

    const visitor = new OperationToProtoVisitor(complexSchema, operations, {
      serviceName: 'EmployeeService',
      packageName: 'employee.v1'
    });

    const protoText = visitor.visit();

    // Validate Proto definition
    expectValidProto(protoText);

    // Should generate all nested input message types
    expect(protoText).toContain('message EmployeeFilter {');
    expect(protoText).toContain('message BasicFilter {');
    expect(protoText).toContain('message AdvancedFilter {');
    expect(protoText).toContain('message LocationFilter {');

    // Should handle nested references correctly
    expect(protoText).toContain('BasicFilter basic');
    expect(protoText).toContain('AdvancedFilter advanced');
    expect(protoText).toContain('LocationFilter location');
    expect(protoText).toContain('repeated string skills');
  });
});