import {
  duplicateDirectiveDefinitionError,
  duplicateEnumValueDefinitionError,
  duplicateFieldDefinitionError,
  duplicateTypeDefinitionError,
  duplicateUnionMemberExtensionError,
  invalidDirectiveError,
  invalidKeyDirectivesError,
  invalidProvidesOrRequiresDirectivesError,
  invalidSelectionSetErrorMessage,
  noBaseTypeExtensionError,
  normalizeSubgraphFromString,
  undefinedDirectiveErrorMessage,
  undefinedFieldInFieldSetErrorMessage,
  undefinedTypeError,
  unparsableFieldSetErrorMessage,
} from '../src';
import { readFileSync } from 'fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  normalizeString,
  schemaToSortedNormalizedString,
  versionOneBaseSchema,
  versionTwoBaseSchema,
} from './utils/utils';

describe('Normalization tests', () => {
  test('that an unparsable graph returns an error', () => {
    const { errors } = normalizeSubgraphFromString('');
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0].message).toContain(
      `The subgraph has syntax errors and could not be parsed.\n` + ` The reason provided was: Syntax Error`,
    );
  });

  test('that an undefined type that is referenced in the schema returns an error', () => {
    const { errors } = normalizeSubgraphFromString(`
      type Example {
        field: Unknown
      }  
    `);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(undefinedTypeError('Unknown'));
  });

  test('that the base scalars are identified', () => {
    const { errors, normalizationResult } = normalizeSubgraphFromString(`
      type Example {
        boolean: Boolean!
        float: Float
        int: Int!
        id: ID
        string: String!
      }  
    `);
    expect(errors).toBeUndefined();
    const subgraphString = normalizationResult!.subgraphString;
    expect(normalizeString(subgraphString!)).toBe(
      normalizeString(
        versionOneBaseSchema +
          `
      type Example {
        boolean: Boolean!
        float: Float
        int: Int!
        id: ID
        string: String!
      }`,
      ),
    );
  });

  test('that undefined directives return an error', () => {
    const { errors } = normalizeSubgraphFromString(`
      type Example {
        string: String @UnknownDirective
      }  
    `);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(
      invalidDirectiveError('UnknownDirective', 'Example.string', [
        undefinedDirectiveErrorMessage('UnknownDirective', 'Example.string'),
      ]),
    );
  });

  test('that duplicate directive definitions return an error', () => {
    const { errors } = normalizeSubgraphFromString(`
      directive @KnownDirective on FIELD_DEFINITION
      directive @KnownDirective on FIELD_DEFINITION
      
      type Example {
        string: String @KnownDirective
      }  
    `);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(duplicateDirectiveDefinitionError('KnownDirective'));
  });

  test('that extending an entity with its key field is valid', () => {
    const { errors, normalizationResult } = normalizeSubgraphFromString(`
      type Entity @key(fields: "id") {
        name: String!
      }
      
      extend type Entity {
        id: ID!
      }
    `);
    expect(errors).toBeUndefined();
    const subgraphString = normalizationResult!.subgraphString;
    expect(normalizeString(subgraphString!)).toBe(
      normalizeString(
        versionOneBaseSchema +
          `
      type Entity @key(fields: "id") {
        name: String!
        id: ID!
      }  
    `,
      ),
    );
  });

  test('that extending an object with the key directive is valid', () => {
    const { errors, normalizationResult } = normalizeSubgraphFromString(`
      type Entity {
        id: ID!
      }
      
      extend type Entity @key(fields: "id") {
        name: String!
      }
    `);
    expect(errors).toBeUndefined();
    const subgraphString = normalizationResult!.subgraphString;
    expect(normalizeString(subgraphString!)).toBe(
      normalizeString(
        versionOneBaseSchema +
          `
      type Entity @key(fields: "id") {
        id: ID!
        name: String!
      }  
    `,
      ),
    );
  });

  test('that an undefined key field returns an error #1', () => {
    const { errors } = normalizeSubgraphFromString(`
      type Entity @key(fields: "unknown") {
        name: String!
      }
    `);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(
      invalidKeyDirectivesError('Entity', [undefinedFieldInFieldSetErrorMessage('unknown', 'Entity', 'unknown')]),
    );
  });

  test('that an undefined key field returns an error #2', () => {
    const { errors } = normalizeSubgraphFromString(`
      type Entity {
        id: ID!
      }
      
      extend type Entity @key(fields: "unknown") {
        name: String!
      }
    `);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(
      invalidKeyDirectivesError('Entity', [undefinedFieldInFieldSetErrorMessage('unknown', 'Entity', 'unknown')]),
    );
  });

  test('that an undefined key field returns an error #3', () => {
    const { errors } = normalizeSubgraphFromString(`
      extend type Entity @key(fields: "unknown") {
        name: String!
      }
    `);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(
      invalidKeyDirectivesError('Entity', [undefinedFieldInFieldSetErrorMessage('unknown', 'Entity', 'unknown')]),
    );
  });

  test('that extending an entity with the same key directive does not duplicate the directive', () => {
    const { errors, normalizationResult } = normalizeSubgraphFromString(`
      type Entity @key(fields: "id") {
        id: ID!
      }
      
      extend type Entity @key(fields: "id") {
        name: String!
      }
    `);
    expect(errors).toBeUndefined();
    const subgraphString = normalizationResult!.subgraphString;
    expect(normalizeString(subgraphString!)).toBe(
      normalizeString(
        versionOneBaseSchema +
          `
      type Entity @key(fields: "id") {
        id: ID!
        name: String!
      }  
    `,
      ),
    );
  });

  test('that enums are normalized', () => {
    const { errors, normalizationResult } = normalizeSubgraphFromString(`
      directive @CustomDirectiveOne on ENUM
      directive @CustomDirectiveTwo on ENUM_VALUE
      directive @CustomDirectiveThree on ENUM
      directive @CustomDirectiveFour on ENUM_VALUE
    
      enum Alphabet @CustomDirectiveOne{
        A
        B @CustomDirectiveTwo
        C
        D
      }
      
      extend enum Alphabet @CustomDirectiveThree {
        E @CustomDirectiveFour
      }
    `);
    expect(errors).toBeUndefined();
    const subgraphString = normalizationResult!.subgraphString;
    expect(normalizeString(subgraphString!)).toBe(
      normalizeString(
        versionOneBaseSchema +
          `
      directive @CustomDirectiveOne on ENUM
      directive @CustomDirectiveTwo on ENUM_VALUE
      directive @CustomDirectiveThree on ENUM
      directive @CustomDirectiveFour on ENUM_VALUE
      
      enum Alphabet @CustomDirectiveOne @CustomDirectiveThree {
        A
        B @CustomDirectiveTwo
        C
        D
        E @CustomDirectiveFour
      }`,
      ),
    );
  });

  test('that extending an enum with a value that already exists returns an error', () => {
    const { errors } = normalizeSubgraphFromString(`
      enum Alphabet {
        A
        B
        C
        D
      }
      
      extend enum Alphabet {
        D
      }
    `);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(duplicateEnumValueDefinitionError('D', 'Alphabet'));
  });

  test('that an enum extension orphan returns an error', () => {
    const { errors } = normalizeSubgraphFromString(`
      extend enum Alphabet {
        D
      }
    `);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(noBaseTypeExtensionError('Alphabet'));
  });

  test('that redefining an enum returns an error', () => {
    const { errors } = normalizeSubgraphFromString(`
      enum Alphabet {
        A
      }
      
      enum Alphabet {
        B
      }
    `);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(duplicateTypeDefinitionError('enum', 'Alphabet'));
  });

  test('that interfaces are normalized', () => {
    const { errors, normalizationResult } = normalizeSubgraphFromString(`
      directive @CustomDirectiveOne on INTERFACE
      directive @CustomDirectiveTwo on FIELD_DEFINITION
      directive @CustomDirectiveThree on INTERFACE
      directive @CustomDirectiveFour on FIELD_DEFINITION
    
      interface Human @CustomDirectiveOne {
        name: String
        age: Int @CustomDirectiveTwo
      }
      
      extend interface Human @CustomDirectiveThree {
        height: Int @CustomDirectiveFour
      }
    `);
    expect(errors).toBeUndefined();
    const subgraphString = normalizationResult!.subgraphString;
    expect(normalizeString(subgraphString!)).toBe(
      normalizeString(
        versionOneBaseSchema +
          `
      directive @CustomDirectiveOne on INTERFACE
      directive @CustomDirectiveTwo on FIELD_DEFINITION
      directive @CustomDirectiveThree on INTERFACE
      directive @CustomDirectiveFour on FIELD_DEFINITION
    
      interface Human @CustomDirectiveOne @CustomDirectiveThree {
        name: String
        age: Int @CustomDirectiveTwo
        height: Int @CustomDirectiveFour
      }`,
      ),
    );
  });

  test('that extending an interface with a field that already exists returns an error', () => {
    const { errors } = normalizeSubgraphFromString(`
      interface Human {
        name: String
        age: Int
      }
      
      extend interface Human {
        age: Int
      }
    `);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(duplicateFieldDefinitionError('age', 'Human'));
  });

  test('that an interface extension orphan returns an error', () => {
    const { errors } = normalizeSubgraphFromString(`
      extend interface Human {
        height: Int
      }
    `);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(noBaseTypeExtensionError('Human'));
  });

  test('that redefining an interface returns an error', () => {
    const { errors } = normalizeSubgraphFromString(`
      interface Human {
        name: String
      }
      
      interface Human {
        age: Int
      }
    `);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(duplicateTypeDefinitionError('interface', 'Human'));
  });

  test('that input objects are normalized', () => {
    const { errors, normalizationResult } = normalizeSubgraphFromString(`
      directive @CustomDirectiveOne on INPUT_OBJECT
      directive @CustomDirectiveTwo on INPUT_FIELD_DEFINITION
      directive @CustomDirectiveThree on INPUT_OBJECT
      directive @CustomDirectiveFour on INPUT_FIELD_DEFINITION
    
      input Input @CustomDirectiveOne {
        name: String
        age: Int @CustomDirectiveTwo
      }
      
      extend input Input @CustomDirectiveThree {
        height: Int @CustomDirectiveFour
      }
    `);
    expect(errors).toBeUndefined();
    const subgraphString = normalizationResult!.subgraphString;
    expect(normalizeString(subgraphString!)).toBe(
      normalizeString(
        versionOneBaseSchema +
          `
      directive @CustomDirectiveOne on INPUT_OBJECT
      directive @CustomDirectiveTwo on INPUT_FIELD_DEFINITION
      directive @CustomDirectiveThree on INPUT_OBJECT
      directive @CustomDirectiveFour on INPUT_FIELD_DEFINITION
    
      input Input @CustomDirectiveOne @CustomDirectiveThree {
        name: String
        age: Int @CustomDirectiveTwo
        height: Int @CustomDirectiveFour
      }`,
      ),
    );
  });

  test('that extending an input object with a field that already exists returns an error', () => {
    const { errors } = normalizeSubgraphFromString(`
      input Input {
        name: String
        age: Int
      }
      
      extend input Input {
        age: Int
      }
    `);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(duplicateFieldDefinitionError('age', 'Input'));
  });

  test('that an input object extension orphan returns an error', () => {
    const { errors } = normalizeSubgraphFromString(`
      extend input Input {
        height: Int
      }
    `);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(noBaseTypeExtensionError('Input'));
  });

  test('that redefining an input object returns an error', () => {
    const { errors } = normalizeSubgraphFromString(`
      input Input {
        name: String
      }
      
      input Input {
        age: Int
      }
    `);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(duplicateTypeDefinitionError('input object', 'Input'));
  });

  test('that object types are normalized successfully', () => {
    const { errors, normalizationResult } = normalizeSubgraphFromString(`
      type Object {
        name: String!
      }
      
      extend type Object {
        age: Int!
      }
    `);
    expect(errors).toBeUndefined();
    const subgraphString = normalizationResult!.subgraphString;
    expect(normalizeString(subgraphString!)).toBe(
      normalizeString(
        versionOneBaseSchema +
          `
    type Object {
      name: String!
      age: Int!
    }`,
      ),
    );
  });

  test('that an object with no fields returns an error', () => {
    const { errors } = normalizeSubgraphFromString(`
      type Object {
      }
    `);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0].message).toBe(
      `The subgraph has syntax errors and could not be parsed.\n` +
        ` The reason provided was: Syntax Error: Expected Name, found "}".`,
    );
  });

  test('that extending an object with a field that already exists returns an error', () => {
    const { errors } = normalizeSubgraphFromString(`
      type Object {
        name: String
        age: Int
      }
      
      extend type Object {
        age: Int
      }
    `);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(duplicateFieldDefinitionError('age', 'Object'));
  });

  test('that an object extension orphan is accepted', () => {
    const { errors, normalizationResult } = normalizeSubgraphFromString(`
      extend type Object {
        height: Int
      }
    `);
    expect(errors).toBeUndefined();
    const subgraphString = normalizationResult!.subgraphString;
    expect(normalizeString(subgraphString!)).toBe(
      normalizeString(
        versionOneBaseSchema +
          `
      extend type Object {
        height: Int
      }
    `,
      ),
    );
  });

  test('that redefining an object returns an error', () => {
    const { errors } = normalizeSubgraphFromString(`
      type Object {
        name: String
      }
      
      type Object {
        age: Int
      }
    `);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(duplicateTypeDefinitionError('object', 'Object'));
  });

  test('that scalars are normalized', () => {
    const { errors, normalizationResult } = normalizeSubgraphFromString(`
      directive @CustomDirectiveOne on SCALAR
      directive @CustomDirectiveTwo on SCALAR
    
      scalar JSON @CustomDirectiveOne
      
      extend scalar JSON @CustomDirectiveTwo
    `);
    expect(errors).toBeUndefined();
    const subgraphString = normalizationResult!.subgraphString;
    expect(normalizeString(subgraphString!)).toBe(
      normalizeString(
        versionOneBaseSchema +
          `
      directive @CustomDirectiveOne on SCALAR
      directive @CustomDirectiveTwo on SCALAR
      
      scalar JSON @CustomDirectiveOne @CustomDirectiveTwo`,
      ),
    );
  });

  test('that a scalar extension orphan returns an error', () => {
    const { errors } = normalizeSubgraphFromString(`
      directive @CustomDirectiveOne on SCALAR
      extend scalar JSON @CustomDirectiveOne
    `);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(noBaseTypeExtensionError('JSON'));
  });

  test('that redefined scalars return an error', () => {
    const { errors } = normalizeSubgraphFromString(`
      scalar JSON
      scalar JSON
    `);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(duplicateTypeDefinitionError('scalar', 'JSON'));
  });

  test('that unions are normalized', () => {
    const { errors, normalizationResult } = normalizeSubgraphFromString(`
      directive @deprecated(reason: String = "No longer supported") on ARGUMENT_DEFINITION | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION
      directive @external on FIELD_DEFINITION | OBJECT
      directive @key(fields: String!) repeatable on OBJECT
      directive @provides(fields: String!) on FIELD_DEFINITION
      directive @requires(fields: String!) on FIELD_DEFINITION
      directive @tag(name: String!) repeatable on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_OBJECT | INPUT_FIELD_DEFINITION | INTERFACE | OBJECT | SCALAR | UNION
      directive @CustomDirectiveOne on UNION
      directive @CustomDirectiveTwo on UNION
    
      union Cats @CustomDirectiveOne = Treacle | Muffin
      
      extend union Cats @CustomDirectiveTwo = Pepper
      
      type Treacle {
        age: Int
      }
      
      type Muffin {
        age: Int
      }
      
      type Pepper {
        age: Int
      }
    `);
    expect(errors).toBeUndefined();
    const subgraphString = normalizationResult!.subgraphString;
    expect(normalizeString(subgraphString!)).toBe(
      normalizeString(
        versionOneBaseSchema +
          `
      directive @CustomDirectiveOne on UNION
      directive @CustomDirectiveTwo on UNION
      
      union Cats @CustomDirectiveOne @CustomDirectiveTwo = Treacle | Muffin | Pepper
      
      type Treacle {
        age: Int
      }
      
      type Muffin {
        age: Int
      }
      
      type Pepper {
        age: Int
      }`,
      ),
    );
  });

  test('that extending a union with a member that already exists returns an error', () => {
    const { errors } = normalizeSubgraphFromString(`
      union Cats = Treacle | Muffin
      
      extend union Cats = Muffin
      
      type Treacle {
        age: Int
      }
      
      type Muffin {
        age: Int
      } 
    `);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(duplicateUnionMemberExtensionError('Muffin', 'Cats'));
  });

  test('that redefining a union returns an error', () => {
    const { errors } = normalizeSubgraphFromString(`
      union Cats = Treacle | Muffin
      
      union Cats = Treacle | Muffin
      
      type Treacle {
        age: Int
      }
      
      type Muffin {
        age: Int
      } 
    `);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(duplicateTypeDefinitionError('union', 'Cats'));
  });

  test('that a union extension orphan returns an error', () => {
    const { errors } = normalizeSubgraphFromString(`
      extend union Cats = Pepper
      
      type Pepper {
        age: Int
      }  
    `);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(noBaseTypeExtensionError('Cats'));
  });

  test('that a union without members returns an error', () => {
    const { errors } = normalizeSubgraphFromString(`
      union Cats =
      
      type Pepper {
        name: String
      }  
    `);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0].message).toBe(
      `The subgraph has syntax errors and could not be parsed.\n` +
        ` The reason provided was: Syntax Error: Unexpected Name "Pepper".`,
    );
  });

  test('that undefined union members return an error', () => {
    const { errors } = normalizeSubgraphFromString(`
      union Cats = Pepper 
    `);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(undefinedTypeError('Pepper'));
  });

  test('Should return an error when a enum has values with type Int', () => {
    const { errors } = normalizeSubgraphFromString(`
      enum UserRole {
        ADMIN
        MODERATOR
        1
      }
    `);
    expect(errors).toBeDefined();
    expect(errors![0].message).toBe(
      `The subgraph has syntax errors and could not be parsed.\n` +
        ` The reason provided was: Syntax Error: Expected Name, found Int "1".`,
    );
  });

  test('Should return an error when a enum has duplicate values', () => {
    const { errors } = normalizeSubgraphFromString(`
      enum UserRole {
        ADMIN
        MODERATOR
        ADMIN
      }
    `);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(duplicateEnumValueDefinitionError('ADMIN', 'UserRole'));
  });

  test('Should return an error when a enum values have special characters', () => {
    const { errors } = normalizeSubgraphFromString(`
     enum Continent {
        AFR!CA
        EUROPE
        ASIA
      }
    `);
    expect(errors).toBeDefined();
    expect(errors![0].message).toBe(
      `The subgraph has syntax errors and could not be parsed.\n` +
        ` The reason provided was: Syntax Error: Expected Name, found "!".`,
    );
  });

  test('Should normalize schemas with only root types', () => {
    const { errors } = normalizeSubgraphFromString(`
      type Query {
        a: String
        schema: String
      }
    `);
    expect(errors).toBeUndefined();
  });

  test('Should normalize type extensions', () => {
    const { errors, normalizationResult } = normalizeSubgraphFromString(`
        directive @tag(name: String!) repeatable on FIELD_DEFINITION

        extend type Product @key(fields: "id") {
            id: ID! @tag(name: "hi-from-inventory")
            dimensions: ProductDimension
            delivery(zip: String): DeliveryEstimates
        }
        
        type Product{
          name: String
        }

        type ProductDimension {
            size: String
            weight: Float @tag(name: "hi-from-inventory-value-type-field")
        }

        type DeliveryEstimates {
            estimatedDelivery: String
            fastestDelivery: String
        }
    `);
    expect(errors).toBeUndefined();
    const subgraphString = normalizationResult!.subgraphString;
    expect(normalizeString(subgraphString!)).toBe(
      normalizeString(
        versionOneBaseSchema +
          `
        type Product @key(fields: "id") {
          name: String
          id: ID! @tag(name: "hi-from-inventory")
          dimensions: ProductDimension
          delivery(zip: String): DeliveryEstimates
        }
        
        type ProductDimension {
          size: String
          weight: Float @tag(name: "hi-from-inventory-value-type-field")
        }
        
        type DeliveryEstimates {
          estimatedDelivery: String
          fastestDelivery: String
        }`,
      ),
    );
  });

  test('Should normalize root type extensions', () => {
    const { errors, normalizationResult } = normalizeSubgraphFromString(`
        directive @tag(name: String!) repeatable on FIELD_DEFINITION

        type Product @key(fields: "id") @key(fields: "sku package") @key(fields: "sku variation { id }"){
          id: ID! @tag(name: "hi-from-products")
          sku: String @tag(name: "hi-from-products")
          package: String
          variation: ProductVariation
          dimensions: ProductDimension
          createdBy: User
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
          email: ID!
          totalProductsCreated: Int
        }
    `);
    expect(errors).toBeUndefined();
    const subgraphString = normalizationResult!.subgraphString;
    expect(normalizeString(subgraphString!)).toBe(
      normalizeString(
        versionOneBaseSchema +
          `
      extend type Query {
        allProducts: [Product]
        product(id: ID!): Product
      }
      
      extend type User @key(fields: "email") {
        email: ID!
        totalProductsCreated: Int
      }
      
      type Product @key(fields: "id") @key(fields: "sku package") @key(fields: "sku variation { id }") {
        id: ID! @tag(name: "hi-from-products")
        sku: String @tag(name: "hi-from-products")
        package: String
        variation: ProductVariation
        dimensions: ProductDimension
        createdBy: User
      }
      
      type ProductVariation {
        id: ID!
      }
      
      type ProductDimension {
        size: String
        weight: Float
      }`,
      ),
    );
  });

  test('that undefined version two directives are injected', () => {
    const schema = readFileSync(join(process.cwd(), 'tests/test-data/testNormalization.graphql'), {
      encoding: 'utf8',
    });
    const { errors, normalizationResult } = normalizeSubgraphFromString(schema);
    expect(errors).toBeUndefined();
    const subgraphString = normalizationResult!.subgraphString;
    expect(normalizeString(subgraphString!)).toBe(
      normalizeString(
        versionTwoBaseSchema +
          `
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
        hidden: String
        oldField: String @deprecated(reason: "refactored out")
      }
      
      type Product implements ProductItf & SkuItf 
        @key(fields: "id") 
        @key(fields: "sku package") 
        @key(fields: "sku variation { id }") {
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
      
      type ProductDimension {
        size: String @shareable
        weight: Float @shareable
      }
      
      type User @key(fields: "email") {
        email: ID!
        totalProductsCreated: Int @shareable
      }`,
      ),
    );
  });

  //Key directive
  test('Should normalize schemas with valid key directives', () => {
    const { errors } = normalizeSubgraphFromString(`
      type User @key(fields: "name") {
        name: String!
        age: Int!
      }
    `);
    expect(errors).toBeUndefined();
  });

  test('Should normalize composite key directives', () => {
    const { errors } = normalizeSubgraphFromString(`
      type User @key(fields: "name age") {
        name: String!
        age: Int!
      }
    `);
    expect(errors).toBeUndefined();
  });

  test('Should give errors when key directive points to a field which doesnt exist', () => {
    const { errors } = normalizeSubgraphFromString(`
      type User @key(fields: "id") {
        name: String!
        age: Int!
      }
    `);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(
      invalidKeyDirectivesError('User', [undefinedFieldInFieldSetErrorMessage('id', 'User', 'id')]),
    );
  });

  test('Should give errors when key directive is applied to a enum', () => {
    const { errors } = normalizeSubgraphFromString(`
      enum User @key(fields: "name") {
        USER1
        USER2
      }
    `);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(
      invalidDirectiveError('key', 'User', [
        ` "User" is type "EnumTypeDefinition", but the directive "key" does not define "ENUM" as a valid location.`,
      ]),
    );
  });

  test('Should give errors when key directive is applied to a input', () => {
    const { errors } = normalizeSubgraphFromString(`
      input User @key(fields: "name") {
        name: String!
        age: Int!
      }
    `);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(
      invalidDirectiveError('key', 'User', [
        ` "User" is type "InputObjectTypeDefinition", but the directive "key" does not define "INPUT_OBJECT" as a valid location.`,
      ]),
    );
  });

  // Tag directive
  test('Should normalize schemas with valid tag directive', () => {
    const { errors } = normalizeSubgraphFromString(`
      type User {
        name: String! @tag(name: "user")
        age: Int!
      }
    `);
    expect(errors).toBeUndefined();
  });

  test('that declaring the @tag directive on a parent without the required name argument returns an error', () => {
    const { errors } = normalizeSubgraphFromString(`
      type User @tag {
        name: String!
        age: Int!
      }
    `);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(
      invalidDirectiveError('tag', 'User', [
        ` The definition for the directive "tag" defines the following 1 required argument: "name".\n` +
          ` However, the same directive that is declared on "User" does not define any arguments.`,
      ]),
    );
  });

  test('that declaring the @tag directive on a child without the required name argument returns an error', () => {
    const { errors } = normalizeSubgraphFromString(`
      type User {
        name: String! @tag
        age: Int!
      }
    `);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(
      invalidDirectiveError('tag', 'User.name', [
        ` The definition for the directive "tag" defines the following 1 required argument: "name".\n` +
          ` However, the same directive that is declared on "User.name" does not define any arguments.`,
      ]),
    );
  });

  // External directive
  test('Should normalize schemas with external directives', () => {
    const { errors } = normalizeSubgraphFromString(`
      type User @external {
        name: String!
        age: Int!
      }
    `);
    expect(errors).toBeUndefined();
  });

  test('Should give errors when external directive is applied to a interface', () => {
    const { errors } = normalizeSubgraphFromString(`
      interface User @external {
        name: String!
        age: Int!
      }
    `);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(
      invalidDirectiveError('external', 'User', [
        ` "User" is type "InterfaceTypeDefinition", but the directive "external" does not define "INTERFACE" as a valid location.`,
      ]),
    );
  });

  test('Should give errors when external directive is applied to an enum', () => {
    const { errors } = normalizeSubgraphFromString(`
      enum User @external {
        USER1
        USER2
      }
    `);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(
      invalidDirectiveError('external', 'User', [
        ` "User" is type "EnumTypeDefinition", but the directive "external" does not define "ENUM" as a valid location.`,
      ]),
    );
  });

  test('Should give errors when external directive is applied to a input', () => {
    const { errors } = normalizeSubgraphFromString(`
      input User @external {
        name: String!
        age: Int!
      }
    `);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(
      invalidDirectiveError('external', 'User', [
        ` "User" is type "InputObjectTypeDefinition", but the directive "external" does not define "INPUT_OBJECT" as a valid location.`,
      ]),
    );
  });

  // Provides directive
  test('Should normalize schemas with provides directives', () => {
    const { errors } = normalizeSubgraphFromString(`
     type Review @key(fields : "id") {
      id: String!
      user: User! @provides(fields : "name")
    }
    
    type User @key(fields : "userId") {
      userId: String!
      name: String! @external
    }
    `);
    expect(errors).toBeUndefined();
  });

  test.skip('Should give errors if the provides directive points to a field that is not external ', () => {
    const { errors } = normalizeSubgraphFromString(`
     type Review @key(fields : "id") {
      id: String!
      user: User! @provides(fields : "age")
    }
    
    type User @key(fields : "userId") {
      userId: String!
      name: String! @external
      age: Int!
    }
    `);
    expect(errors).toBeDefined();
  });

  test('that an error is returned if @provides refers to a non-existent field', () => {
    const { errors } = normalizeSubgraphFromString(`
     type Review @key(fields : "id") {
      id: String!
      user: User! @provides(fields : "age")
    }
    
    type User @key(fields : "userId") {
      userId: String!
      name: String! @external
    }
    `);
    expect(errors).toBeDefined();
    expect(errors![0].message).toStrictEqual(
      `The following "provides" directive is invalid:\n On "Review.user" —` +
        undefinedFieldInFieldSetErrorMessage('age', 'User', 'age'),
    );
  });

  test('that declaring the @provides directive without the required fields argument returns an error', () => {
    const { errors } = normalizeSubgraphFromString(`
     type Review @key(fields : "id") {
      id: String!
      user: User! @provides
    }
    
    type User @key(fields : "userId") {
      userId: String!
      name: String! @external
    }
    `);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(
      invalidDirectiveError('provides', 'Review.user', [
        ` The definition for the directive "provides" defines the following 1 required argument: "fields".\n` +
          ` However, the same directive that is declared on "Review.user" does not define any arguments.`,
      ]),
    );
  });

  test('Should give errors when provides directive is applied to a object', () => {
    const { errors } = normalizeSubgraphFromString(`
      type User @provides(fields : "age") {
        name: String!
        age: Int!
      }
    `);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(
      invalidDirectiveError('provides', 'User', [
        ` "User" is type "ObjectTypeDefinition", but the directive "provides" does not define "OBJECT" as a valid location.`,
      ]),
    );
  });

  test('Should give errors when provides directive is applied to a interface', () => {
    const { errors } = normalizeSubgraphFromString(`
      interface User @provides(fields : "age") {
        name: String!
        age: Int!
      }
    `);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(
      invalidDirectiveError('provides', 'User', [
        ` "User" is type "InterfaceTypeDefinition", but the directive "provides" does not define "INTERFACE" as a valid location.`,
      ]),
    );
  });

  test('Should give errors when provides directive is applied to a enum', () => {
    const { errors } = normalizeSubgraphFromString(`
      enum User @provides(fields : "age") {
        USER1
        USER2
      }
    `);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(
      invalidDirectiveError('provides', 'User', [
        ` "User" is type "EnumTypeDefinition", but the directive "provides" does not define "ENUM" as a valid location.`,
      ]),
    );
  });

  test('Should give errors when provides directive is applied to a input', () => {
    const { errors } = normalizeSubgraphFromString(`
      input User @provides(fields : "age") {
        name: String!
        age: Int!
      }
    `);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(
      invalidDirectiveError('provides', 'User', [
        ` "User" is type "InputObjectTypeDefinition", but the directive "provides" does not define "INPUT_OBJECT" as a valid location.`,
      ]),
    );
  });

  test('that a valid @requires directive composes', () => {
    const { errors } = normalizeSubgraphFromString(`
       type Product @key(fields : "id") {
        id: String!
        shippingCost: String! @requires(fields: "weight")
        weight: Float! @external
      }
    `);
    expect(errors).toBeUndefined();
  });

  test.skip('Should give errors if the requires directive points to a field which is not external ', () => {
    const { errors } = normalizeSubgraphFromString(`
     type Product @key(fields : "id") {
        id: String!
        shippingCost: String! @requires(fields : "age")
        weight: Float! @external
        age: Int
      }
    `);
    expect(errors).toBeDefined();
  });

  test('Should give errors if the requires directive points to a field which does not exist ', () => {
    const { errors } = normalizeSubgraphFromString(`
     type Product @key(fields : "id") {
        id: String!
        shippingCost: String! @requires(fields : "age")
        weight: Float! @external
      }
    `);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(
      invalidProvidesOrRequiresDirectivesError('requires', [
        ` On "Product.shippingCost" —` + undefinedFieldInFieldSetErrorMessage('age', 'Product', 'age'),
      ]),
    );
  });

  test('Should give errors if the requires directive doesnt have a fields argument', () => {
    const { errors } = normalizeSubgraphFromString(`
     type Product @key(fields : "id") {
        id: String!
        shippingCost: String! @requires
        weight: Float! @external
      }
    `);
    expect(errors).toBeDefined();
  });

  test('Should give errors when requires directive is applied to a object', () => {
    const { errors } = normalizeSubgraphFromString(`
      type User @requires(fields : "age") {
        name: String!
        age: Int!
      }
    `);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(
      invalidDirectiveError('requires', 'User', [
        ` "User" is type "ObjectTypeDefinition", but the directive "requires" does not define "OBJECT" as a valid location.`,
      ]),
    );
  });

  test('Should give errors when requires directive is applied to a interface', () => {
    const { errors } = normalizeSubgraphFromString(`
      interface User @requires(fields : "age") {
        name: String!
        age: Int!
      }
    `);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(
      invalidDirectiveError('requires', 'User', [
        ` "User" is type "InterfaceTypeDefinition", but the directive "requires" does not define "INTERFACE" as a valid location.`,
      ]),
    );
  });

  test('Should give errors when requires directive is applied to a enum', () => {
    const { errors } = normalizeSubgraphFromString(`
      enum User @requires(fields : "age") {
        USER1
        USER2
      }
    `);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(
      invalidDirectiveError('requires', 'User', [
        ` "User" is type "EnumTypeDefinition", but the directive "requires" does not define "ENUM" as a valid location.`,
      ]),
    );
  });

  test('Should give errors when provides directive is applied to a input', () => {
    const { errors } = normalizeSubgraphFromString(`
      input User @requires(fields : "age") {
        name: String!
        age: Int!
      }
    `);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(
      invalidDirectiveError('requires', 'User', [
        ` "User" is type "InputObjectTypeDefinition", but the directive "requires" does not define "INPUT_OBJECT" as a valid location.`,
      ]),
    );
  });

  // Shareable directive
  test('Should normalize schemas with shareable directives applied to objects', () => {
    const { errors } = normalizeSubgraphFromString(`
       type User @key(fields: "email") @shareable {
          email: String
          name: String
       }
    `);
    expect(errors).toBeUndefined();
  });

  test('Should normalize schemas with shareable directives applied to fields', () => {
    const { errors } = normalizeSubgraphFromString(`
       type Product @key(fields: "id") {
        id: ID!
        name: String
        description: String @shareable
      }
    `);
    expect(errors).toBeUndefined();
  });

  test('that providing @shareable directive with an argument returns an error', () => {
    const { errors } = normalizeSubgraphFromString(`
     type User @shareable(fields: "email") {
        email: String
        name: String
      }
    `);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(
      invalidDirectiveError('shareable', 'User', [
        ` The definition for the directive "shareable" does not define any arguments.\n` +
          ` However, the same directive declared on "User" defines 1 argument.`,
      ]),
    );
  });

  test('that declaring @shareable on an interface returns an error', () => {
    const { errors } = normalizeSubgraphFromString(`
      interface User @shareable {
        name: String!
        age: Int!
      }
    `);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(
      invalidDirectiveError('shareable', 'User', [
        ` "User" is type "InterfaceTypeDefinition", but the directive "shareable" does not define "INTERFACE" as a valid location.`,
      ]),
    );
  });

  test('that declaring @shareable on an enum returns an error', () => {
    const { errors } = normalizeSubgraphFromString(`
      enum User @shareable {
        USER1
        USER2
      }
    `);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(
      invalidDirectiveError('shareable', 'User', [
        ` "User" is type "EnumTypeDefinition", but the directive "shareable" does not define "ENUM" as a valid location.`,
      ]),
    );
  });

  test('that declaring @shareable on an input object returns an error', () => {
    const { errors } = normalizeSubgraphFromString(`
      input User @shareable {
        name: String!
        age: Int!
      }
    `);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(
      invalidDirectiveError('shareable', 'User', [
        ` "User" is type "InputObjectTypeDefinition", but the directive "shareable"` +
          ` does not define "INPUT_OBJECT" as a valid location.`,
      ]),
    );
  });

  // Inaccessible directive
  test('Should normalize schemas with shareable directives applied to objects', () => {
    const { errors } = normalizeSubgraphFromString(`
       type User @inaccessible {
          email: String
          name: String
       }
    `);
    expect(errors).toBeUndefined();
  });

  test('Should normalize schemas with shareable directives applied to interfaces', () => {
    const { errors } = normalizeSubgraphFromString(`
       interface User @inaccessible {
          email: String
          name: String
       }
    `);
    expect(errors).toBeUndefined();
  });

  test('Should normalize schemas with shareable directives applied to input object', () => {
    const { errors } = normalizeSubgraphFromString(`
       input User @inaccessible {
          email: String
          name: String
       }
    `);
    expect(errors).toBeUndefined();
  });

  test('Should normalize schemas with shareable directives applied to enums', () => {
    const { errors } = normalizeSubgraphFromString(`
       enum User @inaccessible {
          USER1
          USER2
       }
    `);
    expect(errors).toBeUndefined();
  });

  test('that declaring the @inaccessible directive with an argument returns an error', () => {
    const { errors } = normalizeSubgraphFromString(`
       type User @inaccessible(fields: "name") {
          email: String
          name: String
       }
    `);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(
      invalidDirectiveError('inaccessible', 'User', [
        ` The definition for the directive "inaccessible" does not define any arguments.\n` +
          ` However, the same directive declared on "User" defines 1 argument.`,
      ]),
    );
  });

  test('that the composite keys are identified', () => {
    const { errors } = normalizeSubgraphFromString(`
       type Entity @key(fields: "id email") @key(fields: "id organization { id }") {
         id: ID!
         email: ID!
         organization: Organization!
        }
        
        type Organization {
         id: String!
         details: Details
        }
        
        type Details {
         id: ID!
         name: String!
        }
    `);
    expect(errors).toBeUndefined();
  });

  test('that the nested composite keys are identified', () => {
    const { errors } = normalizeSubgraphFromString(`
       type Entity @key(fields: "id email") @key(fields: "id organization { id details { id } }") {
         id: ID!
         email: ID!
         organization: Organization!
        }
        
        type Organization {
         id: String!
         details: Details
        }
        
        type Details {
         id: ID!
         name: String!
        }
    `);
    expect(errors).toBeUndefined();
  });

  test('that invalid fields in composite keys return an error', () => {
    const { errors } = normalizeSubgraphFromString(`
       type Entity @key(fields: "id email") @key(fields: "id organization { id details { id age } }") {
         id: ID!
         email: ID!
         organization: Organization!
        }
        
        type Organization {
         id: String!
         details: Details
        }
        
        type Details {
         id: ID!
         name: String!
        }
    `);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(
      invalidKeyDirectivesError('Entity', [
        undefinedFieldInFieldSetErrorMessage('id organization { id details { id age } }', 'Details', 'age'),
      ]),
    );
  });

  test('that an empty selection set in a composite key returns a parse error', () => {
    const { errors } = normalizeSubgraphFromString(`
       type Entity @key(fields: "id email") @key(fields: "id organization { id details { } }") {
         id: ID!
         email: ID!
         organization: Organization!
        }
        
        type Organization {
         id: String!
         details: Details
        }
        
        type Details {
         id: ID!
         name: String!
        }
    `);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(
      invalidKeyDirectivesError('Entity', [
        unparsableFieldSetErrorMessage(
          'id organization { id details { } }',
          new Error('Syntax Error: Expected Name, found "}".'),
        ),
      ]),
    );
  });

  test('that if an object without its fields are passed in composite keys gives an error', () => {
    const { errors } = normalizeSubgraphFromString(`
       type Entity @key(fields: "id email") @key(fields: "id organization { id details }") {
         id: ID!
         email: ID!
         organization: Organization!
        }
        
        type Organization {
         id: String!
         details: Details
        }
        
        type Details {
         id: ID!
         name: String!
        }
    `);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(
      invalidKeyDirectivesError('Entity', [
        invalidSelectionSetErrorMessage('id organization { id details }', 'Organization.details', 'Details', 'object'),
      ]),
    );
  });

  test('that if multiple nested objects passed in composite keys are identified', () => {
    const { errors } = normalizeSubgraphFromString(`
       type Entity @key(fields: "id email") @key(fields: "id organization { details { id } somethingElse { id } }") {
         id: ID!
         email: ID!
         organization: Organization!
        }
        
        type Organization {
         id: String!
         details: Details
         somethingElse: SomethingElse
        }
        
        type Details {
         id: ID!
         name: String!
        }
        
        type SomethingElse {
         id: ID!
         name: String!
        }
    `);
    expect(errors).toBeUndefined();
  });

  test('that if multiple nested objects with invalid fields are passed in composite keys gives an error', () => {
    const { errors } = normalizeSubgraphFromString(`
       type Entity @key(fields: "id email") @key(fields: "id organization { details { id } somethingElse { id } }") {
         id: ID!
         email: ID!
         organization: Organization!
        }
        
        type Organization {
         id: String!
         details: Details
         somethingElse: SomethingElse
        }
        
        type Details {
         id: ID!
         name: String!
        }
        
        type SomethingElse {
         name: String!
        }
    `);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(
      invalidKeyDirectivesError('Entity', [
        undefinedFieldInFieldSetErrorMessage(
          'id organization { details { id } somethingElse { id } }',
          'SomethingElse',
          'id',
        ),
      ]),
    );
  });

  test('that objects and interfaces can be extended using the @extends directive', () => {
    const { errors, normalizationResult } = normalizeSubgraphFromString(`
      interface Account {
        name: String!
      }
      
      extend interface Account {
        age: Int!
      }
      
      interface Account @extends @tag(name: "interface test") {
        email: String!
      }
      
      type User implements Account {
        name: String!
      }
      
      extend type User@tag(name: "object test") {
        age: Int!
      }
      
      type User @extends {
        email: String!
      }
    `);
    expect(errors).toBeUndefined();
    const subgraphString = normalizationResult!.subgraphString;
    expect(normalizeString(subgraphString!)).toBe(
      normalizeString(
        versionOneBaseSchema +
          `
        interface Account @tag(name: "interface test") {
          name: String!
          age: Int!
          email: String!
        }

        type User implements Account @tag(name: "object test") {
          name: String!
          age: Int!
          email: String!
        }  
    `,
      ),
    );
  });

  test('that extensions declared with @extends remain as extensions', () => {
    const { errors, normalizationResult } = normalizeSubgraphFromString(`
      type User @extends @key(fields: "name") {
        name: String!
      }
    `);
    expect(errors).toBeUndefined();
    const subgraphString = normalizationResult!.subgraphString;
    expect(normalizeString(subgraphString!)).toBe(
      normalizeString(
        versionOneBaseSchema +
          `
        extend type User @key(fields: "name") {
          name: String!
        }
    `,
      ),
    );
  });

  test('that a subgraph is normalized correctly', () => {
    const { errors, normalizationResult } = normalizeSubgraphFromString(`
      enum Enum @requiresScopes(scopes: [["read:enum"]]) {
        VALUE
      }
      
      """
        This is the description for Interface
      """
      interface Interface @requiresScopes(scopes: [["read:private"]]) {
        field(argumentOne: String!): Enum! @authenticated
      }
      
      """
        This is the description for Object
      """
      type Object implements Interface @requiresScopes(scopes: [["read:object"]]) {
        """
          This is the description for Object.field
        """
        field(
          """
            This is the description for the argumentOne argument of Object.field
          """
          argumentOne: String!
        ): Enum!
      }
    `);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
      normalizeString(`
      directive @authenticated on ENUM | FIELD_DEFINITION | INTERFACE | OBJECT | SCALAR
      directive @composeDirective(name: String!) repeatable on SCHEMA
      directive @eventsPublish(sourceName: String! = "default", topic: String!) on FIELD_DEFINITION
      directive @eventsRequest(sourceName: String! = "default", topic: String!) on FIELD_DEFINITION
      directive @eventsSubscribe(sourceName: String! = "default", topic: String!) on FIELD_DEFINITION
      directive @extends on INTERFACE | OBJECTdirective @external on FIELD_DEFINITION | OBJECT
      directive @inaccessible on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
      directive @interfaceObject on OBJECT
      directive @key(fields: openfed__FieldSet!, resolvable: Boolean = true) repeatable on INTERFACE | OBJECT
      directive @link(as: String, for: String, import: [String], url: String!) repeatable on SCHEMA
      directive @override(from: String!) on FIELD_DEFINITION
      directive @provides(fields: openfed__FieldSet!) on FIELD_DEFINITION
      directive @requires(fields: openfed__FieldSet!) on FIELD_DEFINITION
      directive @requiresScopes(scopes: [[openfed__Scope!]!]!) on ENUM | FIELD_DEFINITION | INTERFACE | OBJECT | SCALAR
      directive @shareable on FIELD_DEFINITION | OBJECT
      directive @tag(name: String!) repeatable on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
      
      enum Enum {
        VALUE
      }
      
      """
        This is the description for Interface
      """
      interface Interface {
        field(argumentOne: String!): Enum! @authenticated @requiresScopes(scopes: [["read:private", "read:enum"]])
      }

      """
        This is the description for Object
      """
      type Object implements Interface {
        """
          This is the description for Object.field
        """
        field(
          """
            This is the description for the argumentOne argument of Object.field
          """
          argumentOne: String!
        ): Enum! @authenticated @requiresScopes(scopes: [["read:object", "read:enum", "read:private"]])
      }
      
      scalar openfed__FieldSet
      
      scalar openfed__Scope
    `),
    );
  });
});
