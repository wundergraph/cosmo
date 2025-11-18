import {
  incompatibleParentTypeMergeError,
  INPUT_OBJECT,
  InputObjectDefinitionData,
  invalidSubgraphNamesError,
  KEY,
  noBaseDefinitionForExtensionError,
  noQueryRootTypeError,
  OBJECT,
  ObjectDefinitionData,
  parse,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  SCALAR,
  ScalarDefinitionData,
  SHAREABLE,
  stringToNamedTypeNode,
  Subgraph,
  SubgraphName,
} from '../../src';
import { describe, expect, test } from 'vitest';
import {
  AUTHENTICATED_DIRECTIVE,
  INACCESSIBLE_DIRECTIVE,
  OPENFED_FIELD_SET,
  OPENFED_SCOPE,
  REQUIRES_SCOPES_DIRECTIVE,
  SCHEMA_ALL_ROOTS_DEFINITION,
  SCHEMA_QUERY_DEFINITION,
  TAG_DIRECTIVE,
} from './utils/utils';
import fs from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  federateSubgraphsFailure,
  federateSubgraphsSuccess,
  normalizeString,
  schemaToSortedNormalizedString,
} from '../utils/utils';
import { Kind } from 'graphql';

// @ts-ignore
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('FederationFactory tests', () => {
  test('that trying to federate with non-unique subgraph names returns an error', () => {
    const result = federateSubgraphsFailure([pandas, pandas, users, users], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(invalidSubgraphNamesError([pandas.name, users.name], []));
  });

  test('that trying to federate with empty subgraph names returns an error', () => {
    const result = federateSubgraphsFailure([emptySubgraph, emptySubgraph], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(result.errors).toHaveLength(1);
    const errorMessage = result.errors![0].message;
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
    const result = federateSubgraphsFailure(
      [users, users, pandas, pandas, emptySubgraph, emptySubgraph, emptySubgraph],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(result.errors).toHaveLength(1);
    const errorMessage = result.errors![0].message;
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
    const { federatedGraphSchema } = federateSubgraphsSuccess(
      [demoEmployees, demoFamily, demoHobbies, demoProducts],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_ALL_ROOTS_DEFINITION +
          AUTHENTICATED_DIRECTIVE +
          REQUIRES_SCOPES_DIRECTIVE +
          ` 
      type Alligator implements Animal & Pet {
        class: Class!
        dangerous: String!
        gender: Gender!
        name: String!
      }
      
      interface Animal {
        class: Class!
        gender: Gender!
      }
      
      type Cat implements Animal & Pet {
        class: Class!
        gender: Gender!
        name: String!
        type: CatType!
      }
      
      enum CatType {
        HOME
        STREET
      }
      
      enum Class {
        FISH
        MAMMAL
        REPTILE
      }
      
      type Consultancy {
        lead: Employee!
        name: ProductName!
        upc: ID!
      }
      
      type Cosmo implements IProduct {
        engineers: [Employee!]!
        lead: Employee!
        name: ProductName!
        repositoryURL: String!
        upc: ID!
      }
      
      enum Country {
        AMERICA
        ENGLAND
        GERMANY
        INDIA
        INDONESIA
        KOREA
        NETHERLANDS
        PORTUGAL
        SERBIA
        SPAIN
        TAIWAN
        THAILAND
        UKRAINE
      }
      
      enum Department {
        ENGINEERING
        MARKETING
        OPERATIONS
      }
      
      type Details {
        forename: String!
        hasChildren: Boolean!
        location: Country!
        maritalStatus: MaritalStatus
        middlename: String @deprecated(reason: "No longer supported")
        nationality: Nationality!
        pets: [Pet]
        surname: String!
      }
      
      type DirectiveFact implements TopSecretFact @authenticated {
        description: FactContent!
        factType: TopSecretFactType
        title: String!
      }
      
      type Documentation {
        url(product: ProductName!): String!
        urls(products: [ProductName!]!): [String!]!
      }
      
      type Dog implements Animal & Pet {
        breed: DogBreed!
        class: Class!
        gender: Gender!
        name: String!
      }
      
      enum DogBreed {
        GOLDEN_RETRIEVER
        POODLE
        ROTTWEILER
        YORKSHIRE_TERRIER
      }
      
      type Employee implements Identifiable {
        details: Details
        hobbies: [Hobby!]!
        id: Int!
        notes: String
        products: [ProductName!]!
        role: RoleType!
        startDate: String! @requiresScopes(scopes: [["read:employee", "read:private"], ["read:all"]])
        tag: String!
        updatedAt: String!
      }
      
      type Engineer implements RoleType {
        departments: [Department!]!
        engineerType: EngineerType!
        title: [String!]!
      }
      
      enum EngineerType {
        BACKEND
        FRONTEND
        FULLSTACK
      }
      
      type EntityFact implements TopSecretFact @requiresScopes(scopes: [["read:entity"]]) {
        description: FactContent!
        factType: TopSecretFactType
        title: String!
      }
      
      type Exercise {
        category: ExerciseType!
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
      
      scalar FactContent @requiresScopes(scopes: [["read:scalar"], ["read:all"]])

      type Flying implements Experience {
        planeModels: [String!]!
        yearsOfExperience: Float!
      }
      
      enum GameGenre {
        ADVENTURE
        BOARD
        CARD
        FPS
        ROGUELITE
        RPG
        SIMULATION
        STRATEGY
      }
      
      type Gaming implements Experience {
        genres: [GameGenre!]!
        name: String!
        yearsOfExperience: Float!
      }
      
      enum Gender {
        FEMALE
        MALE
        UNKNOWN
      }
      
      union Hobby = Exercise | Flying | Gaming | Other | Programming | Travelling
      
      interface IProduct {
        engineers: [Employee!]!
        upc: ID!
      }
      
      interface Identifiable {
        id: Int!
      }
      
      enum MaritalStatus {
        ENGAGED
        MARRIED
      }
      
      type Marketer implements RoleType {
        departments: [Department!]!
        title: [String!]!
      }

      type MiscellaneousFact implements TopSecretFact {
        description: FactContent! @requiresScopes(scopes: [["read:miscellaneous"]])
        factType: TopSecretFactType
        title: String!
      }
      
      type Mouse implements Animal & Pet {
        class: Class!
        gender: Gender!
        name: String!
      }

      type Mutation {
        updateEmployeeTag(id: Int!, tag: String!): Employee
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
      
      input NestedSearchInput {
        hasChildren: Boolean
        maritalStatus: MaritalStatus
      }
      
      enum OperationType {
        FINANCE
        HUMAN_RESOURCES
      }
      
      type Operator implements RoleType {
        departments: [Department!]!
        operatorType: [OperationType!]!
        title: [String!]!
      }
      
      type Other {
        name: String!
      }
      
      interface Pet implements Animal {
        class: Class!
        gender: Gender!
        name: String!
      }
      
      type Pony implements Animal & Pet {
        class: Class!
        gender: Gender!
        name: String!
      }

      enum ProductName {
        CONSULTANCY
        COSMO
        ENGINE
        FINANCE
        HUMAN_RESOURCES
        MARKETING
        SDK
      }
      
      union Products = Consultancy | Cosmo | Documentation | SDK

      type Programming {
        languages: [ProgrammingLanguage!]!
      }
      
      enum ProgrammingLanguage {
        CSHARP
        GO
        RUST
        TYPESCRIPT
      }
      
      type Query {
        employee(id: Int!): Employee
        employees: [Employee!]!
        factTypes: [TopSecretFactType!]
        findEmployees(criteria: SearchInput): [Employee!]!
        productTypes: [Products!]!
        products: [Products!]!
        teammates(team: Department!): [Employee!]!
        topSecretFederationFacts: [TopSecretFact!]! @requiresScopes(scopes: [["read:fact"], ["read:all"]])
      }

      interface RoleType {
        departments: [Department!]!
        title: [String!]!
      }

      type SDK implements IProduct {
        clientLanguages: [ProgrammingLanguage!]!
        engineers: [Employee!]!
        owner: Employee!
        upc: ID!
      }
      
      input SearchInput {
        hasPets: Boolean
        nationality: Nationality
        nested: NestedSearchInput
      }

      type Subscription {
        """\`currentTime\` will return a stream of \`Time\` objects."""
        currentTime: Time!
      }
      
      type Time {
        timeStamp: String!
        unixTime: Int!
      }
      
      interface TopSecretFact @authenticated {
        description: FactContent!
        factType: TopSecretFactType
      }
      
      enum TopSecretFactType @authenticated {
        DIRECTIVE
        ENTITY
        MISCELLANEOUS
      }

      type Travelling {
        countriesLived: [Country!]!
      }
    ` +
          OPENFED_SCOPE,
      ),
    );
  });

  test('that subgraphs are federated #1', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess(
      [pandas, products, reviews, users],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          TAG_DIRECTIVE +
          `
      type Panda {
        favoriteFood: String @tag(name: "nom-nom-nom")
        name: ID!
      }
      
      type Product implements ProductItf & SkuItf {
        createdBy: User
        dimensions: ProductDimension
        hidden: String
        id: ID! @tag(name: "hi-from-products")
        name: String
        oldField: String
        package: String
        reviews: [Review!]!
        reviewsCount: Int!
        reviewsScore: Float!
        sku: String
        variation: ProductVariation
      }

      type ProductDimension {
        size: String
        weight: Float
      }
      
      interface ProductItf implements SkuItf {
        createdBy: User
        dimensions: ProductDimension
        id: ID!
        name: String
        oldField: String @deprecated(reason: "refactored out")
        package: String
        reviews: [Review!]!
        reviewsCount: Int!
        reviewsScore: Float!
        sku: String
        variation: ProductVariation
      }

      type ProductVariation {
        id: ID!
        name: String
      }
      
      type Query {
        allPandas: [Panda]
        allProducts: [ProductItf]
        panda(name: ID!): Panda
        product(id: ID!): ProductItf
        review(id: Int!): Review
      }

      type Review {
        body: String!
        id: Int!
      }
      
      enum ShippingClass {
        EXPRESS
        STANDARD
      }
      
      interface SkuItf {
        sku: String
      }

      type User {
        email: ID! @tag(name: "test-from-users")
        name: String
        totalProductsCreated: Int
      }
    `,
      ),
    );
  });

  test('that subgraphs are federated #2', () => {
    const { federatedGraphSchema, subgraphConfigBySubgraphName } = federateSubgraphsSuccess(
      [subgraphA, subgraphB],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
      type Move {
        hasEffect: Boolean!
        name: String!
        pp: Int!
      }

      type Pokemon {
        level: Int!
        moves: [Move!]!
        name: String
      }

      type Query {
        pokemon: [Pokemon]
        trainer: [Trainer!]!
      }

      type Trainer {
        id: Int!
        name: String
        pokemon: [Pokemon!]!
      }
      `,
      ),
    );

    const subgraphAConfig = subgraphConfigBySubgraphName.get(subgraphA.name);
    expect(subgraphAConfig).toBeDefined();

    const subgraphBConfig = subgraphConfigBySubgraphName.get(subgraphB.name);
    expect(subgraphBConfig).toBeDefined();

    expect(subgraphAConfig!.directiveDefinitionByName).toHaveLength(2);
    expect(subgraphAConfig!.directiveDefinitionByName.has(KEY)).toBe(true);
    expect(subgraphAConfig!.directiveDefinitionByName.has(SHAREABLE)).toBe(true);

    expect(subgraphBConfig!.directiveDefinitionByName).toHaveLength(3);
    expect(subgraphBConfig!.directiveDefinitionByName.has('a')).toBe(true);
    expect(subgraphBConfig!.directiveDefinitionByName.has(KEY)).toBe(true);
    expect(subgraphBConfig!.directiveDefinitionByName.has(SHAREABLE)).toBe(true);
  });

  test('that extension orphans return an error', () => {
    const result = federateSubgraphsFailure([subgraphC, subgraphD], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(noBaseDefinitionForExtensionError(OBJECT, 'Entity'));
  });

  test('that root types are promoted', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess([subgraphE], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
      type Query {
        string: String
      }  
    `,
      ),
    );
  });

  test('that version one subgraph is assigned correctly', () => {
    const { subgraphConfigBySubgraphName } = federateSubgraphsSuccess([subgraphE], ROUTER_COMPATIBILITY_VERSION_ONE);

    const subgraphConfig = subgraphConfigBySubgraphName.get(subgraphE.name);
    expect(subgraphConfig).toBeDefined();
    expect(subgraphConfig?.isVersionTwo).toBe(false);
  });

  test('that version two subgraph is assigned correctly', () => {
    const { subgraphConfigBySubgraphName } = federateSubgraphsSuccess([subgraphJ], ROUTER_COMPATIBILITY_VERSION_ONE);

    const subgraphConfig = subgraphConfigBySubgraphName.get(subgraphJ.name);
    expect(subgraphConfig).toBeDefined();
    expect(subgraphConfig?.isVersionTwo).toBe(true);
  });

  test('that custom root types are renamed', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess([subgraphF], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
      type Query {
        string: String
      }  
    `,
      ),
    );
  });

  test('that _Any, _Entity, _Service, _service, _entities, are not included in the federated graph', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess([subgraphG, subgraphH], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
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

  test('that @tag and @inaccessible persist correctly #1.1', () => {
    const { federatedGraphClientSchema, federatedGraphSchema } = federateSubgraphsSuccess(
      [subgraphI, subgraphJ],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          INACCESSIBLE_DIRECTIVE +
          TAG_DIRECTIVE +
          `
      type Entity {
        enum: Enum!
        enumTwo: EnumTwo! @inaccessible
        field(input: Input!): Int!
        id: ID! @inaccessible
      }
      
      enum Enum @tag(name: "enum1") @tag(name: "enum2") @tag(name: "enum3") {
        A @tag(name: "enum value2") @tag(name: "enum value1") @inaccessible
        B @tag(name: "enum value1") @tag(name: "enum value3")
        C @tag(name: "enum value4") @inaccessible
        D @tag(name: "enum value1") @tag(name: "enum value2")
      }
      
      enum EnumTwo @inaccessible {
        A
      }
      
      input Input @tag(name: "input object1") @tag(name: "input object2") {
        one: String @tag(name: "input value2") @tag(name: "input value1") @inaccessible
        two: Int! @tag(name: "input value1") @tag(name: "input value3")
      }
      
      interface Interface @tag(name: "interface1") @tag(name: "interface2") @inaccessible {
        field: String @tag(name: "field1") @tag(name: "field2") @inaccessible
        id: Int! @inaccessible
      }
      
      type Object implements Interface @tag(name: "object2") @tag(name: "object1") @inaccessible {
        field: String @tag(name: "field1") @tag(name: "field2") @inaccessible
        id: Int! @inaccessible
      }
      
      type Query @tag(name: "object2") @tag(name: "object1") {
        dummy: String @tag(name: "field1") @tag(name: "field2")
        entities: [Entity!]!
        field(scalar: Scalar @inaccessible): String!
        scalar: Scalar @inaccessible
        union: [Union!]!
      }
      
      scalar Scalar @tag(name: "scalar1") @tag(name: "scalar2") @inaccessible
      
      union Union = Entity | Object
    `,
      ),
    );
    expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
      type Entity {
        enum: Enum!
        field(input: Input!): Int!
      }
      
      enum Enum {
        B
        D
      }
      
      input Input {
        two: Int!
      }
      
      type Query {
        dummy: String
        entities: [Entity!]!
        field: String!
        union: [Union!]!
      }
      
      union Union = Entity
    `,
      ),
    );
  });

  test('that @tag and @inaccessible persist correctly #1.2', () => {
    const { federatedGraphClientSchema, federatedGraphSchema } = federateSubgraphsSuccess(
      [subgraphJ, subgraphI],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          INACCESSIBLE_DIRECTIVE +
          TAG_DIRECTIVE +
          `
      type Entity {
        enum: Enum!
        enumTwo: EnumTwo! @inaccessible
        field(input: Input!): Int!
        id: ID! @inaccessible
      }
      
      enum Enum @tag(name: "enum2") @tag(name: "enum1") @tag(name: "enum3") {
        A @tag(name: "enum value2") @tag(name: "enum value1") @inaccessible
        B @tag(name: "enum value1") @tag(name: "enum value3")
        C @tag(name: "enum value4") @inaccessible
        D @tag(name: "enum value1") @tag(name: "enum value2")
      }
      
      enum EnumTwo @inaccessible {
        A
      }
      
      input Input @tag(name: "input object1") @tag(name: "input object2") {
        one: String @tag(name: "input value1") @tag(name: "input value2") @inaccessible
        two: Int! @tag(name: "input value3") @tag(name: "input value1")
      }
      
      interface Interface @tag(name: "interface1") @tag(name: "interface2") @inaccessible {
        field: String @tag(name: "field1") @tag(name: "field2") @inaccessible
        id: Int! @inaccessible
      }
      
      type Object implements Interface @tag(name: "object2") @tag(name: "object1") @inaccessible {
        field: String @tag(name: "field1") @tag(name: "field2") @inaccessible
        id: Int! @inaccessible
      }
      
      type Query @tag(name: "object2") @tag(name: "object1") {
        dummy: String @tag(name: "field1") @tag(name: "field2")
        entities: [Entity!]!
        field(scalar: Scalar @inaccessible): String!
        scalar: Scalar @inaccessible
        union: [Union!]!
      }
      
      scalar Scalar @tag(name: "scalar1") @tag(name: "scalar2") @inaccessible
      
      union Union = Entity | Object
    `,
      ),
    );
    expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
      type Entity {
        enum: Enum!
        field(input: Input!): Int!
      }
      
      enum Enum {
        B
        D
      }
      
      input Input {
        two: Int!
      }
      
      type Query {
        dummy: String
        entities: [Entity!]!
        field: String!
        union: [Union!]!
      }
      
      union Union = Entity
    `,
      ),
    );
  });

  test('that valid executable directives are merged and persisted in the federated graph', () => {
    const result = federateSubgraphsSuccess([subgraphK, subgraphL], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
        directive @executableDirective(optionalArgInAll: Float, requiredArgInAll: String!, requiredArgInSome: Int!) on FIELD
        
        type Query {
          dummy: String
        }
      `,
      ),
    );
  });

  test('that all nested entity keys are considered to be shareable', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess([subgraphM, subgraphN], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
    type InnerNestedObject {
      fieldOne: String!
      fieldTwo: Int!
    }

    type NestedObjectOne {
      name: String!
    }
    
    type NestedObjectTwo {
      innerNestedObject: InnerNestedObject!
    }

    type Query {
      user: User!
    }
    
    type User {
      age: Int!
      name: String!
      nestedObjectOne: NestedObjectOne!
      nestedObjectTwo: NestedObjectTwo!
    }
      `,
      ),
    );
  });

  test('that _entities and _service are removed even if a root type is renamed', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess([subgraphF, subgraphO], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
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
    const result = federateSubgraphsFailure([subgraphP], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(noQueryRootTypeError());
  });

  test('that an error is returned if the federated graph has no populated query object', () => {
    const result = federateSubgraphsFailure([subgraphP, subgraphQ], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toStrictEqual(noQueryRootTypeError(false));
    expect(result.errors[1]).toStrictEqual(noQueryRootTypeError());
  });

  test('that an error is returned when merging incompatible types #1.1', () => {
    const result = federateSubgraphsFailure([subgraphR, subgraphS], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(result.errors).toHaveLength(1);
    const existingData = {
      kind: Kind.SCALAR_TYPE_DEFINITION,
      name: OBJECT,
      subgraphNames: new Set<SubgraphName>([subgraphR.name]),
    } as ScalarDefinitionData;
    expect(result.errors).toStrictEqual([
      incompatibleParentTypeMergeError({
        existingData,
        incomingNodeType: OBJECT,
        incomingSubgraphName: subgraphS.name,
      }),
    ]);
  });

  test('that an error is returned when merging incompatible types #1.2', () => {
    const result = federateSubgraphsFailure([subgraphS, subgraphR], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(result.errors).toHaveLength(1);
    const existingData = {
      kind: Kind.OBJECT_TYPE_DEFINITION,
      name: OBJECT,
      subgraphNames: new Set<SubgraphName>([subgraphS.name]),
    } as ObjectDefinitionData;
    expect(result.errors).toStrictEqual([
      incompatibleParentTypeMergeError({
        existingData,
        incomingNodeType: SCALAR,
        incomingSubgraphName: subgraphR.name,
      }),
    ]);
  });

  test('that an error is returned when merging an object extension orphan with an incompatible base type #1.1', () => {
    const result = federateSubgraphsFailure([subgraphT, subgraphU], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(result.errors).toHaveLength(2);
    const existingData = {
      kind: Kind.OBJECT_TYPE_DEFINITION,
      name: OBJECT,
      subgraphNames: new Set<SubgraphName>([subgraphT.name]),
    } as ObjectDefinitionData;
    expect(result.errors).toStrictEqual([
      incompatibleParentTypeMergeError({
        existingData,
        incomingNodeType: INPUT_OBJECT,
        incomingSubgraphName: subgraphU.name,
      }),
      noBaseDefinitionForExtensionError(OBJECT, OBJECT),
    ]);
  });

  test('that an error is returned when merging an object extension orphan with an incompatible base type #1.2', () => {
    const result = federateSubgraphsFailure([subgraphU, subgraphT], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(result.errors).toHaveLength(1);
    const existingData = {
      kind: Kind.INPUT_OBJECT_TYPE_DEFINITION,
      name: OBJECT,
      subgraphNames: new Set<SubgraphName>([subgraphU.name]),
    } as InputObjectDefinitionData;
    expect(result.errors).toStrictEqual([
      incompatibleParentTypeMergeError({
        existingData,
        incomingNodeType: OBJECT,
        incomingSubgraphName: subgraphT.name,
      }),
    ]);
  });

  test('that renaming a root type also renames field return types of the same type #1.1', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess([subgraphV, subgraphW], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toStrictEqual(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `        
        type NestedObject {
          query: [[[[Query!]]]]!
        }
        
        type Object {
          field: Query
          nestedObject: NestedObject!
        }
        
        type Query {
          dummy: Object!
          myQuery: [Query]
          query: Query
          queryTwo: [[[Query]!]]
        }
    `,
      ),
    );
  });

  test('that renaming a root type also renames field return types of the same type #1.2', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess([subgraphW, subgraphV], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toStrictEqual(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `        
        type NestedObject {
          query: [[[[Query!]]]]!
        }
        
        type Object {
          field: Query
          nestedObject: NestedObject!
        }
        
        type Query {
          dummy: Object!
          myQuery: [Query]
          query: Query
          queryTwo: [[[Query]!]]
        }
    `,
      ),
    );
  });

  test('that renaming a root type also renames field return types of the same type #2.1', () => {
    const { federatedGraphSchema, subgraphConfigBySubgraphName } = federateSubgraphsSuccess(
      [subgraphV, subgraphX],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toStrictEqual(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `        
        type NestedObject {
          query: [[[[Query!]]]]!
        }
        
        type Object {
          field: Query
          nestedObject: NestedObject!
        }
        
        type Query {
          dummy: Object!
          myQuery: [Query]
          queries: [[[Query!]!]]
          query: Query
          queryTwo: [[[Query]!]]
        }
    `,
      ),
    );
    const xConfig = subgraphConfigBySubgraphName.get(subgraphX.name);
    expect(xConfig).toBeDefined();
    expect(xConfig!.schemaNode).toStrictEqual({
      directives: [],
      kind: Kind.SCHEMA_DEFINITION,
      operationTypes: [
        {
          kind: Kind.OPERATION_TYPE_DEFINITION,
          operation: 'query',
          type: stringToNamedTypeNode('Queries'),
        },
      ],
    });
  });

  test('that renaming a root type also renames field return types of the same type #2.2', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess([subgraphX, subgraphV], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toStrictEqual(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `        
        type NestedObject {
          query: [[[[Query!]]]]!
        }
        
        type Object {
          field: Query
          nestedObject: NestedObject!
        }
        
        type Query {
          dummy: Object!
          myQuery: [Query]
          queries: [[[Query!]!]]
          query: Query
          queryTwo: [[[Query]!]]
        }
    `,
      ),
    );
  });
});

const demoEmployees: Subgraph = {
  name: 'employees',
  url: '',
  definitions: parse(fs.readFileSync(join(__dirname, 'test-data/employees.graphql')).toString()),
};

const demoFamily: Subgraph = {
  name: 'family',
  url: '',
  definitions: parse(fs.readFileSync(join(__dirname, 'test-data/family.graphql')).toString()),
};

const demoHobbies: Subgraph = {
  name: 'hobbies',
  url: '',
  definitions: parse(fs.readFileSync(join(__dirname, 'test-data/hobbies.graphql')).toString()),
};

const demoProducts: Subgraph = {
  name: 'products',
  url: '',
  definitions: parse(fs.readFileSync(join(__dirname, 'test-data/products.graphql')).toString()),
};

const subgraphA: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(
    `
    directive @external on FIELD_DEFINITION | OBJECT
    directive @key(fields: openfed__FieldSet!, resolvable: Boolean = true) repeatable on INTERFACE | OBJECT
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
  ` + OPENFED_FIELD_SET,
  ),
};

const subgraphB: Subgraph = {
  name: 'subgraph-b',
  url: '',
  definitions: parse(`
    directive @a on FIELD_DEFINITION | OBJECT
    
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
    type Query @tag(name: "object2") @tag(name: "object1") @tag(name: "object1") {
      dummy: String @tag(name: "field1") @tag(name: "field1") @tag(name: "field2")
      entities: [Entity!]!
    }
    
    extend type Entity @key(fields: "id") {
      id: ID!
      enum: Enum!
    }
    
    enum Enum @tag(name: "enum1") @tag(name: "enum1") @tag(name: "enum2") {
      A @tag(name: "enum value2") @tag(name: "enum value2") @tag(name: "enum value1") @inaccessible
      B @tag(name: "enum value1") @tag(name: "enum value3") @tag(name: "enum value1")
    }
    
    extend enum Enum @tag(name: "enum3") {
      C @tag(name: "enum value4") @inaccessible
    }
    
    input Input @tag(name: "input object1") @tag(name: "input object1") @tag(name: "input object2") {
      one: String @tag(name: "input value2") @tag(name: "input value2") @tag(name: "input value1")
      two: Int @tag(name: "input value1")
    }
    
    interface Interface @tag(name: "interface1") @inaccessible @tag(name: "interface1") @tag(name: "interface2") {
      id: Int! @inaccessible
      field: String @tag(name: "field1") @tag(name: "field1") @inaccessible @tag(name: "field2")
    }
    
    type Object implements Interface @tag(name: "object2") @tag(name: "object1") @tag(name: "object1") @shareable {
      id: Int! @inaccessible
      field: String @tag(name: "field1") @tag(name: "field1") @tag(name: "field2")
    }
    
    scalar Scalar @tag(name: "scalar1") @tag(name: "scalar2") @inaccessible @tag(name: "scalar1")
  `),
};

const subgraphJ: Subgraph = {
  name: 'subgraph-j',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID! @inaccessible
      field(input: Input!): Int!
      enumTwo: EnumTwo! @inaccessible
    }
    
    enum Enum @tag(name: "enum2") @tag(name: "enum2") @tag(name: "enum1") {
      D @tag(name: "enum value1") @tag(name: "enum value2") @tag(name: "enum value1")
    }
    
    enum EnumTwo @inaccessible {
      A
    }
    
    input Input @tag(name: "input object1") @tag(name: "input object1") @tag(name: "input object2") {
      one: String @tag(name: "input value1") @inaccessible @tag(name: "input value2") @tag(name: "input value1")
      two: Int! @tag(name: "input value3")
    }
    
    interface Interface @tag(name: "interface1") @tag(name: "interface1") @tag(name: "interface2") {
      field: String @tag(name: "field1") @tag(name: "field1") @tag(name: "field2")
    }
    
    type Object implements Interface @tag(name: "object2") @shareable @tag(name: "object1") @inaccessible @tag(name: "object1") {
      field: String @tag(name: "field1") @tag(name: "field1") @inaccessible @tag(name: "field2")
    }
    
    extend type Query {
      scalar: Scalar @inaccessible
      field(scalar: Scalar @inaccessible): String!
      union: [Union!]!
    }
    
    scalar Scalar @tag(name: "scalar1") @tag(name: "scalar2") @tag(name: "scalar1") @inaccessible
    
    union Union = Entity | Object
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

const subgraphR: Subgraph = {
  name: 'subgraph-r',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String!
    }
    
    scalar Object
  `),
};

