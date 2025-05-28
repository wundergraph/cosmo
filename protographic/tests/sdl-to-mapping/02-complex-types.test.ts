import { describe, expect, it } from 'vitest';
import { compileGraphQLToMapping } from '../../src';

describe('Complex GraphQL Types to Proto Mapping', () => {
  it('maps enum types correctly', () => {
    const sdl = `
      enum UserRole {
        ADMIN
        USER
        GUEST
      }
      
      type User {
        id: ID!
        name: String!
        role: UserRole!
      }
      
      type Query {
        user(id: ID!): User
        usersByRole(role: UserRole!): [User!]!
      }
    `;

    const mapping = compileGraphQLToMapping(sdl, 'UserService');

    expect(mapping.toJson()).toMatchInlineSnapshot(`
      {
        "enumMappings": [
          {
            "type": "UserRole",
            "values": [
              {
                "mapped": "USER_ROLE_ADMIN",
                "original": "ADMIN",
              },
              {
                "mapped": "USER_ROLE_USER",
                "original": "USER",
              },
              {
                "mapped": "USER_ROLE_GUEST",
                "original": "GUEST",
              },
            ],
          },
        ],
        "operationMappings": [
          {
            "mapped": "QueryUser",
            "original": "user",
            "request": "QueryUserRequest",
            "response": "QueryUserResponse",
            "type": "OPERATION_TYPE_QUERY",
          },
          {
            "mapped": "QueryUsersByRole",
            "original": "usersByRole",
            "request": "QueryUsersByRoleRequest",
            "response": "QueryUsersByRoleResponse",
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
                "argumentMappings": [
                  {
                    "mapped": "role",
                    "original": "role",
                  },
                ],
                "mapped": "users_by_role",
                "original": "usersByRole",
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
                "mapped": "role",
                "original": "role",
              },
            ],
            "type": "User",
          },
        ],
        "version": 1,
      }
    `);
  });

  it('maps interface types and implementations', () => {
    const sdl = `
      interface Node {
        id: ID!
      }
      
      interface Character {
        id: ID!
        name: String!
        friendIds: [ID!]!
      }
      
      type Human implements Node & Character {
        id: ID!
        name: String!
        friendIds: [ID!]!
        homePlanet: String
      }
      
      type Droid implements Node & Character {
        id: ID!
        name: String!
        friendIds: [ID!]!
        primaryFunction: String
      }
      
      type Query {
        node(id: ID!): Node
        character(id: ID!): Character
        human(id: ID!): Human
        droid(id: ID!): Droid
      }
    `;

    const mapping = compileGraphQLToMapping(sdl, 'StarWarsService');

    expect(mapping.toJson()).toMatchInlineSnapshot(`
      {
        "operationMappings": [
          {
            "mapped": "QueryNode",
            "original": "node",
            "request": "QueryNodeRequest",
            "response": "QueryNodeResponse",
            "type": "OPERATION_TYPE_QUERY",
          },
          {
            "mapped": "QueryCharacter",
            "original": "character",
            "request": "QueryCharacterRequest",
            "response": "QueryCharacterResponse",
            "type": "OPERATION_TYPE_QUERY",
          },
          {
            "mapped": "QueryHuman",
            "original": "human",
            "request": "QueryHumanRequest",
            "response": "QueryHumanResponse",
            "type": "OPERATION_TYPE_QUERY",
          },
          {
            "mapped": "QueryDroid",
            "original": "droid",
            "request": "QueryDroidRequest",
            "response": "QueryDroidResponse",
            "type": "OPERATION_TYPE_QUERY",
          },
        ],
        "service": "StarWarsService",
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
                "mapped": "node",
                "original": "node",
              },
              {
                "argumentMappings": [
                  {
                    "mapped": "id",
                    "original": "id",
                  },
                ],
                "mapped": "character",
                "original": "character",
              },
              {
                "argumentMappings": [
                  {
                    "mapped": "id",
                    "original": "id",
                  },
                ],
                "mapped": "human",
                "original": "human",
              },
              {
                "argumentMappings": [
                  {
                    "mapped": "id",
                    "original": "id",
                  },
                ],
                "mapped": "droid",
                "original": "droid",
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
                "mapped": "friend_ids",
                "original": "friendIds",
              },
              {
                "mapped": "home_planet",
                "original": "homePlanet",
              },
            ],
            "type": "Human",
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
                "mapped": "friend_ids",
                "original": "friendIds",
              },
              {
                "mapped": "primary_function",
                "original": "primaryFunction",
              },
            ],
            "type": "Droid",
          },
        ],
        "version": 1,
      }
    `);
  });

  it('maps union types correctly', () => {
    const sdl = `
      type Photo {
        id: ID!
        url: String!
        width: Int!
        height: Int!
      }
      
      type Post {
        id: ID!
        title: String!
        content: String!
      }
      
      union SearchResult = Photo | Post
      
      type Query {
        search(term: String!): [SearchResult!]!
      }
    `;

    const mapping = compileGraphQLToMapping(sdl, 'ContentService');

    expect(mapping.toJson()).toMatchInlineSnapshot(`
      {
        "operationMappings": [
          {
            "mapped": "QuerySearch",
            "original": "search",
            "request": "QuerySearchRequest",
            "response": "QuerySearchResponse",
            "type": "OPERATION_TYPE_QUERY",
          },
        ],
        "service": "ContentService",
        "typeFieldMappings": [
          {
            "fieldMappings": [
              {
                "argumentMappings": [
                  {
                    "mapped": "term",
                    "original": "term",
                  },
                ],
                "mapped": "search",
                "original": "search",
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
                "mapped": "url",
                "original": "url",
              },
              {
                "mapped": "width",
                "original": "width",
              },
              {
                "mapped": "height",
                "original": "height",
              },
            ],
            "type": "Photo",
          },
          {
            "fieldMappings": [
              {
                "mapped": "id",
                "original": "id",
              },
              {
                "mapped": "title",
                "original": "title",
              },
              {
                "mapped": "content",
                "original": "content",
              },
            ],
            "type": "Post",
          },
        ],
        "version": 1,
      }
    `);
  });

  it('maps input types with nested fields', () => {
    const sdl = `
      input PaginationInput {
        page: Int!
        limit: Int!
      }
      
      input ProductFilterInput {
        name: String
        minPrice: Float
        maxPrice: Float
        categories: [String!]
        pagination: PaginationInput!
      }
      
      type Product {
        id: ID!
        name: String!
        price: Float!
        category: String!
      }
      
      type Query {
        products(filter: ProductFilterInput!): [Product!]!
      }
    `;

    const mapping = compileGraphQLToMapping(sdl, 'ProductService');

    expect(mapping.toJson()).toMatchInlineSnapshot(`
      {
        "operationMappings": [
          {
            "mapped": "QueryProducts",
            "original": "products",
            "request": "QueryProductsRequest",
            "response": "QueryProductsResponse",
            "type": "OPERATION_TYPE_QUERY",
          },
        ],
        "service": "ProductService",
        "typeFieldMappings": [
          {
            "fieldMappings": [
              {
                "argumentMappings": [
                  {
                    "mapped": "filter",
                    "original": "filter",
                  },
                ],
                "mapped": "products",
                "original": "products",
              },
            ],
            "type": "Query",
          },
          {
            "fieldMappings": [
              {
                "mapped": "page",
                "original": "page",
              },
              {
                "mapped": "limit",
                "original": "limit",
              },
            ],
            "type": "PaginationInput",
          },
          {
            "fieldMappings": [
              {
                "mapped": "name",
                "original": "name",
              },
              {
                "mapped": "min_price",
                "original": "minPrice",
              },
              {
                "mapped": "max_price",
                "original": "maxPrice",
              },
              {
                "mapped": "categories",
                "original": "categories",
              },
              {
                "mapped": "pagination",
                "original": "pagination",
              },
            ],
            "type": "ProductFilterInput",
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
                "mapped": "price",
                "original": "price",
              },
              {
                "mapped": "category",
                "original": "category",
              },
            ],
            "type": "Product",
          },
        ],
        "version": 1,
      }
    `);
  });
});
