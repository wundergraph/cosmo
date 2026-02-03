import { describe, expect, it } from 'vitest';
import { buildSchema, GraphQLField, GraphQLObjectType, GraphQLSchema, StringValueNode } from 'graphql';
import { RequiredFieldsVisitor } from '../../src/index.js';
import { buildProtoMessage } from '../../src/proto-utils.js';
import {
  CompositeMessageKind,
  InterfaceMessageDefinition,
  isInterfaceMessageDefinition,
  isUnionMessageDefinition,
  ProtoMessage,
  ProtoMessageField,
  RPCMethod,
  UnionMessageDefinition,
} from '../../src/types.js';
import { RequiredFieldMapping } from '../../src/required-fields-visitor.js';

/**
 * Options for creating a RequiredFieldsVisitor test setup.
 */
interface CreateVisitorOptions {
  /** The GraphQL SDL to build the schema from */
  sdl: string;
  /** The name of the entity type (defaults to finding the type with @key directive) */
  entityName: string;
  /** The name of the field with the @requires directive */
  requiredFieldName: string;
  /** Optional explicit field set string (if not provided, extracted from @requires directive) */
  fieldSet?: string;
}

/**
 * Result of creating a RequiredFieldsVisitor test setup.
 */
interface VisitorTestSetup {
  schema: GraphQLSchema;
  entity: GraphQLObjectType;
  requiredField: GraphQLField<any, any, any>;
  visitor: RequiredFieldsVisitor;
  /** Calls visitor.visit() and returns the results */
  execute: () => VisitorResult;
}

/**
 * Result of executing the visitor.
 */
interface VisitorResult {
  rpcMethods: RPCMethod[];
  messageDefinitions: ProtoMessage[];
  mapping: Record<string, RequiredFieldMapping>;
}

/**
 * Creates a RequiredFieldsVisitor test setup with common boilerplate handled.
 *
 * @param options - Configuration for the test setup
 * @returns The test setup including the visitor and an execute function
 * @throws Error if the entity or required field is not found
 */
function createVisitorSetup(options: CreateVisitorOptions): VisitorTestSetup {
  const { sdl, entityName, requiredFieldName, fieldSet: explicitFieldSet } = options;

  const schema = buildSchema(sdl, {
    assumeValid: true,
    assumeValidSDL: true,
  });

  const entity = schema.getTypeMap()[entityName] as GraphQLObjectType | undefined;
  if (!entity) {
    throw new Error(`Entity '${entityName}' not found in schema`);
  }

  const requiredField = entity.getFields()[requiredFieldName];
  if (!requiredField) {
    throw new Error(`Field '${requiredFieldName}' not found on entity '${entityName}'`);
  }

  // Extract fieldSet from @requires directive if not explicitly provided
  const fieldSet =
    explicitFieldSet ??
    (
      requiredField.astNode?.directives?.find((d) => d.name.value === 'requires')?.arguments?.[0]
        .value as StringValueNode
    )?.value;

  if (!fieldSet) {
    throw new Error(`No field set found for field '${requiredFieldName}'`);
  }

  const visitor = new RequiredFieldsVisitor(schema, entity, requiredField, fieldSet);

  return {
    schema,
    entity,
    requiredField,
    visitor,
    execute: () => {
      visitor.visit();
      return {
        rpcMethods: visitor.getRPCMethods(),
        messageDefinitions: visitor.getMessageDefinitions(),
        mapping: visitor.getMapping(),
      };
    },
  };
}

/**
 * Asserts that a ProtoMessageField matches expected values.
 */
function assertFieldMessage(
  field: ProtoMessageField | undefined,
  expected: { fieldName: string; typeName: string; fieldNumber: number; isRepeated: boolean },
): void {
  expect(field).toBeDefined();
  expect(field?.fieldName).toBe(expected.fieldName);
  expect(field?.typeName).toBe(expected.typeName);
  expect(field?.fieldNumber).toBe(expected.fieldNumber);
  expect(field?.isRepeated).toBe(expected.isRepeated);
}

/**
 * Asserts that the expected standard messages are present in the message definitions.
 */
function assertStandardMessages(messageDefinitions: ProtoMessage[], methodPrefix: string): void {
  expect(messageDefinitions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ messageName: `${methodPrefix}Request` }),
      expect.objectContaining({ messageName: `${methodPrefix}Context` }),
      expect.objectContaining({ messageName: `${methodPrefix}Response` }),
      expect.objectContaining({ messageName: `${methodPrefix}Result` }),
      expect.objectContaining({ messageName: `${methodPrefix}Fields` }),
    ]),
  );
}

