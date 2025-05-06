import { describe, expect, it } from 'vitest';
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

    // Check entity mappings
    expect(mapping.entityMappings).toHaveLength(1);

    const productEntity = mapping.entityMappings[0];
    expect(productEntity.typeName).toBe('Product');
    expect(productEntity.kind).toBe('entity');
    expect(productEntity.key).toBe('id');
    expect(productEntity.rpc).toBe('LookupProductById');
    expect(productEntity.request).toBe('LookupProductByIdRequest');
    expect(productEntity.response).toBe('LookupProductByIdResponse');

    // Check operation mappings
    expect(mapping.operationMappings).toHaveLength(2);

    // Check type field mappings
    const productType = mapping.typeFieldMappings.find((m) => m.type === 'Product');
    expect(productType).toBeDefined();
    expect(productType?.fieldMappings).toHaveLength(3);
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

    // Check entity mappings
    expect(mapping.entityMappings).toHaveLength(2);

    // User entity
    const userEntity = mapping.entityMappings.find((e) => e.typeName === 'User');
    expect(userEntity).toBeDefined();
    expect(userEntity?.key).toBe('id');
    expect(userEntity?.rpc).toBe('LookupUserById');

    // Order entity
    const orderEntity = mapping.entityMappings.find((e) => e.typeName === 'Order');
    expect(orderEntity).toBeDefined();
    expect(orderEntity?.key).toBe('id');
    expect(orderEntity?.rpc).toBe('LookupOrderById');

    // Check operation mappings
    expect(mapping.operationMappings).toHaveLength(4);

    // Check type field mappings
    const userType = mapping.typeFieldMappings.find((m) => m.type === 'User');
    expect(userType).toBeDefined();
    expect(userType?.fieldMappings).toHaveLength(3);

    const orderType = mapping.typeFieldMappings.find((m) => m.type === 'Order');
    expect(orderType).toBeDefined();
    expect(orderType?.fieldMappings).toHaveLength(4);
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

    // Check entity mappings
    expect(mapping.entityMappings).toHaveLength(2);

    // Product entity
    const productEntity = mapping.entityMappings.find((e) => e.typeName === 'Product');
    expect(productEntity).toBeDefined();
    expect(productEntity?.key).toBe('id');

    // Storage entity
    const storageEntity = mapping.entityMappings.find((e) => e.typeName === 'Storage');
    expect(storageEntity).toBeDefined();
    expect(storageEntity?.key).toBe('id');

    // Check regular operation mappings (should not include _entities)
    const regularOps = mapping.operationMappings.filter((op) => !op.original.startsWith('_'));
    expect(regularOps).toHaveLength(1);
    expect(regularOps[0].original).toBe('products');
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

    // Check entity mappings
    expect(mapping.entityMappings).toHaveLength(3);

    // Product entity (should have multiple keys)
    const productEntity = mapping.entityMappings.find((e) => e.typeName === 'Product');
    expect(productEntity).toBeDefined();
    // Our implementation currently only uses the first key, but it works
    expect(productEntity?.key).toBe('id');

    // Review entity
    const reviewEntity = mapping.entityMappings.find((e) => e.typeName === 'Review');
    expect(reviewEntity).toBeDefined();
    expect(reviewEntity?.key).toBe('id');

    // User entity
    const userEntity = mapping.entityMappings.find((e) => e.typeName === 'User');
    expect(userEntity).toBeDefined();
    expect(userEntity?.key).toBe('id');

    // Check regular operation mappings
    const regularOps = mapping.operationMappings.filter((op) => !op.original.startsWith('_'));
    expect(regularOps).toHaveLength(3);

    // Check Product type field mappings
    const productType = mapping.typeFieldMappings.find((m) => m.type === 'Product');
    expect(productType).toBeDefined();
    expect(productType?.fieldMappings.length).toBeGreaterThan(3);

    // Check Review type field mappings
    const reviewType = mapping.typeFieldMappings.find((m) => m.type === 'Review');
    expect(reviewType).toBeDefined();
    expect(reviewType?.fieldMappings.length).toBeGreaterThan(3);
  });
});
