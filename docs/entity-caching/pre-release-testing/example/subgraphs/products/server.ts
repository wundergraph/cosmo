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

const schemaPath = new URL('./schema.graphqls', import.meta.url);
const compositionSdl = await Bun.file(schemaPath).text();

const stats = {
  product: 0,
  productBySku: 0,
  products: 0,
  entities: 0,
  updateProduct: 0,
  upsertProduct: 0,
};

const federationRuntimeSdl = /* GraphQL */ `
  directive @link(url: String!, import: [String!]) repeatable on SCHEMA
  directive @key(fields: String!, resolvable: Boolean = true) repeatable on OBJECT | INTERFACE
  directive @openfed__entityCache(
    maxAge: Int!
    includeHeaders: Boolean = false
    partialCacheLoad: Boolean = false
    shadowMode: Boolean = false
  ) on OBJECT
  directive @openfed__queryCache(
    maxAge: Int!
    includeHeaders: Boolean = false
    shadowMode: Boolean = false
  ) on FIELD_DEFINITION
  directive @openfed__cacheInvalidate on FIELD_DEFINITION
  directive @openfed__cachePopulate(maxAge: Int) on FIELD_DEFINITION
  directive @openfed__is(fields: String!) on ARGUMENT_DEFINITION

  scalar _Any

  union _Entity = Product

  type _Service {
    sdl: String!
  }

  extend type Query {
    _service: _Service!
    _entities(representations: [_Any!]!): [_Entity]!
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
  typeDefs: [compositionSdl, federationRuntimeSdl],
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
      _service: () => ({ sdl: compositionSdl }),
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
