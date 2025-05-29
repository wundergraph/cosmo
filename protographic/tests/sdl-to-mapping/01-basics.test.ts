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
            "type": "OPERATION_TYPE_QUERY",
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
            "type": "OPERATION_TYPE_QUERY",
          },
          {
            "mapped": "QueryOptionalItems",
            "original": "optionalItems",
            "request": "QueryOptionalItemsRequest",
            "response": "QueryOptionalItemsResponse",
            "type": "OPERATION_TYPE_QUERY",
          },
          {
            "mapped": "QueryNestedLists",
            "original": "nestedLists",
            "request": "QueryNestedListsRequest",
            "response": "QueryNestedListsResponse",
            "type": "OPERATION_TYPE_QUERY",
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
            "type": "OPERATION_TYPE_QUERY",
          },
          {
            "mapped": "QueryUsers",
            "original": "users",
            "request": "QueryUsersRequest",
            "response": "QueryUsersResponse",
            "type": "OPERATION_TYPE_QUERY",
          },
          {
            "mapped": "QuerySearchUsers",
            "original": "searchUsers",
            "request": "QuerySearchUsersRequest",
            "response": "QuerySearchUsersResponse",
            "type": "OPERATION_TYPE_QUERY",
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

  it('maps mutation fields correctly', () => {
    const sdl = `
      type User {
        id: ID!
        name: String!
        email: String!
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
        createUser(input: CreateUserInput!): User!
        updateUser(input: UpdateUserInput!): User
        deleteUser(id: ID!): Boolean!
      }
      
      type Query {
        user(id: ID!): User
      }
    `;

    const mapping = compileGraphQLToMapping(sdl, 'UserMutationService');

    expect(mapping.toJson()).toMatchInlineSnapshot(`
      {
        "operationMappings": [
          {
            "mapped": "QueryUser",
            "original": "user",
            "request": "QueryUserRequest",
            "response": "QueryUserResponse",
            "type": "OPERATION_TYPE_QUERY",
          },
          {
            "mapped": "MutationCreateUser",
            "original": "createUser",
            "request": "MutationCreateUserRequest",
            "response": "MutationCreateUserResponse",
            "type": "OPERATION_TYPE_MUTATION",
          },
          {
            "mapped": "MutationUpdateUser",
            "original": "updateUser",
            "request": "MutationUpdateUserRequest",
            "response": "MutationUpdateUserResponse",
            "type": "OPERATION_TYPE_MUTATION",
          },
          {
            "mapped": "MutationDeleteUser",
            "original": "deleteUser",
            "request": "MutationDeleteUserRequest",
            "response": "MutationDeleteUserResponse",
            "type": "OPERATION_TYPE_MUTATION",
          },
        ],
        "service": "UserMutationService",
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
            ],
            "type": "Query",
          },
          {
            "fieldMappings": [
              {
                "argumentMappings": [
                  {
                    "mapped": "input",
                    "original": "input",
                  },
                ],
                "mapped": "create_user",
                "original": "createUser",
              },
              {
                "argumentMappings": [
                  {
                    "mapped": "input",
                    "original": "input",
                  },
                ],
                "mapped": "update_user",
                "original": "updateUser",
              },
              {
                "argumentMappings": [
                  {
                    "mapped": "id",
                    "original": "id",
                  },
                ],
                "mapped": "delete_user",
                "original": "deleteUser",
              },
            ],
            "type": "Mutation",
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
                "mapped": "email",
                "original": "email",
              },
            ],
            "type": "User",
          },
          {
            "fieldMappings": [
              {
                "mapped": "name",
                "original": "name",
              },
              {
                "mapped": "email",
                "original": "email",
              },
            ],
            "type": "CreateUserInput",
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
                "mapped": "email",
                "original": "email",
              },
            ],
            "type": "UpdateUserInput",
          },
        ],
        "version": 1,
      }
    `);
  });
});
