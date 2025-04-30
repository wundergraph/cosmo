import { intoProto3, printProto3 } from "@/sink/proto3";
import { intoIntermediate } from "@/source/graphql";
import { describe, it, expect } from "bun:test";
// import { transformSDLToProto } from "../../transform";
// import {
//   validateProtoDefinition,
//   normalizeWhitespace,
// } from "../utils/proto-comparator";

describe("Query Transformation", () => {
  const sdl = `
    type User {
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
      users: [User!]!
      user(id: ID!): User
      complexFilterType(
        filter: ComplexFilterTypeInput!
      ): [TypeWithComplexFilterInput!]!
    }

    type Mutation {
      createUser(input: CreateProductInput!): Product!
    }

    type Subscription {
      subscribeUsers: User!
    }

    input CreateProductInput {
      name: String!
      price: Float!
    }
  `;

  it("should correctly read GraphQL SDL into intermediate format", () => {
    const result = intoIntermediate("ProductService", sdl);

    expect(result).toMatchSnapshot();
  });

  it("should generate correct proto3 ast", () => {
    const result = intoIntermediate("ProductService", sdl);
    const proto = intoProto3(result);

    expect(proto).toMatchSnapshot();
  });

  it("should generate correct proto3 schema", () => {
    const result = intoIntermediate("ProductService", sdl);
    const { proto } = intoProto3(result);
    const protoSchema = printProto3(proto);

    expect(protoSchema).toMatchSnapshot();
  });
});
