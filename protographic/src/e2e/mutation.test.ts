import { describe, it, expect } from "bun:test";
import { intoIntermediate } from "@/source/graphql";
import { intoProto3, printProto3 } from "@/sink/proto3";

describe("Mutation Transformation", () => {
  const sdl = `
    type Mutation {
      createProduct(input: CreateProductInput!): Product!
    }

    input CreateProductInput {
      name: String!
      price: Float!
    }

    type Product {
      id: ID!
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