describe('Field Set Visitor', () => {
  it('should visit a field set for a scalar type', () => {
    const { execute } = createVisitorSetup({
      sdl: `
        type User @key(fields: "id") {
          id: ID!
          name: String! @external
          age: Int @requires(fields: "name")
        }
      `,
      entityName: 'User',
      requiredFieldName: 'age',
    });

    const { rpcMethods, messageDefinitions } = execute();

    expect(rpcMethods).toHaveLength(1);
    expect(rpcMethods[0].name).toBe('RequireUserAgeById');
    expect(messageDefinitions).toHaveLength(5);
    assertStandardMessages(messageDefinitions, 'RequireUserAgeById');

    const fieldMessage = messageDefinitions.find((m) => m.messageName === 'RequireUserAgeByIdFields');
    expect(fieldMessage).toBeDefined();
    expect(fieldMessage?.fields).toHaveLength(1);
    assertFieldMessage(fieldMessage?.fields?.[0], {
      fieldName: 'name',
      typeName: 'string',
      fieldNumber: 1,
      isRepeated: false,
    });
  });

  it('should visit a field set for a scalar type and deduplicate fields', () => {
    const { execute } = createVisitorSetup({
      sdl: `
        type User @key(fields: "id") {
          id: ID!
          name: String! @external
          age: Int @requires(fields: "name name")
        }
      `,
      entityName: 'User',
      requiredFieldName: 'age',
    });

    const { rpcMethods, messageDefinitions } = execute();

    expect(rpcMethods).toHaveLength(1);
    expect(rpcMethods[0].name).toBe('RequireUserAgeById');
    expect(messageDefinitions).toHaveLength(5);
    assertStandardMessages(messageDefinitions, 'RequireUserAgeById');

    const fieldMessage = messageDefinitions.find((m) => m.messageName === 'RequireUserAgeByIdFields');
    expect(fieldMessage).toBeDefined();
    expect(fieldMessage?.fields).toHaveLength(1);
    assertFieldMessage(fieldMessage?.fields?.[0], {
      fieldName: 'name',
      typeName: 'string',
      fieldNumber: 1,
      isRepeated: false,
    });
  });

  it('should visit a field set for an object type', () => {
    const { execute } = createVisitorSetup({
      sdl: `
        type User @key(fields: "id") {
          id: ID!
          description: String! @external
          details: Details! @requires(fields: "description")
        }

        type Details {
          firstName: String!
          lastName: String!
        }
      `,
      entityName: 'User',
      requiredFieldName: 'details',
      fieldSet: 'description',
    });

    const { rpcMethods, messageDefinitions } = execute();

    expect(rpcMethods).toHaveLength(1);
    expect(rpcMethods[0].name).toBe('RequireUserDetailsById');
    expect(messageDefinitions).toHaveLength(5);
    assertStandardMessages(messageDefinitions, 'RequireUserDetailsById');

    const fieldMessage = messageDefinitions.find((m) => m.messageName === 'RequireUserDetailsByIdFields');
    expect(fieldMessage).toBeDefined();
    expect(fieldMessage?.fields).toHaveLength(1);
    assertFieldMessage(fieldMessage?.fields[0], {
      fieldName: 'description',
      typeName: 'string',
      fieldNumber: 1,
      isRepeated: false,
    });

    const resultMessage = messageDefinitions.find((m) => m.messageName === 'RequireUserDetailsByIdResult');
    expect(resultMessage).toBeDefined();
    expect(resultMessage?.fields).toHaveLength(1);
    assertFieldMessage(resultMessage?.fields[0], {
      fieldName: 'details',
      typeName: 'Details',
      fieldNumber: 1,
      isRepeated: false,
    });
  });

  it('should visit a field set for a list type', () => {
    const { execute } = createVisitorSetup({
      sdl: `
        type User @key(fields: "id") {
          id: ID!
          descriptions: [String!]! @external
          details: [Details!]! @requires(fields: "descriptions")
        }

        type Details {
          firstName: String!
          lastName: String!
        }
      `,
      entityName: 'User',
      requiredFieldName: 'details',
    });

    const { rpcMethods, messageDefinitions } = execute();

    expect(rpcMethods).toHaveLength(1);
    expect(rpcMethods[0].name).toBe('RequireUserDetailsById');
    expect(messageDefinitions).toHaveLength(5);
    assertStandardMessages(messageDefinitions, 'RequireUserDetailsById');

    const fieldMessage = messageDefinitions.find((m) => m.messageName === 'RequireUserDetailsByIdFields');
    expect(fieldMessage).toBeDefined();
    expect(fieldMessage?.fields).toHaveLength(1);
    assertFieldMessage(fieldMessage?.fields[0], {
      fieldName: 'descriptions',
      typeName: 'string',
      fieldNumber: 1,
      isRepeated: true,
    });

    const resultMessage = messageDefinitions.find((m) => m.messageName === 'RequireUserDetailsByIdResult');
    expect(resultMessage).toBeDefined();
    expect(resultMessage?.fields).toHaveLength(1);
    assertFieldMessage(resultMessage?.fields[0], {
      fieldName: 'details',
      typeName: 'Details',
      fieldNumber: 1,
      isRepeated: true,
    });
  });

  it('should visit a field set for nullable list types', () => {
    const { execute } = createVisitorSetup({
      sdl: `
        type User @key(fields: "id") {
          id: ID!
          descriptions: [String!] @external
          details: [Details!] @requires(fields: "descriptions")
        }

        type Details {
          firstName: String!
          lastName: String!
        }
      `,
      entityName: 'User',
      requiredFieldName: 'details',
      fieldSet: 'descriptions',
    });

    const { rpcMethods, messageDefinitions } = execute();

    expect(rpcMethods).toHaveLength(1);
    expect(rpcMethods[0].name).toBe('RequireUserDetailsById');
    expect(messageDefinitions).toHaveLength(5);
    assertStandardMessages(messageDefinitions, 'RequireUserDetailsById');

    const fieldMessage = messageDefinitions.find((m) => m.messageName === 'RequireUserDetailsByIdFields');
    expect(fieldMessage).toBeDefined();
    expect(fieldMessage?.fields).toHaveLength(1);
    assertFieldMessage(fieldMessage?.fields[0], {
      fieldName: 'descriptions',
      typeName: 'ListOfString',
      fieldNumber: 1,
      isRepeated: false,
    });

    const resultMessage = messageDefinitions.find((m) => m.messageName === 'RequireUserDetailsByIdResult');
    expect(resultMessage).toBeDefined();
    expect(resultMessage?.fields).toHaveLength(1);
    assertFieldMessage(resultMessage?.fields[0], {
      fieldName: 'details',
      typeName: 'ListOfDetails',
      fieldNumber: 1,
      isRepeated: false,
    });
  });

  it('should visit a field set for multiple field selections', () => {
    const { execute } = createVisitorSetup({
      sdl: `
        type User @key(fields: "id") {
          id: ID!
          descriptions: [String!] @external
          field: String! @external
          otherField: String! @external
          details: [Details!] @requires(fields: "descriptions field otherField")
        }

        type Details {
          firstName: String!
          lastName: String!
        }
      `,
      entityName: 'User',
      requiredFieldName: 'details',
    });

    const { rpcMethods, messageDefinitions } = execute();

    expect(rpcMethods).toHaveLength(1);
    expect(rpcMethods[0].name).toBe('RequireUserDetailsById');
    expect(messageDefinitions).toHaveLength(5);
    assertStandardMessages(messageDefinitions, 'RequireUserDetailsById');

    const fieldMessage = messageDefinitions.find((m) => m.messageName === 'RequireUserDetailsByIdFields');
    expect(fieldMessage).toBeDefined();
    expect(fieldMessage?.fields).toHaveLength(3);
    assertFieldMessage(fieldMessage?.fields[0], {
      fieldName: 'descriptions',
      typeName: 'ListOfString',
      fieldNumber: 1,
      isRepeated: false,
    });
    assertFieldMessage(fieldMessage?.fields[1], {
      fieldName: 'field',
      typeName: 'string',
      fieldNumber: 2,
      isRepeated: false,
    });
    assertFieldMessage(fieldMessage?.fields[2], {
      fieldName: 'other_field',
      typeName: 'string',
      fieldNumber: 3,
      isRepeated: false,
    });

    const resultMessage = messageDefinitions.find((m) => m.messageName === 'RequireUserDetailsByIdResult');
    expect(resultMessage).toBeDefined();
    expect(resultMessage?.fields).toHaveLength(1);
    assertFieldMessage(resultMessage?.fields[0], {
      fieldName: 'details',
      typeName: 'ListOfDetails',
      fieldNumber: 1,
      isRepeated: false,
    });
  });

  it('should visit a field set with nested field selections', () => {
    const { execute } = createVisitorSetup({
      sdl: `
        type User @key(fields: "id") {
          id: ID!
          description: Description! @external
          details: Details! @requires(fields: "description { title score }")
        }

        type Description {
          title: String!
          score: Int!
        }

        type Details {
          firstName: String!
          lastName: String!
        }
      `,
      entityName: 'User',
      requiredFieldName: 'details',
    });

    const { rpcMethods, messageDefinitions } = execute();

    expect(rpcMethods).toHaveLength(1);
    expect(rpcMethods[0].name).toBe('RequireUserDetailsById');
    expect(messageDefinitions).toHaveLength(5);
    assertStandardMessages(messageDefinitions, 'RequireUserDetailsById');

    const fieldMessage = messageDefinitions.find((m) => m.messageName === 'RequireUserDetailsByIdFields');
    expect(fieldMessage).toBeDefined();
    expect(fieldMessage?.fields).toHaveLength(1);
    assertFieldMessage(fieldMessage?.fields[0], {
      fieldName: 'description',
      typeName: 'Description',
      fieldNumber: 1,
      isRepeated: false,
    });
    expect(fieldMessage?.nestedMessages).toHaveLength(1);
    expect(fieldMessage?.nestedMessages?.[0].messageName).toBe('Description');
    expect(fieldMessage?.nestedMessages?.[0].fields).toHaveLength(2);
    assertFieldMessage(fieldMessage?.nestedMessages?.[0].fields[0], {
      fieldName: 'title',
      typeName: 'string',
      fieldNumber: 1,
      isRepeated: false,
    });
    assertFieldMessage(fieldMessage?.nestedMessages?.[0].fields[1], {
      fieldName: 'score',
      typeName: 'int32',
      fieldNumber: 2,
      isRepeated: false,
    });

    const resultMessage = messageDefinitions.find((m) => m.messageName === 'RequireUserDetailsByIdResult');
    expect(resultMessage).toBeDefined();
    expect(resultMessage?.fields).toHaveLength(1);
    assertFieldMessage(resultMessage?.fields[0], {
      fieldName: 'details',
      typeName: 'Details',
      fieldNumber: 1,
      isRepeated: false,
    });
  });

  it('should visit a field set with multiple nested field selections', () => {
    const { execute } = createVisitorSetup({
      sdl: `
        type User @key(fields: "id") {
          id: ID!
          description: Description! @external
          details: Details! @requires(fields: "description { title score address { street city state zip } }")
        }

        type Description {
          title: String!
          score: Int!
          address: Address!
        }

        type Address {
          street: String!
          city: String!
          state: String!
          zip: String!
        }

        type Details {
          firstName: String!
          lastName: String!
        }
      `,
      entityName: 'User',
      requiredFieldName: 'details',
    });

    const { rpcMethods, messageDefinitions } = execute();

    expect(rpcMethods).toHaveLength(1);
    expect(rpcMethods[0].name).toBe('RequireUserDetailsById');
    expect(messageDefinitions).toHaveLength(5);
    assertStandardMessages(messageDefinitions, 'RequireUserDetailsById');

    const fieldMessage = messageDefinitions.find((m) => m.messageName === 'RequireUserDetailsByIdFields');
    expect(fieldMessage).toBeDefined();
    expect(fieldMessage?.fields).toHaveLength(1);
    assertFieldMessage(fieldMessage?.fields[0], {
      fieldName: 'description',
      typeName: 'Description',
      fieldNumber: 1,
      isRepeated: false,
    });
    expect(fieldMessage?.nestedMessages).toHaveLength(1);
    expect(fieldMessage?.nestedMessages?.[0].messageName).toBe('Description');
    expect(fieldMessage?.nestedMessages?.[0].fields).toHaveLength(3);
    assertFieldMessage(fieldMessage?.nestedMessages?.[0].fields[0], {
      fieldName: 'title',
      typeName: 'string',
      fieldNumber: 1,
      isRepeated: false,
    });
    assertFieldMessage(fieldMessage?.nestedMessages?.[0].fields[1], {
      fieldName: 'score',
      typeName: 'int32',
      fieldNumber: 2,
      isRepeated: false,
    });
    assertFieldMessage(fieldMessage?.nestedMessages?.[0].fields[2], {
      fieldName: 'address',
      typeName: 'Address',
      fieldNumber: 3,
      isRepeated: false,
    });
    expect(fieldMessage?.nestedMessages?.[0].nestedMessages).toHaveLength(1);
    expect(fieldMessage?.nestedMessages?.[0].nestedMessages?.[0].messageName).toBe('Address');
    expect(fieldMessage?.nestedMessages?.[0].nestedMessages?.[0].fields).toHaveLength(4);
    assertFieldMessage(fieldMessage?.nestedMessages?.[0].nestedMessages?.[0].fields[0], {
      fieldName: 'street',
      typeName: 'string',
      fieldNumber: 1,
      isRepeated: false,
    });
    assertFieldMessage(fieldMessage?.nestedMessages?.[0].nestedMessages?.[0].fields[1], {
      fieldName: 'city',
      typeName: 'string',
      fieldNumber: 2,
      isRepeated: false,
    });
    assertFieldMessage(fieldMessage?.nestedMessages?.[0].nestedMessages?.[0].fields[2], {
      fieldName: 'state',
      typeName: 'string',
      fieldNumber: 3,
      isRepeated: false,
    });
    assertFieldMessage(fieldMessage?.nestedMessages?.[0].nestedMessages?.[0].fields[3], {
      fieldName: 'zip',
      typeName: 'string',
      fieldNumber: 4,
      isRepeated: false,
    });

    const resultMessage = messageDefinitions.find((m) => m.messageName === 'RequireUserDetailsByIdResult');
    expect(resultMessage).toBeDefined();
    expect(resultMessage?.fields).toHaveLength(1);
    assertFieldMessage(resultMessage?.fields[0], {
      fieldName: 'details',
      typeName: 'Details',
      fieldNumber: 1,
      isRepeated: false,
    });
  });

  it('should visit a field set for a union type', () => {
    const { execute } = createVisitorSetup({
      sdl: `
        type User @key(fields: "id") {
          id: ID!
          pet: Animal! @external
          name: String! @external
          details: Details! @requires(fields: "pet { ... on Cat { name catBreed } ... on Dog { name dogBreed } } name")
        }

        union Animal = Cat | Dog

        type Cat {
          name: String!
          catBreed: String!
        }

        type Dog {
          name: String!
          dogBreed: String!
        }

        type Details {
          firstName: String!
          lastName: String!
        }
      `,
      entityName: 'User',
      requiredFieldName: 'details',
    });

    const { rpcMethods, messageDefinitions } = execute();

    expect(rpcMethods).toHaveLength(1);
    expect(rpcMethods[0].name).toBe('RequireUserDetailsById');
    expect(messageDefinitions).toHaveLength(5);
    assertStandardMessages(messageDefinitions, 'RequireUserDetailsById');

    const fieldMessage = messageDefinitions.find((m) => m.messageName === 'RequireUserDetailsByIdFields');
    expect(fieldMessage).toBeDefined();
    expect(fieldMessage?.fields).toHaveLength(2);
    assertFieldMessage(fieldMessage?.fields[0], {
      fieldName: 'pet',
      typeName: 'Animal',
      fieldNumber: 1,
      isRepeated: false,
    });
    assertFieldMessage(fieldMessage?.fields[1], {
      fieldName: 'name',
      typeName: 'string',
      fieldNumber: 2,
      isRepeated: false,
    });

    const compositeType = fieldMessage?.compositeType;
    expect(compositeType).toBeDefined();
    expect(compositeType?.kind).toBe(CompositeMessageKind.UNION);
    expect(compositeType?.typeName).toBe('Animal');
    expect(isUnionMessageDefinition(compositeType!)).toBe(true);
    const unionMessageDefinition = compositeType! as UnionMessageDefinition;
    expect(unionMessageDefinition.memberTypes).toHaveLength(2);
    expect(unionMessageDefinition.memberTypes[0]).toBe('Cat');
    expect(unionMessageDefinition.memberTypes[1]).toBe('Dog');

    const resultMessage = messageDefinitions.find((m) => m.messageName === 'RequireUserDetailsByIdResult');
    expect(resultMessage).toBeDefined();
    expect(resultMessage?.fields).toHaveLength(1);
    assertFieldMessage(resultMessage?.fields[0], {
      fieldName: 'details',
      typeName: 'Details',
      fieldNumber: 1,
      isRepeated: false,
    });

    const messageLines = buildProtoMessage(true, fieldMessage!).join('\n');
    expect(messageLines).toMatchInlineSnapshot(`
      "message RequireUserDetailsByIdFields {
        message Cat {
          string name = 1;
          string cat_breed = 2;
        }

        message Dog {
          string name = 1;
          string dog_breed = 2;
        }

        message Animal {
          oneof value {
            Cat cat = 1;
            Dog dog = 2;
          }
        }
        Animal pet = 1;
        string name = 2;
      }
      "
    `);
  });

  it('should visit a field set for an interface type', () => {
    const { execute } = createVisitorSetup({
      sdl: `
        type User @key(fields: "id") {
          id: ID!
          pet: Animal! @external
          name: String! @external
          details: Details! @requires(fields: "pet { ... on Cat { name catBreed } ... on Dog { name dogBreed } } name")
        }

        interface Animal {
          name: String!
        }

        type Cat implements Animal {
          name: String!
          catBreed: String!
        }

        type Dog implements Animal {
          name: String!
          dogBreed: String!
        }

        type Details {
          firstName: String!
          lastName: String!
        }
      `,
      entityName: 'User',
      requiredFieldName: 'details',
    });

    const { rpcMethods, messageDefinitions } = execute();

    expect(rpcMethods).toHaveLength(1);
    expect(rpcMethods[0].name).toBe('RequireUserDetailsById');
    expect(messageDefinitions).toHaveLength(5);
    assertStandardMessages(messageDefinitions, 'RequireUserDetailsById');

    const fieldMessage = messageDefinitions.find((m) => m.messageName === 'RequireUserDetailsByIdFields');
    expect(fieldMessage).toBeDefined();
    expect(fieldMessage?.fields).toHaveLength(2);
    assertFieldMessage(fieldMessage?.fields[0], {
      fieldName: 'pet',
      typeName: 'Animal',
      fieldNumber: 1,
      isRepeated: false,
    });
    assertFieldMessage(fieldMessage?.fields[1], {
      fieldName: 'name',
      typeName: 'string',
      fieldNumber: 2,
      isRepeated: false,
    });

    const compositeType = fieldMessage?.compositeType;
    expect(compositeType).toBeDefined();
    expect(compositeType?.kind).toBe(CompositeMessageKind.INTERFACE);
    expect(compositeType?.typeName).toBe('Animal');
    expect(isInterfaceMessageDefinition(compositeType!)).toBe(true);
    const interfaceMessageDefinition = compositeType! as InterfaceMessageDefinition;
    expect(interfaceMessageDefinition.implementingTypes).toHaveLength(2);
    expect(interfaceMessageDefinition.implementingTypes[0]).toBe('Cat');
    expect(interfaceMessageDefinition.implementingTypes[1]).toBe('Dog');

    const resultMessage = messageDefinitions.find((m) => m.messageName === 'RequireUserDetailsByIdResult');
    expect(resultMessage).toBeDefined();
    expect(resultMessage?.fields).toHaveLength(1);
    assertFieldMessage(resultMessage?.fields[0], {
      fieldName: 'details',
      typeName: 'Details',
      fieldNumber: 1,
      isRepeated: false,
    });

    const messageLines = buildProtoMessage(true, fieldMessage!).join('\n');
    expect(messageLines).toMatchInlineSnapshot(`
      "message RequireUserDetailsByIdFields {
        message Cat {
          string name = 1;
          string cat_breed = 2;
        }

        message Dog {
          string name = 1;
          string dog_breed = 2;
        }

        message Animal {
          oneof instance {
            Cat cat = 1;
            Dog dog = 2;
          }
        }
        Animal pet = 1;
        string name = 2;
      }
      "
    `);
  });

  it('should visit a field set for an interface type with extracted interface field', () => {
    const { execute } = createVisitorSetup({
      sdl: `
        type User @key(fields: "id") {
          id: ID!
          pet: Animal! @external
          name: String! @external
          details: Details! @requires(fields: "pet { name ... on Cat { catBreed } ... on Dog { dogBreed } } name")
        }

        interface Animal {
          name: String!
        }

        type Cat implements Animal {
          name: String!
          catBreed: String!
        }

        type Dog implements Animal {
          name: String!
          dogBreed: String!
        }

        type Details {
          firstName: String!
          lastName: String!
        }
      `,
      entityName: 'User',
      requiredFieldName: 'details',
    });

    const { rpcMethods, messageDefinitions } = execute();

    expect(rpcMethods).toHaveLength(1);
    expect(rpcMethods[0].name).toBe('RequireUserDetailsById');
    expect(messageDefinitions).toHaveLength(5);
    assertStandardMessages(messageDefinitions, 'RequireUserDetailsById');

    const fieldMessage = messageDefinitions.find((m) => m.messageName === 'RequireUserDetailsByIdFields');
    expect(fieldMessage).toBeDefined();
    expect(fieldMessage?.fields).toHaveLength(2);
    assertFieldMessage(fieldMessage?.fields[0], {
      fieldName: 'pet',
      typeName: 'Animal',
      fieldNumber: 1,
      isRepeated: false,
    });
    assertFieldMessage(fieldMessage?.fields[1], {
      fieldName: 'name',
      typeName: 'string',
      fieldNumber: 2,
      isRepeated: false,
    });

    const compositeType = fieldMessage?.compositeType;
    expect(compositeType).toBeDefined();
    expect(compositeType?.kind).toBe(CompositeMessageKind.INTERFACE);
    expect(compositeType?.typeName).toBe('Animal');
    expect(isInterfaceMessageDefinition(compositeType!)).toBe(true);
    const interfaceMessageDefinition = compositeType! as InterfaceMessageDefinition;
    expect(interfaceMessageDefinition.implementingTypes).toHaveLength(2);
    expect(interfaceMessageDefinition.implementingTypes[0]).toBe('Cat');
    expect(interfaceMessageDefinition.implementingTypes[1]).toBe('Dog');

    const resultMessage = messageDefinitions.find((m) => m.messageName === 'RequireUserDetailsByIdResult');
    expect(resultMessage).toBeDefined();
    expect(resultMessage?.fields).toHaveLength(1);
    assertFieldMessage(resultMessage?.fields[0], {
      fieldName: 'details',
      typeName: 'Details',
      fieldNumber: 1,
      isRepeated: false,
    });

    const messageLines = buildProtoMessage(true, fieldMessage!).join('\n');
    expect(messageLines).toMatchInlineSnapshot(`
      "message RequireUserDetailsByIdFields {
        message Cat {
          string name = 1;
          string cat_breed = 2;
        }

        message Dog {
          string name = 1;
          string dog_breed = 2;
        }

        message Animal {
          oneof instance {
            Cat cat = 1;
            Dog dog = 2;
          }
        }
        Animal pet = 1;
        string name = 2;
      }
      "
    `);
  });

  it('should visit a field set with nested field selections and a union type', () => {
    const { execute } = createVisitorSetup({
      sdl: `
        type User @key(fields: "id") {
          id: ID!
          description: Description! @external
          details: Details! @requires(fields: "description { title score pet { ... on Cat { name catBreed } ... on Dog { name dogBreed } } }")
        }

        type Description {
          title: String!
          score: Int!
          pet: Animal!
        }

        union Animal = Cat | Dog

        type Cat {
          name: String!
          catBreed: String!
        }

        type Dog {
          name: String!
          dogBreed: String!
        }

        type Details {
          firstName: String!
          lastName: String!
        }
      `,
      entityName: 'User',
      requiredFieldName: 'details',
    });

    const { rpcMethods, messageDefinitions } = execute();

    expect(rpcMethods).toHaveLength(1);
    expect(rpcMethods[0].name).toBe('RequireUserDetailsById');
    expect(messageDefinitions).toHaveLength(5);
    assertStandardMessages(messageDefinitions, 'RequireUserDetailsById');

    const fieldMessage = messageDefinitions.find((m) => m.messageName === 'RequireUserDetailsByIdFields');
    expect(fieldMessage).toBeDefined();
    expect(fieldMessage?.fields).toHaveLength(1);
    expect(fieldMessage?.fields[0].fieldName).toBe('description');
    expect(fieldMessage?.fields[0].typeName).toBe('Description');
    expect(fieldMessage?.fields[0].fieldNumber).toBe(1);
    expect(fieldMessage?.fields[0].isRepeated).toBe(false);

    // Check for nested Description message
    expect(fieldMessage?.nestedMessages).toHaveLength(1);
    const descriptionMessage = fieldMessage?.nestedMessages?.[0];
    expect(descriptionMessage?.messageName).toBe('Description');
    expect(descriptionMessage?.fields).toHaveLength(3);

    // Check Description fields
    assertFieldMessage(descriptionMessage?.fields[0], {
      fieldName: 'title',
      typeName: 'string',
      fieldNumber: 1,
      isRepeated: false,
    });
    assertFieldMessage(descriptionMessage?.fields[1], {
      fieldName: 'score',
      typeName: 'int32',
      fieldNumber: 2,
      isRepeated: false,
    });
    assertFieldMessage(descriptionMessage?.fields[2], {
      fieldName: 'pet',
      typeName: 'Animal',
      fieldNumber: 3,
      isRepeated: false,
    });

    // Check for union composite type on Description message
    const compositeType = descriptionMessage?.compositeType;
    expect(compositeType).toBeDefined();
    expect(compositeType?.kind).toBe(CompositeMessageKind.UNION);
    expect(compositeType?.typeName).toBe('Animal');
    expect(isUnionMessageDefinition(compositeType!)).toBe(true);
    const unionMessageDefinition = compositeType! as UnionMessageDefinition;
    expect(unionMessageDefinition.memberTypes).toHaveLength(2);
    expect(unionMessageDefinition.memberTypes).toEqual(expect.arrayContaining(['Cat', 'Dog']));

    const resultMessage = messageDefinitions.find((m) => m.messageName === 'RequireUserDetailsByIdResult');
    expect(resultMessage).toBeDefined();
    expect(resultMessage?.fields).toHaveLength(1);
    assertFieldMessage(resultMessage?.fields[0], {
      fieldName: 'details',
      typeName: 'Details',
      fieldNumber: 1,
      isRepeated: false,
    });
  });
});

