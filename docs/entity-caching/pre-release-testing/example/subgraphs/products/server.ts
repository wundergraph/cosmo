import { GraphQLScalarType, Kind } from 'graphql';
import { createSchema, createYoga } from 'graphql-yoga';

type Product = {
  id: string;
  sku: string;
  name: string;
};

type ProductReference = {
  __typename?: 'Product';
  id?: string;
  sku?: string;
};

const port = Number(process.env.PORT || 4001);

const products = new Map<string, Product>([
  ['p1', { id: 'p1', sku: 'sku-1', name: 'Widget' }],
  ['p2', { id: 'p2', sku: 'sku-2', name: 'Gadget' }],
]);

const stats = {
  product: 0,
  productBySku: 0,
  products: 0,
  entities: 0,
  updateProduct: 0,
  upsertProduct: 0,
};

const typeDefs = /* GraphQL */ `
  scalar _Any

  union _Entity = Product

  type _Service {
    sdl: String!
  }

  type Query {
    _service: _Service!
    _entities(representations: [_Any!]!): [_Entity]!
    product(id: ID!): Product
    productBySku(productSku: String!): Product
    products(ids: [ID!]!): [Product!]!
  }

  type Mutation {
    updateProduct(id: ID!, name: String!): Product
    upsertProduct(id: ID!, sku: String!, name: String!): Product!
  }

  type Product {
    id: ID!
    sku: String!
    name: String!
  }
`;

const serviceSdl = /* GraphQL */ `
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.5", import: ["@key"])

  type Product @key(fields: "id") @key(fields: "sku") {
    id: ID!
    sku: String!
    name: String!
  }

  type Query {
    product(id: ID!): Product
    productBySku(productSku: String!): Product
    products(ids: [ID!]!): [Product!]!
  }

  type Mutation {
    updateProduct(id: ID!, name: String!): Product
    upsertProduct(id: ID!, sku: String!, name: String!): Product!
  }
`;

function resetStats() {
  for (const key of Object.keys(stats) as Array<keyof typeof stats>) {
    stats[key] = 0;
  }
}

function findProductBySku(sku: string) {
  return [...products.values()].find((product) => product.sku === sku) ?? null;
}

function findProductByReference(reference: ProductReference) {
  stats.entities += 1;
  if (reference.id) {
    return products.get(reference.id) ?? null;
  }
  if (reference.sku) {
    return findProductBySku(reference.sku);
  }
  return null;
}

const schema = createSchema({
  typeDefs,
  resolvers: {
    _Any: new GraphQLScalarType({
      name: '_Any',
      parseLiteral(ast) {
        if (ast.kind !== Kind.STRING) {
          return null;
        }
        return JSON.parse(ast.value);
      },
      parseValue(value) {
        return value;
      },
      serialize(value) {
        return value;
      },
    }),
    _Entity: {
      __resolveType(value: ProductReference) {
        return value.__typename ?? 'Product';
      },
    },
    Query: {
      _service: () => ({ sdl: serviceSdl }),
      _entities: (_root: unknown, args: { representations: ProductReference[] }) =>
        args.representations.map(findProductByReference),
      product: (_root: unknown, args: { id: string }) => {
        stats.product += 1;
        return products.get(args.id) ?? null;
      },
      productBySku: (_root: unknown, args: { productSku: string }) => {
        stats.productBySku += 1;
        return findProductBySku(args.productSku);
      },
      products: (_root: unknown, args: { ids: string[] }) => {
        stats.products += 1;
        return args.ids.map((id) => products.get(id)).filter((product): product is Product => Boolean(product));
      },
    },
    Mutation: {
      updateProduct: (_root: unknown, args: { id: string; name: string }) => {
        stats.updateProduct += 1;
        const existing = products.get(args.id);
        if (!existing) {
          return null;
        }
        const updated = { ...existing, name: args.name };
        products.set(args.id, updated);
        return updated;
      },
      upsertProduct: (_root: unknown, args: { id: string; sku: string; name: string }) => {
        stats.upsertProduct += 1;
        const product = { id: args.id, sku: args.sku, name: args.name };
        products.set(args.id, product);
        return product;
      },
    },
  },
});

const yoga = createYoga({
  schema,
  graphqlEndpoint: '/graphql',
  landingPage: false,
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const server = Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/health') {
      return json({ ok: true });
    }
    if (url.pathname === '/stats') {
      return json({ stats });
    }
    if (url.pathname === '/reset' && req.method === 'POST') {
      resetStats();
      return json({ ok: true });
    }
    return yoga.fetch(req);
  },
});

console.info(
  `products subgraph listening on ${new URL(yoga.graphqlEndpoint, `http://${server.hostname}:${server.port}`)}`,
);
