import {
  federateSubgraphs,
  invalidSubgraphNamesError,
  noBaseTypeExtensionError,
  noQueryRootTypeError,
  Subgraph,
} from '../src';
import { parse } from 'graphql';
import { describe, expect, test } from 'vitest';
import {
  documentNodeToNormalizedString,
  normalizeString,
  versionOnePersistedBaseSchema,
  versionTwoPersistedBaseSchema,
} from './utils/utils';
import fs from 'node:fs';
import { join } from 'node:path';

describe('FederationFactory tests', () => {
  test('that trying to federate with non-unique subgraph names returns an error', () => {
    const { errors } = federateSubgraphs([pandas, pandas, users, users]);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(invalidSubgraphNamesError([pandas.name, users.name], []));
  });

  test('that trying to federate with empty subgraph names returns an error', () => {
    const { errors } = federateSubgraphs([emptySubgraph, emptySubgraph]);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    const errorMessage = errors![0].message;
    expect(errorMessage).contains(
      `Subgraphs to be federated must each have a unique, non-empty name.\n` +
        ` The 1st subgraph in the array did not define a name.`,
    );
    expect(errorMessage).contains(
      ` The 2nd subgraph in the array did not define a name.` +
        ` Consequently, any further errors will temporarily identify this subgraph as "`,
    );
  });

  test('that trying to federate with both non-unique and empty subgraph names returns an error', () => {
    const { errors } = federateSubgraphs([users, users, pandas, pandas, emptySubgraph, emptySubgraph, emptySubgraph]);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    const errorMessage = errors![0].message;
    expect(errorMessage).contains(
      `Subgraphs to be federated must each have a unique, non-empty name.\n` +
        ` The following subgraph names are not unique:\n  "users", "pandas"\n` +
        ` The 5th subgraph in the array did not define a name.` +
        ` Consequently, any further errors will temporarily identify this subgraph as "`,
    );
    expect(errorMessage).contains(
      ` The 6th subgraph in the array did not define a name.` +
        ` Consequently, any further errors will temporarily identify this subgraph as "`,
    );
    expect(errorMessage).contains(
      ` The 7th subgraph in the array did not define a name.` +
        ` Consequently, any further errors will temporarily identify this subgraph as "`,
    );
  });

  test('that the demo subgraphs federate to generate the correct federated graph', () => {
    const { errors, federationResult } = federateSubgraphs([demoEmployees, demoFamily, demoHobbies, demoProducts]);
    expect(errors).toBeUndefined();
    expect(errors).toBeUndefined();
    expect(documentNodeToNormalizedString(federationResult!.federatedGraphAST)).toBe(
      normalizeString(
        versionTwoPersistedBaseSchema +
          `
        interface RoleType {
          departments: [Department!]!
          title: [String!]!
        }
        
        interface Identifiable {
          id: Int!
        }
        
        union Products = Consultancy | Cosmo | SDK | Documentation
        
        interface IProduct {
          upc: ID!
          engineers: [Employee!]!
        }
        
        interface Animal {
          class: Class!
          gender: Gender!
        }
        
        interface Experience {
          yearsOfExperience: Float!
        }
        
        union Hobby = Exercise | Flying | Gaming | Programming | Travelling | Other
        
        interface TopSecretFact {
          description: FactContent! @authenticated @requiresScopes(scopes: [["read:scalar"], ["read:all"]])
          factType: TopSecretFactType @authenticated
        }
        
        type Query {
          employee(id: Int!): Employee
          employees: [Employee!]!
          products: [Products!]!
          teammates(team: Department!): [Employee!]!
          findEmployees(criteria: SearchInput): [Employee!]!
          productTypes: [Products!]!
          topSecretFederationFacts: [TopSecretFact!]! @requiresScopes(scopes: [["read:fact"], ["read:all"]])
          factTypes: [TopSecretFactType!] @authenticated
        }
        
        type Mutation {
          updateEmployeeTag(id: Int!, tag: String!): Employee
        }
        
        type Subscription {
          """\`currentTime\` will return a stream of \`Time\` objects."""
          currentTime: Time!
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
        
        enum OperationType {
          FINANCE
          HUMAN_RESOURCES
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
          INDONESIA
          KOREA
          SERBIA
          TAIWAN
          THAILAND
        }
        
        type Details {
          forename: String!
          location: Country!
          surname: String!
          middlename: String @deprecated
          hasChildren: Boolean!
          maritalStatus: MaritalStatus
          nationality: Nationality!
          pets: [Pet]
        }
        
        type Time {
          unixTime: Int!
          timeStamp: String!
        }
        
        type Consultancy {
          upc: ID!
          lead: Employee!
          name: ProductName!
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
        
        type Exercise {
          category: ExerciseType!
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
        
        type Travelling {
          countriesLived: [Country!]!
        }
        
        enum TopSecretFactType {
          DIRECTIVE
          ENTITY
          MISCELLANEOUS
        }
        
        scalar FactContent
        
        enum ProductName {
          CONSULTANCY
          COSMO
          ENGINE
          FINANCE
          HUMAN_RESOURCES
          MARKETING
          SDK
        }
        
        type Documentation {
          url(product: ProductName!): String!
          urls(products: [ProductName!]!): [String!]!
        }
        
        interface Pet implements Animal {
          class: Class!
          gender: Gender!
          name: String!
        }
        
        type Engineer implements RoleType {
          departments: [Department!]!
          engineerType: EngineerType!
          title: [String!]!
        }
        
        type Marketer implements RoleType {
          departments: [Department!]!
          title: [String!]!
        }
        
        type Operator implements RoleType {
          departments: [Department!]!
          operatorType: [OperationType!]!
          title: [String!]!
        }

        type Employee implements Identifiable {
          details: Details
          id: Int!
          tag: String!
          role: RoleType!
          updatedAt: String!
          startDate: String! @requiresScopes(scopes: [["read:employee", "read:private"], ["read:all"]])
          hobbies: [Hobby!]!
          products: [ProductName!]!
          notes: String
        }
        
        type Cosmo implements IProduct {
          upc: ID!
          engineers: [Employee!]!
          lead: Employee!
          name: ProductName!
          repositoryURL: String!
        }
        
        type SDK implements IProduct {
          upc: ID!
          engineers: [Employee!]!
          owner: Employee!
          clientLanguages: [ProgrammingLanguage!]!
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
        
        type Flying implements Experience {
          planeModels: [String!]!
          yearsOfExperience: Float!
        }
        
        type Gaming implements Experience {
          genres: [GameGenre!]!
          name: String!
          yearsOfExperience: Float!
        }
        
        type DirectiveFact implements TopSecretFact {
          title: String! @authenticated
          description: FactContent! @authenticated @requiresScopes(scopes: [["read:scalar"], ["read:all"]])
          factType: TopSecretFactType @authenticated
        }
        
        type EntityFact implements TopSecretFact {
          title: String! @requiresScopes(scopes: [["read:entity"]])
          description: FactContent! @authenticated @requiresScopes(scopes: [["read:entity", "read:scalar"], ["read:entity", "read:all"]])
          factType: TopSecretFactType @authenticated @requiresScopes(scopes: [["read:entity"]])
        }
        
        type MiscellaneousFact implements TopSecretFact {
          title: String!
          description: FactContent! @authenticated @requiresScopes(scopes: [["read:miscellaneous", "read:scalar"], ["read:miscellaneous", "read:all"]])
          factType: TopSecretFactType @authenticated
        }
      `,
      ),
    );
  });

  test('that subgraphs are federated #1', () => {
    const { errors, federationResult } = federateSubgraphs([pandas, products, reviews, users]);
    expect(errors).toBeUndefined();
    expect(documentNodeToNormalizedString(federationResult!.federatedGraphAST)).toBe(
      normalizeString(
        versionTwoPersistedBaseSchema +
          `
      interface SkuItf {
        sku: String
      }
      
      type Query {
        allPandas: [Panda]
        panda(name: ID!): Panda
        allProducts: [ProductItf]
        product(id: ID!): ProductItf
        review(id: Int!): Review
      }

      type Panda {
        name: ID!
        favoriteFood: String @tag(name: "nom-nom-nom")
      }

      enum ShippingClass {
        STANDARD
        EXPRESS
      }

      type ProductVariation {
        id: ID!
        name: String
      }

      type ProductDimension {
        size: String
        weight: Float
      }

      type User {
        email: ID! @tag(name: "test-from-users")
        totalProductsCreated: Int
        name: String
      }

      type Review {
        id: Int!
        body: String!
      }

      interface ProductItf implements SkuItf {
        id: ID!
        sku: String
        name: String
        package: String
        variation: ProductVariation
        dimensions: ProductDimension
        createdBy: User
        oldField: String @deprecated(reason: "refactored out")
        reviewsCount: Int!
        reviewsScore: Float!
        reviews: [Review!]!
      }
      
      type Product implements ProductItf & SkuItf {
        id: ID! @tag(name: "hi-from-products")
        sku: String
        name: String
        package: String
        variation: ProductVariation
        dimensions: ProductDimension
        createdBy: User
        hidden: String
        oldField: String
        reviewsCount: Int!
        reviewsScore: Float!
        reviews: [Review!]!
      }
    `,
      ),
    );
  });

  test('that subgraphs are federated #2', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphB]);
    expect(errors).toBeUndefined();
    expect(documentNodeToNormalizedString(federationResult!.federatedGraphAST)).toBe(
      normalizeString(
        versionTwoPersistedBaseSchema +
          `
      type Query {
        pokemon: [Pokemon]
        trainer: [Trainer!]!
      }

      type Trainer {
        id: Int!
        name: String
        pokemon: [Pokemon!]!
      }

      type Pokemon {
        name: String
        level: Int!
        moves: [Move!]!
      }

      type Move {
        name: String!
        pp: Int!
        hasEffect: Boolean!
      }`,
      ),
    );
  });

  test('that extension orphans return an error', () => {
    const { errors } = federateSubgraphs([subgraphC, subgraphD]);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(noBaseTypeExtensionError('Entity'));
  });

  test('that root types are promoted', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphE]);
    expect(errors).toBeUndefined();
    expect(documentNodeToNormalizedString(federationResult!.federatedGraphAST)).toBe(
      normalizeString(
        versionOnePersistedBaseSchema +
          `
      type Query {
        string: String
      }  
    `,
      ),
    );
  });

  test('that custom root types are renamed', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphF]);
    expect(errors).toBeUndefined();
    expect(documentNodeToNormalizedString(federationResult!.federatedGraphAST)).toBe(
      normalizeString(
        versionOnePersistedBaseSchema +
          `
      type Query {
        string: String
      }  
    `,
      ),
    );
  });

  test('that _Any, _Entity, _Service, _service, _entities, are not included in the federated graph', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphG, subgraphH]);
    expect(errors).toBeUndefined();
    expect(documentNodeToNormalizedString(federationResult!.federatedGraphAST)).toBe(
      normalizeString(
        versionOnePersistedBaseSchema +
          `
      type Query {
        string: String
      }
      
      type User {
        id: String
      }
    `,
      ),
    );
  });

  // TODO reassess
  test.skip('that tag and inaccessible directives are persisted in the federated schema', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphI, subgraphJ]);
    expect(errors).toBeUndefined();
    expect(documentNodeToNormalizedString(federationResult!.federatedGraphAST)).toBe(
      normalizeString(
        versionTwoPersistedBaseSchema +
          `
      interface I @tag(name: "interface1") @tag(name: "interface2") @inaccessible {
        i: Int!
      }

      type Query @tag(name: "object2") @tag(name: "object1") {
        dummy: String @tag(name: "field1") @tag(name: "field2")
      }
      
      enum E @tag(name: "enum1") @tag(name: "enum2") @inaccessible {
        A @tag(name: "enum value2") @tag(name: "enum value1") @inaccessible
      }
      
      input In @tag(name: "input object1") @tag(name: "input object2") @inaccessible {
        field: String @tag(name: "input value2") @tag(name: "input value1") @inaccessible
      }
      
      scalar S @tag(name: "scalar1") @tag(name: "scalar2") @inaccessible
            
      type O implements I @tag(name: "object2") @tag(name: "object1") @inaccessible {
        i: Int!
      }
    `,
      ),
    );
  });

  test('that valid executable directives are merged and persisted in the federated graph', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphK, subgraphL]);
    expect(errors).toBeUndefined();
    expect(documentNodeToNormalizedString(federationResult!.federatedGraphAST)).toBe(
      normalizeString(
        versionOnePersistedBaseSchema +
          `
        directive @executableDirective(requiredArgInAll: String!, requiredArgInSome: Int!, optionalArgInAll: Float) on FIELD
        
        type Query {
          dummy: String
        }  
      `,
      ),
    );
  });

  test('that all nested entity keys are considered to be shareable', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphM, subgraphN]);
    expect(errors).toBeUndefined();
    expect(documentNodeToNormalizedString(federationResult!.federatedGraphAST)).toBe(
      normalizeString(
        versionTwoPersistedBaseSchema +
          `
    type Query {
      user: User!
    }
    
    type User {
      name: String!
      nestedObjectOne: NestedObjectOne!
      nestedObjectTwo: NestedObjectTwo!
      age: Int!
    }
    
    type NestedObjectOne {
      name: String!
    }
    
    type NestedObjectTwo {
      innerNestedObject: InnerNestedObject!
    }
    
    type InnerNestedObject {
      fieldOne: String!
      fieldTwo: Int!
    }
      `,
      ),
    );
  });
  test('that _entities and _service are removed even if a root type is renamed', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphF, subgraphO]);
    expect(errors).toBeUndefined();
    expect(documentNodeToNormalizedString(federationResult!.federatedGraphAST)).toBe(
      normalizeString(
        versionOnePersistedBaseSchema +
          `
      type Query {
        string: String
        user: User!
      }
      
      type User {
        id: ID!
        name: String!
      }
    `,
      ),
    );
  });

  test('that an error is returned if the federated graph has no query object', () => {
    const { errors } = federateSubgraphs([subgraphP]);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(noQueryRootTypeError);
  });

  test('that an error is returned if the federated graph has no populated query object', () => {
    const { errors } = federateSubgraphs([subgraphP, subgraphQ]);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(noQueryRootTypeError);
  });
});

