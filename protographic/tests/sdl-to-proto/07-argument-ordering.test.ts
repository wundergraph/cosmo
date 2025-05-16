import { describe, expect, test } from 'vitest';
import { buildSchema } from 'graphql';
import { GraphQLToProtoTextVisitor } from '../../src/sdl-to-proto-visitor';
import { getEnumValuesWithNumbers, getFieldNumbersFromMessage, loadProtoFromText } from '../util';

describe('Argument Ordering and Field Numbers', () => {
  describe('Basic Argument Ordering', () => {
    test('should maintain field numbers when arguments are reordered in schema', () => {
      // Initial schema with specific argument order
      const initialSchema = buildSchema(`
        type User {
          id: ID!
          name: String!
          email: String!
        }
        
        type Query {
          searchUsers(id: ID, name: String, age: Int): [User]
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
      const searchRequestFields1 = getFieldNumbersFromMessage(root1, 'QuerySearchUsersRequest');

      // Get the generated lock data
      const lockData = visitor1.getGeneratedLockData();
      expect(lockData).not.toBeNull();

      // Modified schema with completely different argument order
      const modifiedSchema = buildSchema(`
        type User {
          id: ID!
          name: String!
          email: String!
        }
        
        type Query {
          searchUsers(
            age: Int,     # moved from 3rd to 1st
            name: String, # moved from 2nd to 2nd (unchanged)
            id: ID        # moved from 1st to 3rd
          ): [User]
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
      const searchRequestFields2 = getFieldNumbersFromMessage(root2, 'QuerySearchUsersRequest');

      // Verify that each field has the same number in both protos
      expect(Object.keys(searchRequestFields1).length).toBeGreaterThan(0);
      for (const [fieldName, fieldNumber] of Object.entries(searchRequestFields1)) {
        expect(searchRequestFields2[fieldName]).toBe(fieldNumber);
      }
    });

    test('should handle adding and removing arguments while preserving field numbers', () => {
      // Initial schema with specific arguments
      const initialSchema = buildSchema(`
        type User {
          id: ID!
          name: String!
        }
        
        type Query {
          filterUsers(
            id: ID, 
            name: String, 
            age: Int
          ): [User]
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
      const filterRequestFields1 = getFieldNumbersFromMessage(root1, 'QueryFilterUsersRequest');

      // Get the generated lock data
      const lockData = visitor1.getGeneratedLockData();
      expect(lockData).not.toBeNull();

      // Modified schema with removed and added arguments
      const modifiedSchema = buildSchema(`
        type User {
          id: ID!
          name: String!
        }
        
        type Query {
          filterUsers(
            id: ID,           # kept
            # name: String,   # removed
            age: Int,         # kept
            email: String     # added
          ): [User]
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
      const filterRequestFields2 = getFieldNumbersFromMessage(root2, 'QueryFilterUsersRequest');

      // Verify that 'id' field kept its number
      expect(filterRequestFields2['id']).toBe(filterRequestFields1['id']);

      // Verify that 'age' field kept its number
      expect(filterRequestFields2['age']).toBe(filterRequestFields1['age']);

      // Verify that 'name' field is not present anymore
      expect(filterRequestFields2['name']).toBeUndefined();

      // Verify that the new 'email' field has been added with a higher number
      const existingNumbers = Object.values(filterRequestFields1);
      expect(filterRequestFields2['email']).toBeGreaterThan(Math.max(...existingNumbers));
    });
  });

  describe('Field Re-addition', () => {
    test('should handle re-adding arguments that were previously removed', () => {
      // Initial schema with arguments
      const initialSchema = buildSchema(`
        type User {
          id: ID!
        }
        
        type Query {
          advancedSearch(
            query: String,
            limit: Int,
            offset: Int
          ): [User]
        }
      `);

      // Create the visitor with no initial lock data
      const visitor1 = new GraphQLToProtoTextVisitor(initialSchema, {
        serviceName: 'SearchService',
      });

      // Generate the first proto
      const proto1 = visitor1.visit();

      // Parse the proto with protobufjs
      const root1 = loadProtoFromText(proto1);
      const searchRequestFields1 = getFieldNumbersFromMessage(root1, 'QueryAdvancedSearchRequest');

      // Remember original field numbers
      const queryNumber = searchRequestFields1['query'];
      const limitNumber = searchRequestFields1['limit'];
      const offsetNumber = searchRequestFields1['offset'];

      // Get the generated lock data
      const lockData = visitor1.getGeneratedLockData();
      expect(lockData).not.toBeNull();

      // Modified schema with removed argument
      const modifiedSchema = buildSchema(`
        type User {
          id: ID!
        }
        
        type Query {
          advancedSearch(
            query: String,
            # limit: Int,     # removed
            offset: Int
          ): [User]
        }
      `);

      // Create another visitor using the generated lock data
      const visitor2 = new GraphQLToProtoTextVisitor(modifiedSchema, {
        serviceName: 'SearchService',
        lockData: lockData || undefined,
      });

      // Generate the second proto
      const proto2 = visitor2.visit();

      // Parse the proto to verify limit field is removed
      const root2 = loadProtoFromText(proto2);
      const searchRequestFields2 = getFieldNumbersFromMessage(root2, 'QueryAdvancedSearchRequest');
      expect(searchRequestFields2['limit']).toBeUndefined();

      // But the existing fields should maintain their numbers
      expect(searchRequestFields2['query']).toBe(queryNumber);
      expect(searchRequestFields2['offset']).toBe(offsetNumber);

      // Third schema with removed argument re-added
      const modifiedSchema2 = buildSchema(`
        type User {
          id: ID!
        }
        
        type Query {
          advancedSearch(
            query: String,
            limit: Int,      # re-added
            offset: Int,
            filterBy: String # new
          ): [User]
        }
      `);

      // Create a third visitor using the same lock data
      const visitor3 = new GraphQLToProtoTextVisitor(modifiedSchema2, {
        serviceName: 'SearchService',
        lockData: lockData || undefined,
      });

      // Generate the third proto
      const proto3 = visitor3.visit();

      // Parse the proto with protobufjs
      const root3 = loadProtoFromText(proto3);
      const searchRequestFields3 = getFieldNumbersFromMessage(root3, 'QueryAdvancedSearchRequest');

      // Verify re-added field gets a new number
      expect(searchRequestFields3['limit']).toBeDefined();

      // Verify existing fields have the same numbers
      expect(searchRequestFields3['query']).toBe(queryNumber);
      expect(searchRequestFields3['offset']).toBe(offsetNumber);

      // Verify new field has a higher number than any existing field
      const maxNumber = Math.max(queryNumber, offsetNumber);
      expect(searchRequestFields3['filter_by']).toBeGreaterThan(maxNumber);
    });

    test('should verify field numbers are preserved when fields are removed and reserved tags are added', () => {
      // Initial schema with arguments
      const initialSchema = buildSchema(`
        type User {
          id: ID!
          name: String!
        }
        
        type Query {
          findUsers(
            id: ID, 
            name: String, 
            age: Int, 
            email: String, 
            active: Boolean
          ): [User]
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
      const findRequestFields1 = getFieldNumbersFromMessage(root1, 'QueryFindUsersRequest');

      // Remember original field numbers
      const idNumber = findRequestFields1['id'];
      const nameNumber = findRequestFields1['name'];
      const ageNumber = findRequestFields1['age'];
      const emailNumber = findRequestFields1['email'];
      const activeNumber = findRequestFields1['active'];

      // Get the generated lock data
      const lockData = visitor1.getGeneratedLockData();
      expect(lockData).not.toBeNull();

      // Modified schema with some fields removed and order changed
      const modifiedSchema = buildSchema(`
        type User {
          id: ID!
          name: String!
        }
        
        type Query {
          findUsers(
            active: Boolean,  # moved from position 5 to position 1
            name: String,     # moved from position 2 to position 2 (unchanged)
            # id: ID,         # removed
            # age: Int,       # removed
            # email: String,  # removed
            status: String    # new field
          ): [User]
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
      const findRequestFields2 = getFieldNumbersFromMessage(root2, 'QueryFindUsersRequest');

      // Preserved fields should maintain their numbers despite reordering
      expect(findRequestFields2['name']).toBe(nameNumber);
      expect(findRequestFields2['active']).toBe(activeNumber);

      // Removed fields should not be present
      expect(findRequestFields2['id']).toBeUndefined();
      expect(findRequestFields2['age']).toBeUndefined();
      expect(findRequestFields2['email']).toBeUndefined();

      // New field should have a higher number than any existing field
      const maxNumber = Math.max(idNumber, nameNumber, ageNumber, emailNumber, activeNumber);
      expect(findRequestFields2['status']).toBeGreaterThan(maxNumber);

      // Check for reserved tag in the proto text
      expect(proto2).toContain('reserved');

      // Now add back a previously removed field and check it gets a new number
      const modifiedSchema3 = buildSchema(`
        type User {
          id: ID!
          name: String!
        }
        
        type Query {
          findUsers(
            active: Boolean,
            name: String,
            status: String,
            id: ID,        # re-added
            # age: Int,    # still removed
            # email: String, # still removed
            created: String # another new field
          ): [User]
        }
      `);

      // Create a third visitor using the same lock data
      const visitor3 = new GraphQLToProtoTextVisitor(modifiedSchema, {
        serviceName: 'UserService',
        lockData: lockData || undefined,
      });

      // Generate the third proto
      const proto3 = visitor3.visit();

      // Parse the proto with protobufjs
      const root3 = loadProtoFromText(proto3);
      const findRequestFields3 = getFieldNumbersFromMessage(root3, 'QueryFindUsersRequest');

      // Check that existing fields still maintain their numbers
      expect(findRequestFields3['name']).toBe(nameNumber);
      expect(findRequestFields3['active']).toBe(activeNumber);

      // The status field from the second version should still have its number
      expect(findRequestFields3['status']).toBe(findRequestFields2['status']);
    });
  });

  describe('Complex Input Arguments', () => {
    test('should handle complex input object arguments', () => {
      // Initial schema with complex input object
      const initialSchema = buildSchema(`
        type Product {
          id: ID!
          name: String!
        }
        
        input FilterOptions {
          minPrice: Float
          maxPrice: Float
          category: String
        }
        
        type Query {
          searchProducts(filter: FilterOptions): [Product]
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
      const searchRequestFields1 = getFieldNumbersFromMessage(root1, 'QuerySearchProductsRequest');
      const filterOptionsFields1 = getFieldNumbersFromMessage(root1, 'FilterOptions');

      // Remember original field numbers
      const filterNumber = searchRequestFields1['filter'];
      const minPriceNumber = filterOptionsFields1['min_price'];
      const maxPriceNumber = filterOptionsFields1['max_price'];
      const categoryNumber = filterOptionsFields1['category'];

      // Get the generated lock data
      const lockData = visitor1.getGeneratedLockData();
      expect(lockData).not.toBeNull();

      // Modified schema with changes to input object fields
      const modifiedSchema = buildSchema(`
        type Product {
          id: ID!
          name: String!
        }
        
        input FilterOptions {
          maxPrice: Float      # reordered
          # minPrice: Float    # removed
          category: String     # kept same position
          inStock: Boolean     # added
        }
        
        type Query {
          searchProducts(filter: FilterOptions): [Product]
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
      const searchRequestFields2 = getFieldNumbersFromMessage(root2, 'QuerySearchProductsRequest');
      const filterOptionsFields2 = getFieldNumbersFromMessage(root2, 'FilterOptions');

      // Verify argument field number is preserved in request
      expect(searchRequestFields2['filter']).toBe(filterNumber);

      // Verify input object field numbers are preserved
      expect(filterOptionsFields2['max_price']).toBe(maxPriceNumber);
      expect(filterOptionsFields2['category']).toBe(categoryNumber);

      // Verify removed field is gone
      expect(filterOptionsFields2['min_price']).toBeUndefined();

      // Verify new field has a higher number than existing fields
      const maxFieldNumber = Math.max(maxPriceNumber, categoryNumber);
      expect(filterOptionsFields2['in_stock']).toBeGreaterThan(maxFieldNumber);
    });

    test('should handle nested input object arguments', () => {
      // Initial schema with nested input objects
      const initialSchema = buildSchema(`
        type Product {
          id: ID!
          name: String!
        }
        
        input PaginationOptions {
          page: Int
          perPage: Int
        }
        
        input SortOptions {
          field: String
          direction: String
        }
        
        input SearchOptions {
          query: String
          pagination: PaginationOptions
          sort: SortOptions
        }
        
        type Query {
          searchProducts(options: SearchOptions): [Product]
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
      const searchRequestFields1 = getFieldNumbersFromMessage(root1, 'QuerySearchProductsRequest');
      const searchOptionsFields1 = getFieldNumbersFromMessage(root1, 'SearchOptions');
      const paginationOptionsFields1 = getFieldNumbersFromMessage(root1, 'PaginationOptions');
      const sortOptionsFields1 = getFieldNumbersFromMessage(root1, 'SortOptions');

      // Remember original field numbers
      const optionsNumber = searchRequestFields1['options'];
      const queryNumber = searchOptionsFields1['query'];
      const paginationNumber = searchOptionsFields1['pagination'];
      const sortNumber = searchOptionsFields1['sort'];
      const pageNumber = paginationOptionsFields1['page'];
      const perPageNumber = paginationOptionsFields1['per_page'];
      const fieldNumber = sortOptionsFields1['field'];
      const directionNumber = sortOptionsFields1['direction'];

      // Get the generated lock data
      const lockData = visitor1.getGeneratedLockData();
      expect(lockData).not.toBeNull();

      // Modified schema with changes to nested input objects
      const modifiedSchema = buildSchema(`
        type Product {
          id: ID!
          name: String!
        }
        
        input PaginationOptions {
          perPage: Int      # reordered
          page: Int         # reordered
          offset: Int       # added
        }
        
        input SortOptions {
          # field: String   # removed
          direction: String
          order: Int        # added
        }
        
        input SearchOptions {
          query: String
          filters: [String] # added
          pagination: PaginationOptions
          sort: SortOptions
        }
        
        type Query {
          searchProducts(options: SearchOptions): [Product]
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
      const searchRequestFields2 = getFieldNumbersFromMessage(root2, 'QuerySearchProductsRequest');
      const searchOptionsFields2 = getFieldNumbersFromMessage(root2, 'SearchOptions');
      const paginationOptionsFields2 = getFieldNumbersFromMessage(root2, 'PaginationOptions');
      const sortOptionsFields2 = getFieldNumbersFromMessage(root2, 'SortOptions');

      // Verify all field numbers are preserved at each level
      // 1. Top-level request
      expect(searchRequestFields2['options']).toBe(optionsNumber);

      // 2. SearchOptions
      expect(searchOptionsFields2['query']).toBe(queryNumber);
      expect(searchOptionsFields2['pagination']).toBe(paginationNumber);
      expect(searchOptionsFields2['sort']).toBe(sortNumber);
      expect(searchOptionsFields2['filters']).toBeGreaterThan(Math.max(queryNumber, paginationNumber, sortNumber));

      // 3. PaginationOptions
      expect(paginationOptionsFields2['page']).toBe(pageNumber);
      expect(paginationOptionsFields2['per_page']).toBe(perPageNumber);
      expect(paginationOptionsFields2['offset']).toBeGreaterThan(Math.max(pageNumber, perPageNumber));

      // 4. SortOptions
      expect(sortOptionsFields2['field']).toBeUndefined(); // Removed field
      expect(sortOptionsFields2['direction']).toBe(directionNumber);
      expect(sortOptionsFields2['order']).toBeGreaterThan(directionNumber);
    });
  });

  describe('Enum Argument Values', () => {
    test('should maintain enum value numbers when used as arguments', () => {
      // Initial schema with enum argument
      const initialSchema = buildSchema(`
        enum SortDirection {
          ASC
          DESC
          NEUTRAL
        }
        
        type Product {
          id: ID!
          name: String!
        }
        
        type Query {
          getProducts(sortDirection: SortDirection): [Product]
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
      const enumValues1 = getEnumValuesWithNumbers(root1, 'SortDirection');

      // Remember original enum values numbers
      const ascNumber = enumValues1['SORT_DIRECTION_ASC'];
      const descNumber = enumValues1['SORT_DIRECTION_DESC'];
      const neutralNumber = enumValues1['SORT_DIRECTION_NEUTRAL'];

      // Get the generated lock data
      const lockData = visitor1.getGeneratedLockData();
      expect(lockData).not.toBeNull();

      // Modified schema with reordered enum values and one removed
      const modifiedSchema = buildSchema(`
        enum SortDirection {
          DESC      # Reordered
          # NEUTRAL # Removed
          ASC       # Reordered
        }
        
        type Product {
          id: ID!
          name: String!
        }
        
        type Query {
          getProducts(sortDirection: SortDirection): [Product]
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
      const enumValues2 = getEnumValuesWithNumbers(root2, 'SortDirection');

      // Verify that existing enum values keep their numbers
      expect(enumValues2['SORT_DIRECTION_ASC']).toBe(ascNumber);
      expect(enumValues2['SORT_DIRECTION_DESC']).toBe(descNumber);

      // Verify that the deleted enum value is not present
      expect(enumValues2['SORT_DIRECTION_NEUTRAL']).toBeUndefined();

      // Get updated lock data with the NEUTRAL value removed
      const lockData2 = visitor2.getGeneratedLockData();

      // Verify that NEUTRAL's number is now in the reserved list
      expect(lockData2!.enums['SortDirection'].reservedNumbers).toContain(neutralNumber);

      // Third schema with removed value re-added and a new value added
      const modifiedSchema2 = buildSchema(`
        enum SortDirection {
          DESC
          ASC
          NEUTRAL     # Re-added
          RANDOM      # New value
        }
        
        type Product {
          id: ID!
          name: String!
        }
        
        type Query {
          getProducts(sortDirection: SortDirection): [Product]
        }
      `);

      // Create a third visitor using the lock data from visitor2
      const visitor3 = new GraphQLToProtoTextVisitor(modifiedSchema2, {
        serviceName: 'ProductService',
        lockData: lockData2 || undefined,
      });

      // Generate the third proto
      const proto3 = visitor3.visit();

      // Parse the proto with protobufjs
      const root3 = loadProtoFromText(proto3);
      const enumValues3 = getEnumValuesWithNumbers(root3, 'SortDirection');

      // Verify that all original enum values keep their numbers
      expect(enumValues3['SORT_DIRECTION_ASC']).toBe(ascNumber);
      expect(enumValues3['SORT_DIRECTION_DESC']).toBe(descNumber);

      // The NEUTRAL value gets a new number since the original enum value was actually removed
      // from the lock data, not just marked as reserved
      const neutralValue = enumValues3['SORT_DIRECTION_NEUTRAL'];
      expect(neutralValue).toBeGreaterThan(Math.max(ascNumber, descNumber));

      // Verify that new enum value has a higher number than all others
      const maxEnumNumber = Math.max(ascNumber, descNumber, neutralValue);
      expect(enumValues3['SORT_DIRECTION_RANDOM']).toBeGreaterThan(maxEnumNumber);
    });
  });

  describe('Mutation Arguments', () => {
    test('should handle mutation arguments with complex input types', () => {
      // Initial schema with mutation containing complex input
      const initialSchema = buildSchema(`
        type User {
          id: ID!
          name: String!
          email: String!
        }
        
        input UserInput {
          name: String!
          email: String!
          age: Int
        }
        
        type Mutation {
          createUser(input: UserInput!): User
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
      const mutationFields1 = getFieldNumbersFromMessage(root1, 'MutationCreateUserRequest');
      const userInputFields1 = getFieldNumbersFromMessage(root1, 'UserInput');

      // Remember original field numbers
      const inputNumber = mutationFields1['input'];
      const nameNumber = userInputFields1['name'];
      const emailNumber = userInputFields1['email'];
      const ageNumber = userInputFields1['age'];

      // Get the generated lock data
      const lockData = visitor1.getGeneratedLockData();
      expect(lockData).not.toBeNull();

      // Modified schema with changes to input type
      const modifiedSchema = buildSchema(`
        type User {
          id: ID!
          name: String!
          email: String!
        }
        
        input UserInput {
          email: String!     # reordered
          # age: Int        # removed
          name: String!      # reordered
          active: Boolean    # added
        }
        
        type Mutation {
          createUser(input: UserInput!): User
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
      const mutationFields2 = getFieldNumbersFromMessage(root2, 'MutationCreateUserRequest');
      const userInputFields2 = getFieldNumbersFromMessage(root2, 'UserInput');

      // Verify that field numbers are preserved
      expect(mutationFields2['input']).toBe(inputNumber);
      expect(userInputFields2['name']).toBe(nameNumber);
      expect(userInputFields2['email']).toBe(emailNumber);

      // Verify that the removed field is not present
      expect(userInputFields2['age']).toBeUndefined();

      // Verify that the new field has a higher number
      const maxFieldNumber = Math.max(nameNumber, emailNumber, ageNumber || 0);
      expect(userInputFields2['active']).toBeGreaterThan(maxFieldNumber);
    });

    test('should handle multiple mutations with different argument sets', () => {
      // Initial schema with multiple mutations
      const initialSchema = buildSchema(`
        type User {
          id: ID!
          name: String!
        }
        
        input CreateUserInput {
          name: String!
          email: String!
        }
        
        input UpdateUserInput {
          id: ID!
          name: String
          email: String
        }
        
        type Mutation {
          createUser(input: CreateUserInput!): User
          updateUser(input: UpdateUserInput!): User
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
      const createFields1 = getFieldNumbersFromMessage(root1, 'MutationCreateUserRequest');
      const updateFields1 = getFieldNumbersFromMessage(root1, 'MutationUpdateUserRequest');
      const createInputFields1 = getFieldNumbersFromMessage(root1, 'CreateUserInput');
      const updateInputFields1 = getFieldNumbersFromMessage(root1, 'UpdateUserInput');

      // Remember original field numbers
      const createInputNumber = createFields1['input'];
      const updateInputNumber = updateFields1['input'];

      const createNameNumber = createInputFields1['name'];
      const createEmailNumber = createInputFields1['email'];

      const updateIdNumber = updateInputFields1['id'];
      const updateNameNumber = updateInputFields1['name'];
      const updateEmailNumber = updateInputFields1['email'];

      // Get the generated lock data
      const lockData = visitor1.getGeneratedLockData();
      expect(lockData).not.toBeNull();

      // Modified schema with changes to both mutations and inputs
      const modifiedSchema = buildSchema(`
        type User {
          id: ID!
          name: String!
        }
        
        input CreateUserInput {
          email: String!      # reordered
          name: String!       # reordered
          role: String        # added
        }
        
        input UpdateUserInput {
          id: ID!             # same position
          # name: String      # removed
          email: String       # same position
          active: Boolean     # added
        }
        
        type Mutation {
          createUser(input: CreateUserInput!): User
          updateUser(input: UpdateUserInput!): User
          deleteUser(id: ID!): Boolean           # new mutation
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
      const createFields2 = getFieldNumbersFromMessage(root2, 'MutationCreateUserRequest');
      const updateFields2 = getFieldNumbersFromMessage(root2, 'MutationUpdateUserRequest');
      const deleteFields = getFieldNumbersFromMessage(root2, 'MutationDeleteUserRequest');
      const createInputFields2 = getFieldNumbersFromMessage(root2, 'CreateUserInput');
      const updateInputFields2 = getFieldNumbersFromMessage(root2, 'UpdateUserInput');

      // Verify that all field numbers are preserved at top level
      expect(createFields2['input']).toBe(createInputNumber);
      expect(updateFields2['input']).toBe(updateInputNumber);

      // Verify that field numbers in CreateUserInput are preserved
      expect(createInputFields2['name']).toBe(createNameNumber);
      expect(createInputFields2['email']).toBe(createEmailNumber);
      expect(createInputFields2['role']).toBeGreaterThan(Math.max(createNameNumber, createEmailNumber));

      // Verify that field numbers in UpdateUserInput are preserved
      expect(updateInputFields2['id']).toBe(updateIdNumber);
      expect(updateInputFields2['name']).toBeUndefined(); // removed
      expect(updateInputFields2['email']).toBe(updateEmailNumber);
      expect(updateInputFields2['active']).toBeGreaterThan(Math.max(updateIdNumber, updateEmailNumber));

      // Verify new mutation has a field
      expect(deleteFields['id']).toBeDefined();
    });
  });

  describe('Multiple Complex Input Arguments', () => {
    test('should handle operations with multiple complex input arguments with field modifications', () => {
      // Initial schema with multiple complex input types as arguments
      const initialSchema = buildSchema(`
        type Product {
          id: ID!
          name: String!
        }
        
        input FilterOptions {
          category: String
          minPrice: Float
          maxPrice: Float
          inStock: Boolean
        }
        
        input PaginationOptions {
          page: Int
          perPage: Int
          offset: Int
        }
        
        input SortOptions {
          field: String
          direction: String
          priority: Int
        }
        
        type Query {
          complexSearch(
            filter: FilterOptions,
            pagination: PaginationOptions,
            sort: SortOptions
          ): [Product]
        }
      `);

      // Create the visitor with no initial lock data
      const visitor1 = new GraphQLToProtoTextVisitor(initialSchema, {
        serviceName: 'SearchService',
      });

      // Generate the first proto
      const proto1 = visitor1.visit();

      // Parse the proto with protobufjs
      const root1 = loadProtoFromText(proto1);

      // Get request field numbers
      const searchRequestFields1 = getFieldNumbersFromMessage(root1, 'QueryComplexSearchRequest');

      // Get input type field numbers
      const filterOptionsFields1 = getFieldNumbersFromMessage(root1, 'FilterOptions');
      const paginationOptionsFields1 = getFieldNumbersFromMessage(root1, 'PaginationOptions');
      const sortOptionsFields1 = getFieldNumbersFromMessage(root1, 'SortOptions');

      // Remember top-level argument field numbers
      const filterNumber = searchRequestFields1['filter'];
      const paginationNumber = searchRequestFields1['pagination'];
      const sortNumber = searchRequestFields1['sort'];

      // Remember original field numbers for all input types
      const categoryNumber = filterOptionsFields1['category'];
      const minPriceNumber = filterOptionsFields1['min_price'];
      const maxPriceNumber = filterOptionsFields1['max_price'];
      const inStockNumber = filterOptionsFields1['in_stock'];

      const pageNumber = paginationOptionsFields1['page'];
      const perPageNumber = paginationOptionsFields1['per_page'];
      const offsetNumber = paginationOptionsFields1['offset'];

      const fieldNumber = sortOptionsFields1['field'];
      const directionNumber = sortOptionsFields1['direction'];
      const priorityNumber = sortOptionsFields1['priority'];

      // Get the generated lock data
      const lockData = visitor1.getGeneratedLockData();
      expect(lockData).not.toBeNull();

      // Modified schema with various changes to the input types:
      // 1. Removed fields
      // 2. Added new fields
      // 3. Reordered fields
      // 4. Moved a field from one input to another
      const modifiedSchema = buildSchema(`
        type Product {
          id: ID!
          name: String!
        }
        
        input FilterOptions {
          maxPrice: Float           # reordered
          # minPrice: Float         # removed
          # inStock: Boolean        # removed
          category: String          # unchanged
          brand: String             # added
          priority: Int             # moved from SortOptions
        }
        
        input PaginationOptions {
          perPage: Int              # reordered
          # offset: Int             # removed
          page: Int                 # reordered
          totalCount: Boolean       # added
        }
        
        input SortOptions {
          # priority: Int           # moved to FilterOptions
          direction: String         # unchanged
          # field: String           # removed
          ascending: Boolean        # added
          inStock: Boolean          # moved from FilterOptions
        }
        
        type Query {
          complexSearch(
            pagination: PaginationOptions,  # reordered
            sort: SortOptions,              # reordered
            filter: FilterOptions,          # reordered
            additionalFilter: FilterOptions # new argument
          ): [Product]
        }
      `);

      // Create another visitor using the generated lock data
      const visitor2 = new GraphQLToProtoTextVisitor(modifiedSchema, {
        serviceName: 'SearchService',
        lockData: lockData || undefined,
      });

      // Generate the second proto
      const proto2 = visitor2.visit();

      // Parse the proto with protobufjs
      const root2 = loadProtoFromText(proto2);

      // Get request field numbers from modified proto
      const searchRequestFields2 = getFieldNumbersFromMessage(root2, 'QueryComplexSearchRequest');

      // Get input type field numbers from modified proto
      const filterOptionsFields2 = getFieldNumbersFromMessage(root2, 'FilterOptions');
      const paginationOptionsFields2 = getFieldNumbersFromMessage(root2, 'PaginationOptions');
      const sortOptionsFields2 = getFieldNumbersFromMessage(root2, 'SortOptions');

      // Verify that top-level argument field numbers are preserved despite reordering
      expect(searchRequestFields2['filter']).toBe(filterNumber);
      expect(searchRequestFields2['pagination']).toBe(paginationNumber);
      expect(searchRequestFields2['sort']).toBe(sortNumber);

      // Verify that new top-level argument gets a higher number
      const maxTopLevelNumber = Math.max(filterNumber, paginationNumber, sortNumber);
      expect(searchRequestFields2['additional_filter']).toBeGreaterThan(maxTopLevelNumber);

      // Verify FilterOptions field numbers
      expect(filterOptionsFields2['category']).toBe(categoryNumber);
      expect(filterOptionsFields2['max_price']).toBe(maxPriceNumber);
      expect(filterOptionsFields2['min_price']).toBeUndefined(); // Removed
      expect(filterOptionsFields2['in_stock']).toBeUndefined(); // Removed

      // New field should have higher number
      const maxFilterNumber = Math.max(categoryNumber, maxPriceNumber, minPriceNumber, inStockNumber);
      expect(filterOptionsFields2['brand']).toBeGreaterThan(maxFilterNumber);

      // Moved field should have a new field number in the new input type
      expect(filterOptionsFields2['priority']).toBeGreaterThan(maxFilterNumber);

      // Verify PaginationOptions field numbers
      expect(paginationOptionsFields2['page']).toBe(pageNumber);
      expect(paginationOptionsFields2['per_page']).toBe(perPageNumber);
      expect(paginationOptionsFields2['offset']).toBeUndefined(); // Removed

      // New field should have higher number
      const maxPaginationNumber = Math.max(pageNumber, perPageNumber, offsetNumber);
      expect(paginationOptionsFields2['total_count']).toBeGreaterThan(maxPaginationNumber);

      // Verify SortOptions field numbers
      expect(sortOptionsFields2['direction']).toBe(directionNumber);
      expect(sortOptionsFields2['field']).toBeUndefined(); // Removed
      expect(sortOptionsFields2['priority']).toBeUndefined(); // Moved

      // New field should have higher number
      const maxSortNumber = Math.max(fieldNumber, directionNumber, priorityNumber);
      expect(sortOptionsFields2['ascending']).toBeGreaterThan(maxSortNumber);

      // Moved field should have a new field number in the new input type
      expect(sortOptionsFields2['in_stock']).toBeGreaterThan(maxSortNumber);
    });
  });
});
