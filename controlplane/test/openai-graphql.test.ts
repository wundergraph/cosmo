import { describe, expect, test } from 'vitest';
import { OpenAIGraphql } from '../../controlplane/src/core/openai-graphql';

describe('OpenAI GraphQL', () => {
  test('Should properly correct schema', async () => {
    if (!process.env.OPENAI_API_KEY) {
      return;
    }
    const ai = new OpenAIGraphql({
      openAiApiKey: process.env.OPENAI_API_KEY,
    });
    const result = await ai.fixSDL({
      sdl: brokenSubgraphSDL,
      checkResult: brokenSubgraphCheckResult,
    });
    expect(result.sdl).toEqual(fixedSubgraphSDL);
  });

  test('Should properly generate a README from a GraphQL schema', async () => {
    if (!process.env.OPENAI_API_KEY) {
      return;
    }
    const ai = new OpenAIGraphql({
      openAiApiKey: process.env.OPENAI_API_KEY,
    });
    const result = await ai.createREADME({
      sdl: schemaSDL,
      graphName: 'MyGraph',
    });

    expect(result.readme).toBeDefined();
  });
});

const brokenSubgraphCheckResult = `
[products] On type "Product", for @key(fields: "sku package"): Cannot query field "package" on type "Product" (the field should either be added to this subgraph or, if it should not be resolved by this subgraph, you need to add it to this subgraph with @external).


type Product @key(fields: "id") @key(fields: "sku package") @key(fields: "sku variation { id }"){
                                                     ^
    id: ID! @tag(name: "hi-from-products")
`;

const brokenSubgraphSDL = `directive @tag(name: String!) repeatable on FIELD_DEFINITION

type Product @key(fields: "id") @key(fields: "sku package") @key(fields: "sku variation { id }"){
  id: ID! @tag(name: "hi-from-products")
  sku: String @tag(name: "hi-from-products")
  variation: ProductVariation
  dimensions: ProductDimension

  createdBy: User @provides(fields: "totalProductsCreated")
}

type ProductVariation {
  id: ID!
}

type ProductDimension {
  size: String
  weight: Float
}

extend type Query {
  allProducts: [Product]
  product(id: ID!): Product
}

extend type User @key(fields: "email") {
  email: ID! @external
  totalProductsCreated: Int @external
}
`;

const fixedSubgraphSDL = `directive @tag(name: String!) repeatable on FIELD_DEFINITION

type Product @key(fields: "id") @key(fields: "sku variation { id }") {
  id: ID! @tag(name: "hi-from-products")
  sku: String @tag(name: "hi-from-products")
  variation: ProductVariation
  dimensions: ProductDimension

  createdBy: User @provides(fields: "totalProductsCreated")
}

type ProductVariation {
  id: ID!
}

type ProductDimension {
  size: String
  weight: Float
}

extend type Query {
  allProducts: [Product]
  product(id: ID!): Product
}

extend type User @key(fields: "email") {
  email: ID! @external
  totalProductsCreated: Int @external
}`;

const schemaSDL = `directive @tag(name: String!) repeatable on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION

directive @inaccessible on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION

union Products = Consultancy | Cosmo | Documentation | SDK

interface Animal {
  class: Class!
  gender: Gender!
}

interface Experience {
  yearsOfExperience: Float!
}

union Hobby = Exercise | Flying | Gaming | Programming | Travelling | Other

interface RoleType {
  departments: [Department!]!
  title: [String!]!
}

interface Identifiable {
  id: Int!
}

interface IProduct {
  upc: ID!
  engineers: [Employee!]!
}

type Query {
  productTypes: [Products!]!
  findEmployees(criteria: SearchInput): [Employee!]!
  employee(id: Int!): Employee
  employees: [Employee!]!
  products: [Products!]!
  teammates(team: Department!): [Employee!]!
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

type Consultancy {
  upc: ID!
  name: ProductName!
  lead: Employee!
}

type Documentation {
  url(product: ProductName!): String!
  urls(products: [ProductName!]!): [String!]!
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

type Details {
  forename: String!
  surname: String!
  hasChildren: Boolean!
  maritalStatus: MaritalStatus
  nationality: Nationality!
  pets: [Pet]
  location: Country!
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

enum Country {
  AMERICA
  ENGLAND
  GERMANY
  INDONESIA
  KOREA
  NETHERLANDS
  PORTUGAL
  SERBIA
  SPAIN
  TAIWAN
  THAILAND
  INDIA
  UKRAINE
}

type Travelling {
  countriesLived: [Country!]!
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

type Time {
  unixTime: Int!
  timeStamp: String!
}

interface Pet implements Animal {
  class: Class!
  gender: Gender!
  name: String!
}

type Employee implements Identifiable {
  id: Int!
  products: [ProductName!]!
  notes: String!
  details: Details
  hobbies: [Hobby!]!
  tag: String!
  role: RoleType!
  updatedAt: String!
}

type Cosmo implements IProduct {
  upc: ID!
  name: ProductName!
  repositoryURL: String!
  engineers: [Employee!]!
  lead: Employee!
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

type SDK implements IProduct {
  upc: ID!
  clientLanguages: [ProgrammingLanguage!]!
  engineers: [Employee!]!
  owner: Employee!
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
}`;
