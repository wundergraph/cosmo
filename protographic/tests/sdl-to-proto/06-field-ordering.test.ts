import { describe, expect, test } from 'vitest';
import { buildSchema } from 'graphql';
import { GraphQLToProtoTextVisitor } from '../../src/sdl-to-proto-visitor';
import { ProtoLock, ProtoLockManager } from '../../src/proto-lock';
import { expectValidProto, getEnumValuesWithNumbers, getFieldNumbersFromMessage, getMethodsInOrder, loadProtoFromText } from '../util';

describe('Preserve Field Order', () => {
  test('should maintain field numbers despite field reordering in schema', () => {
    // Initial schema with specific field order
    const initialSchema = buildSchema(`
      type User {
        id: ID!
        name: String!
        email: String!
      }
      
      type Query {
        getUser(id: ID!): User
      }
    `);

    // Create the visitor with no initial lock data
    const visitor1 = new GraphQLToProtoTextVisitor(initialSchema, {
      serviceName: 'UserService',
    });

    // Generate the first proto
    const proto1 = visitor1.visit();

    // Parse the proto with protobufjs
    const root1 = loadProtoFromText(proto1);
    const fieldsWithNumbers1 = getFieldNumbersFromMessage(root1, 'User');

    // Get the generated lock data
    const lockData = visitor1.getGeneratedLockData();
    expect(lockData).not.toBeNull();

    // Modified schema with completely different field order
    const modifiedSchema = buildSchema(`
      type User {
        email: String!   # moved from 3rd to 1st
        name: String!    # moved from 2nd to 2nd (unchanged)
        id: ID!          # moved from 1st to 3rd
      }
      
      type Query {
        getUser(id: ID!): User
      }
    `);

    // Create another visitor using the generated lock data
    const visitor2 = new GraphQLToProtoTextVisitor(modifiedSchema, {
      serviceName: 'UserService',
      lockData: lockData || undefined,
    });

    // Generate the second proto
    const proto2 = visitor2.visit();

    // Parse the proto with protobufjs
    const root2 = loadProtoFromText(proto2);
    const fieldsWithNumbers2 = getFieldNumbersFromMessage(root2, 'User');

    // Verify that each field has the same number in both protos
    expect(Object.keys(fieldsWithNumbers1).length).toBeGreaterThan(0);
    for (const [fieldName, fieldNumber] of Object.entries(fieldsWithNumbers1)) {
      expect(fieldsWithNumbers2[fieldName]).toBe(fieldNumber);
    }
  });

  test('should maintain service method order with both queries and mutations', () => {
    // Initial schema with both query and mutation operations
    const initialSchema = buildSchema(`
      type User {
        id: ID!
        name: String!
        email: String
      }
      
      type Product {
        id: ID!
        name: String!
        price: Float!
        stock: Int!
      }
      
      input CreateUserInput {
        name: String!
        email: String
      }
      
      input UpdateProductInput {
        id: ID!
        name: String
        price: Float
        stock: Int
      }
      
      type Query {
        getUser(id: ID!): User
        getProduct(id: ID!): Product
        listProducts: [Product!]!
      }
      
      type Mutation {
        createUser(input: CreateUserInput!): User!
        updateProduct(input: UpdateProductInput!): Product!
        deleteProduct(id: ID!): Boolean!
      }
    `);

    // Create the visitor with no initial lock data
    const visitor1 = new GraphQLToProtoTextVisitor(initialSchema, {
      serviceName: 'StoreService',
    });

    // Generate the first proto
    const proto1 = visitor1.visit();

    // Get methods in order
    const root1 = loadProtoFromText(proto1);
    const methods1 = getMethodsInOrder(root1, 'StoreService');

    // Get the generated lock data
    const lockData = visitor1.getGeneratedLockData();
    expect(lockData).not.toBeNull();

    // Modified schema with operations in different order
    const modifiedSchema = buildSchema(`
      type User {
        id: ID!
        name: String!
        email: String
      }
      
      type Product {
        id: ID!
        name: String!
        price: Float!
        stock: Int!
      }
      
      input CreateUserInput {
        name: String!
        email: String
      }
      
      input UpdateProductInput {
        id: ID!
        name: String
        price: Float
        stock: Int
      }
      
      type Mutation {
        deleteProduct(id: ID!): Boolean!      # moved from 3rd to 1st
        createUser(input: CreateUserInput!): User!    # moved from 1st to 2nd
        updateProduct(input: UpdateProductInput!): Product!  # moved from 2nd to 3rd
      }
      
      type Query {
        listProducts: [Product!]!             # moved from 3rd to 1st
        getUser(id: ID!): User                # moved from 1st to 2nd
        getProduct(id: ID!): Product          # moved from 2nd to 3rd
      }
    `);

    // Create another visitor using the generated lock data
    const visitor2 = new GraphQLToProtoTextVisitor(modifiedSchema, {
      serviceName: 'StoreService',
      lockData: lockData || undefined,
    });

    // Generate the second proto
    const proto2 = visitor2.visit();

    // Get methods in order from the second proto
    const root2 = loadProtoFromText(proto2);
    const methods2 = getMethodsInOrder(root2, 'StoreService');

    // Verify methods exist in both protos
    expect(methods1.length).toBeGreaterThan(0);
    expect(methods1.length).toBe(methods2.length);

    // Verify the ordered list of methods from the lock data
    const expectedMethodOrder = lockData!.services.StoreService.methods;

    // Check that our methods in both protos match the expected order
    for (let i = 0; i < methods1.length; i++) {
      expect(methods1[i]).toBe(expectedMethodOrder[i]);
      expect(methods2[i]).toBe(expectedMethodOrder[i]);
    }
  });

  test('should preserve field numbers when adding new fields', () => {
    // Initial schema
    const initialSchema = buildSchema(`
      type User {
        id: ID!
        name: String!
        email: String!
      }
      
      type Query {
        getUser(id: ID!): User
      }
    `);

    // Create the visitor with no initial lock data
    const visitor1 = new GraphQLToProtoTextVisitor(initialSchema, {
      serviceName: 'UserService',
    });

    // Generate the first proto
    const proto1 = visitor1.visit();

    // Parse the proto with protobufjs
    const root1 = loadProtoFromText(proto1);
    const fieldsWithNumbers1 = getFieldNumbersFromMessage(root1, 'User');

    // Get the generated lock data
    const lockData = visitor1.getGeneratedLockData();
    expect(lockData).not.toBeNull();

    // Modified schema with new fields and changed order
    const modifiedSchema = buildSchema(`
      type User {
        email: String!        # moved
        phoneNumber: String!  # new field
        id: ID!               # moved
        created: String!      # new field
        name: String!         # moved
      }
      
      type Query {
        getUser(id: ID!): User
      }
    `);

    // Create another visitor using the generated lock data
    const visitor2 = new GraphQLToProtoTextVisitor(modifiedSchema, {
      serviceName: 'UserService',
      lockData: lockData || undefined,
    });

    // Generate the second proto
    const proto2 = visitor2.visit();

    // Parse the proto with protobufjs
    const root2 = loadProtoFromText(proto2);
    const fieldsWithNumbers2 = getFieldNumbersFromMessage(root2, 'User');

    // Verify that original fields keep their field numbers
    for (const [fieldName, fieldNumber] of Object.entries(fieldsWithNumbers1)) {
      expect(fieldsWithNumbers2[fieldName]).toBe(fieldNumber);
    }

    // Verify that new fields have higher field numbers
    const maxOriginalNumber = Math.max(...Object.values(fieldsWithNumbers1));
    expect(fieldsWithNumbers2['phone_number']).toBeGreaterThan(maxOriginalNumber);
    expect(fieldsWithNumbers2['created']).toBeGreaterThan(maxOriginalNumber);
  });

  test('should maintain enum value numbers despite reordering in schema', () => {
    // Initial schema with enum
    const initialSchema = buildSchema(`
      enum UserRole {
        ADMIN
        USER
        GUEST
        MODERATOR
      }
      
      type User {
        id: ID!
        role: UserRole!
      }
      
      type Query {
        getUser(id: ID!): User
      }
    `);

    // Create the visitor with no initial lock data
    const visitor1 = new GraphQLToProtoTextVisitor(initialSchema, {
      serviceName: 'UserService',
    });

    // Generate the first proto
    const proto1 = visitor1.visit();

    // Parse the proto with protobufjs
    const root1 = loadProtoFromText(proto1);
    const enumValues1 = getEnumValuesWithNumbers(root1, 'UserRole');

    // Verify proper enum format and values presence
    expect(Object.keys(enumValues1).length).toBeGreaterThan(0);
    expect(enumValues1['USER_ROLE_UNSPECIFIED']).toBe(0);
    expect(enumValues1['USER_ROLE_ADMIN']).toBeDefined();
    expect(enumValues1['USER_ROLE_USER']).toBeDefined();
    expect(enumValues1['USER_ROLE_GUEST']).toBeDefined();
    expect(enumValues1['USER_ROLE_MODERATOR']).toBeDefined();

    // Get the generated lock data
    const lockData = visitor1.getGeneratedLockData();
    expect(lockData).not.toBeNull();

    // Modified schema with enum values in different order
    const modifiedSchema = buildSchema(`
      enum UserRole {
        MODERATOR  # moved from 4th to 1st
        GUEST      # moved from 3rd to 2nd
        ADMIN      # moved from 1st to 3rd
        USER       # moved from 2nd to 4th
      }
      
      type User {
        id: ID!
        role: UserRole!
      }
      
      type Query {
        getUser(id: ID!): User
      }
    `);

    // Create another visitor using the generated lock data
    const visitor2 = new GraphQLToProtoTextVisitor(modifiedSchema, {
      serviceName: 'UserService',
      lockData: lockData || undefined,
    });

    // Generate the second proto
    const proto2 = visitor2.visit();

    // Parse the proto with protobufjs
    const root2 = loadProtoFromText(proto2);
    const enumValues2 = getEnumValuesWithNumbers(root2, 'UserRole');

    // Verify that each enum value has the same number in both protos
    expect(Object.keys(enumValues2).length).toBeGreaterThan(0);
    expect(enumValues2['USER_ROLE_UNSPECIFIED']).toBe(0);

    // Check that existing values maintain their numbers
    for (const [valueName, valueNumber] of Object.entries(enumValues1)) {
      if (valueName !== 'USER_ROLE_UNSPECIFIED') {
        // Skip UNSPECIFIED as it's always 0
        expect(enumValues2[valueName]).toBe(valueNumber);
      }
    }
  });

  test('should maintain enum value numbers when adding new enum values', () => {
    // Initial schema with enum
    const initialSchema = buildSchema(`
      enum UserStatus {
        ACTIVE
        INACTIVE
        BLOCKED
      }
      
      type User {
        id: ID!
        status: UserStatus!
      }
      
      type Query {
        getUser(id: ID!): User
      }
    `);

    // Create the visitor with no initial lock data
    const visitor1 = new GraphQLToProtoTextVisitor(initialSchema, {
      serviceName: 'UserService',
    });

    // Generate the first proto
    const proto1 = visitor1.visit();

    // Parse the proto with protobufjs
    const root1 = loadProtoFromText(proto1);
    const enumValues1 = getEnumValuesWithNumbers(root1, 'UserStatus');

    // Verify proper enum format
    expect(Object.keys(enumValues1).length).toBeGreaterThan(0);
    expect(enumValues1['USER_STATUS_UNSPECIFIED']).toBe(0);
    expect(enumValues1['USER_STATUS_ACTIVE']).toBeDefined();
    expect(enumValues1['USER_STATUS_INACTIVE']).toBeDefined();
    expect(enumValues1['USER_STATUS_BLOCKED']).toBeDefined();

    // Get the generated lock data
    const lockData = visitor1.getGeneratedLockData();
    expect(lockData).not.toBeNull();

    // Modified schema with reordered and new enum values
    const modifiedSchema = buildSchema(`
      enum UserStatus {
        BLOCKED      # moved
        PENDING      # new value
        ACTIVE       # moved
        DELETED      # new value
        INACTIVE     # moved
      }
      
      type User {
        id: ID!
        status: UserStatus!
      }
      
      type Query {
        getUser(id: ID!): User
      }
    `);

    // Create another visitor using the generated lock data
    const visitor2 = new GraphQLToProtoTextVisitor(modifiedSchema, {
      serviceName: 'UserService',
      lockData: lockData || undefined,
    });

    // Generate the second proto
    const proto2 = visitor2.visit();

    // Parse the proto with protobufjs
    const root2 = loadProtoFromText(proto2);
    const enumValues2 = getEnumValuesWithNumbers(root2, 'UserStatus');

    // Verify that original enum values keep their numbers
    expect(Object.keys(enumValues2).length).toBeGreaterThan(0);
    expect(enumValues2['USER_STATUS_UNSPECIFIED']).toBe(0);

    // Check that existing values maintain their numbers
    for (const [valueName, valueNumber] of Object.entries(enumValues1)) {
      if (valueName !== 'USER_STATUS_UNSPECIFIED') {
        // Skip UNSPECIFIED
        expect(enumValues2[valueName]).toBe(valueNumber);
      }
    }

    // Verify that new enum values are defined
    expect(enumValues2['USER_STATUS_PENDING']).toBeDefined();
    expect(enumValues2['USER_STATUS_DELETED']).toBeDefined();

    // Verify that new enum values have higher numbers
    const maxOriginalNumber = Math.max(
      ...Object.values(enumValues1).filter((num): num is number => typeof num === 'number' && num > 0),
    );

    expect(enumValues2['USER_STATUS_PENDING']).toBeGreaterThan(maxOriginalNumber);
    expect(enumValues2['USER_STATUS_DELETED']).toBeGreaterThan(maxOriginalNumber);
  });

  test('should preserve field numbers when complex type fields are deleted and re-added', () => {
    // Initial schema with multiple fields
    const initialSchema = buildSchema(`
      type Product {
        id: ID!           # field 1
        name: String!     # field 2
        price: Float!     # field 3
        description: String # field 4
        category: String  # field 5
      }
      
      type Query {
        getProduct(id: ID!): Product
      }
    `);

    // Create the visitor with no initial lock data
    const visitor1 = new GraphQLToProtoTextVisitor(initialSchema, {
      serviceName: 'ProductService',
    });

    // Generate the first proto
    const proto1 = visitor1.visit();

    // Parse the proto with protobufjs
    const root1 = loadProtoFromText(proto1);
    const fieldsWithNumbers1 = getFieldNumbersFromMessage(root1, 'Product');

    // Record the initial field numbers
    expect(Object.keys(fieldsWithNumbers1).length).toBe(5);

    // Remember field numbers for verification later
    const idNumber = fieldsWithNumbers1['id'];
    const nameNumber = fieldsWithNumbers1['name'];
    const priceNumber = fieldsWithNumbers1['price'];
    const descriptionNumber = fieldsWithNumbers1['description'];
    const categoryNumber = fieldsWithNumbers1['category'];

    // Get the generated lock data
    const lockData = visitor1.getGeneratedLockData();
    expect(lockData).not.toBeNull();

    // Modified schema with some fields removed
    const modifiedSchema = buildSchema(`
      type Product {
        id: ID!           # keep
        # name: String!   # removed
        price: Float!     # keep
        # description: String # removed
        category: String  # keep
      }
      
      type Query {
        getProduct(id: ID!): Product
      }
    `);

    // Create another visitor using the generated lock data
    const visitor2 = new GraphQLToProtoTextVisitor(modifiedSchema, {
      serviceName: 'ProductService',
      lockData: lockData || undefined,
    });

    // Generate the second proto
    const proto2 = visitor2.visit();

    // Parse the proto with protobufjs
    const root2 = loadProtoFromText(proto2);
    const fieldsWithNumbers2 = getFieldNumbersFromMessage(root2, 'Product');

    // Verify that remaining fields maintained their original field numbers
    expect(Object.keys(fieldsWithNumbers2).length).toBe(3);
    expect(fieldsWithNumbers2['id']).toBe(idNumber);
    expect(fieldsWithNumbers2['price']).toBe(priceNumber);
    expect(fieldsWithNumbers2['category']).toBe(categoryNumber);

    // Verify name and description were removed
    expect(fieldsWithNumbers2['name']).toBeUndefined();
    expect(fieldsWithNumbers2['description']).toBeUndefined();

    // Modified schema adding back removed fields and adding new ones
    const modifiedSchema2 = buildSchema(`
      type Product {
        id: ID!            # original
        name: String!      # adding back
        price: Float!      # original
        newField: String!  # new field
        category: String   # original
        description: String # adding back
        stock: Int         # new field
      }
      
      type Query {
        getProduct(id: ID!): Product
      }
    `);

    // Create a third visitor using the same lock data
    const visitor3 = new GraphQLToProtoTextVisitor(modifiedSchema2, {
      serviceName: 'ProductService',
      lockData: lockData || undefined,
    });

    // Generate the third proto
    const proto3 = visitor3.visit();

    // Parse the proto with protobufjs
    const root3 = loadProtoFromText(proto3);
    const fieldsWithNumbers3 = getFieldNumbersFromMessage(root3, 'Product');

    // Verify that all original fields maintain their original numbers,
    // even those that were temporarily removed
    expect(fieldsWithNumbers3['id']).toBe(idNumber);
    expect(fieldsWithNumbers3['name']).toBe(nameNumber);
    expect(fieldsWithNumbers3['price']).toBe(priceNumber);
    expect(fieldsWithNumbers3['description']).toBe(descriptionNumber);
    expect(fieldsWithNumbers3['category']).toBe(categoryNumber);

    // Verify new fields have higher numbers that don't conflict with any original fields
    const maxOriginalNumber = Math.max(idNumber, nameNumber, priceNumber, descriptionNumber, categoryNumber);
    expect(fieldsWithNumbers3['new_field']).toBeGreaterThan(maxOriginalNumber);
    expect(fieldsWithNumbers3['stock']).toBeGreaterThan(maxOriginalNumber);
  });
});
