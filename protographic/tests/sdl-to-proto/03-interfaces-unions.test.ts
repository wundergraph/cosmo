import { describe, expect, test } from 'vitest';
import { compileGraphQLToProto } from '../../src';
import { expectValidProto } from '../util';

describe('SDL to Proto - Interfaces and Unions', () => {
  test('should convert interfaces correctly', () => {
    const sdl = `
      interface Node {
        id: ID!
      }
      
      type User implements Node {
        id: ID!
        name: String!
        email: String!
      }
      
      type Product implements Node {
        id: ID!
        name: String!
        price: Float!
      }
      
      type Query {
        node(id: ID!): Node
        nodes: [Node!]!
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
        rpc QueryNode(QueryNodeRequest) returns (QueryNodeResponse) {}
        rpc QueryNodes(QueryNodesRequest) returns (QueryNodesResponse) {}
      }

      // Request message for node operation.
      message QueryNodeRequest {
        string id = 1;
      }
      // Response message for node operation.
      message QueryNodeResponse {
        Node node = 1;
      }
      // Request message for nodes operation.
      message QueryNodesRequest {
      }
      // Response message for nodes operation.
      message QueryNodesResponse {
        repeated Node nodes = 1;
      }

      message Node {
        oneof instance {
        User user = 1;
        Product product = 2;
        }
      }

      message User {
        string id = 1;
        string name = 2;
        string email = 3;
      }

      message Product {
        string id = 1;
        string name = 2;
        double price = 3;
      }"
    `);
  });

  test('should convert multiple interface implementations correctly', () => {
    const sdl = `
      interface Node {
        id: ID!
      }
      
      interface Timestamped {
        createdAt: String!
        updatedAt: String!
      }
      
      type User implements Node & Timestamped {
        id: ID!
        name: String!
        email: String!
        createdAt: String!
        updatedAt: String!
      }
      
      type Query {
        node(id: ID!): Node
        activity: [Timestamped!]!
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
        rpc QueryActivity(QueryActivityRequest) returns (QueryActivityResponse) {}
        rpc QueryNode(QueryNodeRequest) returns (QueryNodeResponse) {}
      }

      // Request message for node operation.
      message QueryNodeRequest {
        string id = 1;
      }
      // Response message for node operation.
      message QueryNodeResponse {
        Node node = 1;
      }
      // Request message for activity operation.
      message QueryActivityRequest {
      }
      // Response message for activity operation.
      message QueryActivityResponse {
        repeated Timestamped activity = 1;
      }

      message Node {
        oneof instance {
        User user = 1;
        }
      }

      message Timestamped {
        oneof instance {
        User user = 1;
        }
      }

      message User {
        string id = 1;
        string name = 2;
        string email = 3;
        string created_at = 4;
        string updated_at = 5;
      }"
    `);
  });

  test('should convert unions correctly', () => {
    const sdl = `
      type User {
        id: ID!
        name: String!
      }
      
      type Product {
        id: ID!
        name: String!
        price: Float!
      }
      
      type Article {
        id: ID!
        title: String!
        body: String!
      }
      
      union SearchResult = User | Product | Article
      
      type Query {
        search(term: String!): [SearchResult!]!
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
        rpc QuerySearch(QuerySearchRequest) returns (QuerySearchResponse) {}
      }

      // Request message for search operation.
      message QuerySearchRequest {
        string term = 1;
      }
      // Response message for search operation.
      message QuerySearchResponse {
        repeated SearchResult search = 1;
      }

      message SearchResult {
        oneof value {
        User user = 1;
        Product product = 2;
        Article article = 3;
        }
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

      message Article {
        string id = 1;
        string title = 2;
        string body = 3;
      }"
    `);
  });

  test('should handle empty interface implementations correctly', () => {
    const sdl = `
      interface Empty {
        id: ID!
      }
      
      type Something implements Empty {
        id: ID!
        name: String!
      }
      
      type Query {
        something: Something
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
        rpc QuerySomething(QuerySomethingRequest) returns (QuerySomethingResponse) {}
      }

      // Request message for something operation.
      message QuerySomethingRequest {
      }
      // Response message for something operation.
      message QuerySomethingResponse {
        Something something = 1;
      }

      message Something {
        string id = 1;
        string name = 2;
      }

      message Empty {
        oneof instance {
        Something something = 1;
        }
      }"
    `);
  });
});
