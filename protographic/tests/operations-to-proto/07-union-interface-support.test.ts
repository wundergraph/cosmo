import { describe, expect, test } from 'vitest';
import { OperationToProtoVisitor } from '../../src/operations-to-proto-visitor';
import { expectValidProto } from '../util';

const SDL = `
  type Query {
    employee(id: Int!): Employee
    employees: [Employee]
    products: [Products!]!
    search(query: String!): [SearchResult!]!
    node(id: ID!): Node
  }

  scalar Upload

  type Mutation {
    updateEmployeeTag(id: Int!, tag: String!): Employee
    updateAvailability(employeeID: Int!, isAvailable: Boolean!): Employee!
  }

  type Subscription {
    currentTime: Time!
  }

  enum Department {
    ENGINEERING
    MARKETING
    OPERATIONS
  }

  interface Node {
    id: ID!
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

  type Time {
    unixTime: Int!
    timeStamp: String!
  }

  union Products = Consultancy | Cosmo | SDK
  union SearchResult = Employee | Products

  interface IProduct {
    upc: ID!
    engineers: [Employee!]!
  }

  type Consultancy implements IProduct {
    upc: ID!
    lead: Employee!
    isLeadAvailable: Boolean
    engineers: [Employee!]!
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

  type Employee implements Identifiable & Node {
    details: Details
    id: Int!
    tag: String!
    role: RoleType!
    notes: String
    updatedAt: String!
    startDate: String!
    currentMood: Mood!
    isAvailable: Boolean!
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

  enum ProgrammingLanguage {
    CSHARP
    GO
    RUST
    TYPESCRIPT
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
`;

describe('Operations to Proto - Union and Interface Support (Priority 1)', () => {
  describe('Union Types in Operations', () => {
    test.skip('should handle union types in query responses', () => {
      const operation = {
        name: 'GetProducts',
        content: `
          query GetProducts {
            products {
              ... on Consultancy {
                upc
                lead {
                  id
                  tag
                }
                isLeadAvailable
              }
              ... on Cosmo {
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
                unicode
                clientLanguages
              }
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should generate oneof fields for union types
      expect(proto).toContain('oneof products_value {');
      expect(proto).toContain('GetProductsProductsConsultancy consultancy = 1;');
      expect(proto).toContain('GetProductsProductsCosmo cosmo = 2;');
      expect(proto).toContain('GetProductsProductsSDK sdk = 3;');

      // Should generate nested messages for each union member
      expect(proto).toContain('message GetProductsProductsConsultancy {');
      expect(proto).toContain('message GetProductsProductsCosmo {');
      expect(proto).toContain('message GetProductsProductsSDK {');
    });

    test.skip('should handle nested union types in complex queries', () => {
      const operation = {
        name: 'SearchEverything',
        content: `
          query SearchEverything($query: String!) {
            search(query: $query) {
              ... on Employee {
                id
                tag
                details {
                  forename
                  surname
                }
              }
              ... on Products {
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
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should handle nested union within union
      expect(proto).toContain('oneof search_value {');
      expect(proto).toContain('SearchEverythingSearchEmployee employee = 1;');
      expect(proto).toContain('SearchEverythingSearchProducts products = 2;');
      
      // Nested union should have its own oneof
      expect(proto).toContain('message SearchEverythingSearchProducts {');
      expect(proto).toContain('oneof products_value {');
    });

    test.skip('should handle union types in lists', () => {
      const operation = {
        name: 'GetAllProducts',
        content: `
          query GetAllProducts {
            products {
              ... on Consultancy {
                upc
                isLeadAvailable
              }
              ... on Cosmo {
                upc
              }
              ... on SDK {
                upc
                unicode
              }
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should generate repeated union message
      expect(proto).toContain('repeated GetAllProductsProducts products = 1;');
      expect(proto).toContain('message GetAllProductsProducts {');
      expect(proto).toContain('oneof products_value {');
    });
  });

  describe('Interface Types in Operations', () => {
    test.skip('should handle interface types in query responses', () => {
      const operation = {
        name: 'GetNode',
        content: `
          query GetNode($id: ID!) {
            node(id: $id) {
              id
              ... on Employee {
                tag
                currentMood
              }
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should generate oneof fields for interface implementations
      expect(proto).toContain('message GetNodeNode {');
      expect(proto).toContain('oneof node_instance {');
      expect(proto).toContain('GetNodeNodeEmployee employee = 1;');
    });

    test.skip('should handle complex interface hierarchies', () => {
      const operation = {
        name: 'GetEmployeeRole',
        content: `
          query GetEmployeeRole($id: Int!) {
            employee(id: $id) {
              role {
                departments
                title
                ... on Engineer {
                  engineerType
                }
                ... on Marketer {
                  departments
                }
                ... on Operator {
                  operatorType
                }
              }
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should generate interface message with oneof
      expect(proto).toContain('message GetEmployeeRoleEmployeeRole {');
      expect(proto).toContain('oneof role_instance {');
      expect(proto).toContain('GetEmployeeRoleEmployeeRoleEngineer engineer = 1;');
      expect(proto).toContain('GetEmployeeRoleEmployeeRoleMarketer marketer = 2;');
      expect(proto).toContain('GetEmployeeRoleEmployeeRoleOperator operator = 3;');
    });

    test.skip('should handle interface types with shared fields', () => {
      const operation = {
        name: 'GetPets',
        content: `
          query GetPets {
            employee(id: 1) {
              details {
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
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should generate interface message with shared fields and oneof for specific implementations
      expect(proto).toContain('message GetPetsEmployeeDetailsPets {');
      expect(proto).toContain('oneof pets_instance {');
      expect(proto).toContain('GetPetsEmployeeDetailsPetsCat cat = 1;');
      expect(proto).toContain('GetPetsEmployeeDetailsPetsDog dog = 2;');
      expect(proto).toContain('GetPetsEmployeeDetailsPetsAlligator alligator = 3;');
    });
  });

  describe('Mixed Union and Interface Operations', () => {
    test.skip('should handle operations with both unions and interfaces', () => {
      const operation = {
        name: 'ComplexSearch',
        content: `
          query ComplexSearch($query: String!) {
            search(query: $query) {
              ... on Employee {
                id
                role {
                  ... on Engineer {
                    engineerType
                  }
                }
              }
              ... on Products {
                ... on SDK {
                  upc
                  owner {
                    id
                    role {
                      departments
                    }
                  }
                }
              }
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should handle nested union and interface combinations
      expect(proto).toContain('oneof search_value {');
      expect(proto).toContain('oneof role_instance {');
    });
  });
});