describe('Ambiguous @key directive deduplication', () => {
  it('should deduplicate @key directives with fields in different order (space-separated)', () => {
    const { execute } = createVisitorSetup({
      sdl: `
        type Product @key(fields: "id name") @key(fields: "name id") {
          id: ID!
          name: String!
          price: Float! @requires(fields: "name")
        }
      `,
      entityName: 'Product',
      requiredFieldName: 'price',
      fieldSet: 'name',
    });

    const { rpcMethods, mapping } = execute();

    // Should only produce 1 RPC method, not 2
    expect(rpcMethods).toHaveLength(1);
    expect(rpcMethods[0].name).toBe('RequireProductPriceByIdAndName');

    // Mapping should have only one entry with normalized key
    expect(Object.keys(mapping)).toHaveLength(1);
    expect(mapping).toHaveProperty('Id Name');
  });

  it('should deduplicate @key directives with different separators (comma vs space)', () => {
    const { execute } = createVisitorSetup({
      sdl: `
        type Product @key(fields: "id,name") @key(fields: "name id") {
          id: ID!
          name: String!
          price: Float! @requires(fields: "name")
        }
      `,
      entityName: 'Product',
      requiredFieldName: 'price',
      fieldSet: 'name',
    });

    const { rpcMethods, mapping } = execute();

    // Should only produce 1 RPC method, not 2
    expect(rpcMethods).toHaveLength(1);
    expect(rpcMethods[0].name).toBe('RequireProductPriceByIdAndName');

    // Mapping should have only one entry
    expect(Object.keys(mapping)).toHaveLength(1);
    expect(mapping).toHaveProperty('Id Name');
  });

  it('should deduplicate identical @key directives', () => {
    const { execute } = createVisitorSetup({
      sdl: `
        type Product @key(fields: "id") @key(fields: "id") {
          id: ID!
          name: String!
          price: Float! @requires(fields: "name")
        }
      `,
      entityName: 'Product',
      requiredFieldName: 'price',
      fieldSet: 'name',
    });

    const { rpcMethods, mapping } = execute();

    // Should only produce 1 RPC method, not 2
    expect(rpcMethods).toHaveLength(1);
    expect(rpcMethods[0].name).toBe('RequireProductPriceById');

    // Mapping should have only one entry
    expect(Object.keys(mapping)).toHaveLength(1);
    expect(mapping).toHaveProperty('Id');
  });

  it('should produce separate RPCs for distinct @key directives', () => {
    const { execute } = createVisitorSetup({
      sdl: `
        type Product @key(fields: "id") @key(fields: "sku") {
          id: ID!
          sku: String!
          name: String!
          price: Float! @requires(fields: "name")
        }
      `,
      entityName: 'Product',
      requiredFieldName: 'price',
      fieldSet: 'name',
    });

    const { rpcMethods, mapping } = execute();

    // Should produce 2 RPC methods for distinct keys
    expect(rpcMethods).toHaveLength(2);
    expect(rpcMethods.map((r) => r.name)).toEqual(
      expect.arrayContaining(['RequireProductPriceById', 'RequireProductPriceBySku']),
    );

    // Mapping should have two entries
    expect(Object.keys(mapping)).toHaveLength(2);
    expect(mapping).toHaveProperty('Id');
    expect(mapping).toHaveProperty('Sku');
  });
});

