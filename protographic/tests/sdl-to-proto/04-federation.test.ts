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

    const protoText = compileGraphQLToProto(sdl);

    // Validate Proto definition
    expectValidProto(protoText);

    // Check that entity lookup operations are present
    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      option go_package = "cosmo/pkg/proto/service.v1;servicev1";

      service DefaultService {
        rpc LookupProductById(LookupProductByIdRequest) returns (LookupProductByIdResponse) {}
        rpc LookupUserById(LookupUserByIdRequest) returns (LookupUserByIdResponse) {}
        rpc QueryProduct(QueryProductRequest) returns (QueryProductResponse) {}
      }

      message LookupProductByIdRequest {
          string id = 1;
      }

      message LookupProductByIdResult {
          Product product = 1;
      }

      message LookupProductByIdResponse {
          repeated LookupProductByIdResult results = 1;
      }

      message LookupUserByIdRequest {
          string id = 1;
      }

      message LookupUserByIdResult {
          User user = 1;
      }

      message LookupUserByIdResponse {
          repeated LookupUserByIdResult results = 1;
      }

      message QueryProductRequest {
          string id = 1;
      }
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

    const protoText = compileGraphQLToProto(sdl);

    // Validate Proto definition
    expectValidProto(protoText);

    // Check that all required components are present
    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      option go_package = "cosmo/pkg/proto/service.v1;servicev1";

      service DefaultService {
        rpc LookupOrderItemById(LookupOrderItemByIdRequest) returns (LookupOrderItemByIdResponse) {}
        rpc QueryOrderItem(QueryOrderItemRequest) returns (QueryOrderItemResponse) {}
      }

      message LookupOrderItemByIdRequest {
          string order_id = 1;
      }

      message LookupOrderItemByIdResult {
          OrderItem order_item = 1;
      }

      message LookupOrderItemByIdResponse {
          repeated LookupOrderItemByIdResult results = 1;
      }

      message QueryOrderItemRequest {
          string order_id = 1;
          string item_id = 2;
      }
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

    const protoText = compileGraphQLToProto(sdl);

    // Validate Proto definition
    expectValidProto(protoText);

    // Check that entity lookup operations are present
    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      option go_package = "cosmo/pkg/proto/service.v1;servicev1";

      service DefaultService {
        rpc LookupUserById(LookupUserByIdRequest) returns (LookupUserByIdResponse) {}
        rpc LookupProductById(LookupProductByIdRequest) returns (LookupProductByIdResponse) {}
        rpc QueryNode(QueryNodeRequest) returns (QueryNodeResponse) {}
      }

      message LookupUserByIdRequest {
          string id = 1;
      }

      message LookupUserByIdResult {
          User user = 1;
      }

      message LookupUserByIdResponse {
          repeated LookupUserByIdResult results = 1;
      }

      message LookupProductByIdRequest {
          string id = 1;
      }

      message LookupProductByIdResult {
          Product product = 1;
      }

      message LookupProductByIdResponse {
          repeated LookupProductByIdResult results = 1;
      }

      message QueryNodeRequest {
          string id = 1;
      }
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

    const protoText = compileGraphQLToProto(sdl);

    // Validate Proto definition
    expectValidProto(protoText);

    // Check that all required components are present
    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      option go_package = "cosmo/pkg/proto/service.v1;servicev1";

      service DefaultService {
        rpc QueryEvents(QueryEventsRequest) returns (QueryEventsResponse) {}
        rpc QueryEvent(QueryEventRequest) returns (QueryEventResponse) {}
      }

      message QueryEventsRequest {
      }
      message QueryEventsResponse {
          repeated Event events = 1;
      }
      message QueryEventRequest {
          string id = 1;
      }
      message QueryEventResponse {
          Event event = 1;
      }

      message Event {
        string id = 1;
        string name = 2;
        string start_time = 3;
        string end_time = 4;
        string metadata = 5;
        string attachment = 6;
      }"
    `);
  });
});
