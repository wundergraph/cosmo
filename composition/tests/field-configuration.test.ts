import { describe, expect, test } from 'vitest';
import { ConfigurationData, federateSubgraphs, normalizeSubgraphFromString } from '../src';
import { createSubgraph } from './utils/utils';

describe('Field Configuration tests', () => {
  describe('Normalization tests' ,() => {
    test('that field configuration for employees.graphql is correctly generated', () => {
      const { errors, normalizationResult } = normalizeSubgraphFromString(employees);
      expect(errors).toBeUndefined();
      expect(normalizationResult).toBeDefined();
      const configurationDataMap = normalizationResult!.configurationDataMap;
      expect(configurationDataMap).toStrictEqual(new Map<string, ConfigurationData>([
        ['Query', {
          fieldNames: new Set<string>(['employee', 'employees', 'team_mates']),
          isRootNode: true,
          selectionSets: [],
          typeName: 'Query',
        }],
        ['RoleType', {
          fieldNames: new Set<string>(['department', 'title']),
          isRootNode: false,
          selectionSets: [],
          typeName: 'RoleType',
        }],
        ['Identifiable', {
          fieldNames: new Set<string>(['id']),
          isRootNode: false,
          selectionSets: [],
          typeName: 'Identifiable',
        }],
        ['Engineer', {
          fieldNames: new Set<string>(['department', 'engineerType', 'title']),
          isRootNode: false,
          selectionSets: [],
          typeName: 'Engineer',
        }],
        ['Marketer', {
          fieldNames: new Set<string>(['department', 'title']),
          isRootNode: false,
          selectionSets: [],
          typeName: 'Marketer',
        }],
        ['Operator', {
          fieldNames: new Set<string>(['department', 'operatorType', 'title']),
          isRootNode: false,
          selectionSets: [],
          typeName: 'Operator',
        }],
        ['Details', {
          fieldNames: new Set<string>(['forename', 'location', 'surname']),
          isRootNode: false,
          selectionSets: [],
          typeName: 'Details',
        }],
        ['Employee', {
          fieldNames: new Set<string>(['details', 'id', 'role']),
          isRootNode: true,
          selectionSets: ['id'],
          typeName: 'Employee',
        }],
      ]));
    });

    test('that field configuration for family.graphql is correctly generated', () => {
      const { errors, normalizationResult } = normalizeSubgraphFromString(family);
      expect(errors).toBeUndefined();
      expect(normalizationResult).toBeDefined();
      const configurationDataMap = normalizationResult!.configurationDataMap;
      expect(configurationDataMap).toStrictEqual(new Map<string, ConfigurationData>([
        ['Animal', {
          fieldNames: new Set<string>(['class', 'gender']),
          isRootNode: false,
          selectionSets: [],
          typeName: 'Animal',
        }],
        ['Pet', {
          fieldNames: new Set<string>(['class', 'gender', 'name']),
          isRootNode: false,
          selectionSets: [],
          typeName: 'Pet',
        }],
        ['Alligator', {
          fieldNames: new Set<string>(['class', 'dangerous', 'gender', 'name']),
          isRootNode: false,
          selectionSets: [],
          typeName: 'Alligator',
        }],
        ['Cat', {
          fieldNames: new Set<string>(['class', 'gender', 'name', 'type']),
          isRootNode: false,
          selectionSets: [],
          typeName: 'Cat',
        }],
        ['Dog', {
          fieldNames: new Set<string>(['breed', 'class', 'gender', 'name']),
          isRootNode: false,
          selectionSets: [],
          typeName: 'Dog',
        }],
        ['Mouse', {
          fieldNames: new Set<string>(['class', 'gender', 'name']),
          isRootNode: false,
          selectionSets: [],
          typeName: 'Mouse',
        }],
        ['Pony', {
          fieldNames: new Set<string>(['class', 'gender', 'name']),
          isRootNode: false,
          selectionSets: [],
          typeName: 'Pony',
        }],
        ['Details', {
          fieldNames: new Set<string>(['forename', 'surname']),
          isRootNode: false,
          selectionSets: [],
          typeName: 'Details',
        }],
        ['Employee', {
          fieldNames: new Set<string>(['details', 'id', 'hasChildren', 'maritalStatus', 'nationality', 'pets']),
          isRootNode: true,
          selectionSets: ['id'],
          typeName: 'Employee',
        }],
      ]));
    });

    test('that field configuration for hobbies.graphql is correctly generated', () => {
      const { errors, normalizationResult } = normalizeSubgraphFromString(hobbies);
      expect(errors).toBeUndefined();
      expect(normalizationResult).toBeDefined();
      const configurationDataMap = normalizationResult!.configurationDataMap;
      expect(configurationDataMap).toStrictEqual(new Map<string, ConfigurationData>([
        ['Exercise', {
          fieldNames: new Set<string>(['category']),
          isRootNode: false,
          selectionSets: [],
          typeName: 'Exercise',
        }],
        ['Experience', {
          fieldNames: new Set<string>(['yearsOfExperience']),
          isRootNode: false,
          selectionSets: [],
          typeName: 'Experience',
        }],
        ['Flying', {
          fieldNames: new Set<string>(['planeModels', 'yearsOfExperience']),
          isRootNode: false,
          selectionSets: [],
          typeName: 'Flying',
        }],
        ['Gaming', {
          fieldNames: new Set<string>(['genres', 'name', 'yearsOfExperience']),
          isRootNode: false,
          selectionSets: [],
          typeName: 'Gaming',
        }],
        ['Other', {
          fieldNames: new Set<string>(['name']),
          isRootNode: false,
          selectionSets: [],
          typeName: 'Other',
        }],
        ['Programming', {
          fieldNames: new Set<string>(['languages']),
          isRootNode: false,
          selectionSets: [],
          typeName: 'Programming',
        }],
        ['Travelling', {
          fieldNames: new Set<string>(['countriesLived']),
          isRootNode: false,
          selectionSets: [],
          typeName: 'Travelling',
        }],
        ['Employee', {
          fieldNames: new Set<string>(['id', 'hobbies']),
          isRootNode: true,
          selectionSets: ['id'],
          typeName: 'Employee',
        }],
      ]));
    });

    test('that field configuration for products.graphql is correctly generated', () => {
      const { errors, normalizationResult } = normalizeSubgraphFromString(products);
      expect(errors).toBeUndefined();
      expect(normalizationResult).toBeDefined();
      const configurationDataMap = normalizationResult!.configurationDataMap;
      expect(configurationDataMap).toStrictEqual(new Map<string, ConfigurationData>([
        ['Employee', {
          fieldNames: new Set<string>(['id', 'products']),
          isRootNode: true,
          selectionSets: ['id'],
          typeName: 'Employee',
        }],
      ]));
    });
  });

  describe('Federation tests', () => {
    test('that argument configurations are correctly generated', () => {
      const { errors, federationResult } = federateSubgraphs([
        createSubgraph('employees', employees), createSubgraph('family', family),
        createSubgraph('hobbies', hobbies), createSubgraph('products', products),
      ]);
      expect(errors).toBeUndefined();
      expect(federationResult!.argumentConfigurations).toStrictEqual([
        {
          argumentNames: ['id'],
          fieldName: 'employee',
          typeName: 'Query',
        },
        {
          argumentNames: ['team'],
          fieldName: 'team_mates',
          typeName: 'Query',
        },
      ])
    });
  });
});

