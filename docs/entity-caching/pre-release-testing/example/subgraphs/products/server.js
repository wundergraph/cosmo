import SchemaBuilder from '@pothos/core';
import DirectivePlugin from '@pothos/plugin-directives';
import FederationPlugin from '@pothos/plugin-federation';
import { createYoga } from 'graphql-yoga';

const port = Number(process.env.PORT || 4001);

const products = new Map([
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

function resetStats() {
  for (const key of Object.keys(stats)) {
    stats[key] = 0;
  }
}

function findProductBySku(sku) {
  return [...products.values()].find((product) => product.sku === sku) ?? null;
}

function findProductByReference(reference) {
  stats.entities += 1;
  if (reference.id) {
    return products.get(reference.id) ?? null;
  }
  if (reference.sku) {
    return findProductBySku(reference.sku);
  }
  return null;
}

const builder = new SchemaBuilder({
  plugins: [DirectivePlugin, FederationPlugin],
});

const Product = builder.objectRef('Product').implement({
  fields: (t) => ({
    id: t.exposeID('id', { nullable: false }),
    sku: t.exposeString('sku', { nullable: false }),
    name: t.exposeString('name', { nullable: false }),
  }),
});

builder.asEntity(Product, {
  key: [builder.selection('id'), builder.selection('sku')],
  resolveReference: findProductByReference,
});

builder.queryType({
  fields: (t) => ({
    product: t.field({
      type: Product,
      nullable: true,
      args: {
        id: t.arg.id({ required: true }),
      },
      resolve: (_root, args) => {
        stats.product += 1;
        return products.get(args.id) ?? null;
      },
    }),
    productBySku: t.field({
      type: Product,
      nullable: true,
      args: {
        productSku: t.arg.string({ required: true }),
      },
      resolve: (_root, args) => {
        stats.productBySku += 1;
        return findProductBySku(args.productSku);
      },
    }),
    products: t.field({
      type: [Product],
      nullable: false,
      args: {
        ids: t.arg.idList({ required: true }),
      },
      resolve: (_root, args) => {
        stats.products += 1;
        return args.ids.map((id) => products.get(id)).filter(Boolean);
      },
    }),
  }),
});

builder.mutationType({
  fields: (t) => ({
    updateProduct: t.field({
      type: Product,
      nullable: true,
      args: {
        id: t.arg.id({ required: true }),
        name: t.arg.string({ required: true }),
      },
      resolve: (_root, args) => {
        stats.updateProduct += 1;
        const existing = products.get(args.id);
        if (!existing) {
          return null;
        }
        const updated = { ...existing, name: args.name };
        products.set(args.id, updated);
        return updated;
      },
    }),
    upsertProduct: t.field({
      type: Product,
      nullable: false,
      args: {
        id: t.arg.id({ required: true }),
        sku: t.arg.string({ required: true }),
        name: t.arg.string({ required: true }),
      },
      resolve: (_root, args) => {
        stats.upsertProduct += 1;
        const product = { id: args.id, sku: args.sku, name: args.name };
        products.set(args.id, product);
        return product;
      },
    }),
  }),
});

const schema = builder.toSubGraphSchema({
  linkUrl: 'https://specs.apollo.dev/federation/v2.5',
  federationDirectives: ['@key'],
});

const yoga = createYoga({
  schema,
  graphqlEndpoint: '/graphql',
  landingPage: false,
});

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

Bun.serve({
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

console.log(`products subgraph listening on http://localhost:${port}/graphql`);
