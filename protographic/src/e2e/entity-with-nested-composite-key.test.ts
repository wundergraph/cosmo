import { describe, it, expect } from "bun:test";
import { intoIntermediate } from "@/source/graphql";
import { intoProto3, printProto3 } from "@/sink/proto3";

describe("Entity with Nested Composite Key", () => {
  const sdl = `
    type Order @key(fields: "nested { customerId orderId }") {
      nested: Nested!
      name: String!
      price: Float!
    }

    type Nested {
      customerId: ID!
      orderId: ID!
    }
  `;

  it("should correctly read GraphQL SDL into intermediate format", () => {
    const result = intoIntermediate("OrderService", sdl);

    expect(result).toMatchSnapshot();
  });

  it("should generate correct proto3 ast", () => {
    const result = intoIntermediate("OrderService", sdl);
    const proto = intoProto3(result);

    expect(proto).toMatchSnapshot();
  });
  
  it("should generate correct proto3 schema", () => {
    const result = intoIntermediate("OrderService", sdl);
    const { proto } = intoProto3(result);
    const protoSchema = printProto3(proto);

    expect(protoSchema).toMatchSnapshot();
  });
});