const employees = `
type Query {
  employee(id: Int!): Employee
  employees: [Employee!]!
  team_mates(team: Department!): [Employee!]!
}

enum Department {
  ENGINEERING
  MARKETING
  OPERATIONS
}

interface RoleType {
  department: Department!
  title: [String!]!
}

enum EngineerType {
  FRONTEND
  BACKEND
  FULLSTACK
}

interface Identifiable {
  id: Int!
}

type Engineer implements RoleType {
  department: Department!
  engineerType: EngineerType!
  title: [String!]!
}

type Marketer implements RoleType{
  department: Department!
  title: [String!]!
}

enum OperationType {
  FINANCE
  HUMAN_RESOURCES
}

type Operator implements RoleType {
  department: Department!
  operatorType: [OperationType!]!
  title: [String!]!
}

enum Country {
  AMERICA
  ENGLAND
  GERMANY
  INDIA
  NETHERLANDS
  PORTUGAL
  SPAIN
  UKRAINE
}

type Details @shareable {
  forename: String!
  location: Country!
  surname: String!
}

type Employee implements Identifiable @key(fields: "id") {
  details: Details! @shareable
  id: Int!
  role: RoleType!
}
`;

const family = `
enum Class {
  Fish
  Mammal
  Reptile
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

interface Pet implements Animal {
  class: Class!
  gender: Gender!
  name: String!
}

enum CatType {
  HOME
  STREET
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

enum DogBreed {
  GOLDEN_RETRIEVER
  POODLE
  ROTTWEILER
  YORKSHIRE_TERRIER
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

type Details  {
  forename: String! @shareable
  surname: String! @shareable
}

type Employee @key(fields: "id") {
  details: Details @shareable
  id: Int!
  # move to details eventually
  hasChildren: Boolean!
  maritalStatus: MaritalStatus
  nationality: Nationality!
  pets: [Pet]
}
`;

const hobbies = `
enum ExerciseType {
  CALISTHENICS
  HIKING
  SPORT
  STRENGTH_TRAINING
}

type Exercise {
  category: ExerciseType!
}

interface Experience {
  yearsOfExperience: Float!
}

type Flying implements Experience {
  planeModels: [String!]!
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

type Gaming implements Experience {
  genres: [GameGenre!]!
  name: String!
  yearsOfExperience: Float!
}

type Other {
  name: String!
}

enum ProgrammingLanguage {
  CSHARP
  GO
  RUST
  TYPESCRIPT
}

type Programming {
  languages: [ProgrammingLanguage!]!
}

enum Country {
  AMERICA
  ENGLAND
  GERMANY
  KOREA
  NETHERLANDS
  INDONESIA
  PORTUGAL
  SERBIA
  SPAIN
  TAIWAN
  THAILAND
}

type Travelling {
  countriesLived: [Country!]!
}

union Hobby = Exercise | Flying | Gaming | Programming | Travelling | Other

type Employee @key(fields: "id") {
  id: Int!
  hobbies: [Hobby!]!
}
`;

const products = `
enum ProductNames {
  CLOUD
  COSMO
  ENGINE
  FINANCE
  HUMAN_RESOURCES
  MARKETING
  SDK
}

type Employee @key(fields: "id") {
  id: Int!
  products: [ProductNames!]!
}
`;