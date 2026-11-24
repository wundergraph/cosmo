import { describe, expect, test } from 'vitest';
import { errorMessage } from '../src/result.js';
import { parseConfig, parseLock, renderConfig, subgraphSchemaFile } from '../src/config.js';

const parsed = (text: string) => {
  const result = parseConfig(text);
  if (!result.success) {
    throw new Error(errorMessage(result));
  }
  return result.data;
};

const failure = (text: string): string => {
  const result = parseConfig(text);
  if (result.success) {
    throw new Error('expected the config to be rejected');
  }
  return errorMessage(result);
};

describe('wundergraph.yaml', () => {
  test('reads every subgraph kind, the router, the check policy, mocks and collections', () => {
    const config = parsed(`
graph: shop
namespace: staging
subgraphs:
  - name: products
    schema: { file: services/products/schema.graphql }
    routing_url: http://localhost:4001/graphql
  - name: reviews
    schema: { command: pnpm --filter reviews run --silent print-schema }
  - name: inventory
    kind: grpc
    schema: { file: modules/inventory/schema.graphql }
    proto: modules/inventory/service.proto
    mapping: modules/inventory/mapping.json
    routing_url: dns:///localhost:4011
  - name: payments
    kind: plugin
    path: plugins/payments
    version: 0.0.1
router:
  release: 0.374.0
  modules:
    - path: modules/inventory
check:
  rules: { naming: warn }
collections: "collections/*"
mocks:
  Product: { name: Lamp }
`);

    expect(config).toEqual({
      graph: 'shop',
      namespace: 'staging',
      subgraphs: [
        {
          name: 'products',
          kind: 'schema',
          schema: { file: 'services/products/schema.graphql' },
          routing_url: 'http://localhost:4001/graphql',
        },
        { name: 'reviews', kind: 'schema', schema: { command: 'pnpm --filter reviews run --silent print-schema' } },
        {
          name: 'inventory',
          kind: 'grpc',
          schema: { file: 'modules/inventory/schema.graphql' },
          proto: 'modules/inventory/service.proto',
          mapping: 'modules/inventory/mapping.json',
          routing_url: 'dns:///localhost:4011',
        },
        { name: 'payments', kind: 'plugin', path: 'plugins/payments', version: '0.0.1' },
      ],
      router: {
        source: { release: '0.374.0' },
        modules: [{ path: 'modules/inventory' }],
        binary: '.forge/bin/router',
      },
      check: { rules: { naming: 'warn' } },
      collections: 'collections/*',
      mocks: { Product: { name: 'Lamp' } },
    });
    expect(config.subgraphs.map((entry) => subgraphSchemaFile(entry))).toEqual([
      'services/products/schema.graphql',
      undefined,
      'modules/inventory/schema.graphql',
      'plugins/payments/src/schema.graphql',
    ]);
  });

  test('defaults the namespace and an empty subgraph list', () => {
    expect(parsed('graph: shop\n')).toEqual({ graph: 'shop', namespace: 'default', subgraphs: [] });
  });

  test('renders what it reads, leaving out defaults', () => {
    const text = [
      'graph: shop',
      'subgraphs:',
      '  - name: products',
      '    schema:',
      '      file: products.graphql',
      '  - name: payments',
      '    kind: plugin',
      '    path: plugins/payments',
      '    version: 0.0.1',
      'router:',
      '  release: 0.374.0',
      '',
    ].join('\n');

    expect(renderConfig(parsed(text))).toBe(text);
  });

  test('names every problem with its path', () => {
    expect(
      failure(`
graph: shop
audience: hub
subgraphs:
  - name: products
  - name: reviews
    schema: { file: a.graphql, command: echo }
  - name: grpc
    kind: grpc
    schema: { file: a.graphql }
`),
    ).toBe(
      [
        'wundergraph.yaml is invalid:',
        '  subgraphs[0].schema: set `schema` to `{ file: <path to an SDL file> }` or `{ command: <command that prints the SDL> }`',
        '  subgraphs[1].schema: set `schema` to `{ file: <path to an SDL file> }` or `{ command: <command that prints the SDL> }`',
        '  subgraphs[2].proto: set a path relative to wundergraph.yaml',
        '  subgraphs[2].mapping: set a path relative to wundergraph.yaml',
        '  subgraphs[2].routing_url: set `routing_url` to where the router reaches the subgraph',
        '  (top level): Unrecognized key: "audience"',
      ].join('\n'),
    );
  });

  test('rejects two subgraphs with one name, a router without one source, and a plugin named apart from its directory', () => {
    expect(
      failure(`
graph: shop
subgraphs:
  - { name: a, schema: { file: a.graphql } }
  - { name: a, schema: { file: b.graphql } }
  - { name: pay, kind: plugin, path: plugins/payments, version: 0.0.1 }
router:
  release: 0.374.0
  commit: abcdef1
`),
    ).toBe(
      [
        'wundergraph.yaml is invalid:',
        '  subgraphs[2]: name a plugin subgraph after its directory, as the router loads it by that name',
        '  subgraphs: give every subgraph its own name',
        '  router: set exactly one of `release: <version>`, `rc: <version>` or `commit: <sha>`',
      ].join('\n'),
    );
  });

  test('asks for the graph when it is missing', () => {
    expect(failure('subgraphs: []')).toBe(
      ['wundergraph.yaml is invalid:', '  graph: set `graph` to the federated graph in Cosmo, e.g. `graph: shop`'].join(
        '\n',
      ),
    );
  });

  test('reports YAML syntax errors', () => {
    expect(failure('graph: [shop')).toMatch(/^wundergraph\.yaml is not valid YAML: /);
  });
});

describe('wundergraph.lock', () => {
  test('reads a lock', () => {
    const result = parseLock(
      [
        'version: 1',
        'router:',
        '  source: { release: 0.374.0 }',
        '  commit: 7d95db310db6972056b56c91c0f5c8075c74ea29',
        '  version: v0.0.0-20251001000000-7d95db310db6',
        '  goVersion: "1.25"',
      ].join('\n'),
    );
    expect(result).toEqual({
      success: true,
      data: {
        version: 1,
        router: {
          source: { release: '0.374.0' },
          commit: '7d95db310db6972056b56c91c0f5c8075c74ea29',
          version: 'v0.0.0-20251001000000-7d95db310db6',
          goVersion: '1.25',
        },
        modules: [],
      },
    });
  });
});
