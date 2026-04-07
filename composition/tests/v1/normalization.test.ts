import {
  duplicateDirectiveDefinitionError,
  duplicateEnumValueDefinitionError,
  duplicateTypeDefinitionError,
  ENUM,
  ENUM_UPPER,
  EXTERNAL,
  type FieldData,
  FIELDS,
  FIRST_ORDINAL,
  INACCESSIBLE,
  INPUT,
  INPUT_OBJECT_UPPER,
  type InputObjectDefinitionData,
  type InputValueData,
  INTERFACE,
  INTERFACE_UPPER,
  invalidDirectiveError,
  invalidDirectiveLocationErrorMessage,
  invalidProvidesOrRequiresDirectivesError,
  invalidSelectionSetErrorMessage,
  KEY,
  NAME,
  numberToOrdinal,
  OBJECT,
  OBJECT_UPPER,
  type ObjectDefinitionData,
  parse,
  PROVIDES,
  QUERY,
  REQUIRES,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  SCALAR,
  SHAREABLE,
  stringToNamedTypeNode,
  type Subgraph,
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
  AUTHENTICATED_DIRECTIVE,
  EXTERNAL_DIRECTIVE,
  KEY_DIRECTIVE,
  OPENFED_FIELD_SET,
  OPENFED_SCOPE,
  REQUIRES_SCOPES_DIRECTIVE,
  SCHEMA_QUERY_DEFINITION,
  SHAREABLE_DIRECTIVE,
  TAG_DIRECTIVE,
} from './utils/utils';
import {
  createSubgraph,
  normalizeString,
  normalizeSubgraphFailure,
  normalizeSubgraphFromStringFailure,
  normalizeSubgraphSuccess,
  schemaToSortedNormalizedString,
} from '../utils/utils';
import { Kind, OperationTypeNode } from 'graphql';
import { printTypeNode } from '@graphql-tools/merge';

