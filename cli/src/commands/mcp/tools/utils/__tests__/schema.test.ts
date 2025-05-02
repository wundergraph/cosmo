import { describe, it, expect } from 'vitest';
import { lexicographicSortSchema, printSchema } from 'graphql';
import { buildSchemaWithoutDirectives } from '../schema.js';

describe('buildSchemaWithoutDirectives', () => {
  it('should remove all directive definitions and usages from a federation schema', () => {
    const schemaWithDirectives = `
      directive @key(fields: String!) on OBJECT | INTERFACE
      directive @external on FIELD_DEFINITION
      directive @requires(fields: String!) on FIELD_DEFINITION
      directive @provides(fields: String!) on FIELD_DEFINITION
      directive @extends on OBJECT | INTERFACE

      type Query {
        topProducts: [Product]
      }

      type Product @key(fields: "id") {
        id: ID!
        name: String!
        price: Int @external
        weight: Int @external
        shippingEstimate: Int @requires(fields: "price weight")
      }

      type User @key(fields: "id") @extends {
        id: ID! @external
        username: String @external
        reviews: [Review] @provides(fields: "author")
      }

      type Review {
        id: ID!
        author: User
        product: Product!
        rating: Int!
      }
    `;

    const expectedSchema = `type Product {
  id: ID!
  name: String!
  price: Int
  shippingEstimate: Int
  weight: Int
}

type Query {
  topProducts: [Product]
}

type Review {
  author: User
  id: ID!
  product: Product!
  rating: Int!
}

type User {
  id: ID!
  reviews: [Review]
  username: String
}`;

    const schema = buildSchemaWithoutDirectives(schemaWithDirectives);
    // Sort the schema to ensure consistent output
    const sortedSchema = lexicographicSortSchema(schema);
    const cleanedSchemaString = printSchema(sortedSchema);

    // Compare the actual cleaned schema with expected schema
    expect(cleanedSchemaString.trim()).toBe(expectedSchema.trim());
  });
  it('should throw an error for an invalid schema', () => {
    const invalidSchema = `
      type Query {
        invalidField: NonExistentType
      }
    `;

    expect(() => buildSchemaWithoutDirectives(invalidSchema)).toThrowError(
      'Failed to parse schema: Unknown type: "NonExistentType".',
    );
  });
});
