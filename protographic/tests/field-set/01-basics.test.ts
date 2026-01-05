import { describe, expect, it } from 'vitest';
import { RequiredFieldsVisitor } from '../../src';
import { buildSchema, GraphQLObjectType, StringValueNode, visit } from 'graphql';
import { buildProtoMessage } from '../../src/proto-utils';
import {
  CompositeMessageKind,
  isUnionMessageDefinition,
  ProtoMessageField,
  UnionMessageDefinition,
} from '../../src/types';

describe('Field Set Visitor', () => {
  it('should visit a field set for a scalar type', () => {
    const sdl = `
    type User @key(fields: "id") {
      id: ID!
      name: String! @external
      age: Int @requires(fields: "name")
    }
  `;

    const schema = buildSchema(sdl, {
      assumeValid: true,
      assumeValidSDL: true,
    });

    const typeMap = schema.getTypeMap();
    const entity = typeMap['User'] as GraphQLObjectType | undefined;
    if (!entity) {
      throw new Error('Entity not found');
    }

    const requiredField = entity.getFields()['age'];
    expect(requiredField).toBeDefined();

    const fieldSet = (
      requiredField.astNode?.directives?.find((d) => d.name.value === 'requires')?.arguments?.[0]
        .value as StringValueNode
    ).value;

    const visitor = new RequiredFieldsVisitor(schema, entity, requiredField, fieldSet);
    visitor.visit();
    const rpcMethods = visitor.getRPCMethods();
    const messageDefinitions = visitor.getMessageDefinitions();

    expect(rpcMethods).toHaveLength(1);
    expect(rpcMethods[0].name).toBe('RequireUserAgeById');
    expect(messageDefinitions).toHaveLength(5);
    expect(messageDefinitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ messageName: 'RequireUserAgeByIdRequest' }),
        expect.objectContaining({ messageName: 'RequireUserAgeByIdContext' }),
        expect.objectContaining({ messageName: 'RequireUserAgeByIdResponse' }),
        expect.objectContaining({ messageName: 'RequireUserAgeByIdResult' }),
        expect.objectContaining({ messageName: 'RequireUserAgeByIdFields' }),
      ]),
    );

    let fieldMessage = messageDefinitions.find((message) => message.messageName === 'RequireUserAgeByIdFields');
    expect(fieldMessage).toBeDefined();
    expect(fieldMessage?.fields).toHaveLength(1);
    expect(fieldMessage?.fields?.[0].fieldName).toBe('name');
    expect(fieldMessage?.fields?.[0].typeName).toBe('string');
    expect(fieldMessage?.fields?.[0].fieldNumber).toBe(1);
    expect(fieldMessage?.fields?.[0].isRepeated).toBe(false);
  });
  it('should visit a field set for an object type', () => {
    const sdl = `
    type User @key(fields: "id") {
      id: ID!
      description: String! @external
      details: Details! @requires(fields: "description")
    }

    type Details {
      firstName: String!
      lastName: String!
    }
  `;

    const schema = buildSchema(sdl, {
      assumeValid: true,
      assumeValidSDL: true,
    });

    const typeMap = schema.getTypeMap();
    const entity = typeMap['User'] as GraphQLObjectType | undefined;
    if (!entity) {
      throw new Error('Entity not found');
    }

    const requiredField = entity.getFields()['details'];
    expect(requiredField).toBeDefined();

    const fieldSet = `description`;

    const visitor = new RequiredFieldsVisitor(schema, entity, requiredField, fieldSet);
    visitor.visit();
    const rpcMethods = visitor.getRPCMethods();
    const messageDefinitions = visitor.getMessageDefinitions();

    expect(rpcMethods).toHaveLength(1);
    expect(rpcMethods[0].name).toBe('RequireUserDetailsById');
    expect(messageDefinitions).toHaveLength(5);
    expect(messageDefinitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ messageName: 'RequireUserDetailsByIdRequest' }),
        expect.objectContaining({ messageName: 'RequireUserDetailsByIdContext' }),
        expect.objectContaining({ messageName: 'RequireUserDetailsByIdResponse' }),
        expect.objectContaining({ messageName: 'RequireUserDetailsByIdResult' }),
        expect.objectContaining({ messageName: 'RequireUserDetailsByIdFields' }),
      ]),
    );

    let fieldMessage = messageDefinitions.find((message) => message.messageName === 'RequireUserDetailsByIdFields');
    expect(fieldMessage).toBeDefined();
    expect(fieldMessage?.fields).toHaveLength(1);
    assertFieldMessage(fieldMessage?.fields[0], {
      fieldName: 'description',
      typeName: 'string',
      fieldNumber: 1,
      isRepeated: false,
    });

    let resultMessage = messageDefinitions.find((message) => message.messageName === 'RequireUserDetailsByIdResult');
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
    const sdl = `
    type User @key(fields: "id") {
      id: ID!
      descriptions: [String!]! @external
      details: [Details!]! @requires(fields: "descriptions")
    }

    type Details {
      firstName: String!
      lastName: String!
    }
  `;

    const schema = buildSchema(sdl, {
      assumeValid: true,
      assumeValidSDL: true,
    });

    const typeMap = schema.getTypeMap();
    const entity = typeMap['User'] as GraphQLObjectType | undefined;
    if (!entity) {
      throw new Error('Entity not found');
    }

    const requiredField = entity.getFields()['details'];
    expect(requiredField).toBeDefined();

    const fieldSet = (
      requiredField.astNode?.directives?.find((d) => d.name.value === 'requires')?.arguments?.[0]
        .value as StringValueNode
    ).value;

    const visitor = new RequiredFieldsVisitor(schema, entity, requiredField, fieldSet);
    visitor.visit();
    const rpcMethods = visitor.getRPCMethods();
    const messageDefinitions = visitor.getMessageDefinitions();

    expect(rpcMethods).toHaveLength(1);
    expect(rpcMethods[0].name).toBe('RequireUserDetailsById');
    expect(messageDefinitions).toHaveLength(5);
    expect(messageDefinitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ messageName: 'RequireUserDetailsByIdRequest' }),
        expect.objectContaining({ messageName: 'RequireUserDetailsByIdContext' }),
        expect.objectContaining({ messageName: 'RequireUserDetailsByIdResponse' }),
        expect.objectContaining({ messageName: 'RequireUserDetailsByIdResult' }),
        expect.objectContaining({ messageName: 'RequireUserDetailsByIdFields' }),
      ]),
    );

    let fieldMessage = messageDefinitions.find((message) => message.messageName === 'RequireUserDetailsByIdFields');
    expect(fieldMessage).toBeDefined();
    expect(fieldMessage?.fields).toHaveLength(1);
    assertFieldMessage(fieldMessage?.fields[0], {
      fieldName: 'descriptions',
      typeName: 'string',
      fieldNumber: 1,
      isRepeated: true,
    });

    let resultMessage = messageDefinitions.find((message) => message.messageName === 'RequireUserDetailsByIdResult');
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
    const sdl = `
    type User @key(fields: "id") {
      id: ID!
      descriptions: [String!] @external
      details: [Details!] @requires(fields: "descriptions")
    }

    type Details {
      firstName: String!
      lastName: String!
    }
  `;

    const schema = buildSchema(sdl, {
      assumeValid: true,
      assumeValidSDL: true,
    });

    const typeMap = schema.getTypeMap();
    const entity = typeMap['User'] as GraphQLObjectType | undefined;
    if (!entity) {
      throw new Error('Entity not found');
    }

    const requiredField = entity.getFields()['details'];
    expect(requiredField).toBeDefined();

    const fieldSet = `descriptions`;

    const visitor = new RequiredFieldsVisitor(schema, entity, requiredField, fieldSet);
    visitor.visit();
    const rpcMethods = visitor.getRPCMethods();
    const messageDefinitions = visitor.getMessageDefinitions();

    expect(rpcMethods).toHaveLength(1);
    expect(rpcMethods[0].name).toBe('RequireUserDetailsById');
    expect(messageDefinitions).toHaveLength(5);
    expect(messageDefinitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ messageName: 'RequireUserDetailsByIdRequest' }),
        expect.objectContaining({ messageName: 'RequireUserDetailsByIdContext' }),
        expect.objectContaining({ messageName: 'RequireUserDetailsByIdResponse' }),
        expect.objectContaining({ messageName: 'RequireUserDetailsByIdResult' }),
        expect.objectContaining({ messageName: 'RequireUserDetailsByIdFields' }),
      ]),
    );

    let fieldMessage = messageDefinitions.find((message) => message.messageName === 'RequireUserDetailsByIdFields');
    expect(fieldMessage).toBeDefined();
    expect(fieldMessage?.fields).toHaveLength(1);
    assertFieldMessage(fieldMessage?.fields[0], {
      fieldName: 'descriptions',
      typeName: 'ListOfString',
      fieldNumber: 1,
      isRepeated: false,
    });

    let resultMessage = messageDefinitions.find((message) => message.messageName === 'RequireUserDetailsByIdResult');
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
    const sdl = `
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
  `;

    const schema = buildSchema(sdl, {
      assumeValid: true,
      assumeValidSDL: true,
    });

    const typeMap = schema.getTypeMap();
    const entity = typeMap['User'] as GraphQLObjectType | undefined;
    if (!entity) {
      throw new Error('Entity not found');
    }

    const requiredField = entity.getFields()['details'];
    expect(requiredField).toBeDefined();

    const fieldSet = (
      requiredField.astNode?.directives?.find((d) => d.name.value === 'requires')?.arguments?.[0]
        .value as StringValueNode
    ).value;

    const visitor = new RequiredFieldsVisitor(schema, entity, requiredField, fieldSet);
    visitor.visit();
    const rpcMethods = visitor.getRPCMethods();
    const messageDefinitions = visitor.getMessageDefinitions();

    expect(rpcMethods).toHaveLength(1);
    expect(rpcMethods[0].name).toBe('RequireUserDetailsById');
    expect(messageDefinitions).toHaveLength(5);
    expect(messageDefinitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ messageName: 'RequireUserDetailsByIdRequest' }),
        expect.objectContaining({ messageName: 'RequireUserDetailsByIdContext' }),
        expect.objectContaining({ messageName: 'RequireUserDetailsByIdResponse' }),
        expect.objectContaining({ messageName: 'RequireUserDetailsByIdResult' }),
        expect.objectContaining({ messageName: 'RequireUserDetailsByIdFields' }),
      ]),
    );

    let fieldMessage = messageDefinitions.find((message) => message.messageName === 'RequireUserDetailsByIdFields');
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

    let resultMessage = messageDefinitions.find((message) => message.messageName === 'RequireUserDetailsByIdResult');
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
    const sdl = `
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
  `;

    const schema = buildSchema(sdl, {
      assumeValid: true,
      assumeValidSDL: true,
    });

    const typeMap = schema.getTypeMap();
    const entity = typeMap['User'] as GraphQLObjectType | undefined;
    if (!entity) {
      throw new Error('Entity not found');
    }

    const requiredField = entity.getFields()['details'];
    expect(requiredField).toBeDefined();

    const fieldSet = (
      requiredField.astNode?.directives?.find((d) => d.name.value === 'requires')?.arguments?.[0]
        .value as StringValueNode
    ).value;

    const visitor = new RequiredFieldsVisitor(schema, entity, requiredField, fieldSet);
    visitor.visit();
    const rpcMethods = visitor.getRPCMethods();
    const messageDefinitions = visitor.getMessageDefinitions();

    expect(rpcMethods).toHaveLength(1);
    expect(rpcMethods[0].name).toBe('RequireUserDetailsById');
    expect(messageDefinitions).toHaveLength(5);
    expect(messageDefinitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ messageName: 'RequireUserDetailsByIdRequest' }),
        expect.objectContaining({ messageName: 'RequireUserDetailsByIdContext' }),
        expect.objectContaining({ messageName: 'RequireUserDetailsByIdResponse' }),
        expect.objectContaining({ messageName: 'RequireUserDetailsByIdResult' }),
        expect.objectContaining({ messageName: 'RequireUserDetailsByIdFields' }),
      ]),
    );

    let fieldMessage = messageDefinitions.find((message) => message.messageName === 'RequireUserDetailsByIdFields');
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

    let resultMessage = messageDefinitions.find((message) => message.messageName === 'RequireUserDetailsByIdResult');
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
    const sdl = `
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
  `;

    const schema = buildSchema(sdl, {
      assumeValid: true,
      assumeValidSDL: true,
    });

    const typeMap = schema.getTypeMap();
    const entity = typeMap['User'] as GraphQLObjectType | undefined;
    if (!entity) {
      throw new Error('Entity not found');
    }

    const requiredField = entity.getFields()['details'];
    expect(requiredField).toBeDefined();

    const fieldSet = (
      requiredField.astNode?.directives?.find((d) => d.name.value === 'requires')?.arguments?.[0]
        .value as StringValueNode
    ).value;

    const visitor = new RequiredFieldsVisitor(schema, entity, requiredField, fieldSet);
    visitor.visit();
    const rpcMethods = visitor.getRPCMethods();
    const messageDefinitions = visitor.getMessageDefinitions();

    expect(rpcMethods).toHaveLength(1);
    expect(rpcMethods[0].name).toBe('RequireUserDetailsById');
    expect(messageDefinitions).toHaveLength(5);
    expect(messageDefinitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ messageName: 'RequireUserDetailsByIdRequest' }),
        expect.objectContaining({ messageName: 'RequireUserDetailsByIdContext' }),
        expect.objectContaining({ messageName: 'RequireUserDetailsByIdResponse' }),
        expect.objectContaining({ messageName: 'RequireUserDetailsByIdResult' }),
        expect.objectContaining({ messageName: 'RequireUserDetailsByIdFields' }),
      ]),
    );

    let fieldMessage = messageDefinitions.find((message) => message.messageName === 'RequireUserDetailsByIdFields');
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

    let resultMessage = messageDefinitions.find((message) => message.messageName === 'RequireUserDetailsByIdResult');
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
    const sdl = `
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
  `;

    const schema = buildSchema(sdl, {
      assumeValid: true,
      assumeValidSDL: true,
    });

    const typeMap = schema.getTypeMap();
    const entity = typeMap['User'] as GraphQLObjectType | undefined;
    if (!entity) {
      throw new Error('Entity not found');
    }

    const requiredField = entity.getFields()['details'];
    expect(requiredField).toBeDefined();

    const fieldSet = (
      requiredField.astNode?.directives?.find((d) => d.name.value === 'requires')?.arguments?.[0]
        .value as StringValueNode
    ).value;

    const visitor = new RequiredFieldsVisitor(schema, entity, requiredField, fieldSet);
    visitor.visit();
    const rpcMethods = visitor.getRPCMethods();
    const messageDefinitions = visitor.getMessageDefinitions();

    expect(rpcMethods).toHaveLength(1);
    expect(rpcMethods[0].name).toBe('RequireUserDetailsById');
    expect(messageDefinitions).toHaveLength(5);
    expect(messageDefinitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ messageName: 'RequireUserDetailsByIdRequest' }),
        expect.objectContaining({ messageName: 'RequireUserDetailsByIdContext' }),
        expect.objectContaining({ messageName: 'RequireUserDetailsByIdResponse' }),
        expect.objectContaining({ messageName: 'RequireUserDetailsByIdResult' }),
        expect.objectContaining({ messageName: 'RequireUserDetailsByIdFields' }),
      ]),
    );

    let fieldMessage = messageDefinitions.find((message) => message.messageName === 'RequireUserDetailsByIdFields');
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

    let resultMessage = messageDefinitions.find((message) => message.messageName === 'RequireUserDetailsByIdResult');
    expect(resultMessage).toBeDefined();
    expect(resultMessage?.fields).toHaveLength(1);
    assertFieldMessage(resultMessage?.fields[0], {
      fieldName: 'details',
      typeName: 'Details',
      fieldNumber: 1,
      isRepeated: false,
    });

    const messageLines = buildProtoMessage(true, fieldMessage!).join('\n');

    /*
  message RequireUserDetailsByIdFields {
    mesage Cat {
      string name = 1;
      string catBreed = 2;
    }

    message Dog {
      string name = 1;
      string dogBreed = 2;
    }

    message Animal {
      oneof value {
        Cat cat = 1;
        Dog dog = 2;
      }
    }

    Animal pet = 1;
  }
  */

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

  it('should visit a field set with nested field selections and a union type', () => {
    const sdl = `
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
  `;

    const schema = buildSchema(sdl, {
      assumeValid: true,
      assumeValidSDL: true,
    });

    const typeMap = schema.getTypeMap();
    const entity = typeMap['User'] as GraphQLObjectType | undefined;
    if (!entity) {
      throw new Error('Entity not found');
    }

    const requiredField = entity.getFields()['details'];
    expect(requiredField).toBeDefined();

    const fieldSet = (
      requiredField.astNode?.directives?.find((d) => d.name.value === 'requires')?.arguments?.[0]
        .value as StringValueNode
    ).value;

    const visitor = new RequiredFieldsVisitor(schema, entity, requiredField, fieldSet);
    visitor.visit();
    const rpcMethods = visitor.getRPCMethods();
    const messageDefinitions = visitor.getMessageDefinitions();

    expect(rpcMethods).toHaveLength(1);
    expect(rpcMethods[0].name).toBe('RequireUserDetailsById');
    expect(messageDefinitions).toHaveLength(5);
    expect(messageDefinitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ messageName: 'RequireUserDetailsByIdRequest' }),
        expect.objectContaining({ messageName: 'RequireUserDetailsByIdContext' }),
        expect.objectContaining({ messageName: 'RequireUserDetailsByIdResponse' }),
        expect.objectContaining({ messageName: 'RequireUserDetailsByIdResult' }),
        expect.objectContaining({ messageName: 'RequireUserDetailsByIdFields' }),
      ]),
    );

    let fieldMessage = messageDefinitions.find((message) => message.messageName === 'RequireUserDetailsByIdFields');
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
    expect(descriptionMessage?.fields[0].fieldName).toBe('title');
    expect(descriptionMessage?.fields[0].typeName).toBe('string');
    expect(descriptionMessage?.fields[0].fieldNumber).toBe(1);
    expect(descriptionMessage?.fields[0].isRepeated).toBe(false);

    expect(descriptionMessage?.fields[1].fieldName).toBe('score');
    expect(descriptionMessage?.fields[1].typeName).toBe('int32');
    expect(descriptionMessage?.fields[1].fieldNumber).toBe(2);
    expect(descriptionMessage?.fields[1].isRepeated).toBe(false);

    expect(descriptionMessage?.fields[2].fieldName).toBe('pet');
    expect(descriptionMessage?.fields[2].typeName).toBe('Animal');
    expect(descriptionMessage?.fields[2].fieldNumber).toBe(3);
    expect(descriptionMessage?.fields[2].isRepeated).toBe(false);

    // Check for union composite type on Description message
    const compositeType = descriptionMessage?.compositeType;
    expect(compositeType).toBeDefined();
    expect(compositeType?.kind).toBe(CompositeMessageKind.UNION);
    expect(compositeType?.typeName).toBe('Animal');
    expect(isUnionMessageDefinition(compositeType!)).toBe(true);
    const unionMessageDefinition = compositeType! as UnionMessageDefinition;
    expect(unionMessageDefinition.memberTypes).toHaveLength(2);
    expect(unionMessageDefinition.memberTypes).toEqual(expect.arrayContaining(['Cat', 'Dog']));

    let resultMessage = messageDefinitions.find((message) => message.messageName === 'RequireUserDetailsByIdResult');
    expect(resultMessage).toBeDefined();
    expect(resultMessage?.fields).toHaveLength(1);
    expect(resultMessage?.fields[0].fieldName).toBe('details');
    expect(resultMessage?.fields[0].typeName).toBe('Details');
    expect(resultMessage?.fields[0].fieldNumber).toBe(1);
    expect(resultMessage?.fields[0].isRepeated).toBe(false);
  });
});

const assertFieldMessage = (
  field: ProtoMessageField | undefined,
  expected: { fieldName: string; typeName: string; fieldNumber: number; isRepeated: boolean },
) => {
  expect(field).toBeDefined();
  expect(field?.fieldName).toBe(expected.fieldName);
  expect(field?.typeName).toBe(expected.typeName);
  expect(field?.fieldNumber).toBe(expected.fieldNumber);
  expect(field?.isRepeated).toBe(expected.isRepeated);
};