describe('Normalization tests', () => {
  test('that an error is returned for an unparsable subgraph', () => {
    const { errors } = normalizeSubgraphFromStringFailure({ sdlString: '' });
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain(
      `The subgraph has syntax errors and could not be parsed.\n` + ` The reason provided was: Syntax Error`,
    );
  });

  test('that an error is returned if an undefined type is referenced in the subgraph', () => {
    const { errors } = normalizeSubgraphFailure(
      createSubgraph(
        'subgraph',
        `
      type Example {
        field: Unknown
      }  
    `,
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(undefinedTypeError('Unknown'));
  });

  test('that the base scalars are identified', () => {
    const { schema } = normalizeSubgraphSuccess(
      createSubgraph(
        'subgraph',
        `
      type Example {
        boolean: Boolean!
        float: Float
        int: Int!
        id: ID
        string: String!
      }  
    `,
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(schema)).toBe(
      normalizeString(
        `
      type Example {
        boolean: Boolean!
        float: Float
        id: ID
        int: Int!
        string: String!
      }`,
      ),
    );
  });

  test('that undefined directives return an error', () => {
    const { errors } = normalizeSubgraphFailure(
      createSubgraph(
        'subgraph',
        `
      type Example {
        string: String @UnknownDirective
      }  
    `,
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(undefinedDirectiveError('UnknownDirective', 'Example.string'));
  });

  test('that duplicate directive definitions return an error', () => {
    const { errors } = normalizeSubgraphFailure(
      createSubgraph(
        'subgraph',
        `
      directive @KnownDirective on FIELD_DEFINITION
      directive @KnownDirective on FIELD_DEFINITION
      
      type Example {
        string: String @KnownDirective
      }  
    `,
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(duplicateDirectiveDefinitionError('KnownDirective'));
  });

  test('that extending an entity with its key field is valid', () => {
    const { schema } = normalizeSubgraphSuccess(
      createSubgraph(
        'subgraph',
        `
      type Entity @key(fields: "id") {
        name: String!
      }
      
      extend type Entity {
        id: ID!
      }
    `,
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(schema!)).toBe(
      normalizeString(
        KEY_DIRECTIVE +
          `
      type Entity @key(fields: "id") {
        id: ID!
        name: String!
      }  
    ` +
          OPENFED_FIELD_SET,
      ),
    );
  });

  test('that extending an object with the key directive is valid', () => {
    const { schema } = normalizeSubgraphSuccess(
      createSubgraph(
        'subgraph',
        `
      type Entity {
        id: ID!
      }
      
      extend type Entity @key(fields: "id") {
        name: String!
      }
    `,
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(schema)).toBe(
      normalizeString(
        KEY_DIRECTIVE +
          `
      type Entity @key(fields: "id") {
        id: ID!
        name: String!
      }  
    ` +
          OPENFED_FIELD_SET,
      ),
    );
  });

  test('that an undefined key field returns an error #1', () => {
    const { errors } = normalizeSubgraphFailure(
      createSubgraph(
        'subgraph',
        `
      type Entity @key(fields: "unknown") {
        name: String!
      }
    `,
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      invalidDirectiveError(KEY, 'Entity', FIRST_ORDINAL, [
        undefinedFieldInFieldSetErrorMessage('unknown', 'Entity', 'unknown'),
      ]),
    );
  });

  test('that an undefined key field returns an error #2', () => {
    const { errors } = normalizeSubgraphFailure(
      createSubgraph(
        'subgraph',
        `
      type Entity {
        id: ID!
      }
      
      extend type Entity @key(fields: "unknown") {
        name: String!
      }
    `,
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      invalidDirectiveError(KEY, 'Entity', FIRST_ORDINAL, [
        undefinedFieldInFieldSetErrorMessage('unknown', 'Entity', 'unknown'),
      ]),
    );
  });

  test('that an undefined key field returns an error #3', () => {
    const { errors } = normalizeSubgraphFailure(
      createSubgraph(
        'subgraph',
        `
      extend type Entity @key(fields: "unknown") {
        name: String!
      }
    `,
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      invalidDirectiveError(KEY, 'Entity', FIRST_ORDINAL, [
        undefinedFieldInFieldSetErrorMessage('unknown', 'Entity', 'unknown'),
      ]),
    );
  });

  test('that extending an entity with the same key directive does not duplicate the directive', () => {
    const { schema } = normalizeSubgraphSuccess(
      createSubgraph(
        'subgraph',
        `
      type Entity @key(fields: "id") {
        id: ID!
      }
      
      extend type Entity @key(fields: "id") {
        name: String!
      }
    `,
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(schema)).toBe(
      normalizeString(
        KEY_DIRECTIVE +
          `
      type Entity @key(fields: "id") {
        id: ID!
        name: String!
      }  
    ` +
          OPENFED_FIELD_SET,
      ),
    );
  });

  test('that enums are normalized', () => {
    const { schema } = normalizeSubgraphSuccess(
      createSubgraph(
        'subgraph',
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
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(schema)).toBe(
      normalizeString(
        `
      directive @CustomDirectiveFour on ENUM_VALUE
      directive @CustomDirectiveOne on ENUM
      directive @CustomDirectiveThree on ENUM
      directive @CustomDirectiveTwo on ENUM_VALUE
      
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
    const { errors } = normalizeSubgraphFailure(
      createSubgraph(
        'subgraph',
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
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(duplicateEnumValueDefinitionError('Alphabet', 'D'));
  });

  test('that redefining an enum returns an error', () => {
    const { errors } = normalizeSubgraphFailure(
      createSubgraph(
        'subgraph',
        `
      enum Alphabet {
        A
      }
      
      enum Alphabet {
        B
      }
    `,
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(duplicateTypeDefinitionError(ENUM, 'Alphabet'));
  });

  test('that interfaces are normalized', () => {
    const { schema } = normalizeSubgraphSuccess(
      createSubgraph(
        'subgraph',
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
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(schema)).toBe(
      normalizeString(
        `
      directive @CustomDirectiveFour on FIELD_DEFINITION
      directive @CustomDirectiveOne on INTERFACE
      directive @CustomDirectiveThree on INTERFACE
      directive @CustomDirectiveTwo on FIELD_DEFINITION
    
      interface Human @CustomDirectiveOne @CustomDirectiveThree {
        age: Int @CustomDirectiveTwo
        height: Int @CustomDirectiveFour
        name: String
      }`,
      ),
    );
  });

  test('that Input Objects are normalized', () => {
    const { schema } = normalizeSubgraphSuccess(
      createSubgraph(
        'subgraph',
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
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(schema)).toBe(
      normalizeString(
        `
      directive @CustomDirectiveFour on INPUT_FIELD_DEFINITION
      directive @CustomDirectiveOne on INPUT_OBJECT
      directive @CustomDirectiveThree on INPUT_OBJECT
      directive @CustomDirectiveTwo on INPUT_FIELD_DEFINITION
    
      input Input @CustomDirectiveOne @CustomDirectiveThree {
        age: Int @CustomDirectiveTwo
        height: Int @CustomDirectiveFour
        name: String
      }`,
      ),
    );
  });

  test('that object types are normalized successfully', () => {
    const { schema } = normalizeSubgraphSuccess(
      createSubgraph(
        'subgraph',
        `
      type Object {
        name: String!
      }
      
      extend type Object {
        age: Int!
      }
    `,
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(schema)).toBe(
      normalizeString(
        `
    type Object {
      age: Int!
      name: String!
    }`,
      ),
    );
  });

  test('that an object with no fields returns an error', () => {
    const { errors } = normalizeSubgraphFromStringFailure({
      sdlString: `
        type Object {
        }
    `,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe(
      `The subgraph has syntax errors and could not be parsed.\n` +
        ` The reason provided was: Syntax Error: Expected Name, found "}".`,
    );
  });

  test('that scalars are normalized', () => {
    const { schema } = normalizeSubgraphSuccess(
      createSubgraph(
        'subgraph',
        `
      directive @CustomDirectiveOne on SCALAR
      directive @CustomDirectiveTwo on SCALAR
    
      scalar JSON @CustomDirectiveOne
      
      extend scalar JSON @CustomDirectiveTwo
    `,
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(schema)).toBe(
      normalizeString(
        `
      directive @CustomDirectiveOne on SCALAR
      directive @CustomDirectiveTwo on SCALAR
      
      scalar JSON @CustomDirectiveOne @CustomDirectiveTwo`,
      ),
    );
  });

  test('that unions are normalized', () => {
    const { schema } = normalizeSubgraphSuccess(
      createSubgraph(
        'subgraph',
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
    `,
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(schema)).toBe(
      normalizeString(
        `
      directive @CustomDirectiveOne on UNION
      directive @CustomDirectiveTwo on UNION
      
      union Cats @CustomDirectiveOne @CustomDirectiveTwo = Muffin | Pepper | Treacle
      
      type Muffin {
        age: Int
      }
      
      type Pepper {
        age: Int
      }
      
      type Treacle {
        age: Int
      }
     `,
      ),
    );
  });

  test('that a union without members returns an error', () => {
    const { errors } = normalizeSubgraphFromStringFailure({
      sdlString: `
        union Cats =
        
        type Pepper {
          name: String
        }  
      `,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe(
      `The subgraph has syntax errors and could not be parsed.\n` +
        ` The reason provided was: Syntax Error: Unexpected Name "Pepper".`,
    );
  });

  test('that undefined union members return an error', () => {
    const { errors } = normalizeSubgraphFailure(
      createSubgraph(
        'subgraph',
        `
      union Cats = Pepper 
    `,
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(undefinedTypeError('Pepper'));
  });

  test('that an error is returned if an integer is provided as an Enum value', () => {
    const { errors } = normalizeSubgraphFromStringFailure({
      sdlString: `
        enum UserRole {
          ADMIN
          MODERATOR
          1
        }
      `,
    });
    expect(errors[0].message).toBe(
      `The subgraph has syntax errors and could not be parsed.\n` +
        ` The reason provided was: Syntax Error: Expected Name, found Int "1".`,
    );
  });

  test('that an error is returned if an Enum defines duplicate values', () => {
    const { errors } = normalizeSubgraphFailure(
      createSubgraph(
        'subgraph',
        `
      enum UserRole {
        ADMIN
        MODERATOR
        ADMIN
      }
    `,
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(duplicateEnumValueDefinitionError('UserRole', 'ADMIN'));
  });

  test('that an error is returned if an Enum value contains special characters', () => {
    const { errors } = normalizeSubgraphFromStringFailure({
      sdlString: `
         enum Continent {
            AFR!CA
            EUROPE
            ASIA
          }
       `,
    });
    expect(errors[0].message).toBe(
      `The subgraph has syntax errors and could not be parsed.\n` +
        ` The reason provided was: Syntax Error: Expected Name, found "!".`,
    );
  });

  test('that Object extensions are normalized successfully', () => {
    const { schema } = normalizeSubgraphSuccess(
      createSubgraph(
        'subgraph',
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
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(schema)).toBe(
      normalizeString(
        KEY_DIRECTIVE +
          TAG_DIRECTIVE +
          `
        type DeliveryEstimates {
          estimatedDelivery: String
          fastestDelivery: String
        }
        
        type Product @key(fields: "id") {
          delivery(zip: String): DeliveryEstimates
          dimensions: ProductDimension
          id: ID! @tag(name: "hi-from-inventory")
          name: String
        }
        
        type ProductDimension {
          size: String
          weight: Float @tag(name: "hi-from-inventory-value-type-field")
        }
        ` +
          OPENFED_FIELD_SET,
      ),
    );
  });

  test('that query extensions are normalized successfully', () => {
    const { schema } = normalizeSubgraphSuccess(
      createSubgraph(
        'subgraph',
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
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(schema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          KEY_DIRECTIVE +
          TAG_DIRECTIVE +
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
      ` +
          OPENFED_FIELD_SET,
      ),
    );
  });

  test('that undefined version two directives are injected', () => {
    const sdl = readFileSync(join(__dirname, 'test-data/testNormalization.graphql'), {
      encoding: 'utf8',
    });
    const { schema } = normalizeSubgraphSuccess(createSubgraph('subgraph', sdl), ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(schema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `directive @hello on FIELD_DEFINITION` +
          KEY_DIRECTIVE +
          `directive @myDirective(a: String!) on FIELD_DEFINITION` +
          SHAREABLE_DIRECTIVE +
          TAG_DIRECTIVE +
          `
      type Product implements ProductItf & SkuItf 
        @key(fields: "id") 
        @key(fields: "sku package") 
        @key(fields: "sku variation { id }") {
        createdBy: User
        dimensions: ProductDimension
        hidden: String
        id: ID! @tag(name: "hi-from-products")
        name: String @hello
        oldField: String
        package: String
        reviewsScore: Float! @shareable
        sku: String
        variation: ProductVariation
      }
      
      type ProductDimension {
        size: String @shareable
        weight: Float @shareable
      }
      
      interface ProductItf implements SkuItf {
        createdBy: User
        dimensions: ProductDimension
        hidden: String
        id: ID!
        name: String
        oldField: String @deprecated(reason: "refactored out")
        package: String
        sku: String
        variation: ProductVariation
      }
      
      type ProductVariation {
        id: ID!
        name: String
      }
      
      type Query {
        allProducts: [ProductItf]
        product(id: ID!): ProductItf
      }
      
      enum ShippingClass {
        EXPRESS
        STANDARD
      }
      
      interface SkuItf {
        sku: String
      }
      
      type User @key(fields: "email") {
        email: ID!
        totalProductsCreated: Int @shareable
      }` +
          OPENFED_FIELD_SET,
      ),
    );
  });

  test('that an error is returned if a field set references a non-existent field', () => {
    const { errors } = normalizeSubgraphFailure(
      createSubgraph(
        'subgraph',
        `
      type User @key(fields: "id") {
        name: String!
        age: Int!
      }
    `,
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      invalidDirectiveError(KEY, 'User', FIRST_ORDINAL, [undefinedFieldInFieldSetErrorMessage('id', 'User', 'id')]),
    );
  });

  test('that an error is returned if a directive is applied to an invalid Enum location', () => {
    const { errors } = normalizeSubgraphFailure(
      createSubgraph(
        'subgraph',
        `
      enum User @key(fields: "name") {
        USER1
        USER2
      }
    `,
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      invalidDirectiveError(KEY, 'User', FIRST_ORDINAL, [invalidDirectiveLocationErrorMessage(KEY, ENUM_UPPER)]),
    );
  });

  test('that an error is returned if a directive is applied to an invalid Input Object location', () => {
    const { errors } = normalizeSubgraphFailure(
      createSubgraph(
        'subgraph',
        `
      input User @key(fields: "name") {
        name: String!
        age: Int!
      }
    `,
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      invalidDirectiveError(KEY, 'User', FIRST_ORDINAL, [
        invalidDirectiveLocationErrorMessage(KEY, INPUT_OBJECT_UPPER),
      ]),
    );
  });

  test('that declaring the @tag directive on a parent without the required name argument returns an error', () => {
    const { errors } = normalizeSubgraphFailure(
      createSubgraph(
        'subgraph',
        `
      type User @tag {
        name: String!
        age: Int!
      }
    `,
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      invalidDirectiveError(TAG, 'User', FIRST_ORDINAL, [undefinedRequiredArgumentsErrorMessage(TAG, [NAME], [])]),
    );
  });

  test('that declaring the @tag directive on a child without the required name argument returns an error', () => {
    const { errors } = normalizeSubgraphFailure(
      createSubgraph(
        'subgraph',
        `
      type User {
        name: String! @tag
        age: Int!
      }
    `,
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      invalidDirectiveError('tag', 'User.name', FIRST_ORDINAL, [
        undefinedRequiredArgumentsErrorMessage(TAG, [NAME], []),
      ]),
    );
  });

  // External directive
  test('that an @external directive declared on the Object level is normalized successfully', () => {
    const { schema } = normalizeSubgraphSuccess(
      createSubgraph(
        'subgraph',
        `
      type User @external {
        age: Int!
        name: String!
      }
    `,
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(schema)).toBe(
      normalizeString(
        EXTERNAL_DIRECTIVE +
          `
      type User {
        age: Int! @external
        name: String! @external
      }
    `,
      ),
    );
  });

  test('that an error is returned if @external is declared on an Interface', () => {
    const { errors } = normalizeSubgraphFailure(
      createSubgraph(
        'subgraph',
        `
      interface User @external {
        name: String!
        age: Int!
      }
    `,
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      invalidDirectiveError(EXTERNAL, 'User', FIRST_ORDINAL, [
        invalidDirectiveLocationErrorMessage(EXTERNAL, INTERFACE_UPPER),
      ]),
    );
  });

  test('that an error is returned if @external is declared on an Enum', () => {
    const { errors } = normalizeSubgraphFailure(
      createSubgraph(
        'subgraph',
        `
      enum User @external {
        USER1
        USER2
      }
    `,
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      invalidDirectiveError(EXTERNAL, 'User', FIRST_ORDINAL, [
        invalidDirectiveLocationErrorMessage(EXTERNAL, ENUM_UPPER),
      ]),
    );
  });

  test('that an error is returned if @external is declared on an Input Object', () => {
    const { errors } = normalizeSubgraphFailure(
      createSubgraph(
        'subgraph',
        `
      input User @external {
        name: String!
        age: Int!
      }
    `,
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      invalidDirectiveError(EXTERNAL, 'User', FIRST_ORDINAL, [
        invalidDirectiveLocationErrorMessage(EXTERNAL, INPUT_OBJECT_UPPER),
      ]),
    );
  });

  test('that an error is returned if @provides references a non-existent field', () => {
    const { errors } = normalizeSubgraphFailure(
      createSubgraph(
        'subgraph',
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
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toStrictEqual(
      `The following "provides" directive is invalid:\n On field "Review.user":\n -` +
        undefinedFieldInFieldSetErrorMessage('age', 'User', 'age'),
    );
  });

  test('that declaring the @provides directive without the required fields argument returns an error', () => {
    const { errors } = normalizeSubgraphFailure(
      createSubgraph(
        'subgraph',
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
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      invalidDirectiveError(PROVIDES, 'Review.user', FIRST_ORDINAL, [
        undefinedRequiredArgumentsErrorMessage(PROVIDES, [FIELDS], []),
      ]),
    );
  });

  test('that an error is returned if @provides is declared on an Object', () => {
    const { errors } = normalizeSubgraphFailure(
      createSubgraph(
        'subgraph',
        `
      type User @provides(fields : "age") {
        name: String!
        age: Int!
      }
    `,
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      invalidDirectiveError(PROVIDES, 'User', FIRST_ORDINAL, [
        invalidDirectiveLocationErrorMessage(PROVIDES, OBJECT_UPPER),
      ]),
    );
  });

  test('that an error is returned if @provides is declared on an Interface', () => {
    const { errors } = normalizeSubgraphFailure(
      createSubgraph(
        'subgraph',
        `
      interface User @provides(fields : "age") {
        name: String!
        age: Int!
      }
    `,
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      invalidDirectiveError(PROVIDES, 'User', FIRST_ORDINAL, [
        invalidDirectiveLocationErrorMessage(PROVIDES, INTERFACE_UPPER),
      ]),
    );
  });

  test('that an error is returned if @provides is declared on an Enum', () => {
    const { errors } = normalizeSubgraphFailure(
      createSubgraph(
        'subgraph',
        `
      enum User @provides(fields : "age") {
        USER1
        USER2
      }
    `,
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      invalidDirectiveError(PROVIDES, 'User', FIRST_ORDINAL, [
        invalidDirectiveLocationErrorMessage(PROVIDES, ENUM_UPPER),
      ]),
    );
  });

  test('that an error is returned if @provides is declared on an Input Object', () => {
    const { errors } = normalizeSubgraphFailure(
      createSubgraph(
        'subgraph',
        `
      input User @provides(fields : "age") {
        name: String!
        age: Int!
      }
    `,
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      invalidDirectiveError(PROVIDES, 'User', FIRST_ORDINAL, [
        invalidDirectiveLocationErrorMessage(PROVIDES, INPUT_OBJECT_UPPER),
      ]),
    );
  });

  test('that an error is returned if @requires references a non-existent field', () => {
    const { errors } = normalizeSubgraphFailure(
      createSubgraph(
        'subgraph',
        `
     type Product @key(fields : "id") {
        id: String!
        shippingCost: String! @requires(fields : "age")
        weight: Float! @external
      }
    `,
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      invalidProvidesOrRequiresDirectivesError(REQUIRES, [
        ` On field "Product.shippingCost":\n -` + undefinedFieldInFieldSetErrorMessage('age', 'Product', 'age'),
      ]),
    );
  });

  test('that an error is returned if a @requires directive does not define arguments', () => {
    const { errors } = normalizeSubgraphFailure(
      createSubgraph(
        'subgraph',
        `
     type Product @key(fields : "id") {
        id: String!
        shippingCost: String! @requires
        weight: Float! @external
      }
    `,
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      invalidDirectiveError(REQUIRES, 'Product.shippingCost', FIRST_ORDINAL, [
        undefinedRequiredArgumentsErrorMessage(REQUIRES, [FIELDS], []),
      ]),
    );
  });

  // Shareable directive
  test('that a @shareable directive declared on the Object level is normalized successfully', () => {
    const { schema } = normalizeSubgraphSuccess(
      createSubgraph(
        'subgraph',
        `
       type User @key(fields: "email") @shareable {
          email: String
          name: String
       }
    `,
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(schema)).toBe(
      normalizeString(
        KEY_DIRECTIVE +
          SHAREABLE_DIRECTIVE +
          `
      type User @key(fields: "email") {
        email: String @shareable
        name: String @shareable
      }
    ` +
          OPENFED_FIELD_SET,
      ),
    );
  });

  test('that an error is returned if an argument is defined on a @shareable directive', () => {
    const { errors } = normalizeSubgraphFailure(
      createSubgraph(
        'subgraph',
        `
     type User @shareable(fields: "email") {
        email: String
        name: String
      }
    `,
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      invalidDirectiveError(SHAREABLE, 'User', FIRST_ORDINAL, [
        unexpectedDirectiveArgumentErrorMessage(SHAREABLE, [FIELDS]),
      ]),
    );
  });

  test('that an error is returned if @inaccessible is declared with an argument', () => {
    const { errors } = normalizeSubgraphFailure(
      createSubgraph(
        'subgraph',
        `
       type User @inaccessible(fields: "name") {
          email: String
          name: String
       }
    `,
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      invalidDirectiveError(INACCESSIBLE, 'User', FIRST_ORDINAL, [
        unexpectedDirectiveArgumentErrorMessage(INACCESSIBLE, [FIELDS]),
      ]),
    );
  });

  test('that composite keys fields are identified', () => {
    const result = normalizeSubgraphSuccess(
      createSubgraph(
        'subgraph',
        `
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
    `,
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(result.success).toBe(true);
  });

  test('that the nested composite keys are identified', () => {
    const result = normalizeSubgraphSuccess(
      createSubgraph(
        'subgraph',
        `
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
    `,
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(result.success).toBe(true);
  });

  test('that invalid fields in composite keys return an error', () => {
    const { errors } = normalizeSubgraphFailure(
      createSubgraph(
        'subgraph',
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
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      invalidDirectiveError(KEY, 'Entity', numberToOrdinal(2), [
        undefinedFieldInFieldSetErrorMessage('id organization { id details { id age } }', 'Details', 'age'),
      ]),
    );
  });

  test('that an empty selection set in a composite key returns a parse error', () => {
    const { errors } = normalizeSubgraphFailure(
      createSubgraph(
        'subgraph',
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
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      invalidDirectiveError(KEY, 'Entity', numberToOrdinal(2), [
        unparsableFieldSetErrorMessage(
          'id organization { id details { } }',
          new Error('Syntax Error: Expected Name, found "}".'),
        ),
      ]),
    );
  });

  test('that an error is returned if a composite type selection does not define a selection set of its own  #1.1', () => {
    const { errors } = normalizeSubgraphFailure(
      createSubgraph(
        'subgraph',
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
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      invalidDirectiveError(KEY, 'Entity', numberToOrdinal(2), [
        invalidSelectionSetErrorMessage('id organization { id details }', ['Organization.details'], 'Details', OBJECT),
      ]),
    );
  });

  test('that an error is returned if a composite type selection does not define a selection set of its own  #1.2', () => {
    const { errors } = normalizeSubgraphFailure(
      createSubgraph(
        'subgraph',
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
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(errors).toBeDefined();
    expect(errors[0]).toStrictEqual(
      invalidDirectiveError(KEY, 'Entity', '2nd', [
        invalidSelectionSetErrorMessage('id organization { details id }', ['Organization.details'], 'Details', OBJECT),
      ]),
    );
  });

  test('that an error is returned if a composite type selection does not define a selection set of its own #2.1', () => {
    const { errors } = normalizeSubgraphFailure(
      createSubgraph(
        'subgraph',
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
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
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
    const { errors } = normalizeSubgraphFailure(
      createSubgraph(
        'subgraph',
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
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(errors).toBeDefined();
    expect(errors[0]).toStrictEqual(
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
    const result = normalizeSubgraphSuccess(
      createSubgraph(
        'subgraph',
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
         id: ID!
         name: String!
        }
    `,
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
  });

  test('that if multiple nested objects with invalid fields are passed in composite keys gives an error', () => {
    const { errors } = normalizeSubgraphFailure(
      createSubgraph(
        'subgraph',
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
      ),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
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
    const { schema } = normalizeSubgraphSuccess(nab, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(schema)).toBe(
      normalizeString(
        AUTHENTICATED_DIRECTIVE +
          REQUIRES_SCOPES_DIRECTIVE +
          `
      enum Enum @requiresScopes(scopes: [["read:enum"]]) {
        VALUE
      }
      
      """This is the description for Interface"""
      interface Interface @requiresScopes(scopes: [["read:private"]]) {
        field(argumentOne: String!): Enum! @authenticated
      }

      """This is the description for Object"""
      type Object implements Interface @requiresScopes(scopes: [["read:object"]]) {
        """This is the description for Object.field"""
        field(
          """This is the description for the argumentOne argument of Object.field"""
          argumentOne: String!
        ): Enum!
      }
    ` +
          OPENFED_SCOPE,
      ),
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

  test('that the correct schema node is generated after boiler plate fields are removed', () => {
    const { schema, schemaNode } = normalizeSubgraphSuccess(naaad, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(schema)).toBe(
      normalizeString(
        `
        schema @a {
          query: Query
        }
          
        directive @a on SCHEMA` +
          KEY_DIRECTIVE +
          `
      
        type Entity @key(fields: "id") {
          id: ID!
        }
        
        type Query
        
        scalar openfed__FieldSet
    `,
      ),
    );
    expect(schemaNode).toStrictEqual({
      directives: [
        {
          arguments: [],
          kind: Kind.DIRECTIVE,
          name: {
            kind: Kind.NAME,
            value: 'a',
          },
        },
      ],
      kind: Kind.SCHEMA_DEFINITION,
      operationTypes: [
        {
          kind: Kind.OPERATION_TYPE_DEFINITION,
          operation: OperationTypeNode.QUERY,
          type: stringToNamedTypeNode(QUERY),
        },
      ],
    });
  });

  test('that the correct schema node is generated after boiler plate fields are removed for a renamed root type', () => {
    const { schema, schemaNode } = normalizeSubgraphSuccess(naaae, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(schema)).toBe(
      normalizeString(
        `
        schema @a {
          query: MyQuery
        }
        
        directive @a on SCHEMA` +
          KEY_DIRECTIVE +
          `
      
        type Entity @key(fields: "id") {
          id: ID!
        }
        
        type MyQuery
        
        scalar openfed__FieldSet
    `,
      ),
    );
    expect(schemaNode).toStrictEqual({
      directives: [
        {
          arguments: [],
          kind: Kind.DIRECTIVE,
          name: {
            kind: Kind.NAME,
            value: 'a',
          },
        },
      ],
      kind: Kind.SCHEMA_DEFINITION,
      operationTypes: [
        {
          kind: Kind.OPERATION_TYPE_DEFINITION,
          operation: OperationTypeNode.QUERY,
          type: stringToNamedTypeNode('MyQuery'),
        },
      ],
    });
  });

  test('that a schema node description is persisted', () => {
    const { schema, schemaNode } = normalizeSubgraphSuccess(naaaf, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(schema)).toBe(
      normalizeString(
        `
        """This is a schema node"""
        schema @a {
          query: MyQuery
        }
        
        directive @a on SCHEMA` +
          KEY_DIRECTIVE +
          `
      
        type Entity @key(fields: "id") {
          id: ID!
        }
        
        type MyQuery
        
        scalar openfed__FieldSet
    `,
      ),
    );
    expect(schemaNode).toStrictEqual({
      description: {
        block: true,
        kind: Kind.STRING,
        value: 'This is a schema node',
      },
      directives: [
        {
          arguments: [],
          kind: Kind.DIRECTIVE,
          name: {
            kind: Kind.NAME,
            value: 'a',
          },
        },
      ],
      kind: Kind.SCHEMA_DEFINITION,
      operationTypes: [
        {
          kind: Kind.OPERATION_TYPE_DEFINITION,
          operation: OperationTypeNode.QUERY,
          type: stringToNamedTypeNode('MyQuery'),
        },
      ],
    });
  });

  // @TODO: schema extension orphans are not supported by old versions of the router, so it's a v1 breaking change.
  test('that a schema extension orphan is not persisted', () => {
    const { schema, schemaNode } = normalizeSubgraphSuccess(naaag, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(schema)).toBe(normalizeString(`directive @a on SCHEMA`));
    expect(schemaNode).toStrictEqual({
      directives: [
        {
          arguments: [],
          kind: Kind.DIRECTIVE,
          name: {
            kind: Kind.NAME,
            value: 'a',
          },
        },
      ],
      kind: Kind.SCHEMA_EXTENSION,
    });
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

const naaad: Subgraph = {
  name: 'naaad',
  url: '',
  definitions: parse(`
    schema @a {
      query: Query
    }
    
    directive @a on SCHEMA
    
    type Entity @key(fields: "id") {
      id: ID!
    }
    
    type Query {
      _entities(representations: [_Any!]!): [_Entity]!
      _service: _Service!
    }
    
    scalar _Any
    
    union _Entity = Entity
    
    type _Service {
      sdl: String
    }
  `),
};

const naaae: Subgraph = {
  name: 'naaae',
  url: '',
  definitions: parse(`
    schema @a {
      query: MyQuery
    }
    
    directive @a on SCHEMA
    
    type Entity @key(fields: "id") {
      id: ID!
    }
    
    type MyQuery {
      _entities(representations: [_Any!]!): [_Entity]!
      _service: _Service!
    }
    
    scalar _Any
    
    union _Entity = Entity
    
    type _Service {
      sdl: String
    }
  `),
};

const naaaf: Subgraph = {
  name: 'naaaf',
  url: '',
  definitions: parse(`
    """This is a schema node"""
    schema @a {
      query: MyQuery
    }
    
    directive @a on SCHEMA
    
    type Entity @key(fields: "id") {
      id: ID!
    }
    
    type MyQuery {
      _entities(representations: [_Any!]!): [_Entity]!
      _service: _Service!
    }
    
    scalar _Any
    
    union _Entity = Entity
    
    type _Service {
      sdl: String
    }
  `),
};

const naaag: Subgraph = {
  name: 'naaag',
  url: '',
  definitions: parse(`
    extend schema @a
    
    directive @a on SCHEMA
  `),
};
