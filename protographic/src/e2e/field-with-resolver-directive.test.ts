import { intoProto3, printProto3 } from "@/sink/proto3";
import { intoIntermediate } from "@/source/graphql";
import { describe, it, expect } from "bun:test";
// import { transformSDLToProto } from "../../transform";
// import {
//   validateProtoDefinition,
//   normalizeWhitespace,
// } from "../utils/proto-comparator";

describe("Field with Resolver Directive Transformation", () => {
  const sdl = `
    type Product @key(fields: "id") {
        id: ID!
        name: String!
        price: Float!
        shippingEstimate: Float! @resolver
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
