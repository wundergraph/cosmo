import {
  duplicateDirectiveDefinitionError,
  duplicateEnumValueDefinitionError,
  duplicateTypeDefinitionError,
  ENUM,
  ENUM_UPPER,
  EXTERNAL,
  FieldData,
  FIELDS,
  FIRST_ORDINAL,
  INACCESSIBLE,
  INPUT,
  INPUT_OBJECT_UPPER,
  InputObjectDefinitionData,
  InputValueData,
  INTERFACE,
  INTERFACE_UPPER,
  invalidDirectiveError,
  invalidDirectiveLocationErrorMessage,
  invalidProvidesOrRequiresDirectivesError,
  invalidSelectionSetErrorMessage,
  KEY,
  NAME,
  NormalizationResultFailure,
  NormalizationResultSuccess,
  normalizeSubgraphFromString,
  numberToOrdinal,
  OBJECT,
  OBJECT_UPPER,
  ObjectDefinitionData,
  PROVIDES,
  QUERY,
  REQUIRES,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  SCALAR,
  SHAREABLE,
  Subgraph,
  TAG,
  undefinedDirectiveError,
  undefinedFieldInFieldSetErrorMessage,
  undefinedRequiredArgumentsErrorMessage,
  undefinedTypeError,
  unexpectedDirectiveArgumentErrorMessage,
  UNION,
  unparsableFieldSetErrorMessage,
} from '../../src';
import { readFileSync } from 'fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  baseDirectiveDefinitions,
  schemaQueryDefinition,
  versionOneBaseSchema,
  versionTwoBaseSchema,
} from './utils/utils';
import { normalizeString, normalizeSubgraphSuccess, schemaToSortedNormalizedString } from '../utils/utils';
import { Kind, parse } from 'graphql';
import { printTypeNode } from '@graphql-tools/merge';

