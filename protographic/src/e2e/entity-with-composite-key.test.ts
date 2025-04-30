import { describe, it, expect } from "bun:test";
// import {
//   validateProtoDefinition,
//   normalizeWhitespace,
// } from "../utils/proto-comparator";
import { intoIntermediate } from "@/source/graphql";
import { intoProto3, printProto3 } from "@/sink/proto3";

describe("Entity with Composite Key", () => {
  const sdl = `
    type Order @key(fields: "customerId orderId") {
      customerId: ID!
      orderId: ID!
      total: Float!
      items: [OrderItem!]!
    }

    type OrderItem {
      productId: ID!
      quantity: Int!
      price: Float!
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

  const expectedProto = `
    syntax = "proto3";

    package order;

    service OrderService {
      rpc LookupOrderByCustomerIdAndOrderId(LookupOrderByCustomerIdAndOrderIdRequest) returns (LookupOrderByCustomerIdAndOrderIdResponse) {}
    }

    message LookupOrderByCustomerIdAndOrderIdRequest {
      repeated LookupOrderByCustomerIdAndOrderIdInput inputs = 1;
    }

    message LookupOrderByCustomerIdAndOrderIdInput {
      OrderByCustomerIdAndOrderIdKey key = 1;
    }

    message LookupOrderByCustomerIdAndOrderIdResponse {
      repeated LookupOrderByCustomerIdAndOrderIdResult results = 1;
    }

    message LookupOrderByCustomerIdAndOrderIdResult {
      Order order = 1;
    }

    message Order {
      string customerId = 1;
      string orderId = 2;
      float total = 3;
      repeated OrderItem items = 4;
    }

    message OrderByCustomerIdAndOrderIdKey {
      string customerId = 1;
      string orderId = 2;
    }

    message OrderItem {
      string productId = 1;
      int32 quantity = 2;
      float price = 3;
    }
  `;
});
