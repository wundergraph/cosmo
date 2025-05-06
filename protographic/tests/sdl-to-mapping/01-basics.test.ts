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

    expect(mapping.toJson()).toMatchInlineSnapshot(`
      {
        "operationMappings": [
          {
            "mapped": "QueryGetSimpleType",
            "original": "getSimpleType",
            "request": "QueryGetSimpleTypeRequest",
            "response": "QueryGetSimpleTypeResponse",
          },
        ],
        "service": "SimpleService",
        "typeFieldMappings": [
          {
            "fieldMappings": [
              {
                "argumentMappings": [
                  {
                    "mapped": "id",
                    "original": "id",
                  },
                ],
                "mapped": "get_simple_type",
                "original": "getSimpleType",
              },
            ],
            "type": "Query",
          },
          {
            "fieldMappings": [
              {
                "mapped": "id",
                "original": "id",
              },
              {
                "mapped": "name",
                "original": "name",
              },
              {
                "mapped": "age",
                "original": "age",
              },
              {
                "mapped": "active",
                "original": "active",
              },
              {
                "mapped": "score",
                "original": "score",
              },
            ],
            "type": "SimpleType",
          },
        ],
        "version": 1,
      }
    `);
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

    expect(mapping.toJson()).toMatchInlineSnapshot(`
      {
        "operationMappings": [
          {
            "mapped": "QueryItems",
            "original": "items",
            "request": "QueryItemsRequest",
            "response": "QueryItemsResponse",
          },
          {
            "mapped": "QueryOptionalItems",
            "original": "optionalItems",
            "request": "QueryOptionalItemsRequest",
            "response": "QueryOptionalItemsResponse",
          },
          {
            "mapped": "QueryNestedLists",
            "original": "nestedLists",
            "request": "QueryNestedListsRequest",
            "response": "QueryNestedListsResponse",
          },
        ],
        "service": "ListService",
        "typeFieldMappings": [
          {
            "fieldMappings": [
              {
                "mapped": "items",
                "original": "items",
              },
              {
                "mapped": "optional_items",
                "original": "optionalItems",
              },
              {
                "mapped": "nested_lists",
                "original": "nestedLists",
              },
            ],
            "type": "Query",
          },
          {
            "fieldMappings": [
              {
                "mapped": "id",
                "original": "id",
              },
              {
                "mapped": "name",
                "original": "name",
              },
            ],
            "type": "Item",
          },
        ],
        "version": 1,
      }
    `);
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

    expect(mapping.toJson()).toMatchInlineSnapshot(`
      {
        "operationMappings": [
          {
            "mapped": "QueryUser",
            "original": "user",
            "request": "QueryUserRequest",
            "response": "QueryUserResponse",
          },
          {
            "mapped": "QueryUsers",
            "original": "users",
            "request": "QueryUsersRequest",
            "response": "QueryUsersResponse",
          },
          {
            "mapped": "QuerySearchUsers",
            "original": "searchUsers",
            "request": "QuerySearchUsersRequest",
            "response": "QuerySearchUsersResponse",
          },
        ],
        "service": "UserService",
        "typeFieldMappings": [
          {
            "fieldMappings": [
              {
                "argumentMappings": [
                  {
                    "mapped": "id",
                    "original": "id",
                  },
                ],
                "mapped": "user",
                "original": "user",
              },
              {
                "mapped": "users",
                "original": "users",
              },
              {
                "argumentMappings": [
                  {
                    "mapped": "query",
                    "original": "query",
                  },
                ],
                "mapped": "search_users",
                "original": "searchUsers",
              },
            ],
            "type": "Query",
          },
          {
            "fieldMappings": [
              {
                "mapped": "id",
                "original": "id",
              },
              {
                "mapped": "name",
                "original": "name",
              },
            ],
            "type": "User",
          },
        ],
        "version": 1,
      }
    `);
  });
});
