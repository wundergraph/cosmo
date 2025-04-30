import { describe, it, expect } from "bun:test";
import { intoIntermediate } from "./graphql";

describe("GraphQL source", () => {
  const sdl = `
    scalar ID
    scalar String
    scalar Float

    type Product @key(fields: "id") {
      id: ID!
      name: String!
      price: Float!
      # shippingEstimate(input: ShippingEstimateInput!): Float!
    }

    type Storage @key(fields: "id") {
      id: ID!
      name: String!
      location: String!
    }

    type User {
      id: ID!
      name: String!
    }

    type NestedTypeA {
      id: ID!
      name: String!
      b: NestedTypeB!
    }

    type NestedTypeB {
      id: ID!
      name: String!
      c: NestedTypeC!
    }

    type NestedTypeC {
      id: ID!
      name: String!
    }

    type RecursiveType {
      id: ID!
      name: String!
      recursiveType: RecursiveType!
    }

    type TypeWithMultipleFilterFields {
      id: ID!
      name: String!
      filterField1: String!
      filterField2: String!
    }

    input FilterTypeInput {
      filterField1: String!
      filterField2: String!
    }

    type TypeWithComplexFilterInput {
      id: ID!
      name: String!
    }

    input FilterType {
      name: String!
      filterField1: String!
      filterField2: String!
      pagination: Pagination
    }

    input Pagination {
      page: Int!
      perPage: Int!
    }

    input ComplexFilterTypeInput {
      filter: FilterType!
    }

    type Query {
      _entities(representations: [_Any!]!): [_Entity!]!
      users: [User!]!
      user(id: ID!): User!
      userIdOptional(id: ID): User
      nestedType: [NestedTypeA!]!
      recursiveType: RecursiveType!
      typeFilterWithArguments(
        filterField1: String!
        filterField2: String!
      ): [TypeWithMultipleFilterFields!]!
      typeWithMultipleFilterFields(
        filter: FilterTypeInput!
      ): [TypeWithMultipleFilterFields!]!
      complexFilterType(
        filter: ComplexFilterTypeInput!
      ): [TypeWithComplexFilterInput!]!
    }

    type Mutation {
      createProduct(input: CreateProductInput!): Product!
    }

    input CreateProductInput {
      name: String!
      price: Float!
    }

    union _Entity = Product | Storage
    scalar _Any
  `;

  it("should correctly read GraphQL SDL into intermediate format", () => {
    const result = intoIntermediate("ProductService", sdl);

    expect(result).toMatchSnapshot();
  });
});
