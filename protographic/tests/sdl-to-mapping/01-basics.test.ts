import { describe, expect, it } from 'vitest';
import { compileGraphQLToMapping } from '../../src';

describe('Basic GraphQL Schema to Proto Mapping', () => {
  it('maps a simple schema with scalar fields', () => {
    const sdl = `
      type SimpleType {
        id: ID!
        name: String!
        age: Int
        active: Boolean
        score: Float
      }
      
      type Query {
        getSimpleType(id: ID!): SimpleType
      }
    `;

    const mapping = compileGraphQLToMapping(sdl, 'SimpleService');

    // Service name
    expect(mapping.service).toBe('SimpleService');

    // Operation mappings
    expect(mapping.operationMappings).toHaveLength(1);
    const getSimpleTypeOp = mapping.operationMappings[0];
    expect(getSimpleTypeOp.original).toBe('getSimpleType');
    expect(getSimpleTypeOp.mapped).toBe('QueryGetSimpleType');
    expect(getSimpleTypeOp.request).toBe('QueryGetSimpleTypeRequest');
    expect(getSimpleTypeOp.response).toBe('QueryGetSimpleTypeResponse');

    // Field mappings
    const queryType = mapping.typeFieldMappings.find((m) => m.type === 'Query');
    expect(queryType).toBeDefined();
    expect(queryType?.fieldMappings).toHaveLength(1);

    const getSimpleTypeField = queryType?.fieldMappings[0];
    expect(getSimpleTypeField?.original).toBe('getSimpleType');
    expect(getSimpleTypeField?.mapped).toBe('get_simple_type');
    expect(getSimpleTypeField?.argumentMappings).toHaveLength(1);
    expect(getSimpleTypeField?.argumentMappings[0].original).toBe('id');

    // Type field mappings
    const simpleType = mapping.typeFieldMappings.find((m) => m.type === 'SimpleType');
    expect(simpleType).toBeDefined();
    expect(simpleType?.fieldMappings).toHaveLength(5);

    // Verify each field is properly mapped
    const fields = ['id', 'name', 'age', 'active', 'score'];
    fields.forEach((field) => {
      const fieldMapping = simpleType?.fieldMappings.find((f) => f.original === field);
      expect(fieldMapping).toBeDefined();
      expect(fieldMapping?.mapped).toBe(field); // Same name for these simple fields
    });
  });

  it('maps list fields correctly', () => {
    const sdl = `
      type Item {
        id: ID!
        name: String!
      }
      
      type Query {
        items: [Item!]!
        optionalItems: [Item]
        nestedLists: [[Item!]!]
      }
    `;

    const mapping = compileGraphQLToMapping(sdl, 'ListService');

    // Check operation mappings
    expect(mapping.operationMappings).toHaveLength(3);

    // Check field mappings
    const queryType = mapping.typeFieldMappings.find((m) => m.type === 'Query');
    expect(queryType).toBeDefined();
    expect(queryType?.fieldMappings).toHaveLength(3);

    const itemsField = queryType?.fieldMappings.find((f) => f.original === 'items');
    const optionalItemsField = queryType?.fieldMappings.find((f) => f.original === 'optionalItems');
    const nestedListsField = queryType?.fieldMappings.find((f) => f.original === 'nestedLists');

    expect(itemsField).toBeDefined();
    expect(optionalItemsField).toBeDefined();
    expect(nestedListsField).toBeDefined();
  });

  it('maps multiple query fields', () => {
    const sdl = `
      type User {
        id: ID!
        name: String!
      }
      
      type Query {
        user(id: ID!): User
        users: [User!]!
        searchUsers(query: String!): [User!]!
      }
    `;

    const mapping = compileGraphQLToMapping(sdl, 'UserService');

    // Check operation mappings - should have one per query field
    expect(mapping.operationMappings).toHaveLength(3);

    const userOp = mapping.operationMappings.find((op) => op.original === 'user');
    const usersOp = mapping.operationMappings.find((op) => op.original === 'users');
    const searchUsersOp = mapping.operationMappings.find((op) => op.original === 'searchUsers');

    expect(userOp).toBeDefined();
    expect(usersOp).toBeDefined();
    expect(searchUsersOp).toBeDefined();

    expect(userOp?.mapped).toBe('QueryUser');
    expect(usersOp?.mapped).toBe('QueryUsers');
    expect(searchUsersOp?.mapped).toBe('QuerySearchUsers');

    // Check field mappings
    const queryType = mapping.typeFieldMappings.find((m) => m.type === 'Query');
    expect(queryType?.fieldMappings).toHaveLength(3);

    // Check argument mappings
    const userField = queryType?.fieldMappings.find((f) => f.original === 'user');
    expect(userField?.argumentMappings).toHaveLength(1);
    expect(userField?.argumentMappings[0].original).toBe('id');

    const searchField = queryType?.fieldMappings.find((f) => f.original === 'searchUsers');
    expect(searchField?.argumentMappings).toHaveLength(1);
    expect(searchField?.argumentMappings[0].original).toBe('query');
    expect(searchField?.argumentMappings[0].mapped).toBe('query');
  });
});