describe('Normalization tests', () => {
  test('that an unparsable graph returns an error', () => {
    const result = normalizeSubgraphFromString(
      '',
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain(
      `The subgraph has syntax errors and could not be parsed.\n` + ` The reason provided was: Syntax Error`,
    );
  });

  test('that an undefined type that is referenced in the schema returns an error', () => {
    const result = normalizeSubgraphFromString(
      `
      type Example {
        field: Unknown
      }  
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(undefinedTypeError('Unknown'));
  });

  test('that the base scalars are identified', () => {
    const result = normalizeSubgraphFromString(
      `
      type Example {
        boolean: Boolean!
        float: Float
        int: Int!
        id: ID
        string: String!
      }  
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultSuccess;
    expect(result.success).toBe(true);
    const subgraphString = result.subgraphString;
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
    const result = normalizeSubgraphFromString(
      `
      type Example {
        string: String @UnknownDirective
      }  
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(undefinedDirectiveError('UnknownDirective', 'Example.string'));
  });

  test('that duplicate directive definitions return an error', () => {
    const result = normalizeSubgraphFromString(
      `
      directive @KnownDirective on FIELD_DEFINITION
      directive @KnownDirective on FIELD_DEFINITION
      
      type Example {
        string: String @KnownDirective
      }  
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(duplicateDirectiveDefinitionError('KnownDirective'));
  });

  test('that extending an entity with its key field is valid', () => {
    const result = normalizeSubgraphFromString(
      `
      type Entity @key(fields: "id") {
        name: String!
      }
      
      extend type Entity {
        id: ID!
      }
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultSuccess;
    expect(result.success).toBe(true);
    const subgraphString = result.subgraphString;
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
    const result = normalizeSubgraphFromString(
      `
      type Entity {
        id: ID!
      }
      
      extend type Entity @key(fields: "id") {
        name: String!
      }
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultSuccess;
    expect(result.success).toBe(true);
    const subgraphString = result.subgraphString;
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
    const result = normalizeSubgraphFromString(
      `
      type Entity @key(fields: "unknown") {
        name: String!
      }
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidDirectiveError(KEY, 'Entity', FIRST_ORDINAL, [
        undefinedFieldInFieldSetErrorMessage('unknown', 'Entity', 'unknown'),
      ]),
    );
  });

  test('that an undefined key field returns an error #2', () => {
    const result = normalizeSubgraphFromString(
      `
      type Entity {
        id: ID!
      }
      
      extend type Entity @key(fields: "unknown") {
        name: String!
      }
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidDirectiveError(KEY, 'Entity', FIRST_ORDINAL, [
        undefinedFieldInFieldSetErrorMessage('unknown', 'Entity', 'unknown'),
      ]),
    );
  });

  test('that an undefined key field returns an error #3', () => {
    const result = normalizeSubgraphFromString(
      `
      extend type Entity @key(fields: "unknown") {
        name: String!
      }
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidDirectiveError(KEY, 'Entity', FIRST_ORDINAL, [
        undefinedFieldInFieldSetErrorMessage('unknown', 'Entity', 'unknown'),
      ]),
    );
  });

  test('that extending an entity with the same key directive does not duplicate the directive', () => {
    const result = normalizeSubgraphFromString(
      `
      type Entity @key(fields: "id") {
        id: ID!
      }
      
      extend type Entity @key(fields: "id") {
        name: String!
      }
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultSuccess;
    expect(result.success).toBe(true);
    const subgraphString = result.subgraphString;
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
    const result = normalizeSubgraphFromString(
      `
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
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultSuccess;
    expect(result.success).toBe(true);
    const subgraphString = result.subgraphString;
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
    const result = normalizeSubgraphFromString(
      `
      enum Alphabet {
        A
        B
        C
        D
      }
      
      extend enum Alphabet {
        D
      }
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(duplicateEnumValueDefinitionError('Alphabet', 'D'));
  });

  test('that redefining an enum returns an error', () => {
    const result = normalizeSubgraphFromString(
      `
      enum Alphabet {
        A
      }
      
      enum Alphabet {
        B
      }
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(duplicateTypeDefinitionError(ENUM, 'Alphabet'));
  });

  test('that interfaces are normalized', () => {
    const result = normalizeSubgraphFromString(
      `
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
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultSuccess;
    expect(result.success).toBe(true);
    const subgraphString = result.subgraphString;
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

  test('that Input Objects are normalized', () => {
    const result = normalizeSubgraphFromString(
      `
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
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultSuccess;
    expect(result.success).toBe(true);
    const subgraphString = result.subgraphString;
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

  test('that object types are normalized successfully', () => {
    const result = normalizeSubgraphFromString(
      `
      type Object {
        name: String!
      }
      
      extend type Object {
        age: Int!
      }
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultSuccess;
    expect(result.success).toBe(true);
    const subgraphString = result.subgraphString;
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
    const result = normalizeSubgraphFromString(
      `
      type Object {
      }
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toBe(
      `The subgraph has syntax errors and could not be parsed.\n` +
        ` The reason provided was: Syntax Error: Expected Name, found "}".`,
    );
  });

  test('that scalars are normalized', () => {
    const result = normalizeSubgraphFromString(
      `
      directive @CustomDirectiveOne on SCALAR
      directive @CustomDirectiveTwo on SCALAR
    
      scalar JSON @CustomDirectiveOne
      
      extend scalar JSON @CustomDirectiveTwo
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultSuccess;
    expect(result.success).toBe(true);
    const subgraphString = result.subgraphString;
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

  test('that unions are normalized', () => {
    const result = normalizeSubgraphFromString(
      `
      directive @deprecated(reason: String = "No longer supported") on ARGUMENT_DEFINITION | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION
      directive @external on FIELD_DEFINITION | OBJECT
      directive @key(fields: openfed__FieldSet!, resolvable: Boolean = true) repeatable on INTERFACE | OBJECT
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
      
      scalar openfed__FieldSet
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultSuccess;
    expect(result.success).toBe(true);
    const subgraphString = result.subgraphString;
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
      }
      
      scalar openfed__FieldSet
     `,
      ),
    );
  });

  test('that a union without members returns an error', () => {
    const result = normalizeSubgraphFromString(
      `
      union Cats =
      
      type Pepper {
        name: String
      }  
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toBe(
      `The subgraph has syntax errors and could not be parsed.\n` +
        ` The reason provided was: Syntax Error: Unexpected Name "Pepper".`,
    );
  });

  test('that undefined union members return an error', () => {
    const result = normalizeSubgraphFromString(
      `
      union Cats = Pepper 
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(undefinedTypeError('Pepper'));
  });

  test('Should return an error when a enum has values with type Int', () => {
    const result = normalizeSubgraphFromString(
      `
      enum UserRole {
        ADMIN
        MODERATOR
        1
      }
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors[0].message).toBe(
      `The subgraph has syntax errors and could not be parsed.\n` +
        ` The reason provided was: Syntax Error: Expected Name, found Int "1".`,
    );
  });

  test('Should return an error when a enum has duplicate values', () => {
    const result = normalizeSubgraphFromString(
      `
      enum UserRole {
        ADMIN
        MODERATOR
        ADMIN
      }
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(duplicateEnumValueDefinitionError('UserRole', 'ADMIN'));
  });

  test('Should return an error when a enum values have special characters', () => {
    const result = normalizeSubgraphFromString(
      `
     enum Continent {
        AFR!CA
        EUROPE
        ASIA
      }
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors[0].message).toBe(
      `The subgraph has syntax errors and could not be parsed.\n` +
        ` The reason provided was: Syntax Error: Expected Name, found "!".`,
    );
  });

  test('Should normalize schemas with only root types', () => {
    const result = normalizeSubgraphFromString(`
      type Query {
        a: String
        schema: String
      }
    `);
    expect(result.success).toBe(true);
  });

  test('Should normalize type extensions', () => {
    const result = normalizeSubgraphFromString(
      `
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
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultSuccess;
    expect(result.success).toBe(true);
    const subgraphString = result.subgraphString;
    expect(normalizeString(subgraphString!)).toBe(
      normalizeString(
        versionOneBaseSchema +
          `
        type Product @key(fields: "id") {
          id: ID! @tag(name: "hi-from-inventory")
          dimensions: ProductDimension
          delivery(zip: String): DeliveryEstimates
          name: String
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
    const result = normalizeSubgraphFromString(
      `
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
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultSuccess;
    expect(result.success).toBe(true);
    expect(schemaToSortedNormalizedString(result.schema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          baseDirectiveDefinitions +
          `
      type Product @key(fields: "id") @key(fields: "sku package") @key(fields: "sku variation { id }") {
        createdBy: User
        dimensions: ProductDimension
        id: ID! @tag(name: "hi-from-products")
        package: String
        sku: String @tag(name: "hi-from-products")
        variation: ProductVariation
      }

      type ProductDimension {
        size: String
        weight: Float
      }
      
      type ProductVariation {
        id: ID!
      }

      type Query {
        allProducts: [Product]
        product(id: ID!): Product
      }
      
      type User @key(fields: "email") {
        email: ID!
        totalProductsCreated: Int
      }

      scalar openfed__FieldSet
      `,
      ),
    );
  });

  test('that undefined version two directives are injected', () => {
    const schema = readFileSync(join(__dirname, 'test-data/testNormalization.graphql'), {
      encoding: 'utf8',
    });
    const result = normalizeSubgraphFromString(
      schema,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultSuccess;
    expect(result.success).toBe(true);
    const subgraphString = result.subgraphString;
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
    const result = normalizeSubgraphFromString(`
      type User @key(fields: "name") {
        name: String!
        age: Int!
      }
    `);
    expect(result.success).toBe(true);
  });

  test('Should normalize composite key directives', () => {
    const result = normalizeSubgraphFromString(`
      type User @key(fields: "name age") {
        name: String!
        age: Int!
      }
    `);
    expect(result.success).toBe(true);
  });

  test('Should give errors when key directive points to a field which doesnt exist', () => {
    const result = normalizeSubgraphFromString(
      `
      type User @key(fields: "id") {
        name: String!
        age: Int!
      }
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidDirectiveError(KEY, 'User', FIRST_ORDINAL, [undefinedFieldInFieldSetErrorMessage('id', 'User', 'id')]),
    );
  });

  test('Should give errors when key directive is applied to a enum', () => {
    const result = normalizeSubgraphFromString(
      `
      enum User @key(fields: "name") {
        USER1
        USER2
      }
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidDirectiveError(KEY, 'User', FIRST_ORDINAL, [invalidDirectiveLocationErrorMessage(KEY, ENUM_UPPER)]),
    );
  });

  test('Should give errors when key directive is applied to an Input', () => {
    const result = normalizeSubgraphFromString(
      `
      input User @key(fields: "name") {
        name: String!
        age: Int!
      }
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidDirectiveError('key', 'User', FIRST_ORDINAL, [
        invalidDirectiveLocationErrorMessage(KEY, INPUT_OBJECT_UPPER),
      ]),
    );
  });

  // Tag directive
  test('Should normalize schemas with valid tag directive', () => {
    const result = normalizeSubgraphFromString(`
      type User {
        name: String! @tag(name: "user")
        age: Int!
      }
    `);
    expect(result.success).toBe(true);
  });

  test('that declaring the @tag directive on a parent without the required name argument returns an error', () => {
    const result = normalizeSubgraphFromString(
      `
      type User @tag {
        name: String!
        age: Int!
      }
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidDirectiveError(TAG, 'User', FIRST_ORDINAL, [undefinedRequiredArgumentsErrorMessage(TAG, [NAME], [])]),
    );
  });

  test('that declaring the @tag directive on a child without the required name argument returns an error', () => {
    const result = normalizeSubgraphFromString(
      `
      type User {
        name: String! @tag
        age: Int!
      }
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidDirectiveError('tag', 'User.name', FIRST_ORDINAL, [
        undefinedRequiredArgumentsErrorMessage(TAG, [NAME], []),
      ]),
    );
  });

  // External directive
  test('Should normalize schemas with external directives', () => {
    const result = normalizeSubgraphFromString(`
      type User @external {
        name: String!
        age: Int!
      }
    `);
    expect(result.success).toBe(true);
  });

  test('Should give errors when external directive is applied to a interface', () => {
    const result = normalizeSubgraphFromString(
      `
      interface User @external {
        name: String!
        age: Int!
      }
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidDirectiveError(EXTERNAL, 'User', FIRST_ORDINAL, [
        invalidDirectiveLocationErrorMessage(EXTERNAL, INTERFACE_UPPER),
      ]),
    );
  });

  test('Should give errors when external directive is applied to an enum', () => {
    const result = normalizeSubgraphFromString(
      `
      enum User @external {
        USER1
        USER2
      }
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidDirectiveError(EXTERNAL, 'User', FIRST_ORDINAL, [
        invalidDirectiveLocationErrorMessage(EXTERNAL, ENUM_UPPER),
      ]),
    );
  });

  test('Should give errors when external directive is applied to a input', () => {
    const result = normalizeSubgraphFromString(
      `
      input User @external {
        name: String!
        age: Int!
      }
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidDirectiveError(EXTERNAL, 'User', FIRST_ORDINAL, [
        invalidDirectiveLocationErrorMessage(EXTERNAL, INPUT_OBJECT_UPPER),
      ]),
    );
  });

  // Provides directive
  test('Should normalize schemas with provides directives', () => {
    const result = normalizeSubgraphFromString(`
     type Review @key(fields : "id") {
      id: String!
      user: User! @provides(fields : "name")
    }
    
    type User @key(fields : "userId") {
      userId: String!
      name: String! @external
    }
    `);
    expect(result.success).toBe(true);
  });

  test('that an error is returned if @provides refers to a non-existent field', () => {
    const result = normalizeSubgraphFromString(
      `
     type Review @key(fields : "id") {
      id: String!
      user: User! @provides(fields : "age")
    }
    
    type User @key(fields : "userId") {
      userId: String!
      name: String! @external
    }
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toStrictEqual(
      `The following "provides" directive is invalid:\n On field "Review.user":\n -` +
        undefinedFieldInFieldSetErrorMessage('age', 'User', 'age'),
    );
  });

  test('that declaring the @provides directive without the required fields argument returns an error', () => {
    const result = normalizeSubgraphFromString(
      `
     type Review @key(fields : "id") {
      id: String!
      user: User! @provides
    }
    
    type User @key(fields : "userId") {
      userId: String!
      name: String! @external
    }
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidDirectiveError(PROVIDES, 'Review.user', FIRST_ORDINAL, [
        undefinedRequiredArgumentsErrorMessage(PROVIDES, [FIELDS], []),
      ]),
    );
  });

  test('Should give errors when provides directive is applied to a object', () => {
    const result = normalizeSubgraphFromString(
      `
      type User @provides(fields : "age") {
        name: String!
        age: Int!
      }
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidDirectiveError(PROVIDES, 'User', FIRST_ORDINAL, [
        invalidDirectiveLocationErrorMessage(PROVIDES, OBJECT_UPPER),
      ]),
    );
  });

  test('Should give errors when provides directive is applied to a interface', () => {
    const result = normalizeSubgraphFromString(
      `
      interface User @provides(fields : "age") {
        name: String!
        age: Int!
      }
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidDirectiveError(PROVIDES, 'User', FIRST_ORDINAL, [
        invalidDirectiveLocationErrorMessage(PROVIDES, INTERFACE_UPPER),
      ]),
    );
  });

  test('Should give errors when provides directive is applied to a enum', () => {
    const result = normalizeSubgraphFromString(
      `
      enum User @provides(fields : "age") {
        USER1
        USER2
      }
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidDirectiveError(PROVIDES, 'User', FIRST_ORDINAL, [
        invalidDirectiveLocationErrorMessage(PROVIDES, ENUM_UPPER),
      ]),
    );
  });

  test('Should give errors when provides directive is applied to a input', () => {
    const result = normalizeSubgraphFromString(
      `
      input User @provides(fields : "age") {
        name: String!
        age: Int!
      }
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidDirectiveError(PROVIDES, 'User', FIRST_ORDINAL, [
        invalidDirectiveLocationErrorMessage(PROVIDES, INPUT_OBJECT_UPPER),
      ]),
    );
  });

  test('that a valid @requires directive composes', () => {
    const result = normalizeSubgraphFromString(`
       type Product @key(fields : "id") {
        id: String!
        shippingCost: String! @requires(fields: "weight")
        weight: Float! @external
      }
    `);
    expect(result.success).toBe(true);
  });

  test('Should give errors if the requires directive points to a field which does not exist ', () => {
    const result = normalizeSubgraphFromString(
      `
     type Product @key(fields : "id") {
        id: String!
        shippingCost: String! @requires(fields : "age")
        weight: Float! @external
      }
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidProvidesOrRequiresDirectivesError(REQUIRES, [
        ` On field "Product.shippingCost":\n -` + undefinedFieldInFieldSetErrorMessage('age', 'Product', 'age'),
      ]),
    );
  });

  test('Should give errors if the requires directive doesnt have a fields argument', () => {
    const result = normalizeSubgraphFromString(`
     type Product @key(fields : "id") {
        id: String!
        shippingCost: String! @requires
        weight: Float! @external
      }
    `);
    expect(result.success).toBe(false);
  });

  test('Should give errors when requires directive is applied to a object', () => {
    const result = normalizeSubgraphFromString(
      `
      type User @requires(fields : "age") {
        name: String!
        age: Int!
      }
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidDirectiveError(REQUIRES, 'User', FIRST_ORDINAL, [
        invalidDirectiveLocationErrorMessage(REQUIRES, OBJECT_UPPER),
      ]),
    );
  });

  test('Should give errors when requires directive is applied to a interface', () => {
    const result = normalizeSubgraphFromString(
      `
      interface User @requires(fields : "age") {
        name: String!
        age: Int!
      }
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidDirectiveError(REQUIRES, 'User', FIRST_ORDINAL, [
        invalidDirectiveLocationErrorMessage(REQUIRES, INTERFACE_UPPER),
      ]),
    );
  });

  test('Should give errors when requires directive is applied to a enum', () => {
    const result = normalizeSubgraphFromString(
      `
      enum User @requires(fields : "age") {
        USER1
        USER2
      }
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidDirectiveError(REQUIRES, 'User', FIRST_ORDINAL, [
        invalidDirectiveLocationErrorMessage(REQUIRES, ENUM_UPPER),
      ]),
    );
  });

  test('Should give errors when provides directive is applied to a input', () => {
    const result = normalizeSubgraphFromString(
      `
      input User @requires(fields : "age") {
        name: String!
        age: Int!
      }
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidDirectiveError(REQUIRES, 'User', FIRST_ORDINAL, [
        invalidDirectiveLocationErrorMessage(REQUIRES, INPUT_OBJECT_UPPER),
      ]),
    );
  });

  // Shareable directive
  test('Should normalize schemas with shareable directives applied to objects', () => {
    const result = normalizeSubgraphFromString(`
       type User @key(fields: "email") @shareable {
          email: String
          name: String
       }
    `);
    expect(result.success).toBe(true);
  });

  test('Should normalize schemas with shareable directives applied to fields', () => {
    const result = normalizeSubgraphFromString(`
       type Product @key(fields: "id") {
        id: ID!
        name: String
        description: String @shareable
      }
    `);
    expect(result.success).toBe(true);
  });

  test('that providing @shareable directive with an argument returns an error', () => {
    const result = normalizeSubgraphFromString(
      `
     type User @shareable(fields: "email") {
        email: String
        name: String
      }
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidDirectiveError(SHAREABLE, 'User', FIRST_ORDINAL, [
        unexpectedDirectiveArgumentErrorMessage(SHAREABLE, [FIELDS]),
      ]),
    );
  });

  test('that declaring @shareable on an interface returns an error', () => {
    const result = normalizeSubgraphFromString(
      `
      interface User @shareable {
        name: String!
        age: Int!
      }
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidDirectiveError(SHAREABLE, 'User', FIRST_ORDINAL, [
        invalidDirectiveLocationErrorMessage(SHAREABLE, INTERFACE_UPPER),
      ]),
    );
  });

  test('that declaring @shareable on an enum returns an error', () => {
    const result = normalizeSubgraphFromString(
      `
      enum User @shareable {
        USER1
        USER2
      }
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidDirectiveError(SHAREABLE, 'User', FIRST_ORDINAL, [
        invalidDirectiveLocationErrorMessage(SHAREABLE, ENUM_UPPER),
      ]),
    );
  });

  test('that declaring @shareable on an input object returns an error', () => {
    const result = normalizeSubgraphFromString(
      `
      input User @shareable {
        name: String!
        age: Int!
      }
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidDirectiveError(SHAREABLE, 'User', FIRST_ORDINAL, [
        invalidDirectiveLocationErrorMessage(SHAREABLE, INPUT_OBJECT_UPPER),
      ]),
    );
  });

  // Inaccessible directive
  test('Should normalize schemas with shareable directives applied to objects', () => {
    const result = normalizeSubgraphFromString(`
       type User @inaccessible {
          email: String
          name: String
       }
    `);
    expect(result.success).toBe(true);
  });

  test('Should normalize schemas with shareable directives applied to interfaces', () => {
    const result = normalizeSubgraphFromString(`
       interface User @inaccessible {
          email: String
          name: String
       }
    `);
    expect(result.success).toBe(true);
  });

  test('Should normalize schemas with shareable directives applied to input object', () => {
    const result = normalizeSubgraphFromString(`
       input User @inaccessible {
          email: String
          name: String
       }
    `);
    expect(result.success).toBe(true);
  });

  test('Should normalize schemas with shareable directives applied to enums', () => {
    const result = normalizeSubgraphFromString(`
       enum User @inaccessible {
          USER1
          USER2
       }
    `);
    expect(result.success).toBe(true);
  });

  test('that declaring the @inaccessible directive with an argument returns an error', () => {
    const result = normalizeSubgraphFromString(
      `
       type User @inaccessible(fields: "name") {
          email: String
          name: String
       }
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidDirectiveError(INACCESSIBLE, 'User', FIRST_ORDINAL, [
        unexpectedDirectiveArgumentErrorMessage(INACCESSIBLE, [FIELDS]),
      ]),
    );
  });

  test('that the composite keys are identified', () => {
    const result = normalizeSubgraphFromString(`
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
    expect(result.success).toBe(true);
  });

  test('that the nested composite keys are identified', () => {
    const result = normalizeSubgraphFromString(`
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
    expect(result.success).toBe(true);
  });

  test('that invalid fields in composite keys return an error', () => {
    const result = normalizeSubgraphFromString(
      `
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
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidDirectiveError(KEY, 'Entity', numberToOrdinal(2), [
        undefinedFieldInFieldSetErrorMessage('id organization { id details { id age } }', 'Details', 'age'),
      ]),
    );
  });

  test('that an empty selection set in a composite key returns a parse error', () => {
    const result = normalizeSubgraphFromString(
      `
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
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidDirectiveError(KEY, 'Entity', numberToOrdinal(2), [
        unparsableFieldSetErrorMessage(
          'id organization { id details { } }',
          new Error('Syntax Error: Expected Name, found "}".'),
        ),
      ]),
    );
  });

  test('that an error is returned if a composite type selection does not define a selection set of its own  #1.1', () => {
    const result = normalizeSubgraphFromString(
      `
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
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidDirectiveError(KEY, 'Entity', numberToOrdinal(2), [
        invalidSelectionSetErrorMessage('id organization { id details }', ['Organization.details'], 'Details', OBJECT),
      ]),
    );
  });

  test('that an error is returned if a composite type selection does not define a selection set of its own  #1.2', () => {
    const result = normalizeSubgraphFromString(
      `
       type Entity @key(fields: "id email") @key(fields: "id organization { details id }") {
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
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors[0]).toStrictEqual(
      invalidDirectiveError(KEY, 'Entity', '2nd', [
        invalidSelectionSetErrorMessage('id organization { details id }', ['Organization.details'], 'Details', OBJECT),
      ]),
    );
  });

  test('that an error is returned if a composite type selection does not define a selection set of its own #2.1', () => {
    const result = normalizeSubgraphFromString(
      `
       type Entity @key(fields: "id email") @key(fields: "id organization { uuid details }") {
         id: ID!
         email: ID!
         organization: Organization!
        }
        
        type Organization {
         uuid: String!
         details: Details
        }
        
        type Details {
         id: ID!
         name: String!
        }
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidDirectiveError(KEY, 'Entity', numberToOrdinal(2), [
        invalidSelectionSetErrorMessage(
          'id organization { uuid details }',
          ['Organization.details'],
          'Details',
          OBJECT,
        ),
      ]),
    );
  });

  test('that an error is returned if a composite type selection does not define a selection set of its own  #2.2', () => {
    const result = normalizeSubgraphFromString(
      `
       type Entity @key(fields: "id email") @key(fields: "id organization { details uuid }") {
         id: ID!
         email: ID!
         organization: Organization!
        }
        
        type Organization {
         uuid: String!
         details: Details
        }
        
        type Details {
         id: ID!
         name: String!
        }
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors[0]).toStrictEqual(
      invalidDirectiveError(KEY, 'Entity', '2nd', [
        invalidSelectionSetErrorMessage(
          'id organization { details uuid }',
          ['Organization.details'],
          'Details',
          OBJECT,
        ),
      ]),
    );
  });

  test('that if multiple nested objects passed in composite keys are identified', () => {
    const result = normalizeSubgraphFromString(`
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
    expect(result.success).toBe(true);
  });

  test('that if multiple nested objects with invalid fields are passed in composite keys gives an error', () => {
    const result = normalizeSubgraphFromString(
      `
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
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidDirectiveError(KEY, 'Entity', numberToOrdinal(2), [
        undefinedFieldInFieldSetErrorMessage(
          'id organization { details { id } somethingElse { id } }',
          'SomethingElse',
          'id',
        ),
      ]),
    );
  });

  test('that a subgraph is normalized correctly', () => {
    const result = normalizeSubgraphSuccess(nab, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(result.schema)).toBe(
      normalizeString(`
      directive @authenticated on ENUM | FIELD_DEFINITION | INTERFACE | OBJECT | SCALAR
      directive @composeDirective(name: String!) repeatable on SCHEMA
      directive @extends on INTERFACE | OBJECT
      directive @external on FIELD_DEFINITION | OBJECT
      directive @inaccessible on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
      directive @interfaceObject on OBJECT
      directive @key(fields: openfed__FieldSet!, resolvable: Boolean = true) repeatable on INTERFACE | OBJECT
      directive @override(from: String!) on FIELD_DEFINITION
      directive @provides(fields: openfed__FieldSet!) on FIELD_DEFINITION
      directive @requires(fields: openfed__FieldSet!) on FIELD_DEFINITION
      directive @requiresScopes(scopes: [[openfed__Scope!]!]!) on ENUM | FIELD_DEFINITION | INTERFACE | OBJECT | SCALAR
      directive @shareable repeatable on FIELD_DEFINITION | OBJECT
      directive @tag(name: String!) repeatable on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
      
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
      
      scalar openfed__FieldSet
      
      scalar openfed__Scope
    `),
    );
  });

  test('that the correct keyFieldSetsByEntityTypeNameByFieldCoords is generated', () => {
    const result = normalizeSubgraphSuccess(naa, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(result.keyFieldSetsByEntityTypeNameByKeyFieldCoords).toStrictEqual(
      new Map<string, Map<string, Set<string>>>([
        [
          'EntityOne.object',
          new Map<string, Set<string>>([
            ['EntityOne', new Set<string>(['object { id } uuid', 'object { nested { id } }'])],
          ]),
        ],
        ['Object.id', new Map<string, Set<string>>([['EntityOne', new Set<string>(['object { id } uuid'])]])],
        ['EntityOne.uuid', new Map<string, Set<string>>([['EntityOne', new Set<string>(['object { id } uuid'])]])],
        ['Object.nested', new Map<string, Set<string>>([['EntityOne', new Set<string>(['object { nested { id } }'])]])],
        [
          'Nested.id',
          new Map<string, Set<string>>([
            ['EntityOne', new Set<string>(['object { nested { id } }'])],
            ['EntityTwo', new Set<string>(['nested { id } uuid'])],
            ['Nested', new Set<string>(['id'])],
          ]),
        ],
        [
          'EntityTwo.uuid',
          new Map<string, Set<string>>([['EntityTwo', new Set<string>(['name uuid', 'nested { id } uuid'])]]),
        ],
        ['EntityTwo.name', new Map<string, Set<string>>([['EntityTwo', new Set<string>(['name uuid'])]])],
        ['EntityTwo.nested', new Map<string, Set<string>>([['EntityTwo', new Set<string>(['nested { id } uuid'])]])],
      ]),
    );
  });

  test('that named type data is generated correctly', () => {
    const { parentDefinitionDataByTypeName } = normalizeSubgraphSuccess(nac, ROUTER_COMPATIBILITY_VERSION_ONE);
    const query = parentDefinitionDataByTypeName.get(QUERY) as ObjectDefinitionData;
    expect(query).toBeDefined();
    const queryEnumField = query.fieldDataByName.get('enum') as FieldData;
    expect(queryEnumField.namedTypeKind).toBe(Kind.ENUM_TYPE_DEFINITION);
    expect(queryEnumField.namedTypeName).toBe(ENUM);
    expect(printTypeNode(queryEnumField.type)).toBe('Enum!');
    const queryEntityInterfaceField = query.fieldDataByName.get('entityInterfaces') as FieldData;
    expect(queryEntityInterfaceField.namedTypeKind).toBe(Kind.INTERFACE_TYPE_DEFINITION);
    expect(queryEntityInterfaceField.namedTypeName).toBe('EntityInterface');
    expect(printTypeNode(queryEntityInterfaceField.type)).toBe('[EntityInterface]');
    const queryInterfaceField = query.fieldDataByName.get('interface') as FieldData;
    expect(queryInterfaceField.namedTypeKind).toBe(Kind.INTERFACE_TYPE_DEFINITION);
    expect(queryInterfaceField.namedTypeName).toBe(INTERFACE);
    expect(printTypeNode(queryInterfaceField.type)).toBe('Interface!');
    const queryScalarField = query.fieldDataByName.get('scalar') as FieldData;
    expect(queryScalarField.namedTypeKind).toBe(Kind.SCALAR_TYPE_DEFINITION);
    expect(queryScalarField.namedTypeName).toBe(SCALAR);
    expect(printTypeNode(queryScalarField.type)).toBe('Scalar!');
    const queryUnionField = query.fieldDataByName.get('union') as FieldData;
    expect(queryUnionField.namedTypeKind).toBe(Kind.UNION_TYPE_DEFINITION);
    expect(queryUnionField.namedTypeName).toBe(UNION);
    expect(printTypeNode(queryUnionField.type)).toBe('Union!');

    const queryObjectField = query.fieldDataByName.get('object') as FieldData;
    expect(queryObjectField.namedTypeKind).toBe(Kind.OBJECT_TYPE_DEFINITION);
    expect(queryObjectField.namedTypeName).toBe(OBJECT);
    expect(printTypeNode(queryObjectField.type)).toBe('Object!');

    const objectEnumArg = queryObjectField.argumentDataByName.get('enum') as InputValueData;
    expect(objectEnumArg).toBeDefined();
    expect(objectEnumArg.namedTypeKind).toBe(Kind.ENUM_TYPE_DEFINITION);
    expect(objectEnumArg.namedTypeName).toBe(ENUM);
    expect(printTypeNode(objectEnumArg.type)).toBe(ENUM);
    const objectInputsArg = queryObjectField.argumentDataByName.get('inputs') as InputValueData;
    expect(objectInputsArg).toBeDefined();
    expect(objectInputsArg.namedTypeKind).toBe(Kind.INPUT_OBJECT_TYPE_DEFINITION);
    expect(objectInputsArg.namedTypeName).toBe('Input');
    expect(printTypeNode(objectInputsArg.type)).toBe('[Input!]!');
    const objectScalarArg = queryObjectField.argumentDataByName.get('scalar') as InputValueData;
    expect(objectScalarArg).toBeDefined();
    expect(objectScalarArg.namedTypeKind).toBe(Kind.SCALAR_TYPE_DEFINITION);
    expect(objectScalarArg.namedTypeName).toBe(SCALAR);
    expect(printTypeNode(objectScalarArg.type)).toBe('Scalar!');

    const input = parentDefinitionDataByTypeName.get(INPUT) as InputObjectDefinitionData;
    expect(input).toBeDefined();
    const inputEnumField = input.inputValueDataByName.get('enum') as InputValueData;
    expect(inputEnumField.namedTypeKind).toBe(Kind.ENUM_TYPE_DEFINITION);
    expect(inputEnumField.namedTypeName).toBe(ENUM);
    expect(printTypeNode(inputEnumField.type)).toBe('Enum!');
    const inputNestedInputField = input.inputValueDataByName.get('nestedInput') as InputValueData;
    expect(inputNestedInputField.namedTypeKind).toBe(Kind.INPUT_OBJECT_TYPE_DEFINITION);
    expect(inputNestedInputField.namedTypeName).toBe('NestedInput');
    expect(printTypeNode(inputNestedInputField.type)).toBe('NestedInput');
    const inputScalarField = input.inputValueDataByName.get('scalar') as InputValueData;
    expect(inputScalarField.namedTypeKind).toBe(Kind.SCALAR_TYPE_DEFINITION);
    expect(inputScalarField.namedTypeName).toBe(SCALAR);
    expect(printTypeNode(inputScalarField.type)).toBe('Scalar!');
  });
});

const naa: Subgraph = {
  name: 'naa',
  url: '',
  definitions: parse(`
    type EntityOne @key(fields: "uuid object { id }") @key(fields: "object { nested { id } }") {
      uuid: ID!
      object: Object!
    }
    
    type EntityTwo @key(fields: "uuid name") @key(fields: "uuid nested { id }") {
      uuid: ID!
      name: String!
      nested: Nested!
    }
    
    type Object {
      id: ID!
      nested: Nested!
    }
    
    type Nested @key(fields: "id") {
      id: ID!
    }
  `),
};

const nab: Subgraph = {
  name: 'nab',
  url: '',
  definitions: parse(`
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
  `),
};

const nac: Subgraph = {
  name: 'nac',
  url: '',
  definitions: parse(`
    enum Enum {
      A
    }
    
    interface Interface {
      id: ID!
    }
    
    type EntityInterface @key(fields: "id") @interfaceObject {
      id: ID!
    }
    
    type Object implements Interface {
      id: ID!
    }
    
    input Input {
      enum: Enum!
      nestedInput: NestedInput
      scalar: Scalar!
    }
    
    input NestedInput {
      enums: [Enum]
      scalar: [Scalar]
    }
    
    type Query {
      enum: Enum!
      entityInterfaces: [EntityInterface]
      interface: Interface!
      object(enum: Enum, inputs: [Input!]!, scalar: Scalar!): Object!
      scalar: Scalar!
      union: Union!
    }
    
    union Union = Object
    
    scalar Scalar
  `),
};
