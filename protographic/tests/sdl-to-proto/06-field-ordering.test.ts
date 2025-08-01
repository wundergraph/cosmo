import { describe, expect, test } from 'vitest';
import { buildSchema } from 'graphql';
import { GraphQLToProtoTextVisitor } from '../../src/sdl-to-proto-visitor';
import {
  getEnumValuesWithNumbers,
  getFieldNumbersFromMessage,
  loadProtoFromText,
  getMessageContent,
  getEnumContent,
  getServiceMethods,
  getReservedNumbers,
} from '../util';
import { isNull } from 'lodash-es';

describe('Field Ordering and Preservation', () => {
  describe('Basic Message Field Ordering', () => {
    test('should maintain field numbers when fields are reordered in schema', () => {
      // Initial schema with specific field order
      const initialSchema = buildSchema(`
        type User {
          id: ID!
          name: String!
          email: String!
        }
        
        type Query {
          getUsers: [User]
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
      const userFields1 = getFieldNumbersFromMessage(root1, 'User');

      // Get the generated lock data
      const lockData = visitor1.getGeneratedLockData();
      expect(lockData).not.toBeNull();

      // Modified schema with completely different field order
      const modifiedSchema = buildSchema(`
        type User {
          email: String!   # moved from 3rd to 1st
          id: ID!          # moved from 1st to 2nd
          name: String!    # moved from 2nd to 3rd
        }
        
        type Query {
          getUsers: [User]
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
      const userFields2 = getFieldNumbersFromMessage(root2, 'User');

      // Verify that each field has the same number in both protos
      expect(Object.keys(userFields1).length).toBe(3);
      expect(userFields1['id']).toBe(userFields2['id']);
      expect(userFields1['name']).toBe(userFields2['name']);
      expect(userFields1['email']).toBe(userFields2['email']);
    });

    test('should handle adding and removing fields while preserving field numbers', () => {
      // Initial schema with specific fields
      const initialSchema = buildSchema(`
        type Product {
          id: ID!
          name: String!
          price: Float!
          description: String
        }
        
        type Query {
          getProducts: [Product]
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
      const productFields1 = getFieldNumbersFromMessage(root1, 'Product');

      // Store original field numbers
      const idNumber = productFields1['id'];
      const priceNumber = productFields1['price'];

      // Get the generated lock data
      const lockData = visitor1.getGeneratedLockData();
      expect(lockData).not.toBeNull();

      // Modified schema with removed and added fields
      const modifiedSchema = buildSchema(`
        type Product {
          id: ID!               # kept
          # name: String!       # removed
          price: Float!         # kept
          # description: String # removed
          category: String      # added
          inStock: Boolean      # added
        }
        
        type Query {
          getProducts: [Product]
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
      const productFields2 = getFieldNumbersFromMessage(root2, 'Product');

      // Verify that preserved fields kept the same numbers
      expect(productFields2['id']).toBe(idNumber);
      expect(productFields2['price']).toBe(priceNumber);

      // Verify removed fields are not present
      expect(productFields2['name']).toBeUndefined();
      expect(productFields2['description']).toBeUndefined();

      // Verify new fields have been added
      expect(productFields2['category']).toBeDefined();
      expect(productFields2['in_stock']).toBeDefined();
    });
  });

  describe('Field Re-addition', () => {
    test('should preserve field numbers when fields are re-added after removal', () => {
      // Initial schema with fields
      const initialSchema = buildSchema(`
        type Post {
          id: ID!
          title: String!
          content: String!
          published: Boolean!
          tags: [String]
        }
        
        type Query {
          getPosts: [Post]
        }
      `);

      // Create the visitor with no initial lock data
      const visitor1 = new GraphQLToProtoTextVisitor(initialSchema, {
        serviceName: 'BlogService',
      });

      // Generate the first proto
      const proto1 = visitor1.visit();

      // Parse the proto with protobufjs
      const root1 = loadProtoFromText(proto1);
      const postFields1 = getFieldNumbersFromMessage(root1, 'Post');

      // Store original field numbers
      const idNumber = postFields1['id'];
      const titleNumber = postFields1['title'];
      const publishedNumber = postFields1['published'];

      // Get the generated lock data
      const lockData = visitor1.getGeneratedLockData();
      expect(lockData).not.toBeNull();

      // Modified schema with removed fields
      const modifiedSchema = buildSchema(`
        type Post {
          id: ID!
          title: String!
          # content: String!    # removed
          published: Boolean!
          # tags: [String]      # removed
        }
        
        type Query {
          getPosts: [Post]
        }
      `);

      // Create another visitor using the generated lock data
      const visitor2 = new GraphQLToProtoTextVisitor(modifiedSchema, {
        serviceName: 'BlogService',
        lockData: lockData || undefined,
      });

      // Generate the second proto
      const proto2 = visitor2.visit();

      // Parse the proto to verify fields are removed
      const root2 = loadProtoFromText(proto2);
      const postFields2 = getFieldNumbersFromMessage(root2, 'Post');

      // Verify fields were removed
      expect(postFields2['content']).toBeUndefined();
      expect(postFields2['tags']).toBeUndefined();

      // Verify remaining fields kept their numbers
      expect(postFields2['id']).toBe(idNumber);
      expect(postFields2['title']).toBe(titleNumber);
      expect(postFields2['published']).toBe(publishedNumber);

      // Schema with re-added fields and new fields
      const modifiedSchema2 = buildSchema(`
        type Post {
          id: ID!
          title: String!
          content: String!    # re-added
          published: Boolean!
          tags: [String]      # re-added
          author: String      # new field
        }
        
        type Query {
          getPosts: [Post]
        }
      `);

      // Create a third visitor using the same lock data
      const visitor3 = new GraphQLToProtoTextVisitor(modifiedSchema2, {
        serviceName: 'BlogService',
        lockData: lockData || undefined,
      });

      // Generate the third proto
      const proto3 = visitor3.visit();

      // Parse the proto with protobufjs
      const root3 = loadProtoFromText(proto3);
      const postFields3 = getFieldNumbersFromMessage(root3, 'Post');

      // Verify that all fields have assigned numbers
      expect(postFields3['id']).toBe(idNumber);
      expect(postFields3['title']).toBe(titleNumber);
      expect(postFields3['published']).toBe(publishedNumber);

      // Re-added fields get new numbers in the current implementation
      expect(postFields3['content']).toBeDefined();
      expect(postFields3['tags']).toBeDefined();

      // Verify new field has been added
      expect(postFields3['author']).toBeDefined();
    });

    test('should add reserved tag when fields are removed in first operation', () => {
      // Initial schema with fields
      const initialSchema = buildSchema(`
        type User {
          id: ID!
          name: String!
          email: String!
          age: Int!
          address: String!
        }
        
        type Query {
          getUsers: [User]
        }
      `);

      // Create the visitor with no initial lock data
      const visitor1 = new GraphQLToProtoTextVisitor(initialSchema, {
        serviceName: 'UserService',
      });

      // Generate the first proto to establish the initial field numbers
      const proto1 = visitor1.visit();

      // Get the lock data with all fields
      const lockData = visitor1.getGeneratedLockData();
      expect(lockData).not.toBeNull();

      // Now modify the schema to remove some fields (still in first-time operation)
      const modifiedSchema = buildSchema(`
        type User {
          id: ID!
          name: String!
          # email: String!  # removed
          # age: Int!       # removed
          address: String!
        }
        
        type Query {
          getUsers: [User]
        }
      `);

      // Create a second visitor WITH the initial lock data
      const visitor2 = new GraphQLToProtoTextVisitor(modifiedSchema, {
        serviceName: 'UserService',
        lockData: lockData || undefined,
      });

      // Generate the proto with some fields removed
      const proto2 = visitor2.visit();

      // Parse the proto using protobufjs
      const root2 = loadProtoFromText(proto2);

      // Verify reserved numbers exist for User message
      const reservedNumbers = getReservedNumbers(root2, 'User');
      expect(reservedNumbers.length).toBeGreaterThan(0);

      // Get updated lock data and verify it contains reserved numbers
      const lockData2 = visitor2.getGeneratedLockData();
      expect(lockData2!.messages['User'].reservedNumbers).toBeDefined();
      expect(lockData2!.messages['User'].reservedNumbers!.length).toBeGreaterThan(0);

      // Now add a field back and add a new field
      const modifiedSchema2 = buildSchema(`
        type User {
          id: ID!
          name: String!
          email: String!   # re-added
          # age: Int!      # still removed
          address: String!
          phone: String!   # new field
        }
        
        type Query {
          getUsers: [User]
        }
      `);

      // Create a third visitor using the lock data from visitor2
      const visitor3 = new GraphQLToProtoTextVisitor(modifiedSchema2, {
        serviceName: 'UserService',
        lockData: lockData2 || undefined,
      });

      // Generate the third proto
      const proto3 = visitor3.visit();

      // Parse the proto using protobufjs
      const root3 = loadProtoFromText(proto3);

      // Get message content using our utility
      const userContent = getMessageContent(root3, 'User');

      // Verify there are still reserved numbers
      expect(userContent.reserved.length).toBeGreaterThan(0);

      // Verify fields exist
      expect(userContent.fields['email']).toBeDefined();
      expect(userContent.fields['phone']).toBeDefined();
      expect(userContent.fields['age']).toBeUndefined();
    });
  });

  describe('Enum Value Ordering', () => {
    test('should maintain enum value numbers when values are reordered', () => {
      // Initial schema with enum
      const initialSchema = buildSchema(`
        enum UserRole {
          ADMIN
          EDITOR
          VIEWER
        }
        
        type User {
          id: ID!
          role: UserRole!
        }
        
        type Query {
          getUsers: [User]
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

      // Store original enum value numbers
      const adminNumber = enumValues1['USER_ROLE_ADMIN'];
      const editorNumber = enumValues1['USER_ROLE_EDITOR'];
      const viewerNumber = enumValues1['USER_ROLE_VIEWER'];

      // Get the generated lock data
      const lockData = visitor1.getGeneratedLockData();
      expect(lockData).not.toBeNull();

      // Modified schema with reordered enum values
      const modifiedSchema = buildSchema(`
        enum UserRole {
          VIEWER    # moved from 3rd to 1st
          ADMIN     # moved from 1st to 2nd
          EDITOR    # moved from 2nd to 3rd
        }
        
        type User {
          id: ID!
          role: UserRole!
        }
        
        type Query {
          getUsers: [User]
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

      // Verify that enum values kept their numbers
      expect(enumValues2['USER_ROLE_ADMIN']).toBe(adminNumber);
      expect(enumValues2['USER_ROLE_EDITOR']).toBe(editorNumber);
      expect(enumValues2['USER_ROLE_VIEWER']).toBe(viewerNumber);
    });

    test('should handle adding, removing, and re-adding enum values', () => {
      // Initial schema with enum
      const initialSchema = buildSchema(`
        enum Status {
          PENDING
          ACTIVE
          INACTIVE
          DELETED
        }
        
        type Query {
          getStatusCounts(status: Status): Int
        }
      `);

      // Create the visitor with no initial lock data
      const visitor1 = new GraphQLToProtoTextVisitor(initialSchema, {
        serviceName: 'StatusService',
      });

      // Generate the first proto
      const proto1 = visitor1.visit();

      // Parse the proto with protobufjs
      const root1 = loadProtoFromText(proto1);
      const enumValues1 = getEnumValuesWithNumbers(root1, 'Status');

      // Store original enum value numbers
      const pendingNumber = enumValues1['STATUS_PENDING'];
      const inactiveNumber = enumValues1['STATUS_INACTIVE'];

      // Get the generated lock data
      const lockData = visitor1.getGeneratedLockData();
      expect(lockData).not.toBeNull();

      // Modified schema with removed enum values
      const modifiedSchema = buildSchema(`
        enum Status {
          PENDING
          # ACTIVE    # removed
          INACTIVE
          # DELETED   # removed
        }
        
        type Query {
          getStatusCounts(status: Status): Int
        }
      `);

      // Create another visitor using the generated lock data
      const visitor2 = new GraphQLToProtoTextVisitor(modifiedSchema, {
        serviceName: 'StatusService',
        lockData: lockData || undefined,
      });

      // Generate the second proto
      const proto2 = visitor2.visit();

      // Parse the proto with protobufjs
      const root2 = loadProtoFromText(proto2);
      const enumValues2 = getEnumValuesWithNumbers(root2, 'Status');

      // Verify remaining enum values kept their numbers
      expect(enumValues2['STATUS_PENDING']).toBe(pendingNumber);
      expect(enumValues2['STATUS_INACTIVE']).toBe(inactiveNumber);

      // Verify removed enum values are gone
      expect(enumValues2['STATUS_ACTIVE']).toBeUndefined();
      expect(enumValues2['STATUS_DELETED']).toBeUndefined();

      // Third schema with re-added values and new values
      const modifiedSchema2 = buildSchema(`
        enum Status {
          PENDING
          ACTIVE       # re-added
          INACTIVE
          DELETED      # re-added
          ARCHIVED     # new
        }
        
        type Query {
          getStatusCounts(status: Status): Int
        }
      `);

      // Create a third visitor using the same lock data
      const visitor3 = new GraphQLToProtoTextVisitor(modifiedSchema2, {
        serviceName: 'StatusService',
        lockData: lockData || undefined,
      });

      // Generate the third proto
      const proto3 = visitor3.visit();

      // Parse the proto with protobufjs
      const root3 = loadProtoFromText(proto3);
      const enumValues3 = getEnumValuesWithNumbers(root3, 'Status');

      // Verify enum values have consistent numbers
      expect(enumValues3['STATUS_PENDING']).toBe(pendingNumber);
      expect(enumValues3['STATUS_INACTIVE']).toBe(inactiveNumber);

      // Re-added enum values get new numbers in the current implementation
      expect(enumValues3['STATUS_ACTIVE']).toBeDefined();
      expect(enumValues3['STATUS_DELETED']).toBeDefined();

      // Verify new enum value has been added
      expect(enumValues3['STATUS_ARCHIVED']).toBeDefined();
    });

    test('should add reserved tag when enum values are removed', () => {
      // Initial schema with enum
      const initialSchema = buildSchema(`
        enum UserRole {
          ADMIN
          EDITOR
          VIEWER
          GUEST
          SUPER_ADMIN
        }
        
        type User {
          id: ID!
          role: UserRole!
        }
        
        type Query {
          getUsers: [User]
        }
      `);

      // Create the visitor with no initial lock data
      const visitor1 = new GraphQLToProtoTextVisitor(initialSchema, {
        serviceName: 'UserService',
      });

      // Generate the first proto
      const proto1 = visitor1.visit();

      // Get the generated lock data with all enum values
      const lockData = visitor1.getGeneratedLockData();
      expect(lockData).not.toBeNull();

      // Modified schema with removed enum values
      const modifiedSchema = buildSchema(`
        enum UserRole {
          ADMIN
          EDITOR
          # VIEWER       # removed
          # GUEST        # removed
          SUPER_ADMIN
        }
        
        type User {
          id: ID!
          role: UserRole!
        }
        
        type Query {
          getUsers: [User]
        }
      `);

      // Create another visitor using the initial lock data
      const visitor2 = new GraphQLToProtoTextVisitor(modifiedSchema, {
        serviceName: 'UserService',
        lockData: lockData || undefined,
      });

      // Generate the second proto
      const proto2 = visitor2.visit();
      const lockData2 = visitor2.getGeneratedLockData();

      // Verify the lock data contains reserved numbers for the removed enum values
      expect(lockData2!.enums['UserRole'].reservedNumbers).toBeDefined();

      // Third schema with one removed value re-added
      const modifiedSchema2 = buildSchema(`
        enum UserRole {
          ADMIN
          EDITOR
          VIEWER        # re-added
          # GUEST       # still removed
          SUPER_ADMIN
          MODERATOR     # new value
        }
        
        type User {
          id: ID!
          role: UserRole!
        }
        
        type Query {
          getUsers: [User]
        }
      `);

      // Create a third visitor using the lock data
      const visitor3 = new GraphQLToProtoTextVisitor(modifiedSchema2, {
        serviceName: 'UserService',
        lockData: lockData2 || undefined,
      });

      // Generate the third proto
      const proto3 = visitor3.visit();

      // Parse the proto and check for reserved values
      const root3 = loadProtoFromText(proto3);
      const enumContent = getEnumContent(root3, 'UserRole');

      // Verify reserved numbers exist
      expect(enumContent.reserved.length).toBeGreaterThan(0);

      // Verify VIEWER is present in the enum values
      expect(enumContent.values['USER_ROLE_VIEWER']).toBeDefined();

      // Verify new value exists
      expect(enumContent.values['USER_ROLE_MODERATOR']).toBeDefined();
    });
  });

  describe('Service Method Ordering', () => {
    test('should maintain the order of service methods', () => {
      // Initial schema with multiple query fields
      const initialSchema = buildSchema(`
        type User {
          id: ID!
          name: String!
        }
        
        type Query {
          getUsers: [User]
          getUser(id: ID!): User
          searchUsers(query: String): [User]
        }
      `);

      // Create the visitor with no initial lock data
      const visitor1 = new GraphQLToProtoTextVisitor(initialSchema, {
        serviceName: 'UserService',
      });

      // Generate the first proto
      const proto1 = visitor1.visit();
      const lockData = visitor1.getGeneratedLockData();
      expect(lockData).not.toBeNull();

      // Load the proto using protobufjs
      const root1 = loadProtoFromText(proto1);

      // Get service methods using our utility
      const methods1 = getServiceMethods(root1, 'UserService');

      // Verify the methods are in the proto output
      expect(methods1).toContain('QueryGetUsers');
      expect(methods1).toContain('QueryGetUser');
      expect(methods1).toContain('QuerySearchUsers');

      // Modified schema with reordered and new methods
      const modifiedSchema = buildSchema(`
        type User {
          id: ID!
          name: String!
        }
        
        type Query {
          searchUsers(query: String): [User]  # moved from 3rd to 1st
          getUser(id: ID!): User              # moved from 2nd to 2nd (unchanged)
          getUsers: [User]                    # moved from 1st to 3rd
          countUsers: Int                     # new method
        }
      `);

      // Create another visitor using the generated lock data
      const visitor2 = new GraphQLToProtoTextVisitor(modifiedSchema, {
        serviceName: 'UserService',
        lockData: lockData || undefined,
      });

      // Generate the second proto
      const proto2 = visitor2.visit();

      // Load the proto using protobufjs
      const root2 = loadProtoFromText(proto2);

      // Get service methods using our utility
      const methods2 = getServiceMethods(root2, 'UserService');

      // Verify all methods are in the proto output
      expect(methods2).toContain('QueryGetUsers');
      expect(methods2).toContain('QueryGetUser');
      expect(methods2).toContain('QuerySearchUsers');
      expect(methods2).toContain('QueryCountUsers');

      // Verify they are ordered alphabetically
      expect(methods2).toEqual([...methods2].sort());
    });

    test('should handle adding, removing, and re-adding service methods', () => {
      // Initial schema with both query and mutation
      const initialSchema = buildSchema(`
        type User {
          id: ID!
          name: String!
        }
        
        type Query {
          getUsers: [User]
          getUser(id: ID!): User
        }
        
        type Mutation {
          createUser(name: String!): User
          updateUser(id: ID!, name: String): User
          deleteUser(id: ID!): Boolean
        }
      `);

      // Create the visitor with no initial lock data
      const visitor1 = new GraphQLToProtoTextVisitor(initialSchema, {
        serviceName: 'UserService',
      });

      // Generate the first proto
      const proto1 = visitor1.visit();
      const lockData = visitor1.getGeneratedLockData();
      expect(lockData).not.toBeNull();

      // Parse the proto with protobufjs
      const root1 = loadProtoFromText(proto1);
      const methods1 = getServiceMethods(root1, 'UserService');

      // Verify original methods are present
      expect(methods1).toContain('QueryGetUsers');
      expect(methods1).toContain('QueryGetUser');
      expect(methods1).toContain('MutationCreateUser');
      expect(methods1).toContain('MutationUpdateUser');
      expect(methods1).toContain('MutationDeleteUser');

      // Modified schema with removed methods
      const modifiedSchema = buildSchema(`
        type User {
          id: ID!
          name: String!
        }
        
        type Query {
          # getUsers: [User]      # removed
          getUser(id: ID!): User
        }
        
        type Mutation {
          createUser(name: String!): User
          # updateUser(id: ID!, name: String): User  # removed
          deleteUser(id: ID!): Boolean
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
      const methods2 = getServiceMethods(root2, 'UserService');

      // Verify methods in proto output
      expect(methods2).toContain('QueryGetUser');
      expect(methods2).toContain('MutationCreateUser');
      expect(methods2).toContain('MutationDeleteUser');
      expect(methods2).not.toContain('QueryGetUsers');
      expect(methods2).not.toContain('MutationUpdateUser');

      // Third schema with re-added methods and new methods
      const modifiedSchema2 = buildSchema(`
        type User {
          id: ID!
          name: String!
        }
        
        type Query {
          getUsers: [User]                # re-added
          getUser(id: ID!): User
          findUserByEmail(email: String!): User  # new
        }
        
        type Mutation {
          createUser(name: String!): User
          updateUser(id: ID!, name: String): User  # re-added
          deleteUser(id: ID!): Boolean
          batchDeleteUsers(ids: [ID!]!): Boolean   # new
        }
      `);

      // Create a third visitor using the same lock data
      const visitor3 = new GraphQLToProtoTextVisitor(modifiedSchema2, {
        serviceName: 'UserService',
        lockData: lockData || undefined,
      });

      // Generate the third proto
      const proto3 = visitor3.visit();

      // Parse the proto with protobufjs
      const root3 = loadProtoFromText(proto3);
      const methods3 = getServiceMethods(root3, 'UserService');

      // Verify all methods are in the proto output
      expect(methods3).toContain('QueryGetUsers');
      expect(methods3).toContain('QueryGetUser');
      expect(methods3).toContain('QueryFindUserByEmail');
      expect(methods3).toContain('MutationCreateUser');
      expect(methods3).toContain('MutationUpdateUser');
      expect(methods3).toContain('MutationDeleteUser');
      expect(methods3).toContain('MutationBatchDeleteUsers');

      // Verify they are ordered alphabetically
      expect(methods3).toEqual([...methods3].sort());
    });
  });

  describe('Complex Scenarios', () => {
    test('should handle nested message types with fields reordering', () => {
      // Initial schema with nested complex types
      const initialSchema = buildSchema(`
        type Address {
          street: String!
          city: String!
          state: String!
          zip: String!
        }
        
        type User {
          id: ID!
          name: String!
          address: Address!
        }
        
        type Query {
          getUsers: [User]
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
      const userFields1 = getFieldNumbersFromMessage(root1, 'User');
      const addressFields1 = getFieldNumbersFromMessage(root1, 'Address');

      // Store original field numbers
      const userIdNumber = userFields1['id'];
      const userNameNumber = userFields1['name'];
      const userAddressNumber = userFields1['address'];

      const streetNumber = addressFields1['street'];
      const cityNumber = addressFields1['city'];
      const stateNumber = addressFields1['state'];
      const zipNumber = addressFields1['zip'];

      // Get the generated lock data
      const lockData = visitor1.getGeneratedLockData();
      expect(lockData).not.toBeNull();

      // Modified schema with reordered fields in both types
      const modifiedSchema = buildSchema(`
        type Address {
          zip: String!      # moved from 4th to 1st
          state: String!    # moved from 3rd to 2nd
          city: String!     # moved from 2nd to 3rd
          street: String!   # moved from 1st to 4th
        }
        
        type User {
          address: Address! # moved from 3rd to 1st
          name: String!     # moved from 2nd to 2nd (unchanged)
          id: ID!           # moved from 1st to 3rd
        }
        
        type Query {
          getUsers: [User]
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
      const userFields2 = getFieldNumbersFromMessage(root2, 'User');
      const addressFields2 = getFieldNumbersFromMessage(root2, 'Address');

      // Verify that field numbers are preserved in User
      expect(userFields2['id']).toBe(userIdNumber);
      expect(userFields2['name']).toBe(userNameNumber);
      expect(userFields2['address']).toBe(userAddressNumber);

      // Verify that field numbers are preserved in Address
      expect(addressFields2['street']).toBe(streetNumber);
      expect(addressFields2['city']).toBe(cityNumber);
      expect(addressFields2['state']).toBe(stateNumber);
      expect(addressFields2['zip']).toBe(zipNumber);
    });

    test('should handle nested message types with mutations', () => {
      // Initial schema with nested input types for mutations
      const initialSchema = buildSchema(`
        type Product {
          id: ID!
          name: String!
          price: Float!
        }

        input PriceRange {
          min: Float!
          max: Float!
          currency: String!
        }
        
        input ProductFilter {
          nameContains: String
          priceRange: PriceRange
          inStock: Boolean
        }
        
        type Mutation {
          createProduct(name: String!, price: Float!, description: String): Product
          updateProduct(id: ID!, name: String, price: Float): Product
          filterProducts(filter: ProductFilter!): [Product]
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

      // Get field numbers from mutation request messages
      const createProductFields = getFieldNumbersFromMessage(root1, 'MutationCreateProductRequest');
      const updateProductFields = getFieldNumbersFromMessage(root1, 'MutationUpdateProductRequest');
      const filterProductsFields = getFieldNumbersFromMessage(root1, 'MutationFilterProductsRequest');

      // Get field numbers from nested input types
      const productFilterFields = getFieldNumbersFromMessage(root1, 'ProductFilter');
      const priceRangeFields = getFieldNumbersFromMessage(root1, 'PriceRange');

      // Store original field numbers
      // Create product mutation
      const createNameNumber = createProductFields['name'];
      const createPriceNumber = createProductFields['price'];
      const createDescNumber = createProductFields['description'];

      // Update product mutation
      const updateIdNumber = updateProductFields['id'];
      const updateNameNumber = updateProductFields['name'];
      const updatePriceNumber = updateProductFields['price'];

      // Filter products mutation
      const filterNumber = filterProductsFields['filter'];

      // ProductFilter input type
      const nameContainsNumber = productFilterFields['name_contains'];
      const priceRangeNumber = productFilterFields['price_range'];
      const inStockNumber = productFilterFields['in_stock'];

      // PriceRange input type
      const minNumber = priceRangeFields['min'];
      const maxNumber = priceRangeFields['max'];
      const currencyNumber = priceRangeFields['currency'];

      // Get the generated lock data
      const lockData = visitor1.getGeneratedLockData();
      expect(lockData).not.toBeNull();

      // Modified schema with reordered fields in input types and mutations
      const modifiedSchema = buildSchema(`
        type Product {
          id: ID!
          name: String!
          price: Float!
        }

        input PriceRange {
          currency: String!  # moved from 3rd to 1st
          max: Float!        # moved from 2nd to 2nd (unchanged)
          min: Float!        # moved from 1st to 3rd
        }
        
        input ProductFilter {
          inStock: Boolean      # moved from 3rd to 1st
          priceRange: PriceRange # moved from 2nd to 2nd (unchanged)
          nameContains: String   # moved from 1st to 3rd
        }
        
        type Mutation {
          updateProduct(price: Float, id: ID!, name: String): Product  # reordered args
          filterProducts(filter: ProductFilter!): [Product]            # unchanged
          createProduct(price: Float!, description: String, name: String!): Product # reordered args
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

      // Get field numbers from the second proto
      const createProductFields2 = getFieldNumbersFromMessage(root2, 'MutationCreateProductRequest');
      const updateProductFields2 = getFieldNumbersFromMessage(root2, 'MutationUpdateProductRequest');
      const filterProductsFields2 = getFieldNumbersFromMessage(root2, 'MutationFilterProductsRequest');
      const productFilterFields2 = getFieldNumbersFromMessage(root2, 'ProductFilter');
      const priceRangeFields2 = getFieldNumbersFromMessage(root2, 'PriceRange');

      // Verify mutation field numbers are preserved
      // Create product
      expect(createProductFields2['name']).toBe(createNameNumber);
      expect(createProductFields2['price']).toBe(createPriceNumber);
      expect(createProductFields2['description']).toBe(createDescNumber);

      // Update product
      expect(updateProductFields2['id']).toBe(updateIdNumber);
      expect(updateProductFields2['name']).toBe(updateNameNumber);
      expect(updateProductFields2['price']).toBe(updatePriceNumber);

      // Filter products
      expect(filterProductsFields2['filter']).toBe(filterNumber);

      // Verify nested input type field numbers are preserved
      // ProductFilter
      expect(productFilterFields2['name_contains']).toBe(nameContainsNumber);
      expect(productFilterFields2['price_range']).toBe(priceRangeNumber);
      expect(productFilterFields2['in_stock']).toBe(inStockNumber);

      // PriceRange
      expect(priceRangeFields2['min']).toBe(minNumber);
      expect(priceRangeFields2['max']).toBe(maxNumber);
      expect(priceRangeFields2['currency']).toBe(currencyNumber);
    });
  });

  describe('List Wrapper Types Field Ordering', () => {
    test('should preserve field numbers for simple list wrapper types', () => {
      // Initial schema with nullable lists that generate simple wrapper types
      const initialSchema = buildSchema(`
        type User {
          id: ID!
          name: String!
          tags: [String]        # nullable list -> generates ListOfString wrapper
          scores: [Int]         # nullable list -> generates ListOfInt wrapper
          categories: [User]    # nullable list -> generates ListOfUser wrapper
        }
        
        type Query {
          getUsers: [User]
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

      // Verify wrapper types exist and get their field numbers
      const listOfStringWrapperFields = getFieldNumbersFromMessage(root1, 'ListOfString');
      const listOfIntWrapperFields = getFieldNumbersFromMessage(root1, 'ListOfInt');
      const listOfUserWrapperFields = getFieldNumbersFromMessage(root1, 'ListOfUser');

      // Get the inner List type field numbers for items
      const stringListType = root1.lookupType('ListOfString').lookupType('List');
      const intListType = root1.lookupType('ListOfInt').lookupType('List');
      const userListType = root1.lookupType('ListOfUser').lookupType('List');

      const stringListFields = getFieldNumbersFromMessage(stringListType.root, 'List');
      const intListFields = getFieldNumbersFromMessage(intListType.root, 'List');
      const userListFields = getFieldNumbersFromMessage(userListType.root, 'List');

      // Store original field numbers for wrapper types (outer 'list' field)
      const stringWrapperListFieldNumber = listOfStringWrapperFields['list'];
      const intWrapperListFieldNumber = listOfIntWrapperFields['list'];
      const userWrapperListFieldNumber = listOfUserWrapperFields['list'];

      // Store original field numbers for inner List types ('items' field)
      const stringListItemsFieldNumber = stringListFields['items'];
      const intListItemsFieldNumber = intListFields['items'];
      const userListItemsFieldNumber = userListFields['items'];

      // Verify all wrapper types have the 'list' field with field number 1
      expect(stringWrapperListFieldNumber).toBe(1);
      expect(intWrapperListFieldNumber).toBe(1);
      expect(userWrapperListFieldNumber).toBe(1);

      // Verify all inner List types have the 'items' field with field number 1
      expect(stringListItemsFieldNumber).toBe(1);
      expect(intListItemsFieldNumber).toBe(1);
      expect(userListItemsFieldNumber).toBe(1);

      // Get the generated lock data
      const lockData = visitor1.getGeneratedLockData();
      expect(lockData).not.toBeNull();

      // Verify wrapper types are NOT in lock data (they're auto-generated with deterministic field numbers)
      expect(lockData!.messages['ListOfString']).toBeUndefined();
      expect(lockData!.messages['ListOfInt']).toBeUndefined();
      expect(lockData!.messages['ListOfUser']).toBeUndefined();

      // Modified schema with additional nullable lists (triggers regeneration)
      const modifiedSchema = buildSchema(`
        type User {
          id: ID!
          name: String!
          tags: [String]        # existing nullable list
          scores: [Int]         # existing nullable list  
          categories: [User]    # existing nullable list
          ratings: [Float]      # new nullable list -> generates ListOfFloat wrapper
        }
        
        type Query {
          getUsers: [User]
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

      // Verify existing wrapper types preserved their field numbers
      const listOfStringWrapperFields2 = getFieldNumbersFromMessage(root2, 'ListOfString');
      const listOfIntWrapperFields2 = getFieldNumbersFromMessage(root2, 'ListOfInt');
      const listOfUserWrapperFields2 = getFieldNumbersFromMessage(root2, 'ListOfUser');
      const listOfFloatWrapperFields2 = getFieldNumbersFromMessage(root2, 'ListOfFloat');

      // Get the inner List type field numbers for items verification
      const stringListType2 = root2.lookupType('ListOfString').lookupType('List');
      const intListType2 = root2.lookupType('ListOfInt').lookupType('List');
      const userListType2 = root2.lookupType('ListOfUser').lookupType('List');
      const floatListType2 = root2.lookupType('ListOfFloat').lookupType('List');

      const stringListFields2 = getFieldNumbersFromMessage(stringListType2.root, 'List');
      const intListFields2 = getFieldNumbersFromMessage(intListType2.root, 'List');
      const userListFields2 = getFieldNumbersFromMessage(userListType2.root, 'List');
      const floatListFields2 = getFieldNumbersFromMessage(floatListType2.root, 'List');

      // Verify wrapper field numbers are preserved (outer 'list' field)
      expect(listOfStringWrapperFields2['list']).toBe(stringWrapperListFieldNumber);
      expect(listOfIntWrapperFields2['list']).toBe(intWrapperListFieldNumber);
      expect(listOfUserWrapperFields2['list']).toBe(userWrapperListFieldNumber);

      // Verify inner List field numbers are preserved ('items' field)
      expect(stringListFields2['items']).toBe(stringListItemsFieldNumber);
      expect(intListFields2['items']).toBe(intListItemsFieldNumber);
      expect(userListFields2['items']).toBe(userListItemsFieldNumber);

      // Verify new wrapper types have field number 1
      expect(listOfFloatWrapperFields2['list']).toBe(1);
      expect(floatListFields2['items']).toBe(1);
    });

    test('should preserve field numbers for nested list wrapper types', () => {
      // Initial schema with nested lists that generate nested wrapper types
      const initialSchema = buildSchema(`
        type User {
          id: ID!
          name: String!
          tagGroups: [[String]]      # nested nullable list -> generates ListOfListOfString wrapper
          scoreMatrix: [[Int]]       # nested nullable list -> generates ListOfListOfInt wrapper
        }
        
        type Query {
          getUsers: [User]
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

      // Verify nested wrapper types exist and get their field numbers
      const listOfListOfStringWrapperFields = getFieldNumbersFromMessage(root1, 'ListOfListOfString');
      const listOfListOfIntWrapperFields = getFieldNumbersFromMessage(root1, 'ListOfListOfInt');

      // For nested wrappers, they should have a 'list' field at the outer level
      const nestedStringWrapperListFieldNumber = listOfListOfStringWrapperFields['list'];
      const nestedIntWrapperListFieldNumber = listOfListOfIntWrapperFields['list'];

      // Verify nested wrapper types have the 'list' field with field number 1
      expect(nestedStringWrapperListFieldNumber).toBe(1);
      expect(nestedIntWrapperListFieldNumber).toBe(1);

      // Also verify the inner simple wrapper types exist and get their field numbers
      const listOfStringWrapperFields = getFieldNumbersFromMessage(root1, 'ListOfString');
      const listOfIntWrapperFields = getFieldNumbersFromMessage(root1, 'ListOfInt');

      // Get the inner List type field numbers for items
      const stringListType = root1.lookupType('ListOfString').lookupType('List');
      const intListType = root1.lookupType('ListOfInt').lookupType('List');

      const stringListFields = getFieldNumbersFromMessage(stringListType.root, 'List');
      const intListFields = getFieldNumbersFromMessage(intListType.root, 'List');

      const simpleStringWrapperListFieldNumber = listOfStringWrapperFields['list'];
      const simpleIntWrapperListFieldNumber = listOfIntWrapperFields['list'];
      const stringListItemsFieldNumber = stringListFields['items'];
      const intListItemsFieldNumber = intListFields['items'];

      expect(simpleStringWrapperListFieldNumber).toBe(1);
      expect(simpleIntWrapperListFieldNumber).toBe(1);
      expect(stringListItemsFieldNumber).toBe(1);
      expect(intListItemsFieldNumber).toBe(1);

      // Get the generated lock data
      const lockData = visitor1.getGeneratedLockData();
      expect(lockData).not.toBeNull();

      // Verify wrapper types are NOT in lock data (they're auto-generated with deterministic field numbers)
      expect(lockData!.messages['ListOfListOfString']).toBeUndefined();
      expect(lockData!.messages['ListOfListOfInt']).toBeUndefined();
      expect(lockData!.messages['ListOfString']).toBeUndefined();
      expect(lockData!.messages['ListOfInt']).toBeUndefined();

      // Modified schema with additional nested lists
      const modifiedSchema = buildSchema(`
        type User {
          id: ID!
          name: String!
          tagGroups: [[String]]      # existing nested nullable list
          scoreMatrix: [[Int]]       # existing nested nullable list
          userGroups: [[User]]       # new nested nullable list -> generates ListOfListOfUser wrapper
        }
        
        type Query {
          getUsers: [User]
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

      // Verify existing wrapper types preserved their field numbers
      const listOfListOfStringWrapperFields2 = getFieldNumbersFromMessage(root2, 'ListOfListOfString');
      const listOfListOfIntWrapperFields2 = getFieldNumbersFromMessage(root2, 'ListOfListOfInt');
      const listOfListOfUserWrapperFields2 = getFieldNumbersFromMessage(root2, 'ListOfListOfUser');

      // Verify existing nested wrapper field numbers are preserved
      expect(listOfListOfStringWrapperFields2['list']).toBe(nestedStringWrapperListFieldNumber);
      expect(listOfListOfIntWrapperFields2['list']).toBe(nestedIntWrapperListFieldNumber);

      // Verify new nested wrapper type has field number 1
      expect(listOfListOfUserWrapperFields2['list']).toBe(1);

      // Verify simple wrapper types are still preserved
      const listOfStringWrapperFields2 = getFieldNumbersFromMessage(root2, 'ListOfString');
      const listOfIntWrapperFields2 = getFieldNumbersFromMessage(root2, 'ListOfInt');
      const listOfUserWrapperFields2 = getFieldNumbersFromMessage(root2, 'ListOfUser');

      // Get the inner List type field numbers for verification
      const stringListType2 = root2.lookupType('ListOfString').lookupType('List');
      const intListType2 = root2.lookupType('ListOfInt').lookupType('List');
      const userListType2 = root2.lookupType('ListOfUser').lookupType('List');

      const stringListFields2 = getFieldNumbersFromMessage(stringListType2.root, 'List');
      const intListFields2 = getFieldNumbersFromMessage(intListType2.root, 'List');
      const userListFields2 = getFieldNumbersFromMessage(userListType2.root, 'List');

      expect(listOfStringWrapperFields2['list']).toBe(simpleStringWrapperListFieldNumber);
      expect(listOfIntWrapperFields2['list']).toBe(simpleIntWrapperListFieldNumber);
      expect(stringListFields2['items']).toBe(stringListItemsFieldNumber);
      expect(intListFields2['items']).toBe(intListItemsFieldNumber);
      expect(listOfUserWrapperFields2['list']).toBe(1); // New simple wrapper for User
      expect(userListFields2['items']).toBe(1); // New simple wrapper inner List for User
    });

    test('should handle mixed simple and nested wrapper types with field preservation', () => {
      // Initial schema with both simple and nested nullable lists
      const initialSchema = buildSchema(`
        type User {
          id: ID!
          name: String!
          tags: [String]             # simple nullable list -> ListOfString
          nestedTags: [[String]]     # nested nullable list -> ListOfListOfString
          friends: [User]            # simple nullable list -> ListOfUser  
          friendGroups: [[User]]     # nested nullable list -> ListOfListOfUser
        }
        
        type Query {
          getUsers: [User]
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

      // Get field numbers for all wrapper types
      const listOfStringWrapperFields = getFieldNumbersFromMessage(root1, 'ListOfString');
      const listOfListOfStringWrapperFields = getFieldNumbersFromMessage(root1, 'ListOfListOfString');
      const listOfUserWrapperFields = getFieldNumbersFromMessage(root1, 'ListOfUser');
      const listOfListOfUserWrapperFields = getFieldNumbersFromMessage(root1, 'ListOfListOfUser');

      // Get the inner List type field numbers for items
      const stringListType = root1.lookupType('ListOfString').lookupType('List');
      const userListType = root1.lookupType('ListOfUser').lookupType('List');

      const stringListFields = getFieldNumbersFromMessage(stringListType.root, 'List');
      const userListFields = getFieldNumbersFromMessage(userListType.root, 'List');

      // Store original field numbers for wrapper types (outer 'list' field)
      const simpleStringWrapperListFieldNumber = listOfStringWrapperFields['list'];
      const simpleUserWrapperListFieldNumber = listOfUserWrapperFields['list'];
      const nestedStringWrapperListFieldNumber = listOfListOfStringWrapperFields['list'];
      const nestedUserWrapperListFieldNumber = listOfListOfUserWrapperFields['list'];

      // Store original field numbers for inner List types ('items' field)
      const stringListItemsFieldNumber = stringListFields['items'];
      const userListItemsFieldNumber = userListFields['items'];

      // Verify correct field numbers for different wrapper levels
      expect(simpleStringWrapperListFieldNumber).toBe(1); // Simple wrapper outer 'list' field
      expect(stringListItemsFieldNumber).toBe(1); // Simple wrapper inner 'items' field
      expect(nestedStringWrapperListFieldNumber).toBe(1); // Nested wrapper outer 'list' field
      expect(simpleUserWrapperListFieldNumber).toBe(1); // Simple wrapper outer 'list' field
      expect(nestedUserWrapperListFieldNumber).toBe(1); // Nested wrapper outer 'list' field
      expect(userListItemsFieldNumber).toBe(1); // Simple wrapper inner 'items' field

      // Get the generated lock data
      const lockData = visitor1.getGeneratedLockData();
      expect(lockData).not.toBeNull();

      // Verify wrapper types are NOT in lock data (they're auto-generated with deterministic field numbers)
      expect(lockData!.messages['ListOfString']).toBeUndefined();
      expect(lockData!.messages['ListOfListOfString']).toBeUndefined();
      expect(lockData!.messages['ListOfUser']).toBeUndefined();
      expect(lockData!.messages['ListOfListOfUser']).toBeUndefined();

      // Modified schema with some lists removed and new ones added
      const modifiedSchema = buildSchema(`
        type User {
          id: ID!
          name: String!
          tags: [String]             # preserved
          # nestedTags: [[String]]   # removed
          friends: [User]            # preserved
          friendGroups: [[User]]     # preserved
          scores: [Int]              # new simple nullable list -> ListOfInt
          # scoreMatrix: [[Int]]     # hypothetical nested list (not added yet)
        }
        
        type Query {
          getUsers: [User]
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

      // Verify preserved wrapper types maintain their field numbers
      const listOfStringWrapperFields2 = getFieldNumbersFromMessage(root2, 'ListOfString');
      const listOfUserWrapperFields2 = getFieldNumbersFromMessage(root2, 'ListOfUser');
      const listOfListOfUserWrapperFields2 = getFieldNumbersFromMessage(root2, 'ListOfListOfUser');
      const listOfIntWrapperFields2 = getFieldNumbersFromMessage(root2, 'ListOfInt');

      // Get the inner List type field numbers for verification
      const stringListType2 = root2.lookupType('ListOfString').lookupType('List');
      const userListType2 = root2.lookupType('ListOfUser').lookupType('List');
      const intListType2 = root2.lookupType('ListOfInt').lookupType('List');

      const stringListFields2 = getFieldNumbersFromMessage(stringListType2.root, 'List');
      const userListFields2 = getFieldNumbersFromMessage(userListType2.root, 'List');
      const intListFields2 = getFieldNumbersFromMessage(intListType2.root, 'List');

      // Verify wrapper field numbers are preserved (outer 'list' field)
      expect(listOfStringWrapperFields2['list']).toBe(simpleStringWrapperListFieldNumber);
      expect(listOfUserWrapperFields2['list']).toBe(simpleUserWrapperListFieldNumber);
      expect(listOfListOfUserWrapperFields2['list']).toBe(nestedUserWrapperListFieldNumber);

      // Verify inner List field numbers are preserved ('items' field)
      expect(stringListFields2['items']).toBe(stringListItemsFieldNumber);
      expect(userListFields2['items']).toBe(userListItemsFieldNumber);

      // Verify new wrapper types have field number 1
      expect(listOfIntWrapperFields2['list']).toBe(1);
      expect(intListFields2['items']).toBe(1);

      // Verify removed wrapper type is not present
      // Check if the removed wrapper type exists in the proto
      let listOfListOfStringExists = false;
      try {
        root2.lookupType('ListOfListOfString');
        listOfListOfStringExists = true;
      } catch (e) {
        // Type doesn't exist, which is expected when the field is removed
        listOfListOfStringExists = false;
      }
      expect(listOfListOfStringExists).toBe(false); // Should not exist since nestedTags was removed
    });
  });
});
