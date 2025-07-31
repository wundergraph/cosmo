import { describe, expect, it } from 'vitest';
import { compileGraphQLToProto } from '../../src';
import { expectValidProto } from '../util';

describe('SDL to Proto Comments', () => {
  it('should convert GraphQL type descriptions to Proto comments', () => {
    // Define a schema with various comment styles
    const sdl = `
      """
      User type multi-line description.
      This is a second line.
      """
      type User {
        "Single line description for id field"
        id: ID!
        
        """
        Multi-line description for the name field.
        Second line of the description.
        """
        name: String
        
        # This is not a description, just a comment in SDL
        age: Int
      }
      
      "Single line description for the Role enum"
      enum Role {
        "Admin role description"
        ADMIN
        
        """
        User role multi-line description.
        Has lower privileges than admin.
        """
        USER
      }
      
      """
      Input type for creating a user.
      Contains all required fields.
      """
      input CreateUserInput {
        "User's name"
        name: String!
        
        "User's email address"
        email: String!
      }
      
      type Query {
        "Get a user by ID"
        user(
          "The ID of the user to fetch"
          id: ID!
        ): User
        
        """
        List all users with pagination.
        Returns a list of User objects.
        """
        users(
          """
          Number of items to skip.
          Use for pagination.
          """
          offset: Int
          
          "Maximum number of items to return"
          limit: Int
        ): [User!]!
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
        // Get a user by ID
        rpc QueryUser(QueryUserRequest) returns (QueryUserResponse) {}
        /*
         * List all users with pagination.
         * Returns a list of User objects.
         */
        rpc QueryUsers(QueryUsersRequest) returns (QueryUsersResponse) {}
      }

      // Request message for user operation: Get a user by ID.
      message QueryUserRequest {
        // The ID of the user to fetch
        string id = 1;
      }
      // Response message for user operation: Get a user by ID.
      message QueryUserResponse {
        // Get a user by ID
        User user = 1;
      }
      /*
       * Request message for users operation: List all users with pagination.
       * Returns a list of User objects..
       */
      message QueryUsersRequest {
        /*
         * Number of items to skip.
         * Use for pagination.
         */
        google.protobuf.Int32Value offset = 1;
        // Maximum number of items to return
        google.protobuf.Int32Value limit = 2;
      }
      /*
       * Response message for users operation: List all users with pagination.
       * Returns a list of User objects..
       */
      message QueryUsersResponse {
        /*
         * List all users with pagination.
         * Returns a list of User objects.
         */
        repeated User users = 1;
      }

      /*
       * User type multi-line description.
       * This is a second line.
       */
      message User {
        // Single line description for id field
        string id = 1;
        /*
         * Multi-line description for the name field.
         * Second line of the description.
         */
        google.protobuf.StringValue name = 2;
        google.protobuf.Int32Value age = 3;
      }

      // Single line description for the Role enum
      enum Role {
        ROLE_UNSPECIFIED = 0;
        // Admin role description
        ROLE_ADMIN = 1;
        /*
         * User role multi-line description.
         * Has lower privileges than admin.
         */
        ROLE_USER = 2;
      }

      /*
       * Input type for creating a user.
       * Contains all required fields.
       */
      message CreateUserInput {
        // User's name
        string name = 1;
        // User's email address
        string email = 2;
      }"
    `);
  });

  it('should handle complex schema with interface and union types', () => {
    const sdl = `
      "Base interface for all entities"
      interface Node {
        "Unique identifier"
        id: ID!
      }
      
      """
      A person represents a human with a name.
      This entity implements the Node interface.
      """
      type Person implements Node {
        "Unique identifier"
        id: ID!
        
        "Person's full name"
        name: String!
      }
      
      "Organization entity"
      type Organization implements Node {
        "Unique identifier"
        id: ID!
        
        "Organization name"
        name: String!
        
        "Organization description"
        description: String
      }
      
      """
      Search result union type.
      Can be either a Person or Organization.
      """
      union SearchResult = Person | Organization
      
      type Query {
        "Search for entities by name"
        search(
          "Search query string"
          query: String!
        ): [SearchResult!]!
        
        "Get node by ID"
        node(
          "The ID of the node"
          id: ID!
        ): Node
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
        // Get node by ID
        rpc QueryNode(QueryNodeRequest) returns (QueryNodeResponse) {}
        // Search for entities by name
        rpc QuerySearch(QuerySearchRequest) returns (QuerySearchResponse) {}
      }

      // Request message for search operation: Search for entities by name.
      message QuerySearchRequest {
        // Search query string
        string query = 1;
      }
      // Response message for search operation: Search for entities by name.
      message QuerySearchResponse {
        // Search for entities by name
        repeated SearchResult search = 1;
      }
      // Request message for node operation: Get node by ID.
      message QueryNodeRequest {
        // The ID of the node
        string id = 1;
      }
      // Response message for node operation: Get node by ID.
      message QueryNodeResponse {
        // Get node by ID
        Node node = 1;
      }

      /*
       * Search result union type.
       * Can be either a Person or Organization.
       */
      message SearchResult {
        oneof value {
        /*
         * A person represents a human with a name.
         * This entity implements the Node interface.
         */
        Person person = 1;
        // Organization entity
        Organization organization = 2;
        }
      }

      // Base interface for all entities
      message Node {
        oneof instance {
        /*
         * A person represents a human with a name.
         * This entity implements the Node interface.
         */
        Person person = 1;
        // Organization entity
        Organization organization = 2;
        }
      }

      /*
       * A person represents a human with a name.
       * This entity implements the Node interface.
       */
      message Person {
        // Unique identifier
        string id = 1;
        // Person's full name
        string name = 2;
      }

      // Organization entity
      message Organization {
        // Unique identifier
        string id = 1;
        // Organization name
        string name = 2;
        // Organization description
        google.protobuf.StringValue description = 3;
      }"
    `);
  });

  it('should add comments to entity lookup messages for federation types', () => {
    // Define federation directives first
    const sdl = `
      directive @key(fields: String!) on OBJECT
      
      """
      User entity type.
      This is a federated entity marked with the @key directive.
      """
      type User @key(fields: "id") {
        "Unique user identifier"
        id: ID!
        
        "User's full name"
        name: String!
        
        "User's email address"
        email: String!
      }
      
      """
      Product entity type.
      Contains product information across the graph.
      """
      type Product @key(fields: "upc") {
        "Universal Product Code"
        upc: ID!
        
        "Product name"
        name: String!
        
        "Product price in cents"
        price: Int!
        
        "Optional product description"
        description: String
      }
      
      type Query {
        "Get all available products"
        products: [Product!]!
        
        "Get a single product by UPC"
        product(
          "The product UPC"
          upc: ID!
        ): Product
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
        /*
         * Lookup Product entity by upc: Product entity type.
         * Contains product information across the graph.
         */
        rpc LookupProductByUpc(LookupProductByUpcRequest) returns (LookupProductByUpcResponse) {}
        /*
         * Lookup User entity by id: User entity type.
         * This is a federated entity marked with the @key directive.
         */
        rpc LookupUserById(LookupUserByIdRequest) returns (LookupUserByIdResponse) {}
        // Get a single product by UPC
        rpc QueryProduct(QueryProductRequest) returns (QueryProductResponse) {}
        // Get all available products
        rpc QueryProducts(QueryProductsRequest) returns (QueryProductsResponse) {}
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

      // Request message for products operation: Get all available products.
      message QueryProductsRequest {
      }
      // Response message for products operation: Get all available products.
      message QueryProductsResponse {
        // Get all available products
        repeated Product products = 1;
      }
      // Request message for product operation: Get a single product by UPC.
      message QueryProductRequest {
        // The product UPC
        string upc = 1;
      }
      // Response message for product operation: Get a single product by UPC.
      message QueryProductResponse {
        // Get a single product by UPC
        Product product = 1;
      }

      /*
       * User entity type.
       * This is a federated entity marked with the @key directive.
       */
      message User {
        // Unique user identifier
        string id = 1;
        // User's full name
        string name = 2;
        // User's email address
        string email = 3;
      }

      /*
       * Product entity type.
       * Contains product information across the graph.
       */
      message Product {
        // Universal Product Code
        string upc = 1;
        // Product name
        string name = 2;
        // Product price in cents
        int32 price = 3;
        // Optional product description
        google.protobuf.StringValue description = 4;
      }"
    `);
  });
});
