import { describe, expect, test } from 'vitest';
import { compileOperationsToProto } from '../../src/operation-to-proto';
import { expectValidProto, getFieldNumbersFromMessage, loadProtoFromText } from '../util';

describe('Operations Field Ordering Stability', () => {
  describe('Response Message Field Ordering', () => {
    test('should maintain field numbers when query fields are reordered', () => {
      const schema = `
        type Query {
          user: User
        }
        
        type User {
          id: ID!
          name: String!
          email: String!
          age: Int
        }
      `;

      // First operation with specific field order
      const operation1 = `
        query GetUser {
          user {
            id
            name
            email
            age
          }
        }
      `;

      const result1 = compileOperationsToProto(operation1, schema);
      expectValidProto(result1.proto);

      const root1 = loadProtoFromText(result1.proto);
      const userFields1 = getFieldNumbersFromMessage(root1, 'GetUserResponse.User');

      // Store original field numbers
      const idNumber = userFields1['id'];
      const nameNumber = userFields1['name'];
      const emailNumber = userFields1['email'];
      const ageNumber = userFields1['age'];

      // Second operation with completely different field order
      const operation2 = `
        query GetUser {
          user {
            age
            email
            id
            name
          }
        }
      `;

      const result2 = compileOperationsToProto(operation2, schema, {
        lockData: result1.lockData,
      });
      expectValidProto(result2.proto);

      const root2 = loadProtoFromText(result2.proto);
      const userFields2 = getFieldNumbersFromMessage(root2, 'GetUserResponse.User');

      // Verify field numbers are preserved despite reordering
      expect(userFields2['id']).toBe(idNumber);
      expect(userFields2['name']).toBe(nameNumber);
      expect(userFields2['email']).toBe(emailNumber);
      expect(userFields2['age']).toBe(ageNumber);
    });

    test('should handle adding and removing fields while preserving field numbers', () => {
      const schema = `
        type Query {
          product: Product
        }
        
        type Product {
          id: ID!
          name: String!
          price: Float!
          description: String
          inStock: Boolean
          category: String
        }
      `;

      // Initial operation with all fields
      const operation1 = `
        query GetProduct {
          product {
            id
            name
            price
            description
            inStock
          }
        }
      `;

      const result1 = compileOperationsToProto(operation1, schema);
      expectValidProto(result1.proto);

      const root1 = loadProtoFromText(result1.proto);
      const productFields1 = getFieldNumbersFromMessage(root1, 'GetProductResponse.Product');

      const idNumber = productFields1['id'];
      const priceNumber = productFields1['price'];

      // Second operation with some fields removed
      const operation2 = `
        query GetProduct {
          product {
            id
            price
          }
        }
      `;

      const result2 = compileOperationsToProto(operation2, schema, {
        lockData: result1.lockData,
      });
      expectValidProto(result2.proto);

      const root2 = loadProtoFromText(result2.proto);
      const productFields2 = getFieldNumbersFromMessage(root2, 'GetProductResponse.Product');

      // Verify preserved fields kept their numbers
      expect(productFields2['id']).toBe(idNumber);
      expect(productFields2['price']).toBe(priceNumber);

      // Verify removed fields are not present
      expect(productFields2['name']).toBeUndefined();
      expect(productFields2['description']).toBeUndefined();
      expect(productFields2['in_stock']).toBeUndefined();

      // Third operation with fields re-added and new field
      const operation3 = `
        query GetProduct {
          product {
            id
            name
            price
            description
            inStock
            category
          }
        }
      `;

      const result3 = compileOperationsToProto(operation3, schema, {
        lockData: result2.lockData,
      });
      expectValidProto(result3.proto);

      const root3 = loadProtoFromText(result3.proto);
      const productFields3 = getFieldNumbersFromMessage(root3, 'GetProductResponse.Product');

      // Verify original fields still have same numbers
      expect(productFields3['id']).toBe(idNumber);
      expect(productFields3['price']).toBe(priceNumber);

      // Verify re-added fields exist (they get new numbers, not reusing old ones)
      expect(productFields3['name']).toBeDefined();
      expect(productFields3['description']).toBeDefined();

      // Verify new field exists
      expect(productFields3['category']).toBeDefined();

      // Re-added fields should have higher numbers than original fields
      expect(productFields3['name']).toBeGreaterThan(priceNumber);
      expect(productFields3['description']).toBeGreaterThan(priceNumber);
    });

    test('should handle nested object field ordering', () => {
      const schema = `
        type Query {
          user: User
        }
        
        type User {
          id: ID!
          name: String!
          profile: Profile
        }
        
        type Profile {
          bio: String
          avatar: String
          location: String
        }
      `;

      // First operation
      const operation1 = `
        query GetUser {
          user {
            id
            name
            profile {
              bio
              avatar
              location
            }
          }
        }
      `;

      const result1 = compileOperationsToProto(operation1, schema);
      expectValidProto(result1.proto);

      const root1 = loadProtoFromText(result1.proto);
      const userFields1 = getFieldNumbersFromMessage(root1, 'GetUserResponse.User');
      const profileFields1 = getFieldNumbersFromMessage(root1, 'GetUserResponse.User.Profile');

      // Second operation with reordered nested fields
      const operation2 = `
        query GetUser {
          user {
            profile {
              location
              bio
              avatar
            }
            name
            id
          }
        }
      `;

      const result2 = compileOperationsToProto(operation2, schema, {
        lockData: result1.lockData,
      });
      expectValidProto(result2.proto);

      const root2 = loadProtoFromText(result2.proto);
      const userFields2 = getFieldNumbersFromMessage(root2, 'GetUserResponse.User');
      const profileFields2 = getFieldNumbersFromMessage(root2, 'GetUserResponse.User.Profile');

      // Verify both parent and nested field numbers are preserved
      expect(userFields2['id']).toBe(userFields1['id']);
      expect(userFields2['name']).toBe(userFields1['name']);
      expect(userFields2['profile']).toBe(userFields1['profile']);

      expect(profileFields2['bio']).toBe(profileFields1['bio']);
      expect(profileFields2['avatar']).toBe(profileFields1['avatar']);
      expect(profileFields2['location']).toBe(profileFields1['location']);
    });
  });

  describe('Request Message Variable Ordering', () => {
    test('should maintain field numbers when variables are reordered', () => {
      const schema = `
        type Query {
          searchUsers(id: ID, name: String, email: String, age: Int): [User]
        }
        
        type User {
          id: ID!
          name: String!
        }
      `;

      // First operation with specific variable order
      const operation1 = `
        query SearchUsers($id: ID, $name: String, $email: String, $age: Int) {
          searchUsers(id: $id, name: $name, email: $email, age: $age) {
            id
            name
          }
        }
      `;

      const result1 = compileOperationsToProto(operation1, schema);
      expectValidProto(result1.proto);

      const root1 = loadProtoFromText(result1.proto);
      const requestFields1 = getFieldNumbersFromMessage(root1, 'SearchUsersRequest');

      const idNumber = requestFields1['id'];
      const nameNumber = requestFields1['name'];
      const emailNumber = requestFields1['email'];
      const ageNumber = requestFields1['age'];

      // Second operation with completely different variable order
      const operation2 = `
        query SearchUsers($age: Int, $email: String, $id: ID, $name: String) {
          searchUsers(id: $id, name: $name, email: $email, age: $age) {
            id
            name
          }
        }
      `;

      const result2 = compileOperationsToProto(operation2, schema, {
        lockData: result1.lockData,
      });
      expectValidProto(result2.proto);

      const root2 = loadProtoFromText(result2.proto);
      const requestFields2 = getFieldNumbersFromMessage(root2, 'SearchUsersRequest');

      // Verify field numbers are preserved
      expect(requestFields2['id']).toBe(idNumber);
      expect(requestFields2['name']).toBe(nameNumber);
      expect(requestFields2['email']).toBe(emailNumber);
      expect(requestFields2['age']).toBe(ageNumber);
    });

    test('should handle adding and removing variables', () => {
      const schema = `
        type Query {
          filterUsers(id: ID, name: String, age: Int, email: String, active: Boolean): [User]
        }
        
        type User {
          id: ID!
          name: String!
        }
      `;

      // Initial operation with all variables
      const operation1 = `
        query FilterUsers($id: ID, $name: String, $age: Int, $email: String, $active: Boolean) {
          filterUsers(id: $id, name: $name, age: $age, email: $email, active: $active) {
            id
            name
          }
        }
      `;

      const result1 = compileOperationsToProto(operation1, schema);
      expectValidProto(result1.proto);

      const root1 = loadProtoFromText(result1.proto);
      const requestFields1 = getFieldNumbersFromMessage(root1, 'FilterUsersRequest');

      const nameNumber = requestFields1['name'];
      const activeNumber = requestFields1['active'];

      // Second operation with some variables removed
      const operation2 = `
        query FilterUsers($name: String, $active: Boolean) {
          filterUsers(name: $name, active: $active) {
            id
            name
          }
        }
      `;

      const result2 = compileOperationsToProto(operation2, schema, {
        lockData: result1.lockData,
      });
      expectValidProto(result2.proto);

      const root2 = loadProtoFromText(result2.proto);
      const requestFields2 = getFieldNumbersFromMessage(root2, 'FilterUsersRequest');

      // Verify preserved variables kept their numbers
      expect(requestFields2['name']).toBe(nameNumber);
      expect(requestFields2['active']).toBe(activeNumber);

      // Verify removed variables are not present
      expect(requestFields2['id']).toBeUndefined();
      expect(requestFields2['age']).toBeUndefined();
      expect(requestFields2['email']).toBeUndefined();

      // Third operation with variables re-added (no unused variables)
      const operation3 = `
        query FilterUsers($name: String, $active: Boolean, $id: ID) {
          filterUsers(id: $id, name: $name, active: $active) {
            id
            name
          }
        }
      `;

      const result3 = compileOperationsToProto(operation3, schema, {
        lockData: result2.lockData,
      });
      expectValidProto(result3.proto);

      const root3 = loadProtoFromText(result3.proto);
      const requestFields3 = getFieldNumbersFromMessage(root3, 'FilterUsersRequest');

      // Verify original variables still have same numbers
      expect(requestFields3['name']).toBe(nameNumber);
      expect(requestFields3['active']).toBe(activeNumber);

      // Verify re-added variable exists (gets new number, not reusing old one)
      expect(requestFields3['id']).toBeDefined();
      expect(requestFields3['id']).toBeGreaterThan(activeNumber);
    });
  });

  describe('Input Object Field Ordering', () => {
    test('should maintain field numbers in input objects when fields are reordered', () => {
      const schema = `
        type Query {
          ping: String
        }
        
        type Mutation {
          createUser(input: UserInput!): User
        }
        
        input UserInput {
          name: String!
          email: String!
          age: Int
          active: Boolean
        }
        
        type User {
          id: ID!
          name: String!
        }
      `;

      // First operation
      const operation1 = `
        mutation CreateUser($input: UserInput!) {
          createUser(input: $input) {
            id
            name
          }
        }
      `;

      const result1 = compileOperationsToProto(operation1, schema);
      expectValidProto(result1.proto);

      const root1 = loadProtoFromText(result1.proto);
      const inputFields1 = getFieldNumbersFromMessage(root1, 'UserInput');

      const nameNumber = inputFields1['name'];
      const emailNumber = inputFields1['email'];
      const ageNumber = inputFields1['age'];
      const activeNumber = inputFields1['active'];

      // Second operation - same input type should preserve field numbers
      const operation2 = `
        mutation CreateUser($input: UserInput!) {
          createUser(input: $input) {
            id
            name
          }
        }
      `;

      const result2 = compileOperationsToProto(operation2, schema, {
        lockData: result1.lockData,
      });
      expectValidProto(result2.proto);

      const root2 = loadProtoFromText(result2.proto);
      const inputFields2 = getFieldNumbersFromMessage(root2, 'UserInput');

      // Verify field numbers are preserved
      expect(inputFields2['name']).toBe(nameNumber);
      expect(inputFields2['email']).toBe(emailNumber);
      expect(inputFields2['age']).toBe(ageNumber);
      expect(inputFields2['active']).toBe(activeNumber);
    });

    test('should handle nested input objects with field reordering', () => {
      const schema = `
        type Query {
          ping: String
        }
        
        type Mutation {
          filterUsers(filter: UserFilterInput!): [User]
        }
        
        input UserFilterInput {
          basic: BasicInfo
          preferences: UserPreferences
          metadata: [String!]
        }
        
        input BasicInfo {
          id: ID
          name: String
          email: String
        }
        
        input UserPreferences {
          active: Boolean
          notifications: Boolean
          theme: String
        }
        
        type User {
          id: ID!
          name: String!
        }
      `;

      // First operation with specific field order
      const operation1 = `
        mutation FilterUsers($filter: UserFilterInput!) {
          filterUsers(filter: $filter) {
            id
            name
          }
        }
      `;

      const result1 = compileOperationsToProto(operation1, schema);
      expectValidProto(result1.proto);

      const root1 = loadProtoFromText(result1.proto);
      const filterFields1 = getFieldNumbersFromMessage(root1, 'UserFilterInput');
      const basicFields1 = getFieldNumbersFromMessage(root1, 'BasicInfo');
      const prefsFields1 = getFieldNumbersFromMessage(root1, 'UserPreferences');

      // Store original field numbers
      const filterBasicNumber = filterFields1['basic'];
      const filterPrefsNumber = filterFields1['preferences'];
      const filterMetadataNumber = filterFields1['metadata'];

      const basicIdNumber = basicFields1['id'];
      const basicNameNumber = basicFields1['name'];
      const basicEmailNumber = basicFields1['email'];

      const prefsActiveNumber = prefsFields1['active'];
      const prefsNotificationsNumber = prefsFields1['notifications'];
      const prefsThemeNumber = prefsFields1['theme'];

      // Get the generated lock data
      const lockData = result1.lockData;
      expect(lockData).not.toBeNull();

      // Second operation - same schema, should preserve all field numbers
      const operation2 = `
        mutation FilterUsers($filter: UserFilterInput!) {
          filterUsers(filter: $filter) {
            id
            name
          }
        }
      `;

      const result2 = compileOperationsToProto(operation2, schema, {
        lockData: lockData,
      });
      expectValidProto(result2.proto);

      const root2 = loadProtoFromText(result2.proto);
      const filterFields2 = getFieldNumbersFromMessage(root2, 'UserFilterInput');
      const basicFields2 = getFieldNumbersFromMessage(root2, 'BasicInfo');
      const prefsFields2 = getFieldNumbersFromMessage(root2, 'UserPreferences');

      // Verify parent input object field numbers are preserved
      expect(filterFields2['basic']).toBe(filterBasicNumber);
      expect(filterFields2['preferences']).toBe(filterPrefsNumber);
      expect(filterFields2['metadata']).toBe(filterMetadataNumber);

      // Verify nested BasicInfo field numbers are preserved
      expect(basicFields2['id']).toBe(basicIdNumber);
      expect(basicFields2['name']).toBe(basicNameNumber);
      expect(basicFields2['email']).toBe(basicEmailNumber);

      // Verify nested UserPreferences field numbers are preserved
      expect(prefsFields2['active']).toBe(prefsActiveNumber);
      expect(prefsFields2['notifications']).toBe(prefsNotificationsNumber);
      expect(prefsFields2['theme']).toBe(prefsThemeNumber);
    });

    test('should handle adding and removing fields in nested input objects', () => {
      const schema = `
        type Query {
          ping: String
        }
        
        type Mutation {
          updateUser(filter: UserFilterInput!): User
        }
        
        input UserFilterInput {
          basic: BasicInfo
          preferences: UserPreferences
        }
        
        input BasicInfo {
          id: ID
          name: String
          email: String
          phone: String
        }
        
        input UserPreferences {
          active: Boolean
          notifications: Boolean
          theme: String
        }
        
        type User {
          id: ID!
          name: String!
        }
      `;

      // First operation
      const operation1 = `
        mutation UpdateUser($filter: UserFilterInput!) {
          updateUser(filter: $filter) {
            id
            name
          }
        }
      `;

      const result1 = compileOperationsToProto(operation1, schema);
      expectValidProto(result1.proto);

      const root1 = loadProtoFromText(result1.proto);
      const basicFields1 = getFieldNumbersFromMessage(root1, 'BasicInfo');
      const prefsFields1 = getFieldNumbersFromMessage(root1, 'UserPreferences');

      // Store original field numbers
      const basicIdNumber = basicFields1['id'];
      const basicEmailNumber = basicFields1['email'];
      const prefsActiveNumber = prefsFields1['active'];

      const lockData1 = result1.lockData;

      // Modified schema with some fields removed
      const schema2 = `
        type Query {
          ping: String
        }
        
        type Mutation {
          updateUser(filter: UserFilterInput!): User
        }
        
        input UserFilterInput {
          basic: BasicInfo
          preferences: UserPreferences
        }
        
        input BasicInfo {
          id: ID
          email: String
          # name: String  # removed
          # phone: String # removed
        }
        
        input UserPreferences {
          active: Boolean
          # notifications: Boolean # removed
          # theme: String          # removed
        }
        
        type User {
          id: ID!
          name: String!
        }
      `;

      const operation2 = `
        mutation UpdateUser($filter: UserFilterInput!) {
          updateUser(filter: $filter) {
            id
            name
          }
        }
      `;

      const result2 = compileOperationsToProto(operation2, schema2, {
        lockData: lockData1,
      });
      expectValidProto(result2.proto);

      const root2 = loadProtoFromText(result2.proto);
      const basicFields2 = getFieldNumbersFromMessage(root2, 'BasicInfo');
      const prefsFields2 = getFieldNumbersFromMessage(root2, 'UserPreferences');

      // Verify preserved fields kept their numbers
      expect(basicFields2['id']).toBe(basicIdNumber);
      expect(basicFields2['email']).toBe(basicEmailNumber);
      expect(prefsFields2['active']).toBe(prefsActiveNumber);

      // Verify removed fields are not present
      expect(basicFields2['name']).toBeUndefined();
      expect(basicFields2['phone']).toBeUndefined();
      expect(prefsFields2['notifications']).toBeUndefined();
      expect(prefsFields2['theme']).toBeUndefined();

      const lockData2 = result2.lockData;

      // Third schema with fields re-added and new fields
      const schema3 = `
        type Query {
          ping: String
        }
        
        type Mutation {
          updateUser(filter: UserFilterInput!): User
        }
        
        input UserFilterInput {
          basic: BasicInfo
          preferences: UserPreferences
        }
        
        input BasicInfo {
          id: ID
          name: String        # re-added
          email: String
          phone: String       # re-added
          address: String     # new field
        }
        
        input UserPreferences {
          active: Boolean
          notifications: Boolean  # re-added
          theme: String           # re-added
          language: String        # new field
        }
        
        type User {
          id: ID!
          name: String!
        }
      `;

      const operation3 = `
        mutation UpdateUser($filter: UserFilterInput!) {
          updateUser(filter: $filter) {
            id
            name
          }
        }
      `;

      const result3 = compileOperationsToProto(operation3, schema3, {
        lockData: lockData2,
      });
      expectValidProto(result3.proto);

      const root3 = loadProtoFromText(result3.proto);
      const basicFields3 = getFieldNumbersFromMessage(root3, 'BasicInfo');
      const prefsFields3 = getFieldNumbersFromMessage(root3, 'UserPreferences');

      // Verify original fields still have same numbers
      expect(basicFields3['id']).toBe(basicIdNumber);
      expect(basicFields3['email']).toBe(basicEmailNumber);
      expect(prefsFields3['active']).toBe(prefsActiveNumber);

      // Verify re-added fields exist (they get new numbers)
      expect(basicFields3['name']).toBeDefined();
      expect(basicFields3['phone']).toBeDefined();
      expect(prefsFields3['notifications']).toBeDefined();
      expect(prefsFields3['theme']).toBeDefined();

      // Verify new fields exist
      expect(basicFields3['address']).toBeDefined();
      expect(prefsFields3['language']).toBeDefined();

      // Re-added and new fields should have higher numbers than original fields
      expect(basicFields3['name']).toBeGreaterThan(basicEmailNumber);
      expect(basicFields3['address']).toBeGreaterThan(basicEmailNumber);
      expect(prefsFields3['language']).toBeGreaterThan(prefsActiveNumber);
    });

    test('should handle deeply nested input objects (3 levels)', () => {
      const schema = `
        type Query {
          ping: String
        }
        
        type Mutation {
          searchUsers(criteria: SearchCriteria!): [User]
        }
        
        input SearchCriteria {
          filters: FilterGroup
          sorting: SortOptions
        }
        
        input FilterGroup {
          user: UserFilters
          date: DateFilters
        }
        
        input UserFilters {
          name: String
          email: String
          active: Boolean
        }
        
        input DateFilters {
          from: String
          to: String
        }
        
        input SortOptions {
          field: String
          direction: String
        }
        
        type User {
          id: ID!
          name: String!
        }
      `;

      // First operation
      const operation1 = `
        mutation SearchUsers($criteria: SearchCriteria!) {
          searchUsers(criteria: $criteria) {
            id
            name
          }
        }
      `;

      const result1 = compileOperationsToProto(operation1, schema);
      expectValidProto(result1.proto);

      const root1 = loadProtoFromText(result1.proto);

      // Get field numbers at all nesting levels
      const criteriaFields1 = getFieldNumbersFromMessage(root1, 'SearchCriteria');
      const filterGroupFields1 = getFieldNumbersFromMessage(root1, 'FilterGroup');
      const userFiltersFields1 = getFieldNumbersFromMessage(root1, 'UserFilters');
      const dateFiltersFields1 = getFieldNumbersFromMessage(root1, 'DateFilters');
      const sortFields1 = getFieldNumbersFromMessage(root1, 'SortOptions');

      // Store original field numbers at each level
      const criteriaFiltersNumber = criteriaFields1['filters'];
      const criteriaSortingNumber = criteriaFields1['sorting'];

      const filterGroupUserNumber = filterGroupFields1['user'];
      const filterGroupDateNumber = filterGroupFields1['date'];

      const userFiltersNameNumber = userFiltersFields1['name'];
      const userFiltersEmailNumber = userFiltersFields1['email'];
      const userFiltersActiveNumber = userFiltersFields1['active'];

      const dateFiltersFromNumber = dateFiltersFields1['from'];
      const dateFiltersToNumber = dateFiltersFields1['to'];

      const sortFieldNumber = sortFields1['field'];
      const sortDirectionNumber = sortFields1['direction'];

      const lockData = result1.lockData;

      // Second operation - same schema, should preserve all field numbers
      const operation2 = `
        mutation SearchUsers($criteria: SearchCriteria!) {
          searchUsers(criteria: $criteria) {
            id
            name
          }
        }
      `;

      const result2 = compileOperationsToProto(operation2, schema, {
        lockData: lockData,
      });
      expectValidProto(result2.proto);

      const root2 = loadProtoFromText(result2.proto);

      const criteriaFields2 = getFieldNumbersFromMessage(root2, 'SearchCriteria');
      const filterGroupFields2 = getFieldNumbersFromMessage(root2, 'FilterGroup');
      const userFiltersFields2 = getFieldNumbersFromMessage(root2, 'UserFilters');
      const dateFiltersFields2 = getFieldNumbersFromMessage(root2, 'DateFilters');
      const sortFields2 = getFieldNumbersFromMessage(root2, 'SortOptions');

      // Verify all field numbers are preserved at all nesting levels
      expect(criteriaFields2['filters']).toBe(criteriaFiltersNumber);
      expect(criteriaFields2['sorting']).toBe(criteriaSortingNumber);

      expect(filterGroupFields2['user']).toBe(filterGroupUserNumber);
      expect(filterGroupFields2['date']).toBe(filterGroupDateNumber);

      expect(userFiltersFields2['name']).toBe(userFiltersNameNumber);
      expect(userFiltersFields2['email']).toBe(userFiltersEmailNumber);
      expect(userFiltersFields2['active']).toBe(userFiltersActiveNumber);

      expect(dateFiltersFields2['from']).toBe(dateFiltersFromNumber);
      expect(dateFiltersFields2['to']).toBe(dateFiltersToNumber);

      expect(sortFields2['field']).toBe(sortFieldNumber);
      expect(sortFields2['direction']).toBe(sortDirectionNumber);
    });
  });

  describe('Fragment Field Ordering', () => {
    test('should maintain field numbers when fragment fields are reordered', () => {
      const schema = `
        type Query {
          user: User
        }
        
        type User {
          id: ID!
          name: String!
          email: String!
          age: Int
        }
      `;

      // First operation with fragment
      const operation1 = `
        fragment UserFields on User {
          id
          name
          email
          age
        }
        
        query GetUser {
          user {
            ...UserFields
          }
        }
      `;

      const result1 = compileOperationsToProto(operation1, schema);
      expectValidProto(result1.proto);

      const root1 = loadProtoFromText(result1.proto);
      const userFields1 = getFieldNumbersFromMessage(root1, 'GetUserResponse.User');

      const idNumber = userFields1['id'];
      const nameNumber = userFields1['name'];
      const emailNumber = userFields1['email'];
      const ageNumber = userFields1['age'];

      // Second operation with reordered fragment fields
      const operation2 = `
        fragment UserFields on User {
          age
          email
          id
          name
        }
        
        query GetUser {
          user {
            ...UserFields
          }
        }
      `;

      const result2 = compileOperationsToProto(operation2, schema, {
        lockData: result1.lockData,
      });
      expectValidProto(result2.proto);

      const root2 = loadProtoFromText(result2.proto);
      const userFields2 = getFieldNumbersFromMessage(root2, 'GetUserResponse.User');

      // Verify field numbers are preserved
      expect(userFields2['id']).toBe(idNumber);
      expect(userFields2['name']).toBe(nameNumber);
      expect(userFields2['email']).toBe(emailNumber);
      expect(userFields2['age']).toBe(ageNumber);
    });

    test('should handle mixed fragment spreads and inline fields with reordering', () => {
      const schema = `
        type Query {
          user: User
        }
        
        type User {
          id: ID!
          name: String!
          email: String!
          age: Int
          active: Boolean
        }
      `;

      // First operation
      const operation1 = `
        fragment BasicInfo on User {
          id
          name
        }
        
        query GetUser {
          user {
            ...BasicInfo
            email
            age
            active
          }
        }
      `;

      const result1 = compileOperationsToProto(operation1, schema);
      expectValidProto(result1.proto);

      const root1 = loadProtoFromText(result1.proto);
      const userFields1 = getFieldNumbersFromMessage(root1, 'GetUserResponse.User');

      // Second operation with reordered fields
      const operation2 = `
        fragment BasicInfo on User {
          name
          id
        }
        
        query GetUser {
          user {
            active
            age
            ...BasicInfo
            email
          }
        }
      `;

      const result2 = compileOperationsToProto(operation2, schema, {
        lockData: result1.lockData,
      });
      expectValidProto(result2.proto);

      const root2 = loadProtoFromText(result2.proto);
      const userFields2 = getFieldNumbersFromMessage(root2, 'GetUserResponse.User');

      // Verify all field numbers are preserved
      for (const [fieldName, fieldNumber] of Object.entries(userFields1)) {
        expect(userFields2[fieldName]).toBe(fieldNumber);
      }
    });
  });

  describe('Multiple Operations', () => {
    test('should reject multiple operations in a single document', () => {
      const schema = `
        type Query {
          user: User
          users: [User!]!
        }
        
        type User {
          id: ID!
          name: String!
          email: String!
        }
      `;

      // Multiple operations in one document
      const operations = `
        query GetUser {
          user {
            id
            name
            email
          }
        }
        
        query GetUsers {
          users {
            id
            name
          }
        }
      `;

      expect(() => compileOperationsToProto(operations, schema)).toThrow(
        'Multiple operations found in document: GetUser, GetUsers',
      );
    });
  });

  describe('Mutation Operations', () => {
    test('should maintain field numbers in mutation variables', () => {
      const schema = `
        type Query {
          ping: String
        }
        
        type Mutation {
          updateUser(id: ID!, name: String, email: String, age: Int): User
        }
        
        type User {
          id: ID!
          name: String!
        }
      `;

      // First mutation
      const operation1 = `
        mutation UpdateUser($id: ID!, $name: String, $email: String, $age: Int) {
          updateUser(id: $id, name: $name, email: $email, age: $age) {
            id
            name
          }
        }
      `;

      const result1 = compileOperationsToProto(operation1, schema);
      expectValidProto(result1.proto);

      const root1 = loadProtoFromText(result1.proto);
      const requestFields1 = getFieldNumbersFromMessage(root1, 'UpdateUserRequest');

      // Second mutation with reordered variables
      const operation2 = `
        mutation UpdateUser($age: Int, $email: String, $id: ID!, $name: String) {
          updateUser(id: $id, name: $name, email: $email, age: $age) {
            id
            name
          }
        }
      `;

      const result2 = compileOperationsToProto(operation2, schema, {
        lockData: result1.lockData,
      });
      expectValidProto(result2.proto);

      const root2 = loadProtoFromText(result2.proto);
      const requestFields2 = getFieldNumbersFromMessage(root2, 'UpdateUserRequest');

      // Verify field numbers are preserved
      for (const [fieldName, fieldNumber] of Object.entries(requestFields1)) {
        expect(requestFields2[fieldName]).toBe(fieldNumber);
      }
    });
  });

  describe('Complex Scenarios', () => {
    test('should handle deeply nested selections with field reordering', () => {
      const schema = `
        type Query {
          user: User
        }
        
        type User {
          id: ID!
          name: String!
          profile: Profile
        }
        
        type Profile {
          bio: String
          settings: Settings
        }
        
        type Settings {
          theme: String
          notifications: Boolean
          language: String
        }
      `;

      // First operation
      const operation1 = `
        query GetUser {
          user {
            id
            name
            profile {
              bio
              settings {
                theme
                notifications
                language
              }
            }
          }
        }
      `;

      const result1 = compileOperationsToProto(operation1, schema);
      expectValidProto(result1.proto);

      const root1 = loadProtoFromText(result1.proto);
      const settingsFields1 = getFieldNumbersFromMessage(root1, 'GetUserResponse.User.Profile.Settings');

      // Second operation with reordered deeply nested fields
      const operation2 = `
        query GetUser {
          user {
            profile {
              settings {
                language
                theme
                notifications
              }
              bio
            }
            name
            id
          }
        }
      `;

      const result2 = compileOperationsToProto(operation2, schema, {
        lockData: result1.lockData,
      });
      expectValidProto(result2.proto);

      const root2 = loadProtoFromText(result2.proto);
      const settingsFields2 = getFieldNumbersFromMessage(root2, 'GetUserResponse.User.Profile.Settings');

      // Verify deeply nested field numbers are preserved
      expect(settingsFields2['theme']).toBe(settingsFields1['theme']);
      expect(settingsFields2['notifications']).toBe(settingsFields1['notifications']);
      expect(settingsFields2['language']).toBe(settingsFields1['language']);
    });

    test('should handle operations with both variable and response field reordering', () => {
      const schema = `
        type Query {
          searchUsers(query: String!, limit: Int, offset: Int): SearchResult
        }
        
        type SearchResult {
          users: [User!]!
          total: Int!
          hasMore: Boolean!
        }
        
        type User {
          id: ID!
          name: String!
          email: String!
        }
      `;

      // First operation
      const operation1 = `
        query SearchUsers($query: String!, $limit: Int, $offset: Int) {
          searchUsers(query: $query, limit: $limit, offset: $offset) {
            users {
              id
              name
              email
            }
            total
            hasMore
          }
        }
      `;

      const result1 = compileOperationsToProto(operation1, schema);
      expectValidProto(result1.proto);

      const root1 = loadProtoFromText(result1.proto);
      const requestFields1 = getFieldNumbersFromMessage(root1, 'SearchUsersRequest');
      const resultFields1 = getFieldNumbersFromMessage(root1, 'SearchUsersResponse.SearchUsers');
      const userFields1 = getFieldNumbersFromMessage(root1, 'SearchUsersResponse.SearchUsers.Users');

      // Second operation with everything reordered
      const operation2 = `
        query SearchUsers($offset: Int, $limit: Int, $query: String!) {
          searchUsers(query: $query, limit: $limit, offset: $offset) {
            hasMore
            total
            users {
              email
              name
              id
            }
          }
        }
      `;

      const result2 = compileOperationsToProto(operation2, schema, {
        lockData: result1.lockData,
      });
      expectValidProto(result2.proto);

      const root2 = loadProtoFromText(result2.proto);
      const requestFields2 = getFieldNumbersFromMessage(root2, 'SearchUsersRequest');
      const resultFields2 = getFieldNumbersFromMessage(root2, 'SearchUsersResponse.SearchUsers');
      const userFields2 = getFieldNumbersFromMessage(root2, 'SearchUsersResponse.SearchUsers.Users');

      // Verify all field numbers are preserved at all levels
      for (const [fieldName, fieldNumber] of Object.entries(requestFields1)) {
        expect(requestFields2[fieldName]).toBe(fieldNumber);
      }

      for (const [fieldName, fieldNumber] of Object.entries(resultFields1)) {
        expect(resultFields2[fieldName]).toBe(fieldNumber);
      }

      for (const [fieldName, fieldNumber] of Object.entries(userFields1)) {
        expect(userFields2[fieldName]).toBe(fieldNumber);
      }
    });
  });

  describe('Edge Cases', () => {
    test('should handle operations with no variables', () => {
      const schema = `
        type Query {
          hello: String
        }
      `;

      const operation1 = `
        query GetHello {
          hello
        }
      `;

      const result1 = compileOperationsToProto(operation1, schema);
      expectValidProto(result1.proto);

      const operation2 = `
        query GetHello {
          hello
        }
      `;

      const result2 = compileOperationsToProto(operation2, schema, {
        lockData: result1.lockData,
      });
      expectValidProto(result2.proto);

      // Should produce identical output
      expect(result1.proto).toBe(result2.proto);
    });

    test('should handle operations with only scalar fields', () => {
      const schema = `
        type Query {
          user: User
        }
        
        type User {
          id: ID!
          name: String!
        }
      `;

      const operation1 = `
        query GetUser {
          user {
            id
            name
          }
        }
      `;

      const result1 = compileOperationsToProto(operation1, schema);
      expectValidProto(result1.proto);

      const operation2 = `
        query GetUser {
          user {
            name
            id
          }
        }
      `;

      const result2 = compileOperationsToProto(operation2, schema, {
        lockData: result1.lockData,
      });
      expectValidProto(result2.proto);

      const root1 = loadProtoFromText(result1.proto);
      const root2 = loadProtoFromText(result2.proto);

      const userFields1 = getFieldNumbersFromMessage(root1, 'GetUserResponse.User');
      const userFields2 = getFieldNumbersFromMessage(root2, 'GetUserResponse.User');

      expect(userFields2['id']).toBe(userFields1['id']);
      expect(userFields2['name']).toBe(userFields1['name']);
    });

    test('should produce consistent output when run multiple times with same operation', () => {
      const schema = `
        type Query {
          user(id: ID!): User
        }
        
        type User {
          id: ID!
          name: String!
          email: String!
        }
      `;

      const operation = `
        query GetUser($id: ID!) {
          user(id: $id) {
            id
            name
            email
          }
        }
      `;

      const result1 = compileOperationsToProto(operation, schema);
      const result2 = compileOperationsToProto(operation, schema, {
        lockData: result1.lockData,
      });
      const result3 = compileOperationsToProto(operation, schema, {
        lockData: result2.lockData,
      });

      // All three should produce identical proto output
      expect(result1.proto).toBe(result2.proto);
      expect(result2.proto).toBe(result3.proto);
    });
  });

  describe('Inline Fragments', () => {
    test('should maintain field numbers with inline fragments on interfaces', () => {
      const schema = `
        type Query {
          node(id: ID!): Node
        }
        
        interface Node {
          id: ID!
        }
        
        type User implements Node {
          id: ID!
          name: String!
          email: String!
        }
        
        type Post implements Node {
          id: ID!
          title: String!
          content: String!
        }
      `;

      // First operation
      const operation1 = `
        query GetNode($id: ID!) {
          node(id: $id) {
            id
            ... on User {
              name
              email
            }
            ... on Post {
              title
              content
            }
          }
        }
      `;

      const result1 = compileOperationsToProto(operation1, schema);
      expectValidProto(result1.proto);

      const root1 = loadProtoFromText(result1.proto);
      const nodeFields1 = getFieldNumbersFromMessage(root1, 'GetNodeResponse.Node');

      // Second operation with reordered inline fragments
      const operation2 = `
        query GetNode($id: ID!) {
          node(id: $id) {
            ... on Post {
              content
              title
            }
            ... on User {
              email
              name
            }
            id
          }
        }
      `;

      const result2 = compileOperationsToProto(operation2, schema, {
        lockData: result1.lockData,
      });
      expectValidProto(result2.proto);

      const root2 = loadProtoFromText(result2.proto);
      const nodeFields2 = getFieldNumbersFromMessage(root2, 'GetNodeResponse.Node');

      // Verify field numbers are preserved
      for (const [fieldName, fieldNumber] of Object.entries(nodeFields1)) {
        expect(nodeFields2[fieldName]).toBe(fieldNumber);
      }
    });
  });

  describe('Real-world Scenario', () => {
    test('should handle complex operation with multiple levels of nesting and reordering', () => {
      const schema = `
        type Query {
          searchContent(
            query: String!
            filters: SearchFilters
            pagination: PaginationInput
          ): SearchResults
        }
        
        input SearchFilters {
          types: [String!]
          tags: [String!]
          dateRange: DateRangeInput
        }
        
        input DateRangeInput {
          start: String
          end: String
        }
        
        input PaginationInput {
          limit: Int
          offset: Int
        }
        
        type SearchResults {
          items: [SearchItem!]!
          total: Int!
          hasMore: Boolean!
        }
        
        union SearchItem = Article | Video
        
        type Article {
          id: ID!
          title: String!
          author: Author!
          publishedAt: String!
        }
        
        type Video {
          id: ID!
          title: String!
          duration: Int!
          creator: Author!
        }
        
        type Author {
          id: ID!
          name: String!
          avatar: String
        }
      `;

      // First operation with specific ordering
      const operation1 = `
        query SearchContent(
          $query: String!
          $filters: SearchFilters
          $pagination: PaginationInput
        ) {
          searchContent(query: $query, filters: $filters, pagination: $pagination) {
            items {
              ... on Article {
                id
                title
                author {
                  id
                  name
                  avatar
                }
                publishedAt
              }
              ... on Video {
                id
                title
                duration
                creator {
                  id
                  name
                  avatar
                }
              }
            }
            total
            hasMore
          }
        }
      `;

      const result1 = compileOperationsToProto(operation1, schema);
      expectValidProto(result1.proto);

      const root1 = loadProtoFromText(result1.proto);
      const requestFields1 = getFieldNumbersFromMessage(root1, 'SearchContentRequest');
      const resultsFields1 = getFieldNumbersFromMessage(root1, 'SearchContentResponse.SearchContent');

      // Second operation with completely reordered everything
      const operation2 = `
        query SearchContent(
          $pagination: PaginationInput
          $filters: SearchFilters
          $query: String!
        ) {
          searchContent(query: $query, filters: $filters, pagination: $pagination) {
            hasMore
            total
            items {
              ... on Video {
                creator {
                  avatar
                  name
                  id
                }
                duration
                title
                id
              }
              ... on Article {
                publishedAt
                author {
                  avatar
                  name
                  id
                }
                title
                id
              }
            }
          }
        }
      `;

      const result2 = compileOperationsToProto(operation2, schema, {
        lockData: result1.lockData,
      });
      expectValidProto(result2.proto);

      const root2 = loadProtoFromText(result2.proto);
      const requestFields2 = getFieldNumbersFromMessage(root2, 'SearchContentRequest');
      const resultsFields2 = getFieldNumbersFromMessage(root2, 'SearchContentResponse.SearchContent');

      // Verify all field numbers are preserved at all levels
      for (const [fieldName, fieldNumber] of Object.entries(requestFields1)) {
        expect(requestFields2[fieldName]).toBe(fieldNumber);
      }

      for (const [fieldName, fieldNumber] of Object.entries(resultsFields1)) {
        expect(resultsFields2[fieldName]).toBe(fieldNumber);
      }
    });
  });
});
