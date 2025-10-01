import { describe, expect, test } from 'vitest';
import { compileGraphQLToProto } from '../../src';
import { expectValidProto } from '../util';

describe('SDL to Proto - Federation and Special Types', () => {
  test('should handle entity types with @key directive', () => {
    const sdl = `
      directive @key(fields: String!) on OBJECT | INTERFACE
      
      type Product @key(fields: "id") {
        id: ID!
        name: String!
        price: Float!
      }
      
      type User @key(fields: "id") {
        id: ID!
        name: String!
        email: String!
      }
      
      type Query {
        product(id: ID!): Product
        _entities(representations: [_Any!]!): [_Entity]!
      }
      
      scalar _Any
      union _Entity = Product | User
    `;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    // Validate Proto definition
    expectValidProto(protoText);

    // Check that entity lookup operations are present
    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      // Service definition for DefaultService
      service DefaultService {
        // Lookup Product entity by id
        rpc LookupProductById(LookupProductByIdRequest) returns (LookupProductByIdResponse) {}
        // Lookup User entity by id
        rpc LookupUserById(LookupUserByIdRequest) returns (LookupUserByIdResponse) {}
        rpc QueryProduct(QueryProductRequest) returns (QueryProductResponse) {}
      }

      // Key message for Product entity lookup
      message LookupProductByIdRequestKey {
        // Key field for Product entity lookup.
        string id = 1;
      }

      // Request message for Product entity lookup.
      message LookupProductByIdRequest {
        /*
         * List of keys to look up Product entities.
         * Order matters - each key maps to one entity in LookupProductByIdResponse.
         */
        repeated LookupProductByIdRequestKey keys = 1;
      }

      // Response message for Product entity lookup.
      message LookupProductByIdResponse {
        /*
         * List of Product entities in the same order as the keys in LookupProductByIdRequest.
         * Always return the same number of entities as keys. Use null for entities that cannot be found.
         * 
         * Example:
         *   LookupUserByIdRequest:
         *     keys:
         *       - id: 1
         *       - id: 2
         *   LookupUserByIdResponse:
         *     result:
         *       - id: 1 # User with id 1 found
         *       - null  # User with id 2 not found
         */
        repeated Product result = 1;
      }

      // Key message for User entity lookup
      message LookupUserByIdRequestKey {
        // Key field for User entity lookup.
        string id = 1;
      }

      // Request message for User entity lookup.
      message LookupUserByIdRequest {
        /*
         * List of keys to look up User entities.
         * Order matters - each key maps to one entity in LookupUserByIdResponse.
         */
        repeated LookupUserByIdRequestKey keys = 1;
      }

      // Response message for User entity lookup.
      message LookupUserByIdResponse {
        /*
         * List of User entities in the same order as the keys in LookupUserByIdRequest.
         * Always return the same number of entities as keys. Use null for entities that cannot be found.
         * 
         * Example:
         *   LookupUserByIdRequest:
         *     keys:
         *       - id: 1
         *       - id: 2
         *   LookupUserByIdResponse:
         *     result:
         *       - id: 1 # User with id 1 found
         *       - null  # User with id 2 not found
         */
        repeated User result = 1;
      }

      // Request message for product operation.
      message QueryProductRequest {
        string id = 1;
      }
      // Response message for product operation.
      message QueryProductResponse {
        Product product = 1;
      }

      message Product {
        string id = 1;
        string name = 2;
        double price = 3;
      }

      message User {
        string id = 1;
        string name = 2;
        string email = 3;
      }"
    `);
  });

  test('should handle entity types with composite key', () => {
    const sdl = `
      directive @key(fields: String!) on OBJECT | INTERFACE
      
      type OrderItem @key(fields: "orderId itemId") {
        orderId: ID!
        itemId: ID!
        quantity: Int!
        price: Float!
      }
      
      type Query {
        orderItem(orderId: ID!, itemId: ID!): OrderItem
      }
    `;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    // Validate Proto definition
    expectValidProto(protoText);

    // Check that all required components are present
    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      // Service definition for DefaultService
      service DefaultService {
        // Lookup OrderItem entity by itemId and orderId
        rpc LookupOrderItemByItemIdAndOrderId(LookupOrderItemByItemIdAndOrderIdRequest) returns (LookupOrderItemByItemIdAndOrderIdResponse) {}
        rpc QueryOrderItem(QueryOrderItemRequest) returns (QueryOrderItemResponse) {}
      }

      // Key message for OrderItem entity lookup
      message LookupOrderItemByItemIdAndOrderIdRequestKey {
        // Key field for OrderItem entity lookup.
        string item_id = 1;
        // Key field for OrderItem entity lookup.
        string order_id = 2;
      }

      // Request message for OrderItem entity lookup.
      message LookupOrderItemByItemIdAndOrderIdRequest {
        /*
         * List of keys to look up OrderItem entities.
         * Order matters - each key maps to one entity in LookupOrderItemByItemIdAndOrderIdResponse.
         */
        repeated LookupOrderItemByItemIdAndOrderIdRequestKey keys = 1;
      }

      // Response message for OrderItem entity lookup.
      message LookupOrderItemByItemIdAndOrderIdResponse {
        /*
         * List of OrderItem entities in the same order as the keys in LookupOrderItemByItemIdAndOrderIdRequest.
         * Always return the same number of entities as keys. Use null for entities that cannot be found.
         * 
         * Example:
         *   LookupUserByIdRequest:
         *     keys:
         *       - id: 1
         *       - id: 2
         *   LookupUserByIdResponse:
         *     result:
         *       - id: 1 # User with id 1 found
         *       - null  # User with id 2 not found
         */
        repeated OrderItem result = 1;
      }

      // Request message for orderItem operation.
      message QueryOrderItemRequest {
        string order_id = 1;
        string item_id = 2;
      }
      // Response message for orderItem operation.
      message QueryOrderItemResponse {
        OrderItem order_item = 1;
      }

      message OrderItem {
        string order_id = 1;
        string item_id = 2;
        int32 quantity = 3;
        double price = 4;
      }"
    `);
  });

  test('should handle directive syntax with interfaces', () => {
    const sdl = `
      directive @key(fields: String!) on OBJECT | INTERFACE
      
      interface Node @key(fields: "id") {
        id: ID!
      }
      
      type User implements Node @key(fields: "id") {
        id: ID!
        name: String!
      }
      
      type Product implements Node @key(fields: "id") {
        id: ID!
        name: String!
        price: Float!
      }
      
      type Query {
        node(id: ID!): Node
        _entities(representations: [_Any!]!): [_Entity]!
      }
      
      scalar _Any
      union _Entity = User | Product
    `;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    // Validate Proto definition
    expectValidProto(protoText);

    // Check that entity lookup operations are present
    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      // Service definition for DefaultService
      service DefaultService {
        // Lookup Product entity by id
        rpc LookupProductById(LookupProductByIdRequest) returns (LookupProductByIdResponse) {}
        // Lookup User entity by id
        rpc LookupUserById(LookupUserByIdRequest) returns (LookupUserByIdResponse) {}
        rpc QueryNode(QueryNodeRequest) returns (QueryNodeResponse) {}
      }

      // Key message for User entity lookup
      message LookupUserByIdRequestKey {
        // Key field for User entity lookup.
        string id = 1;
      }

      // Request message for User entity lookup.
      message LookupUserByIdRequest {
        /*
         * List of keys to look up User entities.
         * Order matters - each key maps to one entity in LookupUserByIdResponse.
         */
        repeated LookupUserByIdRequestKey keys = 1;
      }

      // Response message for User entity lookup.
      message LookupUserByIdResponse {
        /*
         * List of User entities in the same order as the keys in LookupUserByIdRequest.
         * Always return the same number of entities as keys. Use null for entities that cannot be found.
         * 
         * Example:
         *   LookupUserByIdRequest:
         *     keys:
         *       - id: 1
         *       - id: 2
         *   LookupUserByIdResponse:
         *     result:
         *       - id: 1 # User with id 1 found
         *       - null  # User with id 2 not found
         */
        repeated User result = 1;
      }

      // Key message for Product entity lookup
      message LookupProductByIdRequestKey {
        // Key field for Product entity lookup.
        string id = 1;
      }

      // Request message for Product entity lookup.
      message LookupProductByIdRequest {
        /*
         * List of keys to look up Product entities.
         * Order matters - each key maps to one entity in LookupProductByIdResponse.
         */
        repeated LookupProductByIdRequestKey keys = 1;
      }

      // Response message for Product entity lookup.
      message LookupProductByIdResponse {
        /*
         * List of Product entities in the same order as the keys in LookupProductByIdRequest.
         * Always return the same number of entities as keys. Use null for entities that cannot be found.
         * 
         * Example:
         *   LookupUserByIdRequest:
         *     keys:
         *       - id: 1
         *       - id: 2
         *   LookupUserByIdResponse:
         *     result:
         *       - id: 1 # User with id 1 found
         *       - null  # User with id 2 not found
         */
        repeated Product result = 1;
      }

      // Request message for node operation.
      message QueryNodeRequest {
        string id = 1;
      }
      // Response message for node operation.
      message QueryNodeResponse {
        Node node = 1;
      }

      message User {
        string id = 1;
        string name = 2;
      }

      message Product {
        string id = 1;
        string name = 2;
        double price = 3;
      }

      message Node {
        oneof instance {
        User user = 1;
        Product product = 2;
        }
      }"
    `);
  });

  test('should handle special scalar types', () => {
    const sdl = `
      scalar DateTime
      scalar JSON
      scalar Upload
      
      type Event {
        id: ID!
        name: String!
        startTime: DateTime!
        endTime: DateTime
        metadata: JSON
        attachment: Upload
      }
      
      type Query {
        events: [Event!]!
        event(id: ID!): Event
      }
    `;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    // Validate Proto definition
    expectValidProto(protoText);

    // Check that all required components are present
    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      import "google/protobuf/wrappers.proto";

      // Service definition for DefaultService
      service DefaultService {
        rpc QueryEvent(QueryEventRequest) returns (QueryEventResponse) {}
        rpc QueryEvents(QueryEventsRequest) returns (QueryEventsResponse) {}
      }

      // Request message for events operation.
      message QueryEventsRequest {
      }
      // Response message for events operation.
      message QueryEventsResponse {
        repeated Event events = 1;
      }
      // Request message for event operation.
      message QueryEventRequest {
        string id = 1;
      }
      // Response message for event operation.
      message QueryEventResponse {
        Event event = 1;
      }

      message Event {
        string id = 1;
        string name = 2;
        string start_time = 3;
        google.protobuf.StringValue end_time = 4;
        google.protobuf.StringValue metadata = 5;
        google.protobuf.StringValue attachment = 6;
      }"
    `);
  });

  test('should handle entity types with multiple @key directives', () => {
    const sdl = `
      directive @key(fields: String!) on OBJECT | INTERFACE
      
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

    const { proto: protoText } = compileGraphQLToProto(sdl);

    // Validate Proto definition
    expectValidProto(protoText);

    // Check that both lookup operations are present
    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      // Service definition for DefaultService
      service DefaultService {
        // Lookup Product entity by id
        rpc LookupProductById(LookupProductByIdRequest) returns (LookupProductByIdResponse) {}
        // Lookup Product entity by upc
        rpc LookupProductByUpc(LookupProductByUpcRequest) returns (LookupProductByUpcResponse) {}
        rpc QueryProducts(QueryProductsRequest) returns (QueryProductsResponse) {}
      }

      // Key message for Product entity lookup
      message LookupProductByIdRequestKey {
        // Key field for Product entity lookup.
        string id = 1;
      }

      // Request message for Product entity lookup.
      message LookupProductByIdRequest {
        /*
         * List of keys to look up Product entities.
         * Order matters - each key maps to one entity in LookupProductByIdResponse.
         */
        repeated LookupProductByIdRequestKey keys = 1;
      }

      // Response message for Product entity lookup.
      message LookupProductByIdResponse {
        /*
         * List of Product entities in the same order as the keys in LookupProductByIdRequest.
         * Always return the same number of entities as keys. Use null for entities that cannot be found.
         * 
         * Example:
         *   LookupUserByIdRequest:
         *     keys:
         *       - id: 1
         *       - id: 2
         *   LookupUserByIdResponse:
         *     result:
         *       - id: 1 # User with id 1 found
         *       - null  # User with id 2 not found
         */
        repeated Product result = 1;
      }

      // Key message for Product entity lookup
      message LookupProductByUpcRequestKey {
        // Key field for Product entity lookup.
        string upc = 1;
      }

      // Request message for Product entity lookup.
      message LookupProductByUpcRequest {
        /*
         * List of keys to look up Product entities.
         * Order matters - each key maps to one entity in LookupProductByUpcResponse.
         */
        repeated LookupProductByUpcRequestKey keys = 1;
      }

      // Response message for Product entity lookup.
      message LookupProductByUpcResponse {
        /*
         * List of Product entities in the same order as the keys in LookupProductByUpcRequest.
         * Always return the same number of entities as keys. Use null for entities that cannot be found.
         * 
         * Example:
         *   LookupUserByIdRequest:
         *     keys:
         *       - id: 1
         *       - id: 2
         *   LookupUserByIdResponse:
         *     result:
         *       - id: 1 # User with id 1 found
         *       - null  # User with id 2 not found
         */
        repeated Product result = 1;
      }

      // Request message for products operation.
      message QueryProductsRequest {
      }
      // Response message for products operation.
      message QueryProductsResponse {
        repeated Product products = 1;
      }

      message Product {
        string id = 1;
        string upc = 2;
        string name = 3;
        double price = 4;
      }"
    `);
  });

  test('should handle entity types with proper compound key fields', () => {
    const sdl = `
      directive @key(fields: String!) on OBJECT | INTERFACE
      
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

    const { proto: protoText } = compileGraphQLToProto(sdl);

    // Validate Proto definition
    expectValidProto(protoText);

    // Check that compound key lookup with both fields is present
    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      // Service definition for DefaultService
      service DefaultService {
        // Lookup OrderItem entity by itemId and orderId
        rpc LookupOrderItemByItemIdAndOrderId(LookupOrderItemByItemIdAndOrderIdRequest) returns (LookupOrderItemByItemIdAndOrderIdResponse) {}
        rpc QueryOrderItems(QueryOrderItemsRequest) returns (QueryOrderItemsResponse) {}
      }

      // Key message for OrderItem entity lookup
      message LookupOrderItemByItemIdAndOrderIdRequestKey {
        // Key field for OrderItem entity lookup.
        string item_id = 1;
        // Key field for OrderItem entity lookup.
        string order_id = 2;
      }

      // Request message for OrderItem entity lookup.
      message LookupOrderItemByItemIdAndOrderIdRequest {
        /*
         * List of keys to look up OrderItem entities.
         * Order matters - each key maps to one entity in LookupOrderItemByItemIdAndOrderIdResponse.
         */
        repeated LookupOrderItemByItemIdAndOrderIdRequestKey keys = 1;
      }

      // Response message for OrderItem entity lookup.
      message LookupOrderItemByItemIdAndOrderIdResponse {
        /*
         * List of OrderItem entities in the same order as the keys in LookupOrderItemByItemIdAndOrderIdRequest.
         * Always return the same number of entities as keys. Use null for entities that cannot be found.
         * 
         * Example:
         *   LookupUserByIdRequest:
         *     keys:
         *       - id: 1
         *       - id: 2
         *   LookupUserByIdResponse:
         *     result:
         *       - id: 1 # User with id 1 found
         *       - null  # User with id 2 not found
         */
        repeated OrderItem result = 1;
      }

      // Request message for orderItems operation.
      message QueryOrderItemsRequest {
      }
      // Response message for orderItems operation.
      message QueryOrderItemsResponse {
        repeated OrderItem order_items = 1;
      }

      message OrderItem {
        string order_id = 1;
        string item_id = 2;
        int32 quantity = 3;
        double price = 4;
      }"
    `);
  });

  test('should handle entity types with proper compound key fields with extra commas and spaces', () => {
    const sdl = `
      directive @key(fields: String!) on OBJECT | INTERFACE
      
      type OrderItem @key(fields: "     ,orderId,     itemId, ") {
        orderId: ID!
        itemId: ID!
        quantity: Int!
        price: Float!
      }
      
      type Query {
        orderItems: [OrderItem!]!
      }
    `;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    // Validate Proto definition
    expectValidProto(protoText);

    // Check that compound key lookup with both fields is present
    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      // Service definition for DefaultService
      service DefaultService {
        // Lookup OrderItem entity by itemId and orderId
        rpc LookupOrderItemByItemIdAndOrderId(LookupOrderItemByItemIdAndOrderIdRequest) returns (LookupOrderItemByItemIdAndOrderIdResponse) {}
        rpc QueryOrderItems(QueryOrderItemsRequest) returns (QueryOrderItemsResponse) {}
      }

      // Key message for OrderItem entity lookup
      message LookupOrderItemByItemIdAndOrderIdRequestKey {
        // Key field for OrderItem entity lookup.
        string item_id = 1;
        // Key field for OrderItem entity lookup.
        string order_id = 2;
      }

      // Request message for OrderItem entity lookup.
      message LookupOrderItemByItemIdAndOrderIdRequest {
        /*
         * List of keys to look up OrderItem entities.
         * Order matters - each key maps to one entity in LookupOrderItemByItemIdAndOrderIdResponse.
         */
        repeated LookupOrderItemByItemIdAndOrderIdRequestKey keys = 1;
      }

      // Response message for OrderItem entity lookup.
      message LookupOrderItemByItemIdAndOrderIdResponse {
        /*
         * List of OrderItem entities in the same order as the keys in LookupOrderItemByItemIdAndOrderIdRequest.
         * Always return the same number of entities as keys. Use null for entities that cannot be found.
         * 
         * Example:
         *   LookupUserByIdRequest:
         *     keys:
         *       - id: 1
         *       - id: 2
         *   LookupUserByIdResponse:
         *     result:
         *       - id: 1 # User with id 1 found
         *       - null  # User with id 2 not found
         */
        repeated OrderItem result = 1;
      }

      // Request message for orderItems operation.
      message QueryOrderItemsRequest {
      }
      // Response message for orderItems operation.
      message QueryOrderItemsResponse {
        repeated OrderItem order_items = 1;
      }

      message OrderItem {
        string order_id = 1;
        string item_id = 2;
        int32 quantity = 3;
        double price = 4;
      }"
    `);
  });

  test('should handle entity types with mixed multiple and compound keys', () => {
    const sdl = `
      directive @key(fields: String!) on OBJECT | INTERFACE
      
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

    const { proto: protoText } = compileGraphQLToProto(sdl);

    // Validate Proto definition
    expectValidProto(protoText);

    // Check that both single and compound key lookups are present
    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      // Service definition for DefaultService
      service DefaultService {
        // Lookup Product entity by id
        rpc LookupProductById(LookupProductByIdRequest) returns (LookupProductByIdResponse) {}
        // Lookup Product entity by manufacturerId and productCode
        rpc LookupProductByManufacturerIdAndProductCode(LookupProductByManufacturerIdAndProductCodeRequest) returns (LookupProductByManufacturerIdAndProductCodeResponse) {}
        rpc QueryProducts(QueryProductsRequest) returns (QueryProductsResponse) {}
      }

      // Key message for Product entity lookup
      message LookupProductByIdRequestKey {
        // Key field for Product entity lookup.
        string id = 1;
      }

      // Request message for Product entity lookup.
      message LookupProductByIdRequest {
        /*
         * List of keys to look up Product entities.
         * Order matters - each key maps to one entity in LookupProductByIdResponse.
         */
        repeated LookupProductByIdRequestKey keys = 1;
      }

      // Response message for Product entity lookup.
      message LookupProductByIdResponse {
        /*
         * List of Product entities in the same order as the keys in LookupProductByIdRequest.
         * Always return the same number of entities as keys. Use null for entities that cannot be found.
         * 
         * Example:
         *   LookupUserByIdRequest:
         *     keys:
         *       - id: 1
         *       - id: 2
         *   LookupUserByIdResponse:
         *     result:
         *       - id: 1 # User with id 1 found
         *       - null  # User with id 2 not found
         */
        repeated Product result = 1;
      }

      // Key message for Product entity lookup
      message LookupProductByManufacturerIdAndProductCodeRequestKey {
        // Key field for Product entity lookup.
        string manufacturer_id = 1;
        // Key field for Product entity lookup.
        string product_code = 2;
      }

      // Request message for Product entity lookup.
      message LookupProductByManufacturerIdAndProductCodeRequest {
        /*
         * List of keys to look up Product entities.
         * Order matters - each key maps to one entity in LookupProductByManufacturerIdAndProductCodeResponse.
         */
        repeated LookupProductByManufacturerIdAndProductCodeRequestKey keys = 1;
      }

      // Response message for Product entity lookup.
      message LookupProductByManufacturerIdAndProductCodeResponse {
        /*
         * List of Product entities in the same order as the keys in LookupProductByManufacturerIdAndProductCodeRequest.
         * Always return the same number of entities as keys. Use null for entities that cannot be found.
         * 
         * Example:
         *   LookupUserByIdRequest:
         *     keys:
         *       - id: 1
         *       - id: 2
         *   LookupUserByIdResponse:
         *     result:
         *       - id: 1 # User with id 1 found
         *       - null  # User with id 2 not found
         */
        repeated Product result = 1;
      }

      // Request message for products operation.
      message QueryProductsRequest {
      }
      // Response message for products operation.
      message QueryProductsResponse {
        repeated Product products = 1;
      }

      message Product {
        string id = 1;
        string manufacturer_id = 2;
        string product_code = 3;
        string name = 4;
        double price = 5;
      }"
    `);
  });
  test('should not generate lookup methods for non-resolvable keys', () => {
    const sdl = `
      scalar openfed__FieldSet
      directive @key(fields: openfed__FieldSet!, resolvable: Boolean = true) repeatable on INTERFACE | OBJECT
      
      type Product @key(fields: "id", resolvable: false) @key(fields: "manufacturerId productCode", resolvable: false) {
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

    const { proto: protoText } = compileGraphQLToProto(sdl);

    // Validate Proto definition
    expectValidProto(protoText);

    // Check that no lookup methods are generated for non-resolvable keys
    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      // Service definition for DefaultService
      service DefaultService {
        rpc QueryProducts(QueryProductsRequest) returns (QueryProductsResponse) {}
      }

      // Request message for products operation.
      message QueryProductsRequest {
      }
      // Response message for products operation.
      message QueryProductsResponse {
        repeated Product products = 1;
      }

      message Product {
        string id = 1;
        string manufacturer_id = 2;
        string product_code = 3;
        string name = 4;
        double price = 5;
      }"
    `);
  });
  test('should generate lookup methods for resolvable keys', () => {
    const sdl = `
      scalar openfed__FieldSet
      directive @key(fields: openfed__FieldSet!, resolvable: Boolean = true) repeatable on INTERFACE | OBJECT
      
      type Product @key(fields: "id", resolvable: false) @key(fields: "manufacturerId productCode", resolvable: true) {
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

    const { proto: protoText } = compileGraphQLToProto(sdl);

    // Validate Proto definition
    expectValidProto(protoText);

    // Expect that only the resolvable key is generated
    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      // Service definition for DefaultService
      service DefaultService {
        // Lookup Product entity by manufacturerId and productCode
        rpc LookupProductByManufacturerIdAndProductCode(LookupProductByManufacturerIdAndProductCodeRequest) returns (LookupProductByManufacturerIdAndProductCodeResponse) {}
        rpc QueryProducts(QueryProductsRequest) returns (QueryProductsResponse) {}
      }

      // Key message for Product entity lookup
      message LookupProductByManufacturerIdAndProductCodeRequestKey {
        // Key field for Product entity lookup.
        string manufacturer_id = 1;
        // Key field for Product entity lookup.
        string product_code = 2;
      }

      // Request message for Product entity lookup.
      message LookupProductByManufacturerIdAndProductCodeRequest {
        /*
         * List of keys to look up Product entities.
         * Order matters - each key maps to one entity in LookupProductByManufacturerIdAndProductCodeResponse.
         */
        repeated LookupProductByManufacturerIdAndProductCodeRequestKey keys = 1;
      }

      // Response message for Product entity lookup.
      message LookupProductByManufacturerIdAndProductCodeResponse {
        /*
         * List of Product entities in the same order as the keys in LookupProductByManufacturerIdAndProductCodeRequest.
         * Always return the same number of entities as keys. Use null for entities that cannot be found.
         * 
         * Example:
         *   LookupUserByIdRequest:
         *     keys:
         *       - id: 1
         *       - id: 2
         *   LookupUserByIdResponse:
         *     result:
         *       - id: 1 # User with id 1 found
         *       - null  # User with id 2 not found
         */
        repeated Product result = 1;
      }

      // Request message for products operation.
      message QueryProductsRequest {
      }
      // Response message for products operation.
      message QueryProductsResponse {
        repeated Product products = 1;
      }

      message Product {
        string id = 1;
        string manufacturer_id = 2;
        string product_code = 3;
        string name = 4;
        double price = 5;
      }"
    `);
  });
  test('should generate lookup method when resolvable is not specified', () => {
    const sdl = `
      scalar openfed__FieldSet
      directive @key(fields: openfed__FieldSet!, resolvable: Boolean = true) repeatable on INTERFACE | OBJECT
      
      type Product @key(fields: "id", resolvable: false) @key(fields: "manufacturerId productCode") {
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

    const { proto: protoText } = compileGraphQLToProto(sdl);

    // Validate Proto definition
    expectValidProto(protoText);

    // Expect that only the resolvable key is generated
    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      // Service definition for DefaultService
      service DefaultService {
        // Lookup Product entity by manufacturerId and productCode
        rpc LookupProductByManufacturerIdAndProductCode(LookupProductByManufacturerIdAndProductCodeRequest) returns (LookupProductByManufacturerIdAndProductCodeResponse) {}
        rpc QueryProducts(QueryProductsRequest) returns (QueryProductsResponse) {}
      }

      // Key message for Product entity lookup
      message LookupProductByManufacturerIdAndProductCodeRequestKey {
        // Key field for Product entity lookup.
        string manufacturer_id = 1;
        // Key field for Product entity lookup.
        string product_code = 2;
      }

      // Request message for Product entity lookup.
      message LookupProductByManufacturerIdAndProductCodeRequest {
        /*
         * List of keys to look up Product entities.
         * Order matters - each key maps to one entity in LookupProductByManufacturerIdAndProductCodeResponse.
         */
        repeated LookupProductByManufacturerIdAndProductCodeRequestKey keys = 1;
      }

      // Response message for Product entity lookup.
      message LookupProductByManufacturerIdAndProductCodeResponse {
        /*
         * List of Product entities in the same order as the keys in LookupProductByManufacturerIdAndProductCodeRequest.
         * Always return the same number of entities as keys. Use null for entities that cannot be found.
         * 
         * Example:
         *   LookupUserByIdRequest:
         *     keys:
         *       - id: 1
         *       - id: 2
         *   LookupUserByIdResponse:
         *     result:
         *       - id: 1 # User with id 1 found
         *       - null  # User with id 2 not found
         */
        repeated Product result = 1;
      }

      // Request message for products operation.
      message QueryProductsRequest {
      }
      // Response message for products operation.
      message QueryProductsResponse {
        repeated Product products = 1;
      }

      message Product {
        string id = 1;
        string manufacturer_id = 2;
        string product_code = 3;
        string name = 4;
        double price = 5;
      }"
    `);
  });
});