const demoEmployees: Subgraph = {
  name: 'employees',
  url: '',
  definitions: parse(fs.readFileSync(join(process.cwd(), 'tests/test-data/employees.graphql')).toString()),
};

const demoFamily: Subgraph = {
  name: 'family',
  url: '',
  definitions: parse(fs.readFileSync(join(process.cwd(), 'tests/test-data/family.graphql')).toString()),
};

const demoHobbies: Subgraph = {
  name: 'hobbies',
  url: '',
  definitions: parse(fs.readFileSync(join(process.cwd(), 'tests/test-data/hobbies.graphql')).toString()),
};

const demoProducts: Subgraph = {
  name: 'products',
  url: '',
  definitions: parse(fs.readFileSync(join(process.cwd(), 'tests/test-data/products.graphql')).toString()),
};

const subgraphA: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    directive @external on FIELD_DEFINITION | OBJECT
    directive @key(fields: String!) on INTERFACE | OBJECT
    directive @provides(fields: String!) on FIELD_DEFINITION
    directive @requires(fields: String!) on FIELD_DEFINITION
    directive @shareable on FIELD_DEFINITION | OBJECT

    type Query {
      pokemon: [Pokemon] @shareable
    }

    type Trainer @key(fields: "id") {
      id: Int!
      name: String @shareable
    }

    type Pokemon {
      name: String! @shareable
      level: Int! @shareable
      moves: [Move!]!  @shareable
    }

    type Move {
      name: String! @shareable
      pp: Int! @shareable
    }
  `),
};

const subgraphB: Subgraph = {
  name: 'subgraph-b',
  url: '',
  definitions: parse(`
    type Query {
      trainer: [Trainer!]!
      pokemon: [Pokemon!]! @shareable
    }

    type Trainer @key(fields: "id") {
      id: Int!
      name: String! @shareable
      pokemon: [Pokemon!]!
    }

    type Pokemon {
      name: String @shareable
      level: Int! @shareable
      moves: [Move!]! @shareable
    }

    type Move @shareable {
      name: String!
      pp: Int!
      hasEffect: Boolean!
    }
  `),
};

const pandas: Subgraph = {
  name: 'pandas',
  url: '',
  definitions: parse(`
    type Query {
      allPandas: [Panda]
      panda(name: ID!): Panda
    }

    type Panda {
      name:ID!
      favoriteFood: String @tag(name: "nom-nom-nom")
    }
  `),
};

const products: Subgraph = {
  name: 'products',
  url: '',
  definitions: parse(`
    directive @myDirective(a: String!) on FIELD_DEFINITION
    directive @hello on FIELD_DEFINITION

    type Query {
      allProducts: [ProductItf]
      product(id: ID!): ProductItf
    }

    interface SkuItf {
      sku: String
    }

    interface ProductItf implements SkuItf {
      id: ID!
      sku: String
      name: String
      package: String
      variation: ProductVariation
      dimensions: ProductDimension
      createdBy: User
      oldField: String @deprecated(reason: "refactored out")
    }

    type Product implements ProductItf & SkuItf @key(fields: "id") @key(fields: "sku package") @key(fields: "sku variation { id }"){
      id: ID! @tag(name: "hi-from-products")
      sku: String
      name: String @hello
      package: String
      variation: ProductVariation
      dimensions: ProductDimension
      createdBy: User
      hidden: String
      reviewsScore: Float! @shareable
      oldField: String
    }

    enum ShippingClass {
      STANDARD
      EXPRESS
    }

    type ProductVariation {
      id: ID!
      name: String
    }

    type ProductDimension @shareable {
      size: String
      weight: Float
    }

    type User @key(fields: "email") {
      email: ID!
      totalProductsCreated: Int @shareable
    }
  `),
};

const reviews: Subgraph = {
  name: 'reviews',
  url: '',
  definitions: parse(`
    directive @override(from: String!) on FIELD_DEFINITION
  
    type Query {
      review(id: Int!): Review
    }

    type Product implements ProductItf @key(fields: "id") {
      id: ID!
      reviewsCount: Int!
      reviewsScore: Float! @shareable @override(from: "products")
      reviews: [Review!]!
    }

    interface ProductItf {
      id: ID!
      reviewsCount: Int!
      reviewsScore: Float!
      reviews: [Review!]!
    }

    type Review {
      id: Int!
      body: String!
    }
  `),
};

const users: Subgraph = {
  name: 'users',
  url: '',
  definitions: parse(`
    type User @key(fields:"email") {
      email:ID! @tag(name: "test-from-users")
      name: String
      totalProductsCreated: Int @shareable
    }
  `),
};

const emptySubgraph: Subgraph = {
  name: '',
  url: '',
  definitions: parse(`
    scalar String
  `),
};

const subgraphC: Subgraph = {
  name: 'subgraph-c',
  url: '',
  definitions: parse(`
    schema {
      query: Query
    }
    
    type Query {
      string: String
    }  
  `),
};

const subgraphD: Subgraph = {
  name: 'subgraph-d',
  url: '',
  definitions: parse(`
    extend type Entity @key(fields: "id") {
      id: ID!
    }    
  `),
};

const subgraphE: Subgraph = {
  name: 'subgraph-e',
  url: '',
  definitions: parse(`
    extend type Query {
      string: String
    }
  `),
};

const subgraphF: Subgraph = {
  name: 'subgraph-f',
  url: '',
  definitions: parse(`
    schema {
      query: CustomQuery
    }
    type CustomQuery {
      string: String
    }
  `),
};

const subgraphG: Subgraph = {
  name: 'subgraph-g',
  url: '',
  definitions: parse(`
    type Query {
      string: String
      _service: _Service
      _entities(representations: [_Any!]!): [_Entity]!
    }

    type _Service{
      sdl: String
    }

    union _Entity = User

    type User @key(fields: "id"){
      id: String
    }

    scalar _Any
  `),
};

const subgraphH: Subgraph = {
  name: 'subgraph-h',
  url: '',
  definitions: parse(`
    type Query {
      string: String
      _service: _Service
      _entities(representations: [_Any!]!): [_Entity]!
    }

    type _Service{
      sdl: String
    }

    union _Entity = User

    type User @key(fields: "id"){
      id: String
    }

    scalar _Any
  `),
};

const subgraphI: Subgraph = {
  name: 'subgraph-i',
  url: '',
  definitions: parse(`
    type Query @shareable @tag(name: "object2") @tag(name: "object1") @tag(name: "object1") {
      dummy: String @tag(name: "field1") @tag(name: "field1") @tag(name: "field2")
    }
    
    enum E @tag(name: "enum1") @inaccessible @tag(name: "enum1") @tag(name: "enum2") {
      A @tag(name: "enum value2") @tag(name: "enum value2") @tag(name: "enum value1") @inaccessible
    }
    
    input In @tag(name: "input object1") @tag(name: "input object1") @tag(name: "input object2") {
      field: String @tag(name: "input value2") @tag(name: "input value2") @tag(name: "input value1") @inaccessible
    }
    
    interface I @tag(name: "interface1") @inaccessible @tag(name: "interface1") @tag(name: "interface2") {
      i: Int!
      field: String @tag(name: "field1") @tag(name: "field1") @inaccessible @tag(name: "field2")
    }
    
    type O implements I @inaccessible @tag(name: "object2") @tag(name: "object1") @tag(name: "object1") @shareable {
      i: Int!
      field: String @tag(name: "field1") @inaccessible @tag(name: "field1") @tag(name: "field2")
    }
    
    scalar S @tag(name: "scalar1") @tag(name: "scalar2") @inaccessible @tag(name: "scalar1")
  `),
};

const subgraphJ: Subgraph = {
  name: 'subgraph-j',
  url: '',
  definitions: parse(`
    enum E @inaccessible @tag(name: "enum2") @tag(name: "enum2") @tag(name: "enum1") {
      A @tag(name: "enum value1") @tag(name: "enum value2") @tag(name: "enum value1")
    }
    
    input In @tag(name: "input object1") @inaccessible @tag(name: "input object1") @tag(name: "input object2") {
      field: String @tag(name: "input value1") @inaccessible @tag(name: "input value2") @tag(name: "input value1")
    }
    
    interface I @tag(name: "interface1") @tag(name: "interface1") @inaccessible @tag(name: "interface2") {
      field: String @inaccessible @tag(name: "field1") @tag(name: "field1") @tag(name: "field2")
    }
    
    type O implements I @tag(name: "object2") @shareable @tag(name: "object1") @inaccessible @tag(name: "object1") {
      field: String @tag(name: "field1") @tag(name: "field1") @inaccessible @tag(name: "field2")
    }
    
    scalar S @tag(name: "scalar1") @tag(name: "scalar2") @tag(name: "scalar1") @inaccessible
  `),
};

const subgraphK: Subgraph = {
  name: 'subgraph-k',
  url: '',
  definitions: parse(`
    directive @executableDirective(requiredArgInAll: String!, requiredArgInSome: Int!, optionalArgInAll: Float, optionalArg: Boolean) on FIELD | SCHEMA | FIELD_DEFINITION
  
    type Query {
      dummy: String
    }
  `),
};

const subgraphL: Subgraph = {
  name: 'subgraph-l',
  url: '',
  definitions: parse(`
    directive @executableDirective(requiredArgInAll: String!, requiredArgInSome: Int, optionalArgInAll: Float) on FIELD | OBJECT
  `),
};

const subgraphM: Subgraph = {
  name: 'subgraph-m',
  url: '',
  definitions: parse(`
    type Query {
      user: User!
    }
    
    type User @key(fields: "nestedObjectOne { name }")
    @key(fields: """
      nestedObjectTwo {
        innerNestedObject {
          fieldOne
          fieldTwo
        }
      }
      name
    """)  {
      name: String!
      nestedObjectOne: NestedObjectOne!
      nestedObjectTwo: NestedObjectTwo!
      age: Int! @shareable
    }
    
    type NestedObjectOne {
      name: String!
    }
    
    type NestedObjectTwo {
      innerNestedObject: InnerNestedObject!
    }
    
    type InnerNestedObject {
      fieldOne: String!
      fieldTwo: Int!
    }