describe('Nested message deduplication', () => {
  it('should reuse nested message when multiple fields reference the same type', () => {
    const { execute } = createVisitorSetup({
      sdl: `
        type User @key(fields: "id") {
          id: ID!
          homeAddress: Address! @external
          workAddress: Address! @external
          computed: String! @requires(fields: "homeAddress { city street } workAddress { city zip }")
        }

        type Address {
          city: String!
          street: String!
          zip: String!
        }
      `,
      entityName: 'User',
      requiredFieldName: 'computed',
    });

    const { messageDefinitions } = execute();

    const fieldsMessage = messageDefinitions.find((m) => m.messageName === 'RequireUserComputedByIdFields');
    expect(fieldsMessage).toBeDefined();

    // Should have two fields: homeAddress and workAddress
    expect(fieldsMessage?.fields).toHaveLength(2);
    expect(fieldsMessage?.fields.map((f) => f.fieldName)).toEqual(
      expect.arrayContaining(['home_address', 'work_address']),
    );

    // Should have only ONE nested Address message, not two
    expect(fieldsMessage?.nestedMessages).toHaveLength(1);
    expect(fieldsMessage?.nestedMessages?.[0].messageName).toBe('Address');

    // The single Address message should contain all fields from both selections (city, street, zip)
    const addressMessage = fieldsMessage?.nestedMessages?.[0];
    expect(addressMessage?.fields).toHaveLength(3);
    expect(addressMessage?.fields.map((f) => f.fieldName)).toEqual(expect.arrayContaining(['city', 'street', 'zip']));
  });

  it('should create separate nested messages for different types', () => {
    const { execute } = createVisitorSetup({
      sdl: `
        type User @key(fields: "id") {
          id: ID!
          homeAddress: Address! @external
          profile: Profile! @external
          computed: String! @requires(fields: "homeAddress { city } profile { bio }")
        }

        type Address {
          city: String!
        }

        type Profile {
          bio: String!
        }
      `,
      entityName: 'User',
      requiredFieldName: 'computed',
    });

    const { messageDefinitions } = execute();

    const fieldsMessage = messageDefinitions.find((m) => m.messageName === 'RequireUserComputedByIdFields');
    expect(fieldsMessage).toBeDefined();

    // Should have two different nested messages: Address and Profile
    expect(fieldsMessage?.nestedMessages).toHaveLength(2);
    expect(fieldsMessage?.nestedMessages?.map((m) => m.messageName)).toEqual(
      expect.arrayContaining(['Address', 'Profile']),
    );
  });
});
