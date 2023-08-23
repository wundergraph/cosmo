import { describe, expect, test } from "vitest";
import { OpenAIGraphql } from "../src/openai-graphql";

describe("OpenAI GraphQL", () => {
    test("Should properly correct schema", async () => {
        if (!process.env.OPENAI_API_KEY){
            return;
        }
        const ai = new OpenAIGraphql({
            openAiApiKey: process.env.OPENAI_API_KEY,
        });
        const result = await ai.fixSDL({
            sdl: brokenSubgraphSDL,
            checkResult: brokenSubgraphCheckResult
        });
        expect(result.sdl).toEqual(fixedSubgraphSDL);
    });
});

const brokenSubgraphCheckResult = `
[products] On type "Product", for @key(fields: "sku package"): Cannot query field "package" on type "Product" (the field should either be added to this subgraph or, if it should not be resolved by this subgraph, you need to add it to this subgraph with @external).


type Product @key(fields: "id") @key(fields: "sku package") @key(fields: "sku variation { id }"){
                                                     ^
    id: ID! @tag(name: "hi-from-products")
`

const brokenSubgraphSDL = `directive @tag(name: String!) repeatable on FIELD_DEFINITION

type Product @key(fields: "id") @key(fields: "sku package") @key(fields: "sku variation { id }"){
  id: ID! @tag(name: "hi-from-products")
  sku: String @tag(name: "hi-from-products")
  variation: ProductVariation
  dimensions: ProductDimension

  createdBy: User @provides(fields: "totalProductsCreated")
}

type ProductVariation {
  id: ID!
}

type ProductDimension {
  size: String
  weight: Float
}

extend type Query {
  allProducts: [Product]
  product(id: ID!): Product
}

extend type User @key(fields: "email") {
  email: ID! @external
  totalProductsCreated: Int @external
}
`

const fixedSubgraphSDL = `directive @tag(name: String!) repeatable on FIELD_DEFINITION

type Product @key(fields: "id") @key(fields: "sku variation { id }") {
  id: ID! @tag(name: "hi-from-products")
  sku: String @tag(name: "hi-from-products")
  variation: ProductVariation
  dimensions: ProductDimension

  createdBy: User @provides(fields: "totalProductsCreated")
}

type ProductVariation {
  id: ID!
}

type ProductDimension {
  size: String
  weight: Float
}

extend type Query {
  allProducts: [Product]
  product(id: ID!): Product
}

extend type User @key(fields: "email") {
  email: ID! @external
  totalProductsCreated: Int @external
}`