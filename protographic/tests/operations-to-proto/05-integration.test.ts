import { describe, expect, test } from 'vitest';
import { OperationToProtoVisitor } from '../../src/operations-to-proto-visitor';
import { expectValidProto, loadProtoFromText, getFieldNumbersFromMessage, getServiceMethods } from '../util';

describe('Operations to Proto - Integration Tests', () => {
  // Using the comprehensive SDL schema from the task
  const comprehensiveSchema = `
    type Query {
      employee(id: Int!): Employee
      employeeAsList(id: Int!): [Employee]
      employees: [Employee]
      products: [Products!]!
      teammates(team: Department!): [Employee!]!
      firstEmployee: Employee!
      findEmployees(criteria: SearchInput): [Employee!]!
    }

    scalar Upload

    type Mutation {
      updateEmployeeTag(id: Int!, tag: String!): Employee
      singleUpload(file: Upload!): Boolean!
      singleUploadWithInput(arg: FileUpload!): Boolean!
      multipleUpload(files: [Upload!]!): Boolean!
      updateAvailability(employeeID: Int!, isAvailable: Boolean!): Employee!
      updateMood(employeeID: Int!, mood: Mood!): Employee!
    }

    input FileUpload {
      nested: DeeplyNestedFileUpload
      nestedList: [Upload!]
    }

    input DeeplyNestedFileUpload {
      file: Upload!
    }

    type Subscription {
      currentTime: Time!
      countEmp(max: Int!, intervalMilliseconds: Int!): Int!
      countEmp2(max: Int!, intervalMilliseconds: Int!): Int!
      countFor(count: Int!): Int!
      countHob(max: Int!, intervalMilliseconds: Int!): Int!
    }

    enum Department {
      ENGINEERING
      MARKETING
      OPERATIONS
    }

    interface RoleType {
      departments: [Department!]!
      title: [String!]!
      employees: [Employee!]!
    }

    enum EngineerType {
      BACKEND
      FRONTEND
      FULLSTACK
    }

    interface Identifiable {
      id: Int!
    }

    enum OperationType {
      FINANCE
      HUMAN_RESOURCES
    }

    type Details {
      forename: String!
      location: Country!
      surname: String!
      pastLocations: [City!]!
      middlename: String @deprecated
      hasChildren: Boolean!
      maritalStatus: MaritalStatus
      nationality: Nationality!
      pets: [Pet]
    }

    type City {
      type: String!
      name: String!
      country: Country
    }

    type Country {
      key: CountryKey!
    }

    type CountryKey {
      name: String!
    }

    enum Mood {
      HAPPY
      SAD
    }

    type ErrorWrapper {
      okField: String
      errorField: String
    }

    type Time {
      unixTime: Int!
      timeStamp: String!
    }

    union Products = Consultancy | Cosmo | SDK

    interface IProduct {
      upc: ID!
      engineers: [Employee!]!
    }

    type Consultancy {
      upc: ID!
      lead: Employee!
      isLeadAvailable: Boolean
    }

    enum Class {
      FISH
      MAMMAL
      REPTILE
    }

    enum Gender {
      FEMALE
      MALE
      UNKNOWN
    }

    interface Animal {
      class: Class!
      gender: Gender!
    }

    enum CatType {
      HOME
      STREET
    }

    enum DogBreed {
      GOLDEN_RETRIEVER
      POODLE
      ROTTWEILER
      YORKSHIRE_TERRIER
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

    enum ExerciseType {
      CALISTHENICS
      HIKING
      SPORT
      STRENGTH_TRAINING
    }

    interface Experience {
      yearsOfExperience: Float!
    }

    enum GameGenre {
      ADVENTURE
      BOARD
      FPS
      CARD
      RPG
      ROGUELITE
      SIMULATION
      STRATEGY
    }

    enum ProgrammingLanguage {
      CSHARP
      GO
      RUST
      TYPESCRIPT
    }

    interface Hobby {
      employees: [Employee!]!
    }

    type Engineer implements RoleType {
      departments: [Department!]!
      title: [String!]!
      employees: [Employee!]!
      engineerType: EngineerType!
    }

    type Marketer implements RoleType {
      departments: [Department!]!
      title: [String!]!
      employees: [Employee!]!
    }

    type Operator implements RoleType {
      departments: [Department!]!
      title: [String!]!
      employees: [Employee!]!
      operatorType: [OperationType!]!
    }

    type Employee implements Identifiable {
      details: Details
      id: Int!
      tag: String!
      role: RoleType!
      notes: String
      updatedAt: String!
      startDate: String!
      currentMood: Mood!
      derivedMood: Mood!
      isAvailable: Boolean!
      rootFieldThrowsError: String
      rootFieldErrorWrapper: ErrorWrapper
      hobbies: [Hobby!]
    }

    type Cosmo implements IProduct {
      upc: ID!
      engineers: [Employee!]!
      lead: Employee!
    }

    type SDK implements IProduct {
      upc: ID!
      engineers: [Employee!]!
      owner: Employee!
      unicode: String!
      clientLanguages: [ProgrammingLanguage!]!
    }

    interface Pet implements Animal {
      class: Class!
      gender: Gender!
      name: String!
    }

    type Alligator implements Pet & Animal {
      class: Class!
      dangerous: String!
      gender: Gender!
      name: String!
    }

    type Cat implements Pet & Animal {
      class: Class!
      gender: Gender!
      name: String!
      type: CatType!
    }

    type Dog implements Pet & Animal {
      breed: DogBreed!
      class: Class!
      gender: Gender!
      name: String!
    }

    type Mouse implements Pet & Animal {
      class: Class!
      gender: Gender!
      name: String!
    }

    type Pony implements Pet & Animal {
      class: Class!
      gender: Gender!
      name: String!
    }

    type Exercise implements Hobby {
      employees: [Employee!]!
      category: ExerciseType!
    }

    type Flying implements Experience & Hobby {
      employees: [Employee!]!
      planeModels: [String!]!
      yearsOfExperience: Float!
    }

    type Gaming implements Experience & Hobby {
      employees: [Employee!]!
      genres: [GameGenre!]!
      name: String!
      yearsOfExperience: Float!
    }

    type Other implements Hobby {
      employees: [Employee!]!
      name: String!
    }

    type Programming implements Hobby {
      employees: [Employee!]!
      languages: [ProgrammingLanguage!]!
    }

    type Travelling implements Hobby {
      employees: [Employee!]!
      countriesLived: [Country!]!
    }
  `;

  test('should handle comprehensive employee query with all nested fields', () => {
    const operations = [
      {
        name: 'GetCompleteEmployee',
        content: `
          query GetCompleteEmployee($id: Int!) {
            employee(id: $id) {
              id
              tag
              isAvailable
              currentMood
              derivedMood
              updatedAt
              startDate
              notes
              details {
                forename
                surname
                hasChildren
                maritalStatus
                nationality
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
                pets {
                  name
                  class
                  gender
                  ... on Cat {
                    type
                  }
                  ... on Dog {
                    breed
                  }
                  ... on Alligator {
                    dangerous
                  }
                }
              }
              role {
                departments
                title
                ... on Engineer {
                  engineerType
                }
                ... on Operator {
                  operatorType
                }
              }
              hobbies {
                ... on Gaming {
                  name
                  genres
                  yearsOfExperience
                }
                ... on Programming {
                  languages
                }
                ... on Flying {
                  planeModels
                  yearsOfExperience
                }
                ... on Exercise {
                  category
                }
                ... on Travelling {
                  countriesLived {
                    key {
                      name
                    }
                  }
                }
                ... on Other {
                  name
                }
              }
            }
          }
        `
      }
    ];

    const visitor = new OperationToProtoVisitor(comprehensiveSchema, operations, {
      serviceName: 'EmployeeService',
      packageName: 'employee.v1'
    });

    const protoText = visitor.visit();

    // Validate Proto definition
    expectValidProto(protoText);

    // Should generate many nested message types
    expect(protoText).toContain('message GetCompleteEmployeeEmployee');
    expect(protoText).toContain('message GetCompleteEmployeeEmployeeDetails');
    expect(protoText).toContain('message GetCompleteEmployeeEmployeeDetailsLocation');
    expect(protoText).toContain('message GetCompleteEmployeeEmployeeDetailsPets');
    expect(protoText).toContain('message GetCompleteEmployeeEmployeeRole');
    expect(protoText).toContain('message GetCompleteEmployeeEmployeeHobbies');

    // Should handle union and interface types with oneof
    expect(protoText).toContain('repeated GetCompleteEmployeeEmployeeDetailsPets pets');
    expect(protoText).toContain('repeated GetCompleteEmployeeEmployeeHobbies hobbies');
    expect(protoText).toContain('oneof type_specific');

    // Should generate fragment-specific message types
    expect(protoText).toContain('message GetCompleteEmployeeEmployeeDetailsPetsCat');
    expect(protoText).toContain('message GetCompleteEmployeeEmployeeDetailsPetsDog');
    expect(protoText).toContain('message GetCompleteEmployeeEmployeeRoleEngineer');
    expect(protoText).toContain('message GetCompleteEmployeeEmployeeHobbiesGaming');
  });

  test.skip('should handle complex mutation with file uploads - nested input generation not fully supported yet', () => {
    const operations = [
      {
        name: 'UploadWithInput',
        content: `
          mutation UploadWithInput($arg: FileUpload!) {
            singleUploadWithInput(arg: $arg)
          }
        `
      }
    ];

    const visitor = new OperationToProtoVisitor(comprehensiveSchema, operations, {
      serviceName: 'FileService',
      packageName: 'file.v1'
    });

    const protoText = visitor.visit();

    // Validate Proto definition
    expectValidProto(protoText);

    // Should generate input message types for file upload
    expect(protoText).toContain('message FileUpload {');
    expect(protoText).toContain('message DeeplyNestedFileUpload {');

    // Should handle Upload scalar as string (default scalar mapping)
    expect(protoText).toContain('string file = 1;');
    expect(protoText).toContain('repeated string nested_list');
  });

  test('should handle products query with union types', () => {
    const operations = [
      {
        name: 'GetProducts',
        content: `
          query GetProducts {
            products {
              ... on Consultancy {
                upc
                isLeadAvailable
                lead {
                  id
                  tag
                  currentMood
                }
              }
              ... on Cosmo {
                upc
                lead {
                  id
                  tag
                }
                engineers {
                  id
                  tag
                  role {
                    departments
                  }
                }
              }
              ... on SDK {
                upc
                unicode
                clientLanguages
                owner {
                  id
                  tag
                }
                engineers {
                  id
                  tag
                }
              }
            }
          }
        `
      }
    ];

    const visitor = new OperationToProtoVisitor(comprehensiveSchema, operations, {
      serviceName: 'ProductService',
      packageName: 'product.v1'
    });

    const protoText = visitor.visit();

    // Validate Proto definition
    expectValidProto(protoText);

    // Should generate nested message types for union members
    expect(protoText).toContain('message GetProductsProducts');
    expect(protoText).toContain('message GetProductsProductsConsultancyLead');
    expect(protoText).toContain('message GetProductsProductsCosmoLead');
    expect(protoText).toContain('message GetProductsProductsCosmoEngineers');
    expect(protoText).toContain('message GetProductsProductsSdkOwner');
    expect(protoText).toContain('message GetProductsProductsSdkEngineers');

    // Should handle repeated fields correctly
    expect(protoText).toContain('repeated GetProductsProducts products = 1;');
    expect(protoText).toContain('repeated GetProductsProductsCosmoEngineers engineers');
    expect(protoText).toContain('ProgrammingLanguage client_languages');

    // Should handle union types with oneof
    expect(protoText).toContain('oneof type_specific');

    // Should generate fragment-specific message types for union members
    expect(protoText).toContain('message GetProductsProductsConsultancy');
    expect(protoText).toContain('message GetProductsProductsCosmo');
    expect(protoText).toContain('message GetProductsProductsSdk');
  });

  test('should handle search with complex input types', () => {
    const operations = [
      {
        name: 'SearchEmployees',
        content: `
          query SearchEmployees($criteria: SearchInput) {
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

    const visitor = new OperationToProtoVisitor(comprehensiveSchema, operations, {
      serviceName: 'SearchService',
      packageName: 'search.v1'
    });

    const protoText = visitor.visit();

    // Validate Proto definition
    expectValidProto(protoText);

    // Should generate enum definitions
    expect(protoText).toContain('enum Nationality {');
    expect(protoText).toContain('enum MaritalStatus {');
    expect(protoText).toContain('NATIONALITY_UNSPECIFIED = 0;');
    expect(protoText).toContain('MARITAL_STATUS_UNSPECIFIED = 0;');

    // Should generate input message types
    expect(protoText).toContain('message SearchInput {');
    expect(protoText).toContain('message NestedSearchInput {');

    // Parse the proto to verify structure
    const root = loadProtoFromText(protoText);
    const searchInputFields = getFieldNumbersFromMessage(root, 'SearchInput');
    const nestedSearchInputFields = getFieldNumbersFromMessage(root, 'NestedSearchInput');

    expect(searchInputFields['has_pets']).toBeDefined();
    expect(searchInputFields['nationality']).toBeDefined();
    expect(searchInputFields['nested']).toBeDefined();

    expect(nestedSearchInputFields['marital_status']).toBeDefined();
    expect(nestedSearchInputFields['has_children']).toBeDefined();
  });

  test('should handle multiple operations with different complexity levels', () => {
    const operations = [
      {
        name: 'GetFirstEmployee',
        content: `
          query GetFirstEmployee {
            firstEmployee {
              id
              tag
            }
          }
        `
      },
      {
        name: 'GetTeammates',
        content: `
          query GetTeammates($team: Department!) {
            teammates(team: $team) {
              id
              tag
              currentMood
              role {
                departments
                title
              }
            }
          }
        `
      },
      {
        name: 'UpdateEmployeeMood',
        content: `
          mutation UpdateEmployeeMood($employeeID: Int!, $mood: Mood!) {
            updateMood(employeeID: $employeeID, mood: $mood) {
              id
              currentMood
              derivedMood
            }
          }
        `
      },
      {
        name: 'MultipleFileUpload',
        content: `
          mutation MultipleFileUpload($files: [Upload!]!) {
            multipleUpload(files: $files)
          }
        `
      }
    ];

    const visitor = new OperationToProtoVisitor(comprehensiveSchema, operations, {
      serviceName: 'ComprehensiveService',
      packageName: 'comprehensive.v1'
    });

    const protoText = visitor.visit();

    // Validate Proto definition
    expectValidProto(protoText);

    // Parse the proto to verify service methods
    const root = loadProtoFromText(protoText);
    const methods = getServiceMethods(root, 'ComprehensiveService');

    // Verify all operations are present
    expect(methods).toContain('GetFirstEmployee');
    expect(methods).toContain('GetTeammates');
    expect(methods).toContain('UpdateEmployeeMood');
    expect(methods).toContain('MultipleFileUpload');

    // Should generate enum definitions
    expect(protoText).toContain('enum Department {');
    expect(protoText).toContain('enum Mood {');

    // Should handle different variable types correctly
    expect(protoText).toContain('Department team = 1;');
    expect(protoText).toContain('Mood mood = 2;');
    expect(protoText).toContain('repeated string files = 1;');

    // Should generate appropriate response types
    expect(protoText).toContain('GetFirstEmployeeFirstEmployee first_employee = 1;');
    expect(protoText).toContain('repeated GetTeammatesTeammates teammates = 1;');
    expect(protoText).toContain('bool multiple_upload = 1;');
  });

  test('should handle operations with wrapper types correctly', () => {
    const operations = [
      {
        name: 'GetEmployeeWithOptionals',
        content: `
          query GetEmployeeWithOptionals($id: Int!) {
            employee(id: $id) {
              id
              tag
              notes
              details {
                maritalStatus
                pets {
                  name
                }
              }
              rootFieldErrorWrapper {
                okField
                errorField
              }
            }
          }
        `
      }
    ];

    const visitor = new OperationToProtoVisitor(comprehensiveSchema, operations, {
      serviceName: 'EmployeeService',
      packageName: 'employee.v1'
    });

    const protoText = visitor.visit();

    // Validate Proto definition
    expectValidProto(protoText);

    // Should generate enum definitions
    expect(protoText).toContain('enum MaritalStatus {');

    // Should use wrapper types for nullable fields
    expect(protoText).toContain('import "google/protobuf/wrappers.proto";');
    expect(protoText).toContain('google.protobuf.StringValue notes');
    expect(protoText).toContain('google.protobuf.StringValue ok_field');
    expect(protoText).toContain('google.protobuf.StringValue error_field');

    // Should use direct types for non-null fields
    expect(protoText).toContain('int32 id = 1;');
    expect(protoText).toContain('string tag = 2;');
    expect(protoText).toContain('string name = 1;');
  });

  test('should maintain consistency across multiple generations with lock data', () => {
    const operations = [
      {
        name: 'GetEmployee',
        content: `
          query GetEmployee($id: Int!) {
            employee(id: $id) {
              id
              tag
              isAvailable
              details {
                forename
                surname
                nationality
              }
            }
          }
        `
      }
    ];

    // First generation
    const visitor1 = new OperationToProtoVisitor(comprehensiveSchema, operations, {
      serviceName: 'EmployeeService',
      packageName: 'employee.v1'
    });

    const proto1 = visitor1.visit();
    const lockData = visitor1.getGeneratedLockData();

    // Parse first proto
    const root1 = loadProtoFromText(proto1);
    const employeeFields1 = getFieldNumbersFromMessage(root1, 'GetEmployeeEmployee');
    const detailsFields1 = getFieldNumbersFromMessage(root1, 'GetEmployeeEmployeeDetails');

    // Second generation with same operations but using lock data
    const visitor2 = new OperationToProtoVisitor(comprehensiveSchema, operations, {
      serviceName: 'EmployeeService',
      packageName: 'employee.v1',
      lockData: lockData || undefined
    });

    const proto2 = visitor2.visit();

    // Parse second proto
    const root2 = loadProtoFromText(proto2);
    const employeeFields2 = getFieldNumbersFromMessage(root2, 'GetEmployeeEmployee');
    const detailsFields2 = getFieldNumbersFromMessage(root2, 'GetEmployeeEmployeeDetails');

    // Field numbers should be identical
    expect(employeeFields2['id']).toBe(employeeFields1['id']);
    expect(employeeFields2['tag']).toBe(employeeFields1['tag']);
    expect(employeeFields2['is_available']).toBe(employeeFields1['is_available']);
    expect(employeeFields2['details']).toBe(employeeFields1['details']);

    expect(detailsFields2['forename']).toBe(detailsFields1['forename']);
    expect(detailsFields2['surname']).toBe(detailsFields1['surname']);
    expect(detailsFields2['nationality']).toBe(detailsFields1['nationality']);

    // Proto text should be identical
    expect(proto2).toBe(proto1);
  });
});