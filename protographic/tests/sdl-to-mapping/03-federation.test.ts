import { describe, expect, it, test } from 'vitest';
import { compileGraphQLToMapping } from '../../src';

describe('GraphQL Federation to Proto Mapping', () => {
  it('maps basic federation entity with @key directive', () => {
    const sdl = `
      directive @key(fields: String!) on OBJECT
      
      type Product @key(fields: "id") {
        id: ID!
        name: String!
        price: Float!
      }
      
      type Query {
        product(id: ID!): Product
        products: [Product!]!
      }
    `;

    const mapping = compileGraphQLToMapping(sdl, 'ProductService');

    expect(mapping.toJson()).toMatchInlineSnapshot(`
      {
        "entityMappings": [
          {
            "key": "id",
            "kind": "entity",
            "request": "LookupProductByIdRequest",
            "response": "LookupProductByIdResponse",
            "rpc": "LookupProductById",
            "typeName": "Product",
          },
        ],
        "operationMappings": [
          {
            "mapped": "QueryProduct",
            "original": "product",
            "request": "QueryProductRequest",
            "response": "QueryProductResponse",
            "type": "OPERATION_TYPE_QUERY",
          },
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
                    "mapped": "id",
                    "original": "id",
                  },
                ],
                "mapped": "product",
                "original": "product",
              },
              {
                "mapped": "products",
                "original": "products",
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
                "mapped": "price",
                "original": "price",
              },
            ],
            "type": "Product",
          },
        ],
        "version": 1,
      }
    `);
  });

  it('maps multiple entities with @key directive', () => {
    const sdl = `
      directive @key(fields: String!) on OBJECT
      
      type User @key(fields: "id") {
        id: ID!
        name: String!
        email: String!
      }
      
      type Order @key(fields: "id") {
        id: ID!
        user: User!
        total: Float!
        date: String!
      }
      
      type Query {
        user(id: ID!): User
        users: [User!]!
        order(id: ID!): Order
        orders: [Order!]!
      }
    `;

    const mapping = compileGraphQLToMapping(sdl, 'ECommerceService');

    expect(mapping.toJson()).toMatchInlineSnapshot(`
      {
        "entityMappings": [
          {
            "key": "id",
            "kind": "entity",
            "request": "LookupUserByIdRequest",
            "response": "LookupUserByIdResponse",
            "rpc": "LookupUserById",
            "typeName": "User",
          },
          {
            "key": "id",
            "kind": "entity",
            "request": "LookupOrderByIdRequest",
            "response": "LookupOrderByIdResponse",
            "rpc": "LookupOrderById",
            "typeName": "Order",
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
            "mapped": "QueryUsers",
            "original": "users",
            "request": "QueryUsersRequest",
            "response": "QueryUsersResponse",
            "type": "OPERATION_TYPE_QUERY",
          },
          {
            "mapped": "QueryOrder",
            "original": "order",
            "request": "QueryOrderRequest",
            "response": "QueryOrderResponse",
            "type": "OPERATION_TYPE_QUERY",
          },
          {
            "mapped": "QueryOrders",
            "original": "orders",
            "request": "QueryOrdersRequest",
            "response": "QueryOrdersResponse",
            "type": "OPERATION_TYPE_QUERY",
          },
        ],
        "service": "ECommerceService",
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
                    "mapped": "id",
                    "original": "id",
                  },
                ],
                "mapped": "order",
                "original": "order",
              },
              {
                "mapped": "orders",
                "original": "orders",
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
                "mapped": "email",
                "original": "email",
              },
            ],
            "type": "User",
          },
          {
            "fieldMappings": [
              {
                "mapped": "id",
                "original": "id",
              },
              {
                "mapped": "user",
                "original": "user",
              },
              {
                "mapped": "total",
                "original": "total",
              },
              {
                "mapped": "date",
                "original": "date",
              },
            ],
            "type": "Order",
          },
        ],
        "version": 1,
      }
    `);
  });

  it('maps federation service with _entities query', () => {
    const sdl = `
      directive @key(fields: String!) on OBJECT
      
      type Product @key(fields: "id") {
        id: ID!
        name: String!
        price: Float!
      }
      
      type Storage @key(fields: "id") {
        id: ID!
        name: String!
        location: String!
      }
      
      type Query {
        _entities(representations: [_Any!]!): [_Entity!]!
        products: [Product!]!
      }
      
      union _Entity = Product | Storage
      scalar _Any
    `;

    const mapping = compileGraphQLToMapping(sdl, 'InventoryService');

    expect(mapping.toJson()).toMatchInlineSnapshot(`
      {
        "entityMappings": [
          {
            "key": "id",
            "kind": "entity",
            "request": "LookupProductByIdRequest",
            "response": "LookupProductByIdResponse",
            "rpc": "LookupProductById",
            "typeName": "Product",
          },
          {
            "key": "id",
            "kind": "entity",
            "request": "LookupStorageByIdRequest",
            "response": "LookupStorageByIdResponse",
            "rpc": "LookupStorageById",
            "typeName": "Storage",
          },
        ],
        "operationMappings": [
          {
            "mapped": "QueryProducts",
            "original": "products",
            "request": "QueryProductsRequest",
            "response": "QueryProductsResponse",
            "type": "OPERATION_TYPE_QUERY",
          },
        ],
        "service": "InventoryService",
        "typeFieldMappings": [
          {
            "fieldMappings": [
              {
                "mapped": "products",
                "original": "products",
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
                "mapped": "price",
                "original": "price",
              },
            ],
            "type": "Product",
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
                "mapped": "location",
                "original": "location",
              },
            ],
            "type": "Storage",
          },
        ],
        "version": 1,
      }
    `);
  });

  it('maps complex federation schema with multiple types', () => {
    const sdl = `
      directive @key(fields: String!) on OBJECT
      directive @extends on OBJECT
      
      type User @key(fields: "id") {
        id: ID!
        name: String!
      }
      
      type Review @key(fields: "id") {
        id: ID!
        text: String!
        rating: Int!
        product: Product!
        user: User!
      }
      
      type Product @key(fields: "id") @key(fields: "upc") {
        id: ID!
        upc: String!
        name: String!
        price: Float!
        reviews: [Review!]!
      }
      
      type Query {
        product(id: ID!): Product
        topProducts(first: Int = 5): [Product!]!
        review(id: ID!): Review
        _entities(representations: [_Any!]!): [_Entity!]!
      }
      
      union _Entity = Product | User | Review
      scalar _Any
    `;

    const mapping = compileGraphQLToMapping(sdl, 'ProductCatalogService');

    expect(mapping.toJson()).toMatchInlineSnapshot(`
      {
        "entityMappings": [
          {
            "key": "id",
            "kind": "entity",
            "request": "LookupUserByIdRequest",
            "response": "LookupUserByIdResponse",
            "rpc": "LookupUserById",
            "typeName": "User",
          },
          {
            "key": "id",
            "kind": "entity",
            "request": "LookupReviewByIdRequest",
            "response": "LookupReviewByIdResponse",
            "rpc": "LookupReviewById",
            "typeName": "Review",
          },
          {
            "key": "id",
            "kind": "entity",
            "request": "LookupProductByIdRequest",
            "response": "LookupProductByIdResponse",
            "rpc": "LookupProductById",
            "typeName": "Product",
          },
        ],
        "operationMappings": [
          {
            "mapped": "QueryProduct",
            "original": "product",
            "request": "QueryProductRequest",
            "response": "QueryProductResponse",
            "type": "OPERATION_TYPE_QUERY",
          },
          {
            "mapped": "QueryTopProducts",
            "original": "topProducts",
            "request": "QueryTopProductsRequest",
            "response": "QueryTopProductsResponse",
            "type": "OPERATION_TYPE_QUERY",
          },
          {
            "mapped": "QueryReview",
            "original": "review",
            "request": "QueryReviewRequest",
            "response": "QueryReviewResponse",
            "type": "OPERATION_TYPE_QUERY",
          },
        ],
        "service": "ProductCatalogService",
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
                "mapped": "product",
                "original": "product",
              },
              {
                "argumentMappings": [
                  {
                    "mapped": "first",
                    "original": "first",
                  },
                ],
                "mapped": "top_products",
                "original": "topProducts",
              },
              {
                "argumentMappings": [
                  {
                    "mapped": "id",
                    "original": "id",
                  },
                ],
                "mapped": "review",
                "original": "review",
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
          {
            "fieldMappings": [
              {
                "mapped": "id",
                "original": "id",
              },
              {
                "mapped": "text",
                "original": "text",
              },
              {
                "mapped": "rating",
                "original": "rating",
              },
              {
                "mapped": "product",
                "original": "product",
              },
              {
                "mapped": "user",
                "original": "user",
              },
            ],
            "type": "Review",
          },
          {
            "fieldMappings": [
              {
                "mapped": "id",
                "original": "id",
              },
              {
                "mapped": "upc",
                "original": "upc",
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
                "mapped": "reviews",
                "original": "reviews",
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