`),
};

const subgraphN: Subgraph = {
  name: 'subgraph-n',
  url: '',
  definitions: parse(`
    type User @key(fields: "nestedObjectOne { name }")
    @key(fields: """
      nestedObjectTwo {
        innerNestedObject {
          fieldOne
          fieldTwo
        }
      }
      name
    """)  {
      name: String!
      nestedObjectOne: NestedObjectOne!
      nestedObjectTwo: NestedObjectTwo!
      age: Int! @shareable
    }
    
    type NestedObjectOne {
      name: String!
    }
    
    type NestedObjectTwo {
      innerNestedObject: InnerNestedObject!
    }
    
    type InnerNestedObject {
      fieldOne: String!
      fieldTwo: Int!
    }
`),
};

const subgraphO: Subgraph = {
  name: 'subgraph-o',
  url: '',
  definitions: parse(`
    schema {
      query: Queries
    }
    
    type Queries {
      user: User!
      _entities(representations: [_Any!]!): [_Entity]
      _service: _Service
    }
    
    type User @key(fields: "id") {
      id: ID!
      name: String!
    }
    
    union _Entity = User
    
    type _Service {
      sdl: String
    }
    
    scalar _Any
`),
};

const subgraphP: Subgraph = {
  name: 'subgraph-p',
  url: '',
  definitions: parse(`
    scalar Dummy
  `),
};

const subgraphQ: Subgraph = {
  name: 'subgraph-q',
  url: '',
  definitions: parse(`
    type Query
  `),
};