const subgraphS: Subgraph = {
  name: 'subgraph-s',
  url: '',
  definitions: parse(`
    type Object {
      field: String!
    }
  `),
};

const subgraphT: Subgraph = {
  name: 'subgraph-t',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String!
    }
    
    extend type Object @key(fields: "id") {
      id: ID!
    }
  `),
};

const subgraphU: Subgraph = {
  name: 'subgraph-u',
  url: '',
  definitions: parse(`
    input Object {
      field: String!
    }
  `),
};

const subgraphV: Subgraph = {
  name: 'subgraph-v',
  url: '',
  definitions: parse(`
    schema {
      query: MyQuery
    }
    
    type MyQuery {
      dummy: Object!
      query: MyQuery!
      queryTwo: [[[MyQuery]!]]!
      myQuery: [MyQuery]
    }
    
    type Object {
      field: MyQuery
    }
    
    type NestedObject {
      query: [[[[MyQuery!]]]!]!
    }
  `),
};

const subgraphW: Subgraph = {
  name: 'subgraph-w',
  url: '',
  definitions: parse(`
    schema {
      query: Query
    }
    
    type Query {
      dummy: Object!
      query: Query
      queryTwo: [[[Query]!]]
    }
    
    type Object {
      field: Query
      nestedObject: NestedObject!
    }
    
    type NestedObject {
      query: [[[[Query!]]]]!
    }
  `),
};

const subgraphX: Subgraph = {
  name: 'subgraph-x',
  url: '',
  definitions: parse(`
    schema {
      query: Queries
    }
    
    type Queries {
      dummy: Object!
      query: Queries
      queryTwo: [[[Queries]!]]
      queries: [[[Queries!]!]]
    }
    
    type Object {
      field: Queries
      nestedObject: NestedObject!
    }
    
    type NestedObject {
      query: [[[[Queries!]]]]!
    }
  `),
};
