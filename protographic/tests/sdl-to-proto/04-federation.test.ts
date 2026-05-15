import { describe, expect, test } from 'vitest';
import { compileGraphQLToProto } from '../../src/index.js';
import { expectValidProto } from '../util.js';

describe('SDL to Proto - Federation and Special Types', () => {
  describe('Entity types with @key directive', () => {
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
  });

  describe('Interface entities', () => {
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
        // Lookup Node entity by id
        rpc LookupNodeById(LookupNodeByIdRequest) returns (LookupNodeByIdResponse) {}
        // Lookup Product entity by id
        rpc LookupProductById(LookupProductByIdRequest) returns (LookupProductByIdResponse) {}
        // Lookup User entity by id
        rpc LookupUserById(LookupUserByIdRequest) returns (LookupUserByIdResponse) {}
        rpc QueryNode(QueryNodeRequest) returns (QueryNodeResponse) {}
      }

      // Key message for Node entity lookup
      message LookupNodeByIdRequestKey {
        // Key field for Node entity lookup.
        string id = 1;
      }

      // Request message for Node entity lookup.
      message LookupNodeByIdRequest {
        /*
         * List of keys to look up Node entities.
         * Order matters - each key maps to one entity in LookupNodeByIdResponse.
         */
        repeated LookupNodeByIdRequestKey keys = 1;
      }

      // Response message for Node entity lookup.
      message LookupNodeByIdResponse {
        /*
         * List of Node entities in the same order as the keys in LookupNodeByIdRequest.
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
        repeated Node result = 1;
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

      message Node {
        oneof instance {
        User user = 1;
        Product product = 2;
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
      }"
    `);
    });

    test('should handle interface entity with @key and multiple implementing types', () => {
      const sdl = `
        directive @key(fields: String!) on OBJECT | INTERFACE

        interface Media @key(fields: "id") {
          id: ID!
          title: String!
          duration: Int!
        }

        type Movie implements Media @key(fields: "id") {
          id: ID!
          title: String!
          duration: Int!
          director: String!
        }

        type Song implements Media @key(fields: "id") {
          id: ID!
          title: String!
          duration: Int!
          artist: String!
        }

        type Query {
          media(id: ID!): Media
          _entities(representations: [_Any!]!): [_Entity]!
        }

        scalar _Any
        union _Entity = Movie | Song
      `;

      const { proto: protoText } = compileGraphQLToProto(sdl);

      expectValidProto(protoText);

      // Should have lookups for concrete types and the interface
      expect(protoText).toContain('rpc LookupMovieById');
      expect(protoText).toContain('rpc LookupSongById');
      expect(protoText).toContain('rpc LookupMediaById');

      // Should have request/response messages for all lookups
      expect(protoText).toContain('message LookupMovieByIdRequest');
      expect(protoText).toContain('message LookupMovieByIdResponse');
      expect(protoText).toContain('message LookupMovieByIdRequestKey');
      expect(protoText).toContain('message LookupSongByIdRequest');
      expect(protoText).toContain('message LookupSongByIdResponse');
      expect(protoText).toContain('message LookupSongByIdRequestKey');
      expect(protoText).toContain('message LookupMediaByIdRequest');
      expect(protoText).toContain('message LookupMediaByIdResponse');
      expect(protoText).toContain('message LookupMediaByIdRequestKey');

      // Should have messages for all types
      expect(protoText).toContain('message Movie');
      expect(protoText).toContain('message Song');
      expect(protoText).toContain('message Media');

      // Interface should use oneof pattern
      expect(protoText).toContain('oneof instance');

      expect(protoText).toMatchInlineSnapshot(`
        "syntax = "proto3";
        package service.v1;

        // Service definition for DefaultService
        service DefaultService {
          // Lookup Media entity by id
          rpc LookupMediaById(LookupMediaByIdRequest) returns (LookupMediaByIdResponse) {}
          // Lookup Movie entity by id
          rpc LookupMovieById(LookupMovieByIdRequest) returns (LookupMovieByIdResponse) {}
          // Lookup Song entity by id
          rpc LookupSongById(LookupSongByIdRequest) returns (LookupSongByIdResponse) {}
          rpc QueryMedia(QueryMediaRequest) returns (QueryMediaResponse) {}
        }

        // Key message for Media entity lookup
        message LookupMediaByIdRequestKey {
          // Key field for Media entity lookup.
          string id = 1;
        }

        // Request message for Media entity lookup.
        message LookupMediaByIdRequest {
          /*
           * List of keys to look up Media entities.
           * Order matters - each key maps to one entity in LookupMediaByIdResponse.
           */
          repeated LookupMediaByIdRequestKey keys = 1;
        }

        // Response message for Media entity lookup.
        message LookupMediaByIdResponse {
          /*
           * List of Media entities in the same order as the keys in LookupMediaByIdRequest.
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
          repeated Media result = 1;
        }

        // Key message for Movie entity lookup
        message LookupMovieByIdRequestKey {
          // Key field for Movie entity lookup.
          string id = 1;
        }

        // Request message for Movie entity lookup.
        message LookupMovieByIdRequest {
          /*
           * List of keys to look up Movie entities.
           * Order matters - each key maps to one entity in LookupMovieByIdResponse.
           */
          repeated LookupMovieByIdRequestKey keys = 1;
        }

        // Response message for Movie entity lookup.
        message LookupMovieByIdResponse {
          /*
           * List of Movie entities in the same order as the keys in LookupMovieByIdRequest.
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
          repeated Movie result = 1;
        }

        // Key message for Song entity lookup
        message LookupSongByIdRequestKey {
          // Key field for Song entity lookup.
          string id = 1;
        }

        // Request message for Song entity lookup.
        message LookupSongByIdRequest {
          /*
           * List of keys to look up Song entities.
           * Order matters - each key maps to one entity in LookupSongByIdResponse.
           */
          repeated LookupSongByIdRequestKey keys = 1;
        }

        // Response message for Song entity lookup.
        message LookupSongByIdResponse {
          /*
           * List of Song entities in the same order as the keys in LookupSongByIdRequest.
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
          repeated Song result = 1;
        }

        // Request message for media operation.
        message QueryMediaRequest {
          string id = 1;
        }
        // Response message for media operation.
        message QueryMediaResponse {
          Media media = 1;
        }

        message Media {
          oneof instance {
          Movie movie = 1;
          Song song = 2;
          }
        }

        message Movie {
          string id = 1;
          string title = 2;
          int32 duration = 3;
          string director = 4;
        }

        message Song {
          string id = 1;
          string title = 2;
          int32 duration = 3;
          string artist = 4;
        }"
      `);
    });

    test('should handle interface entity with different keys on interface vs implementing types', () => {
      const sdl = `
        directive @key(fields: String!) on OBJECT | INTERFACE

        interface Account @key(fields: "id") {
          id: ID!
          email: String!
        }

        type PersonalAccount implements Account @key(fields: "id") @key(fields: "email") {
          id: ID!
          email: String!
          firstName: String!
          lastName: String!
        }

        type BusinessAccount implements Account @key(fields: "id") {
          id: ID!
          email: String!
          companyName: String!
          taxId: String!
        }

        type Query {
          account(id: ID!): Account
          _entities(representations: [_Any!]!): [_Entity]!
        }

        scalar _Any
        union _Entity = PersonalAccount | BusinessAccount
      `;

      const { proto: protoText } = compileGraphQLToProto(sdl);

      expectValidProto(protoText);

      // Interface lookup
      expect(protoText).toContain('rpc LookupAccountById');

      // Concrete type lookups - PersonalAccount has two keys
      expect(protoText).toContain('rpc LookupPersonalAccountById');
      expect(protoText).toContain('rpc LookupPersonalAccountByEmail');
      expect(protoText).toContain('rpc LookupBusinessAccountById');

      // Account should use oneof for implementing types
      expect(protoText).toContain('oneof instance');

      expect(protoText).toMatchInlineSnapshot(`
        "syntax = "proto3";
        package service.v1;

        // Service definition for DefaultService
        service DefaultService {
          // Lookup Account entity by id
          rpc LookupAccountById(LookupAccountByIdRequest) returns (LookupAccountByIdResponse) {}
          // Lookup BusinessAccount entity by id
          rpc LookupBusinessAccountById(LookupBusinessAccountByIdRequest) returns (LookupBusinessAccountByIdResponse) {}
          // Lookup PersonalAccount entity by email
          rpc LookupPersonalAccountByEmail(LookupPersonalAccountByEmailRequest) returns (LookupPersonalAccountByEmailResponse) {}
          // Lookup PersonalAccount entity by id
          rpc LookupPersonalAccountById(LookupPersonalAccountByIdRequest) returns (LookupPersonalAccountByIdResponse) {}
          rpc QueryAccount(QueryAccountRequest) returns (QueryAccountResponse) {}
        }

        // Key message for Account entity lookup
        message LookupAccountByIdRequestKey {
          // Key field for Account entity lookup.
          string id = 1;
        }

        // Request message for Account entity lookup.
        message LookupAccountByIdRequest {
          /*
           * List of keys to look up Account entities.
           * Order matters - each key maps to one entity in LookupAccountByIdResponse.
           */
          repeated LookupAccountByIdRequestKey keys = 1;
        }

        // Response message for Account entity lookup.
        message LookupAccountByIdResponse {
          /*
           * List of Account entities in the same order as the keys in LookupAccountByIdRequest.
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
          repeated Account result = 1;
        }

        // Key message for PersonalAccount entity lookup
        message LookupPersonalAccountByIdRequestKey {
          // Key field for PersonalAccount entity lookup.
          string id = 1;
        }

        // Request message for PersonalAccount entity lookup.
        message LookupPersonalAccountByIdRequest {
          /*
           * List of keys to look up PersonalAccount entities.
           * Order matters - each key maps to one entity in LookupPersonalAccountByIdResponse.
           */
          repeated LookupPersonalAccountByIdRequestKey keys = 1;
        }

        // Response message for PersonalAccount entity lookup.
        message LookupPersonalAccountByIdResponse {
          /*
           * List of PersonalAccount entities in the same order as the keys in LookupPersonalAccountByIdRequest.
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
          repeated PersonalAccount result = 1;
        }

        // Key message for PersonalAccount entity lookup
        message LookupPersonalAccountByEmailRequestKey {
          // Key field for PersonalAccount entity lookup.
          string email = 1;
        }

        // Request message for PersonalAccount entity lookup.
        message LookupPersonalAccountByEmailRequest {
          /*
           * List of keys to look up PersonalAccount entities.
           * Order matters - each key maps to one entity in LookupPersonalAccountByEmailResponse.
           */
          repeated LookupPersonalAccountByEmailRequestKey keys = 1;
        }

        // Response message for PersonalAccount entity lookup.
        message LookupPersonalAccountByEmailResponse {
          /*
           * List of PersonalAccount entities in the same order as the keys in LookupPersonalAccountByEmailRequest.
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
          repeated PersonalAccount result = 1;
        }

        // Key message for BusinessAccount entity lookup
        message LookupBusinessAccountByIdRequestKey {
          // Key field for BusinessAccount entity lookup.
          string id = 1;
        }

        // Request message for BusinessAccount entity lookup.
        message LookupBusinessAccountByIdRequest {
          /*
           * List of keys to look up BusinessAccount entities.
           * Order matters - each key maps to one entity in LookupBusinessAccountByIdResponse.
           */
          repeated LookupBusinessAccountByIdRequestKey keys = 1;
        }

        // Response message for BusinessAccount entity lookup.
        message LookupBusinessAccountByIdResponse {
          /*
           * List of BusinessAccount entities in the same order as the keys in LookupBusinessAccountByIdRequest.
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
          repeated BusinessAccount result = 1;
        }

        // Request message for account operation.
        message QueryAccountRequest {
          string id = 1;
        }
        // Response message for account operation.
        message QueryAccountResponse {
          Account account = 1;
        }

        message Account {
          oneof instance {
          PersonalAccount personal_account = 1;
          BusinessAccount business_account = 2;
          }
        }

        message PersonalAccount {
          string id = 1;
          string email = 2;
          string first_name = 3;
          string last_name = 4;
        }

        message BusinessAccount {
          string id = 1;
          string email = 2;
          string company_name = 3;
          string tax_id = 4;
        }"
      `);
    });

    test('should handle interface entity with composite key', () => {
      const sdl = `
        directive @key(fields: String!) on OBJECT | INTERFACE

        interface Vehicle @key(fields: "make model") {
          make: String!
          model: String!
          year: Int!
        }

        type Car implements Vehicle @key(fields: "make model") {
          make: String!
          model: String!
          year: Int!
          numDoors: Int!
        }

        type Truck implements Vehicle @key(fields: "make model") {
          make: String!
          model: String!
          year: Int!
          payloadCapacity: Float!
        }

        type Query {
          vehicle(make: String!, model: String!): Vehicle
        }
      `;

      const { proto: protoText } = compileGraphQLToProto(sdl);

      expectValidProto(protoText);

      // Should have lookups with composite keys for all types
      expect(protoText).toContain('rpc LookupCarByMakeAndModel');
      expect(protoText).toContain('rpc LookupTruckByMakeAndModel');
      expect(protoText).toContain('rpc LookupVehicleByMakeAndModel');

      // Composite key messages should have both fields
      expect(protoText).toContain('message LookupVehicleByMakeAndModelRequestKey');

      // Interface should use oneof
      expect(protoText).toContain('oneof instance');

      expect(protoText).toMatchInlineSnapshot(`
        "syntax = "proto3";
        package service.v1;

        // Service definition for DefaultService
        service DefaultService {
          // Lookup Car entity by make and model
          rpc LookupCarByMakeAndModel(LookupCarByMakeAndModelRequest) returns (LookupCarByMakeAndModelResponse) {}
          // Lookup Truck entity by make and model
          rpc LookupTruckByMakeAndModel(LookupTruckByMakeAndModelRequest) returns (LookupTruckByMakeAndModelResponse) {}
          // Lookup Vehicle entity by make and model
          rpc LookupVehicleByMakeAndModel(LookupVehicleByMakeAndModelRequest) returns (LookupVehicleByMakeAndModelResponse) {}
          rpc QueryVehicle(QueryVehicleRequest) returns (QueryVehicleResponse) {}
        }

        // Key message for Vehicle entity lookup
        message LookupVehicleByMakeAndModelRequestKey {
          // Key field for Vehicle entity lookup.
          string make = 1;
          // Key field for Vehicle entity lookup.
          string model = 2;
        }

        // Request message for Vehicle entity lookup.
        message LookupVehicleByMakeAndModelRequest {
          /*
           * List of keys to look up Vehicle entities.
           * Order matters - each key maps to one entity in LookupVehicleByMakeAndModelResponse.
           */
          repeated LookupVehicleByMakeAndModelRequestKey keys = 1;
        }

        // Response message for Vehicle entity lookup.
        message LookupVehicleByMakeAndModelResponse {
          /*
           * List of Vehicle entities in the same order as the keys in LookupVehicleByMakeAndModelRequest.
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
          repeated Vehicle result = 1;
        }

        // Key message for Car entity lookup
        message LookupCarByMakeAndModelRequestKey {
          // Key field for Car entity lookup.
          string make = 1;
          // Key field for Car entity lookup.
          string model = 2;
        }

        // Request message for Car entity lookup.
        message LookupCarByMakeAndModelRequest {
          /*
           * List of keys to look up Car entities.
           * Order matters - each key maps to one entity in LookupCarByMakeAndModelResponse.
           */
          repeated LookupCarByMakeAndModelRequestKey keys = 1;
        }

        // Response message for Car entity lookup.
        message LookupCarByMakeAndModelResponse {
          /*
           * List of Car entities in the same order as the keys in LookupCarByMakeAndModelRequest.
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
          repeated Car result = 1;
        }

        // Key message for Truck entity lookup
        message LookupTruckByMakeAndModelRequestKey {
          // Key field for Truck entity lookup.
          string make = 1;
          // Key field for Truck entity lookup.
          string model = 2;
        }

        // Request message for Truck entity lookup.
        message LookupTruckByMakeAndModelRequest {
          /*
           * List of keys to look up Truck entities.
           * Order matters - each key maps to one entity in LookupTruckByMakeAndModelResponse.
           */
          repeated LookupTruckByMakeAndModelRequestKey keys = 1;
        }

        // Response message for Truck entity lookup.
        message LookupTruckByMakeAndModelResponse {
          /*
           * List of Truck entities in the same order as the keys in LookupTruckByMakeAndModelRequest.
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
          repeated Truck result = 1;
        }

        // Request message for vehicle operation.
        message QueryVehicleRequest {
          string make = 1;
          string model = 2;
        }
        // Response message for vehicle operation.
        message QueryVehicleResponse {
          Vehicle vehicle = 1;
        }

        message Vehicle {
          oneof instance {
          Car car = 1;
          Truck truck = 2;
          }
        }

        message Car {
          string make = 1;
          string model = 2;
          int32 year = 3;
          int32 num_doors = 4;
        }

        message Truck {
          string make = 1;
          string model = 2;
          int32 year = 3;
          double payload_capacity = 4;
        }"
      `);
    });
  });

  describe('Special scalar types', () => {
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

  describe('Multiple and compound keys', () => {
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
  });

  describe('Resolvable keys', () => {
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

  describe('Required fields', () => {
    test('should generate rpc method for required field', () => {
      const sdl = `
      type Product @key(fields: "id") {
        id: ID!
        manufacturerId: ID! @external
        productCode: String! @external
        name: String! @requires(fields: "manufacturerId productCode")
        price: Float!
      }
    `;

      const { proto: protoText } = compileGraphQLToProto(sdl);

      // Validate Proto definition
      expectValidProto(protoText);

      expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      // Service definition for DefaultService
      service DefaultService {
        // Lookup Product entity by id
        rpc LookupProductById(LookupProductByIdRequest) returns (LookupProductByIdResponse) {}
        rpc RequireProductNameById(RequireProductNameByIdRequest) returns (RequireProductNameByIdResponse) {}
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

      message RequireProductNameByIdRequest {
        // RequireProductNameByIdContext provides the context for the required fields method RequireProductNameById.
        repeated RequireProductNameByIdContext context = 1;
      }

      message RequireProductNameByIdContext {
        LookupProductByIdRequestKey key = 1;
        RequireProductNameByIdFields fields = 2;
      }

      message RequireProductNameByIdResponse {
        // RequireProductNameByIdResult provides the result for the required fields method RequireProductNameById.
        repeated RequireProductNameByIdResult result = 1;
      }

      message RequireProductNameByIdResult {
        string name = 1;
      }

      message RequireProductNameByIdFields {
        string manufacturer_id = 1;
        string product_code = 2;
      }

      message Product {
        string id = 1;
        double price = 2;
      }"
    `);
    });
    test('should generate rpc method for required field with nested fields', () => {
      const sdl = `
      type Product @key(fields: "id") {
        id: ID!
        manufacturerId: ID! @external
        details: ProductDetails! @external
        name: String! @requires(fields: "manufacturerId details { description reviewSummary { status message } }")
        price: Float!
      }

      type ProductDetails {
        id: ID!
        description: String!
        title: String!
        reviewSummary: ActionResult!
      }

      type ActionResult {
        status: String!
        message: String!
      }
    `;

      const { proto: protoText } = compileGraphQLToProto(sdl);

      // Validate Proto definition
      expectValidProto(protoText);

      expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      // Service definition for DefaultService
      service DefaultService {
        // Lookup Product entity by id
        rpc LookupProductById(LookupProductByIdRequest) returns (LookupProductByIdResponse) {}
        rpc RequireProductNameById(RequireProductNameByIdRequest) returns (RequireProductNameByIdResponse) {}
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

      message RequireProductNameByIdRequest {
        // RequireProductNameByIdContext provides the context for the required fields method RequireProductNameById.
        repeated RequireProductNameByIdContext context = 1;
      }

      message RequireProductNameByIdContext {
        LookupProductByIdRequestKey key = 1;
        RequireProductNameByIdFields fields = 2;
      }

      message RequireProductNameByIdResponse {
        // RequireProductNameByIdResult provides the result for the required fields method RequireProductNameById.
        repeated RequireProductNameByIdResult result = 1;
      }

      message RequireProductNameByIdResult {
        string name = 1;
      }

      message RequireProductNameByIdFields {
        message ProductDetails {
          message ActionResult {
            string status = 1;
            string message = 2;
          }

          string description = 1;
          ActionResult review_summary = 2;
        }

        string manufacturer_id = 1;
        ProductDetails details = 2;
      }

      message Product {
        string id = 1;
        double price = 2;
      }

      message ProductDetails {
        string id = 1;
        string description = 2;
        string title = 3;
        ActionResult review_summary = 4;
      }

      message ActionResult {
        string status = 1;
        string message = 2;
      }"
    `);
    });
    test('should generate rpc method for required field with field arguments', () => {
      const sdl = `
      type User @key(fields: "id") {
        id: ID!
        name: String! @external

        post(slug: String!): Post! @requires(fields: "name")
      }

      type Post {
        id: ID!
        author: User!
        title: String!
      }

      type Query {
        user(id: ID!): User
      }
    `;

      const { proto: protoText } = compileGraphQLToProto(sdl);

      // Validate Proto definition
      expectValidProto(protoText);

      expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      // Service definition for DefaultService
      service DefaultService {
        // Lookup User entity by id
        rpc LookupUserById(LookupUserByIdRequest) returns (LookupUserByIdResponse) {}
        rpc QueryUser(QueryUserRequest) returns (QueryUserResponse) {}
        rpc RequireUserPostById(RequireUserPostByIdRequest) returns (RequireUserPostByIdResponse) {}
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

      // Request message for user operation.
      message QueryUserRequest {
        string id = 1;
      }
      // Response message for user operation.
      message QueryUserResponse {
        User user = 1;
      }
      message RequireUserPostByIdRequest {
        // RequireUserPostByIdContext provides the context for the required fields method RequireUserPostById.
        repeated RequireUserPostByIdContext context = 1;
        // RequireUserPostByIdArgs provides the field arguments for the required field with method RequireUserPostById.
        RequireUserPostByIdArgs field_args = 2;
      }

      message RequireUserPostByIdContext {
        LookupUserByIdRequestKey key = 1;
        RequireUserPostByIdFields fields = 2;
      }

      message RequireUserPostByIdArgs {
        string slug = 1;
      }

      message RequireUserPostByIdResponse {
        // RequireUserPostByIdResult provides the result for the required fields method RequireUserPostById.
        repeated RequireUserPostByIdResult result = 1;
      }

      message RequireUserPostByIdResult {
        Post post = 1;
      }

      message RequireUserPostByIdFields {
        string name = 1;
      }

      message User {
        string id = 1;
      }

      message Post {
        string id = 1;
        User author = 2;
        string title = 3;
      }"
    `);
    });
    test('should generate rpc method for required field with list type field argument', () => {
      const sdl = `
      type User @key(fields: "id") {
        id: ID!
        name: String! @external

        posts(tags: [String!]!): [Post!]! @requires(fields: "name")
      }

      type Post {
        id: ID!
        author: User!
        title: String!
      }

      type Query {
        user(id: ID!): User
      }
    `;

      const { proto: protoText } = compileGraphQLToProto(sdl);

      // Validate Proto definition
      expectValidProto(protoText);

      expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      // Service definition for DefaultService
      service DefaultService {
        // Lookup User entity by id
        rpc LookupUserById(LookupUserByIdRequest) returns (LookupUserByIdResponse) {}
        rpc QueryUser(QueryUserRequest) returns (QueryUserResponse) {}
        rpc RequireUserPostsById(RequireUserPostsByIdRequest) returns (RequireUserPostsByIdResponse) {}
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

      // Request message for user operation.
      message QueryUserRequest {
        string id = 1;
      }
      // Response message for user operation.
      message QueryUserResponse {
        User user = 1;
      }
      message RequireUserPostsByIdRequest {
        // RequireUserPostsByIdContext provides the context for the required fields method RequireUserPostsById.
        repeated RequireUserPostsByIdContext context = 1;
        // RequireUserPostsByIdArgs provides the field arguments for the required field with method RequireUserPostsById.
        RequireUserPostsByIdArgs field_args = 2;
      }

      message RequireUserPostsByIdContext {
        LookupUserByIdRequestKey key = 1;
        RequireUserPostsByIdFields fields = 2;
      }

      message RequireUserPostsByIdArgs {
        repeated string tags = 1;
      }

      message RequireUserPostsByIdResponse {
        // RequireUserPostsByIdResult provides the result for the required fields method RequireUserPostsById.
        repeated RequireUserPostsByIdResult result = 1;
      }

      message RequireUserPostsByIdResult {
        repeated Post posts = 1;
      }

      message RequireUserPostsByIdFields {
        string name = 1;
      }

      message User {
        string id = 1;
      }

      message Post {
        string id = 1;
        User author = 2;
        string title = 3;
      }"
    `);
    });
    test('should generate rpc method for required field with input object type field argument', () => {
      const sdl = `
      input PostFilter {
        authorName: String!
        limit: Int!
      }

      type User @key(fields: "id") {
        id: ID!
        name: String! @external

        posts(filter: PostFilter!): [Post!]! @requires(fields: "name")
      }

      type Post {
        id: ID!
        author: User!
        title: String!
      }

      type Query {
        user(id: ID!): User
      }
    `;

      const { proto: protoText } = compileGraphQLToProto(sdl);

      // Validate Proto definition
      expectValidProto(protoText);

      expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      // Service definition for DefaultService
      service DefaultService {
        // Lookup User entity by id
        rpc LookupUserById(LookupUserByIdRequest) returns (LookupUserByIdResponse) {}
        rpc QueryUser(QueryUserRequest) returns (QueryUserResponse) {}
        rpc RequireUserPostsById(RequireUserPostsByIdRequest) returns (RequireUserPostsByIdResponse) {}
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

      // Request message for user operation.
      message QueryUserRequest {
        string id = 1;
      }
      // Response message for user operation.
      message QueryUserResponse {
        User user = 1;
      }
      message RequireUserPostsByIdRequest {
        // RequireUserPostsByIdContext provides the context for the required fields method RequireUserPostsById.
        repeated RequireUserPostsByIdContext context = 1;
        // RequireUserPostsByIdArgs provides the field arguments for the required field with method RequireUserPostsById.
        RequireUserPostsByIdArgs field_args = 2;
      }

      message RequireUserPostsByIdContext {
        LookupUserByIdRequestKey key = 1;
        RequireUserPostsByIdFields fields = 2;
      }

      message RequireUserPostsByIdArgs {
        PostFilter filter = 1;
      }

      message RequireUserPostsByIdResponse {
        // RequireUserPostsByIdResult provides the result for the required fields method RequireUserPostsById.
        repeated RequireUserPostsByIdResult result = 1;
      }

      message RequireUserPostsByIdResult {
        repeated Post posts = 1;
      }

      message RequireUserPostsByIdFields {
        string name = 1;
      }

      message User {
        string id = 1;
      }

      message PostFilter {
        string author_name = 1;
        int32 limit = 2;
      }

      message Post {
        string id = 1;
        User author = 2;
        string title = 3;
      }"
    `);
    });
    test('should generate rpc method for required field with nullable field argument', () => {
      const sdl = `
      type User @key(fields: "id") {
        id: ID!
        name: String! @external

        post(slug: String): Post @requires(fields: "name")
      }

      type Post {
        id: ID!
        author: User!
        title: String!
      }

      type Query {
        user(id: ID!): User
      }
    `;

      const { proto: protoText } = compileGraphQLToProto(sdl);

      // Validate Proto definition
      expectValidProto(protoText);

      expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      import "google/protobuf/wrappers.proto";

      // Service definition for DefaultService
      service DefaultService {
        // Lookup User entity by id
        rpc LookupUserById(LookupUserByIdRequest) returns (LookupUserByIdResponse) {}
        rpc QueryUser(QueryUserRequest) returns (QueryUserResponse) {}
        rpc RequireUserPostById(RequireUserPostByIdRequest) returns (RequireUserPostByIdResponse) {}
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

      // Request message for user operation.
      message QueryUserRequest {
        string id = 1;
      }
      // Response message for user operation.
      message QueryUserResponse {
        User user = 1;
      }
      message RequireUserPostByIdRequest {
        // RequireUserPostByIdContext provides the context for the required fields method RequireUserPostById.
        repeated RequireUserPostByIdContext context = 1;
        // RequireUserPostByIdArgs provides the field arguments for the required field with method RequireUserPostById.
        RequireUserPostByIdArgs field_args = 2;
      }

      message RequireUserPostByIdContext {
        LookupUserByIdRequestKey key = 1;
        RequireUserPostByIdFields fields = 2;
      }

      message RequireUserPostByIdArgs {
        google.protobuf.StringValue slug = 1;
      }

      message RequireUserPostByIdResponse {
        // RequireUserPostByIdResult provides the result for the required fields method RequireUserPostById.
        repeated RequireUserPostByIdResult result = 1;
      }

      message RequireUserPostByIdResult {
        Post post = 1;
      }

      message RequireUserPostByIdFields {
        string name = 1;
      }

      message User {
        string id = 1;
      }

      message Post {
        string id = 1;
        User author = 2;
        string title = 3;
      }"
    `);
    });
    test('should generate rpc method for required field with randomly ordered fields', () => {
      const sdl = `
      type Product @key(fields: "id") {
        id: ID!
        manufacturerId: ID! @external
        details: ProductDetails! @external
        name: String! @requires(fields: "details { description reviewSummary { message status } } manufacturerId")
        price: Float!
      }

      type ProductDetails {
        id: ID!
        description: String!
        title: String!
        reviewSummary: ActionResult!
      }

      type ActionResult {
        status: String!
        message: String!
      }
    `;

      const { proto: protoText } = compileGraphQLToProto(sdl);

      // Validate Proto definition
      expectValidProto(protoText);

      expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      // Service definition for DefaultService
      service DefaultService {
        // Lookup Product entity by id
        rpc LookupProductById(LookupProductByIdRequest) returns (LookupProductByIdResponse) {}
        rpc RequireProductNameById(RequireProductNameByIdRequest) returns (RequireProductNameByIdResponse) {}
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

      message RequireProductNameByIdRequest {
        // RequireProductNameByIdContext provides the context for the required fields method RequireProductNameById.
        repeated RequireProductNameByIdContext context = 1;
      }

      message RequireProductNameByIdContext {
        LookupProductByIdRequestKey key = 1;
        RequireProductNameByIdFields fields = 2;
      }

      message RequireProductNameByIdResponse {
        // RequireProductNameByIdResult provides the result for the required fields method RequireProductNameById.
        repeated RequireProductNameByIdResult result = 1;
      }

      message RequireProductNameByIdResult {
        string name = 1;
      }

      message RequireProductNameByIdFields {
        message ProductDetails {
          message ActionResult {
            string message = 1;
            string status = 2;
          }

          string description = 1;
          ActionResult review_summary = 2;
        }

        ProductDetails details = 1;
        string manufacturer_id = 2;
      }

      message Product {
        string id = 1;
        double price = 2;
      }

      message ProductDetails {
        string id = 1;
        string description = 2;
        string title = 3;
        ActionResult review_summary = 4;
      }

      message ActionResult {
        string status = 1;
        string message = 2;
      }"
    `);
    });
    test('should generate rpc method for required field with inline fragments and __typename', () => {
      const sdl = `
      type Storage @key(fields: "id") {
        id: ID!
        primaryItem: StorageItem! @external
        itemInfo: String! @requires(fields: "primaryItem { __typename ... on PalletItem { name palletCount } ... on ContainerItem { name containerSize } }")
      }

      interface StorageItem {
        name: String!
      }

      type PalletItem implements StorageItem {
        name: String!
        palletCount: Int!
      }

      type ContainerItem implements StorageItem {
        name: String!
        containerSize: String!
      }
    `;

      const { proto: protoText } = compileGraphQLToProto(sdl);

      // Validate Proto definition
      expectValidProto(protoText);

      // Should generate a Require RPC with oneof for the interface type
      // __typename should be skipped in the proto generation
      expect(protoText).toContain('rpc RequireStorageItemInfoById');
      expect(protoText).toContain('RequireStorageItemInfoByIdFields');
      expect(protoText).toContain('oneof instance');
      expect(protoText).toContain('PalletItem');
      expect(protoText).toContain('ContainerItem');
      // __typename should NOT appear in proto
      expect(protoText).not.toContain('__typename');
      expect(protoText).not.toContain('typename');
    });
  });
});
