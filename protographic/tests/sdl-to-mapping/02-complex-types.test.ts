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

    // Check enum mappings
    expect(mapping.enumMappings).toHaveLength(1);
    const roleEnum = mapping.enumMappings[0];
    expect(roleEnum.type).toBe('UserRole');
    expect(roleEnum.values).toHaveLength(3);

    // Check enum values
    const adminValue = roleEnum.values.find((v) => v.original === 'ADMIN');
    const userValue = roleEnum.values.find((v) => v.original === 'USER');
    const guestValue = roleEnum.values.find((v) => v.original === 'GUEST');

    expect(adminValue).toBeDefined();
    expect(userValue).toBeDefined();
    expect(guestValue).toBeDefined();

    expect(adminValue?.mapped).toBe('USERROLE_ADMIN');
    expect(userValue?.mapped).toBe('USERROLE_USER');
    expect(guestValue?.mapped).toBe('USERROLE_GUEST');

    // Check query with enum argument
    const queryType = mapping.typeFieldMappings.find((m) => m.type === 'Query');
    const usersByRoleField = queryType?.fieldMappings.find((f) => f.original === 'usersByRole');
    expect(usersByRoleField).toBeDefined();
    expect(usersByRoleField?.argumentMappings).toHaveLength(1);
    expect(usersByRoleField?.argumentMappings[0].original).toBe('role');
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

    // Check operation mappings
    expect(mapping.operationMappings).toHaveLength(4);

    // Check type field mappings
    const humanType = mapping.typeFieldMappings.find((m) => m.type === 'Human');
    const droidType = mapping.typeFieldMappings.find((m) => m.type === 'Droid');

    expect(humanType).toBeDefined();
    expect(droidType).toBeDefined();

    // Check Human fields
    expect(humanType?.fieldMappings).toHaveLength(4);
    const homePlanetField = humanType?.fieldMappings.find((f) => f.original === 'homePlanet');
    expect(homePlanetField).toBeDefined();
    expect(homePlanetField?.mapped).toBe('home_planet');

    // Check Droid fields
    expect(droidType?.fieldMappings).toHaveLength(4);
    const primaryFunctionField = droidType?.fieldMappings.find((f) => f.original === 'primaryFunction');
    expect(primaryFunctionField).toBeDefined();
    expect(primaryFunctionField?.mapped).toBe('primary_function');
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

    // Check operation mappings
    expect(mapping.operationMappings).toHaveLength(1);

    // Check type field mappings for union member types
    const photoType = mapping.typeFieldMappings.find((m) => m.type === 'Photo');
    const postType = mapping.typeFieldMappings.find((m) => m.type === 'Post');

    expect(photoType).toBeDefined();
    expect(postType).toBeDefined();

    expect(photoType?.fieldMappings).toHaveLength(4);
    expect(postType?.fieldMappings).toHaveLength(3);
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

    // Check operation mappings
    expect(mapping.operationMappings).toHaveLength(1);

    // Check query field mappings with complex input
    const queryType = mapping.typeFieldMappings.find((m) => m.type === 'Query');
    const productsField = queryType?.fieldMappings.find((f) => f.original === 'products');

    expect(productsField).toBeDefined();
    expect(productsField?.argumentMappings).toHaveLength(1);
    expect(productsField?.argumentMappings[0].original).toBe('filter');
    expect(productsField?.argumentMappings[0].mapped).toBe('filter');

    // Check product type mappings
    const productType = mapping.typeFieldMappings.find((m) => m.type === 'Product');
    expect(productType).toBeDefined();
    expect(productType?.fieldMappings).toHaveLength(4);

    // Check input type mappings
    const paginationInput = mapping.typeFieldMappings.find((m) => m.type === 'PaginationInput');
    expect(paginationInput).toBeDefined();
    expect(paginationInput?.fieldMappings).toHaveLength(2);

    // Check pagination input fields
    const pageField = paginationInput?.fieldMappings.find((f) => f.original === 'page');
    const limitField = paginationInput?.fieldMappings.find((f) => f.original === 'limit');
    expect(pageField).toBeDefined();
    expect(limitField).toBeDefined();
    expect(pageField?.mapped).toBe('page');
    expect(limitField?.mapped).toBe('limit');

    // Check product filter input type
    const productFilterInput = mapping.typeFieldMappings.find((m) => m.type === 'ProductFilterInput');
    expect(productFilterInput).toBeDefined();
    expect(productFilterInput?.fieldMappings).toHaveLength(5);

    // Check product filter fields
    const nameField = productFilterInput?.fieldMappings.find((f) => f.original === 'name');
    const minPriceField = productFilterInput?.fieldMappings.find((f) => f.original === 'minPrice');
    const paginationField = productFilterInput?.fieldMappings.find((f) => f.original === 'pagination');

    expect(nameField).toBeDefined();
    expect(minPriceField).toBeDefined();
    expect(paginationField).toBeDefined();

    expect(minPriceField?.mapped).toBe('min_price');
    expect(paginationField?.mapped).toBe('pagination');
  });
});
