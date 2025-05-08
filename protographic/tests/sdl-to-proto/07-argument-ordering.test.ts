import { describe, expect, test } from 'vitest';
import { buildSchema } from 'graphql';
import { GraphQLToProtoTextVisitor } from '../../src/sdl-to-proto-visitor';
import { ProtoLockManager } from '../../src/proto-lock';
import { getFieldNumbersFromMessage, loadProtoFromText, getEnumValuesWithNumbers } from '../util';

describe('Argument Ordering and Field Numbers', () => {
  describe('Schema Integration', () => {
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
  
    test('should preserve field numbers when arguments are removed and later re-added', () => {
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
  
      // Verify re-added field has the same number
      expect(searchRequestFields3['limit']).toBe(limitNumber);
      
      // Verify existing fields have the same numbers
      expect(searchRequestFields3['query']).toBe(queryNumber);
      expect(searchRequestFields3['offset']).toBe(offsetNumber);
  
      // Verify new field has a higher number
      expect(searchRequestFields3['filter_by']).toBeGreaterThan(
        Math.max(queryNumber, limitNumber, offsetNumber)
      );
    });
    
    test('should handle multiple complex input arguments being removed and re-added', () => {
      // Initial schema with multiple complex input types
      const initialSchema = buildSchema(`
        type Product {
          id: ID!
          name: String!
          price: Float!
        }
        
        input FilterInput {
          minPrice: Float
          maxPrice: Float
          categories: [String]
          inStock: Boolean
        }
        
        input SortInput {
          field: String
          direction: String
          nullsFirst: Boolean
        }
        
        input PaginationInput {
          offset: Int
          limit: Int
        }
        
        type Query {
          searchProducts(
            query: String,
            filter: FilterInput,
            sort: SortInput,
            pagination: PaginationInput
          ): [Product]
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
      
      // Get field numbers for request message and all input type messages
      const searchRequestFields1 = getFieldNumbersFromMessage(root1, 'QuerySearchProductsRequest');
      const filterInputFields1 = getFieldNumbersFromMessage(root1, 'FilterInput');
      const sortInputFields1 = getFieldNumbersFromMessage(root1, 'SortInput');
      const paginationInputFields1 = getFieldNumbersFromMessage(root1, 'PaginationInput');
      
      // Verify all input fields exist in request with field numbers
      const queryFieldNumber = searchRequestFields1['query'];
      const filterFieldNumber = searchRequestFields1['filter'];
      const sortFieldNumber = searchRequestFields1['sort'];
      const paginationFieldNumber = searchRequestFields1['pagination'];
      
      expect(queryFieldNumber).toBeDefined();
      expect(filterFieldNumber).toBeDefined();
      expect(sortFieldNumber).toBeDefined();
      expect(paginationFieldNumber).toBeDefined();
      
      // Get the generated lock data
      const lockData = visitor1.getGeneratedLockData();
      expect(lockData).not.toBeNull();
  
      // Modified schema with some input types removed, others modified
      const modifiedSchema = buildSchema(`
        type Product {
          id: ID!
          name: String!
          price: Float!
        }
        
        input FilterInput {
          minPrice: Float
          maxPrice: Float
          # categories removed
          inStock: Boolean
          brand: String  # added
        }
        
        # SortInput completely removed
        
        input PaginationInput {
          # offset removed
          limit: Int
          page: Int  # added
        }
        
        type Query {
          searchProducts(
            query: String,
            filter: FilterInput,
            # sort removed
            pagination: PaginationInput,
            includeOutOfStock: Boolean  # simple arg added
          ): [Product]
        }
      `);
  
      // Create another visitor using the generated lock data
      const visitor2 = new GraphQLToProtoTextVisitor(modifiedSchema, {
        serviceName: 'ProductService',
        lockData: lockData || undefined,
      });
  
      // Generate the second proto
      const proto2 = visitor2.visit();
      
      // Third schema with removed input type re-added and others modified again
      const modifiedSchema2 = buildSchema(`
        type Product {
          id: ID!
          name: String!
          price: Float!
        }
        
        input FilterInput {
          minPrice: Float
          maxPrice: Float
          categories: [String]  # re-added
          inStock: Boolean
          brand: String  # kept from last change
          tags: [String]  # newly added
        }
        
        input SortInput {  # completely re-added with changes
          field: String
          direction: String
          # nullsFirst removed
          caseSensitive: Boolean  # added
        }
        
        input PaginationInput {
          offset: Int  # re-added
          limit: Int
          page: Int  # kept from last change
        }
        
        # Added a completely new input type
        input HighlightInput {
          enabled: Boolean
          fields: [String]
        }
        
        type Query {
          searchProducts(
            query: String,
            filter: FilterInput,
            sort: SortInput,  # re-added
            pagination: PaginationInput,
            includeOutOfStock: Boolean,  # kept from last change
            highlight: HighlightInput  # newly added complex type
          ): [Product]
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
      
      // Get field numbers for request message and all input types
      const searchRequestFields3 = getFieldNumbersFromMessage(root3, 'QuerySearchProductsRequest');
      const filterInputFields3 = getFieldNumbersFromMessage(root3, 'FilterInput');
      const sortInputFields3 = getFieldNumbersFromMessage(root3, 'SortInput');
      const paginationInputFields3 = getFieldNumbersFromMessage(root3, 'PaginationInput');
      
      // 1. Verify fields in the request message
      // Existing fields should keep their original numbers
      expect(searchRequestFields3['query']).toBe(queryFieldNumber);
      expect(searchRequestFields3['filter']).toBe(filterFieldNumber);
      expect(searchRequestFields3['sort']).toBe(sortFieldNumber);
      expect(searchRequestFields3['pagination']).toBe(paginationFieldNumber);
      
      // New fields should have higher numbers
      const maxRequestFieldNumber = Math.max(
        queryFieldNumber, 
        filterFieldNumber, 
        sortFieldNumber, 
        paginationFieldNumber
      );
      expect(searchRequestFields3['include_out_of_stock']).toBeGreaterThan(maxRequestFieldNumber);
      expect(searchRequestFields3['highlight']).toBeGreaterThan(maxRequestFieldNumber);
      
      // 2. Verify fields in FilterInput
      // Re-added field should keep its original number
      expect(filterInputFields3['categories']).toBe(filterInputFields1['categories']);
      
      // Fields that stayed throughout should keep numbers
      expect(filterInputFields3['min_price']).toBe(filterInputFields1['min_price']);
      expect(filterInputFields3['max_price']).toBe(filterInputFields1['max_price']);
      expect(filterInputFields3['in_stock']).toBe(filterInputFields1['in_stock']);
      
      // New fields should have higher numbers
      const maxFilterFieldNumber = Math.max(
        filterInputFields1['min_price'],
        filterInputFields1['max_price'],
        filterInputFields1['categories'],
        filterInputFields1['in_stock']
      );
      expect(filterInputFields3['brand']).toBeGreaterThan(maxFilterFieldNumber);
      expect(filterInputFields3['tags']).toBeGreaterThan(maxFilterFieldNumber);
      
      // 3. Verify fields in SortInput
      // Fields from original SortInput should keep their numbers
      expect(sortInputFields3['field']).toBe(sortInputFields1['field']);
      expect(sortInputFields3['direction']).toBe(sortInputFields1['direction']);
      
      // New fields should have higher numbers
      const maxSortFieldNumber = Math.max(
        sortInputFields1['field'],
        sortInputFields1['direction'],
        sortInputFields1['nulls_first'] || 0
      );
      expect(sortInputFields3['case_sensitive']).toBeGreaterThan(maxSortFieldNumber);
      
      // 4. Verify fields in PaginationInput
      // Re-added field should keep its original number
      expect(paginationInputFields3['offset']).toBe(paginationInputFields1['offset']);
      
      // Field that stayed should keep number
      expect(paginationInputFields3['limit']).toBe(paginationInputFields1['limit']);
      
      // New field should have higher number
      const maxPaginationFieldNumber = Math.max(
        paginationInputFields1['offset'],
        paginationInputFields1['limit']
      );
      expect(paginationInputFields3['page']).toBeGreaterThan(maxPaginationFieldNumber);
    });
    
    test('should preserve field numbers for mutations with complex inputs', () => {
      // Initial schema with mutation and complex input types
      const initialSchema = buildSchema(`
        type Product {
          id: ID!
          name: String!
          price: Float!
          inventory: Int!
        }
        
        input ProductInput {
          name: String!
          price: Float!
          description: String
          inventory: Int
        }
        
        input CategoryAssignmentInput {
          categoryIds: [ID!]!
          primary: Boolean
        }
        
        type Mutation {
          createProduct(
            input: ProductInput!,
            categories: CategoryAssignmentInput
          ): Product
          
          updateProductInventory(
            id: ID!,
            quantity: Int!,
            location: String,
            notes: String
          ): Product
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
      
      // Get field numbers for mutation request messages and input types
      const createProductFields1 = getFieldNumbersFromMessage(root1, 'MutationCreateProductRequest');
      const updateInventoryFields1 = getFieldNumbersFromMessage(root1, 'MutationUpdateProductInventoryRequest');
      const productInputFields1 = getFieldNumbersFromMessage(root1, 'ProductInput');
      const categoryInputFields1 = getFieldNumbersFromMessage(root1, 'CategoryAssignmentInput');
      
      // Save initial field numbers for later comparison
      const createInputFieldNumber = createProductFields1['input'];
      const createCategoriesFieldNumber = createProductFields1['categories'];
      const updateIdFieldNumber = updateInventoryFields1['id'];
      const updateQuantityFieldNumber = updateInventoryFields1['quantity'];
      const updateLocationFieldNumber = updateInventoryFields1['location'];
      const updateNotesFieldNumber = updateInventoryFields1['notes'];
      
      // Verify all required fields exist with numbers
      expect(createInputFieldNumber).toBeDefined();
      expect(createCategoriesFieldNumber).toBeDefined();
      expect(updateIdFieldNumber).toBeDefined();
      expect(updateQuantityFieldNumber).toBeDefined();
      
      // Get the generated lock data
      const lockData = visitor1.getGeneratedLockData();
      expect(lockData).not.toBeNull();
  
      // Modified schema with changes to mutations and input types
      const modifiedSchema = buildSchema(`
        type Product {
          id: ID!
          name: String!
          price: Float!
          inventory: Int!
        }
        
        input ProductInput {
          name: String!
          price: Float!
          description: String
          inventory: Int
          tags: [String]  # Added field
        }
        
        # CategoryAssignmentInput removed
        
        input InventoryUpdateInput {  # New input type
          quantity: Int!
          location: String
          reason: String
        }
        
        type Mutation {
          createProduct(
            input: ProductInput!
            # categories removed
            metadata: String  # Added simple field
          ): Product
          
          updateProductInventory(
            id: ID!,
            # quantity removed as direct arg 
            # location removed
            inventory: InventoryUpdateInput,  # Added complex input replacing fields
            notes: String
          ): Product
        }
      `);
  
      // Create another visitor using the generated lock data
      const visitor2 = new GraphQLToProtoTextVisitor(modifiedSchema, {
        serviceName: 'ProductService',
        lockData: lockData || undefined,
      });
  
      // Generate the second proto
      const proto2 = visitor2.visit();
      
      // Third schema with restoration of some removed elements
      const modifiedSchema2 = buildSchema(`
        type Product {
          id: ID!
          name: String!
          price: Float!
          inventory: Int!
        }
        
        input ProductInput {
          name: String!
          price: Float!
          description: String
          inventory: Int
          tags: [String]  # Kept from last change
          images: [String]  # Added new field
        }
        
        input CategoryAssignmentInput {  # Re-added with changes
          categoryIds: [ID!]!
          primary: Boolean
          featured: Boolean  # Added field
        }
        
        input InventoryUpdateInput {  
          quantity: Int!
          location: String
          reason: String
          batchId: String  # Added field
        }
        
        type Mutation {
          createProduct(
            input: ProductInput!,
            categories: CategoryAssignmentInput,  # Re-added
            metadata: String  # Kept from last change
          ): Product
          
          updateProductInventory(
            id: ID!,
            inventory: InventoryUpdateInput,
            notes: String,
            location: String  # Re-added as direct field
          ): Product
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
      
      // Get field numbers for mutation request messages and input types
      const createProductFields3 = getFieldNumbersFromMessage(root3, 'MutationCreateProductRequest');
      const updateInventoryFields3 = getFieldNumbersFromMessage(root3, 'MutationUpdateProductInventoryRequest');
      const productInputFields3 = getFieldNumbersFromMessage(root3, 'ProductInput');
      const categoryInputFields3 = getFieldNumbersFromMessage(root3, 'CategoryAssignmentInput');
      
      // 1. Verify field numbers in create product mutation
      // Original fields should keep their numbers
      expect(createProductFields3['input']).toBe(createInputFieldNumber);
      expect(createProductFields3['categories']).toBe(createCategoriesFieldNumber);
      
      // New fields should have higher numbers
      const maxCreateFieldNumber = Math.max(createInputFieldNumber, createCategoriesFieldNumber);
      expect(createProductFields3['metadata']).toBeGreaterThan(maxCreateFieldNumber);
      
      // 2. Verify field numbers in update inventory mutation
      // Original fields should keep their numbers
      expect(updateInventoryFields3['id']).toBe(updateIdFieldNumber);
      expect(updateInventoryFields3['notes']).toBe(updateNotesFieldNumber);
      expect(updateInventoryFields3['location']).toBe(updateLocationFieldNumber);
      
      // New fields should have higher numbers
      const maxUpdateFieldNumber = Math.max(
        updateIdFieldNumber,
        updateQuantityFieldNumber,
        updateLocationFieldNumber,
        updateNotesFieldNumber
      );
      expect(updateInventoryFields3['inventory']).toBeGreaterThan(maxUpdateFieldNumber);
      
      // 3. Verify fields in re-added CategoryAssignmentInput
      // Re-added fields should keep original numbers
      expect(categoryInputFields3['category_ids']).toBe(categoryInputFields1['category_ids']);
      expect(categoryInputFields3['primary']).toBe(categoryInputFields1['primary']);
      
      // New fields should have higher numbers
      const maxCategoryFieldNumber = Math.max(
        categoryInputFields1['category_ids'],
        categoryInputFields1['primary']
      );
      expect(categoryInputFields3['featured']).toBeGreaterThan(maxCategoryFieldNumber);
      
      // 4. Verify product input fields
      // Original fields should keep numbers
      expect(productInputFields3['name']).toBe(productInputFields1['name']);
      expect(productInputFields3['price']).toBe(productInputFields1['price']);
      expect(productInputFields3['description']).toBe(productInputFields1['description']);
      expect(productInputFields3['inventory']).toBe(productInputFields1['inventory']);
      
      // New fields should have higher numbers
      const maxProductFieldNumber = Math.max(
        productInputFields1['name'],
        productInputFields1['price'],
        productInputFields1['description'],
        productInputFields1['inventory']
      );
      expect(productInputFields3['tags']).toBeGreaterThan(maxProductFieldNumber);
      expect(productInputFields3['images']).toBeGreaterThan(maxProductFieldNumber);
    });

    test('should maintain field numbers when enum argument values are reordered or deleted', () => {
      // Initial schema with an enum argument
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
      
      // Get field numbers for the enum values
      const enumFields1 = getEnumValuesWithNumbers(root1, 'SortDirection');
      
      // Save the initial field numbers - note that enum values are prefixed in protobuf
      const ascNumber = enumFields1['SORT_DIRECTION_ASC'];
      const descNumber = enumFields1['SORT_DIRECTION_DESC'];
      const neutralNumber = enumFields1['SORT_DIRECTION_NEUTRAL'];
      
      // Verify all enum values have field numbers
      expect(ascNumber).toBeDefined();
      expect(descNumber).toBeDefined();
      expect(neutralNumber).toBeDefined();
      
      // Get the generated lock data
      const lockData = visitor1.getGeneratedLockData();
      expect(lockData).not.toBeNull();
  
      // Modified schema with reordered enum values and one deleted
      const modifiedSchema = buildSchema(`
        enum SortDirection {
          DESC      # Reordered from second to first
          # NEUTRAL # Deleted
          ASC       # Reordered from first to second
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
      
      // Get field numbers for the enum values in the modified schema
      const enumFields2 = getEnumValuesWithNumbers(root2, 'SortDirection');
      
      // Verify that existing enum values kept their field numbers
      expect(enumFields2['SORT_DIRECTION_ASC']).toBe(ascNumber);
      expect(enumFields2['SORT_DIRECTION_DESC']).toBe(descNumber);
      
      // Verify that the deleted enum value is not present
      expect(enumFields2['SORT_DIRECTION_NEUTRAL']).toBeUndefined();
      
      // Third schema with the deleted enum value restored and a new one added
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
  
      // Create a third visitor using the same lock data
      const visitor3 = new GraphQLToProtoTextVisitor(modifiedSchema2, {
        serviceName: 'ProductService',
        lockData: lockData || undefined,
      });
  
      // Generate the third proto
      const proto3 = visitor3.visit();
  
      // Parse the proto with protobufjs
      const root3 = loadProtoFromText(proto3);
      
      // Get field numbers for the enum values in the final schema
      const enumFields3 = getEnumValuesWithNumbers(root3, 'SortDirection');
      
      // Verify that all existing enum values kept their field numbers
      expect(enumFields3['SORT_DIRECTION_ASC']).toBe(ascNumber);
      expect(enumFields3['SORT_DIRECTION_DESC']).toBe(descNumber);
      expect(enumFields3['SORT_DIRECTION_NEUTRAL']).toBe(neutralNumber);
      
      // Verify that the new enum value has a higher number
      const maxEnumNumber = Math.max(ascNumber, descNumber, neutralNumber);
      expect(enumFields3['SORT_DIRECTION_RANDOM']).toBeGreaterThan(maxEnumNumber);
    });
  });
});
