import { describe, expect, it, test } from 'vitest';
import { compileGraphQLToMapping } from '../../src/index.js';

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
          {
            "key": "upc",
            "kind": "entity",
            "request": "LookupProductByUpcRequest",
            "response": "LookupProductByUpcResponse",
            "rpc": "LookupProductByUpc",
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

  it('maps entity with multiple @key directives to separate entity mappings', () => {
    const sdl = `
      directive @key(fields: String!) on OBJECT
      
      type Product @key(fields: "id") @key(fields: "upc") {
        id: ID!
        upc: String!
        name: String!
        price: Float!
      }
      
      type Query {
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
          {
            "key": "upc",
            "kind": "entity",
            "request": "LookupProductByUpcRequest",
            "response": "LookupProductByUpcResponse",
            "rpc": "LookupProductByUpc",
            "typeName": "Product",
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
        "service": "ProductService",
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
            ],
            "type": "Product",
          },
        ],
        "version": 1,
      }
    `);
  });

  it('correctly handles malformed key fields', () => {
    // fields has a space after id
    const sdl = `
      directive @key(fields: String!) on OBJECT
      
      type Product @key(fields: "id ") {
        id: ID!
        upc: String!
        name: String!
        price: Float!
      }
      
      type Query {
        products: [Product!]!
      }
    `;

    const mapping = compileGraphQLToMapping(sdl, 'ProductService');

    expect(mapping.toJson()).toMatchInlineSnapshot(`
      {
        "entityMappings": [
          {
            "key": "id ",
            "kind": "entity",
            "request": "LookupProductByIdRequest",
            "response": "LookupProductByIdResponse",
            "rpc": "LookupProductById",
            "typeName": "Product",
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
        "service": "ProductService",
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
            ],
            "type": "Product",
          },
        ],
        "version": 1,
      }
    `);
  });

  it('maps entity with compound key fields to single entity mapping', () => {
    const sdl = `
      directive @key(fields: String!) on OBJECT
      
      type OrderItem @key(fields: "orderId itemId") @key(fields: "itemId orderId") {
        orderId: ID!
        itemId: ID!
        quantity: Int!
        price: Float!
      }
      
      type Query {
        orderItems: [OrderItem!]!
      }
    `;

    const mapping = compileGraphQLToMapping(sdl, 'OrderService');

    expect(mapping.toJson()).toMatchInlineSnapshot(`
      {
        "entityMappings": [
          {
            "key": "orderId itemId",
            "kind": "entity",
            "request": "LookupOrderItemByItemIdAndOrderIdRequest",
            "response": "LookupOrderItemByItemIdAndOrderIdResponse",
            "rpc": "LookupOrderItemByItemIdAndOrderId",
            "typeName": "OrderItem",
          },
          {
            "key": "itemId orderId",
            "kind": "entity",
            "request": "LookupOrderItemByItemIdAndOrderIdRequest",
            "response": "LookupOrderItemByItemIdAndOrderIdResponse",
            "rpc": "LookupOrderItemByItemIdAndOrderId",
            "typeName": "OrderItem",
          },
        ],
        "operationMappings": [
          {
            "mapped": "QueryOrderItems",
            "original": "orderItems",
            "request": "QueryOrderItemsRequest",
            "response": "QueryOrderItemsResponse",
            "type": "OPERATION_TYPE_QUERY",
          },
        ],
        "service": "OrderService",
        "typeFieldMappings": [
          {
            "fieldMappings": [
              {
                "mapped": "order_items",
                "original": "orderItems",
              },
            ],
            "type": "Query",
          },
          {
            "fieldMappings": [
              {
                "mapped": "order_id",
                "original": "orderId",
              },
              {
                "mapped": "item_id",
                "original": "itemId",
              },
              {
                "mapped": "quantity",
                "original": "quantity",
              },
              {
                "mapped": "price",
                "original": "price",
              },
            ],
            "type": "OrderItem",
          },
        ],
        "version": 1,
      }
    `);
  });

  it('maps entity with mixed multiple and compound keys', () => {
    const sdl = `
      directive @key(fields: String!) on OBJECT
      
      type Product @key(fields: "id") @key(fields: "manufacturerId productCode") {
        id: ID!
        manufacturerId: ID!
        productCode: String!
        name: String!
        price: Float!
      }
      
      type Query {
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
          {
            "key": "manufacturerId productCode",
            "kind": "entity",
            "request": "LookupProductByManufacturerIdAndProductCodeRequest",
            "response": "LookupProductByManufacturerIdAndProductCodeResponse",
            "rpc": "LookupProductByManufacturerIdAndProductCode",
            "typeName": "Product",
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
        "service": "ProductService",
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
                "mapped": "manufacturer_id",
                "original": "manufacturerId",
              },
              {
                "mapped": "product_code",
                "original": "productCode",
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

  it('maps entity with mixed multiple and compound keys with commas and extra spaces', () => {
    const sdl = `
      directive @key(fields: String!) on OBJECT
      
      type Product @key(fields: "id") @key(fields: "manufacturerId,    productCode") {
        id: ID!
        manufacturerId: ID!
        productCode: String!
        name: String!
        price: Float!
      }
      
      type Query {
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
          {
            "key": "manufacturerId,    productCode",
            "kind": "entity",
            "request": "LookupProductByManufacturerIdAndProductCodeRequest",
            "response": "LookupProductByManufacturerIdAndProductCodeResponse",
            "rpc": "LookupProductByManufacturerIdAndProductCode",
            "typeName": "Product",
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
        "service": "ProductService",
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
                "mapped": "manufacturer_id",
                "original": "manufacturerId",
              },
              {
                "mapped": "product_code",
                "original": "productCode",
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

  it('maps entity with required and external fields', () => {
    const sdl = `
      directive @key(fields: String!) on OBJECT
      
      type Product @key(fields: "id") {
        id: ID!
        price: Float! @external
        itemCount: Int! @external
        stockHealthScore: Float! @requires(fields: "itemCount price")
      }
      
      type Query {
        products: [Product!]!
      }
    `;

    const mapping = compileGraphQLToMapping(sdl, 'ProductService');

    // RequireWarehouseStockHealthScoreByIdFields.RestockData
    expect(mapping.toJson()).toMatchInlineSnapshot(`
      {
        "entityMappings": [
          {
            "key": "id",
            "kind": "entity",
            "request": "LookupProductByIdRequest",
            "requiredFieldMappings": [
              {
                "fieldMapping": {
                  "mapped": "stock_health_score",
                  "original": "stockHealthScore",
                },
                "request": "RequireProductStockHealthScoreByIdRequest",
                "response": "RequireProductStockHealthScoreByIdResponse",
                "rpc": "RequireProductStockHealthScoreById",
              },
            ],
            "response": "LookupProductByIdResponse",
            "rpc": "LookupProductById",
            "typeName": "Product",
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
        "service": "ProductService",
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
                "mapped": "price",
                "original": "price",
              },
              {
                "mapped": "item_count",
                "original": "itemCount",
              },
              {
                "mapped": "stock_health_score",
                "original": "stockHealthScore",
              },
            ],
            "type": "Product",
          },
        ],
        "version": 1,
      }
    `);
  });

  it('maps entity with required and external fields with nested fields', () => {
    const sdl = `
      directive @key(fields: String!) on OBJECT
      
      type Product @key(fields: "id") {
        id: ID!
        name: String!
        price: Float! @external
        itemCount: Int! @external
        restockData: RestockData! @external
        stockHealthScore: Float! @requires(fields: "itemCount restockData { lastRestockDate } price")
      }

      type RestockData {
        lastRestockDate: String!
      }
      
      type Query {
        products: [Product!]!
      }
    `;

    const mapping = compileGraphQLToMapping(sdl, 'ProductService');

    // RequireWarehouseStockHealthScoreByIdFields.RestockData
    expect(mapping.toJson()).toMatchInlineSnapshot(`
      {
        "entityMappings": [
          {
            "key": "id",
            "kind": "entity",
            "request": "LookupProductByIdRequest",
            "requiredFieldMappings": [
              {
                "fieldMapping": {
                  "mapped": "stock_health_score",
                  "original": "stockHealthScore",
                },
                "request": "RequireProductStockHealthScoreByIdRequest",
                "response": "RequireProductStockHealthScoreByIdResponse",
                "rpc": "RequireProductStockHealthScoreById",
              },
            ],
            "response": "LookupProductByIdResponse",
            "rpc": "LookupProductById",
            "typeName": "Product",
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
        "service": "ProductService",
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
              {
                "mapped": "item_count",
                "original": "itemCount",
              },
              {
                "mapped": "restock_data",
                "original": "restockData",
              },
              {
                "mapped": "stock_health_score",
                "original": "stockHealthScore",
              },
            ],
            "type": "Product",
          },
          {
            "fieldMappings": [
              {
                "mapped": "last_restock_date",
                "original": "lastRestockDate",
              },
            ],
            "type": "RestockData",
          },
        ],
        "version": 1,
      }
    `);
  });

  it('maps entity with multiple key directives and required fields', () => {
    const sdl = `
      directive @key(fields: String!) repeatable on OBJECT

      type Product @key(fields: "id") @key(fields: "sku") {
        id: ID!
        sku: String!
        price: Float! @external
        itemCount: Int! @external
        stockHealthScore: Float! @requires(fields: "itemCount price")
      }

      type Query {
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
            "requiredFieldMappings": [
              {
                "fieldMapping": {
                  "mapped": "stock_health_score",
                  "original": "stockHealthScore",
                },
                "request": "RequireProductStockHealthScoreByIdRequest",
                "response": "RequireProductStockHealthScoreByIdResponse",
                "rpc": "RequireProductStockHealthScoreById",
              },
            ],
            "response": "LookupProductByIdResponse",
            "rpc": "LookupProductById",
            "typeName": "Product",
          },
          {
            "key": "sku",
            "kind": "entity",
            "request": "LookupProductBySkuRequest",
            "requiredFieldMappings": [
              {
                "fieldMapping": {
                  "mapped": "stock_health_score",
                  "original": "stockHealthScore",
                },
                "request": "RequireProductStockHealthScoreBySkuRequest",
                "response": "RequireProductStockHealthScoreBySkuResponse",
                "rpc": "RequireProductStockHealthScoreBySku",
              },
            ],
            "response": "LookupProductBySkuResponse",
            "rpc": "LookupProductBySku",
            "typeName": "Product",
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
        "service": "ProductService",
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
                "mapped": "sku",
                "original": "sku",
              },
              {
                "mapped": "price",
                "original": "price",
              },
              {
                "mapped": "item_count",
                "original": "itemCount",
              },
              {
                "mapped": "stock_health_score",
                "original": "stockHealthScore",
              },
            ],
            "type": "Product",
          },
        ],
        "version": 1,
      }
    `);
  });

  it('maps entity with compound key and required fields', () => {
    const sdl = `
      directive @key(fields: String!) on OBJECT

      type Product @key(fields: "id sku") {
        id: ID!
        sku: String!
        manufacturerId: ID! @external
        categoryCode: String! @external
        displayName: String! @requires(fields: "manufacturerId categoryCode")
      }

      type Query {
        products: [Product!]!
      }
    `;

    const mapping = compileGraphQLToMapping(sdl, 'ProductService');

    expect(mapping.toJson()).toMatchInlineSnapshot(`
      {
        "entityMappings": [
          {
            "key": "id sku",
            "kind": "entity",
            "request": "LookupProductByIdAndSkuRequest",
            "requiredFieldMappings": [
              {
                "fieldMapping": {
                  "mapped": "display_name",
                  "original": "displayName",
                },
                "request": "RequireProductDisplayNameByIdAndSkuRequest",
                "response": "RequireProductDisplayNameByIdAndSkuResponse",
                "rpc": "RequireProductDisplayNameByIdAndSku",
              },
            ],
            "response": "LookupProductByIdAndSkuResponse",
            "rpc": "LookupProductByIdAndSku",
            "typeName": "Product",
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
        "service": "ProductService",
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
                "mapped": "sku",
                "original": "sku",
              },
              {
                "mapped": "manufacturer_id",
                "original": "manufacturerId",
              },
              {
                "mapped": "category_code",
                "original": "categoryCode",
              },
              {
                "mapped": "display_name",
                "original": "displayName",
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
