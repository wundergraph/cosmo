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
        // Lookup OrderItem entity by orderId
        rpc LookupOrderItemByOrderId(LookupOrderItemByOrderIdRequest) returns (LookupOrderItemByOrderIdResponse) {}
        rpc QueryOrderItem(QueryOrderItemRequest) returns (QueryOrderItemResponse) {}
      }

      // Key message for OrderItem entity lookup
      message LookupOrderItemByOrderIdRequestKey {
        // Key field for OrderItem entity lookup.
        string order_id = 1;
      }

      // Request message for OrderItem entity lookup.
      message LookupOrderItemByOrderIdRequest {
        /*
         * List of keys to look up OrderItem entities.
         * Order matters - each key maps to one entity in LookupOrderItemByOrderIdResponse.
         */
        repeated LookupOrderItemByOrderIdRequestKey keys = 1;
      }

      // Response message for OrderItem entity lookup.
      message LookupOrderItemByOrderIdResponse {
        /*
         * List of OrderItem entities in the same order as the keys in LookupOrderItemByOrderIdRequest.
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
});
