import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { createFakeSystem, createWorkspace, lockForReleaseA, read, runForge, versionA } from './harness.js';

const template = fileURLToPath(new URL('../../gomodules/sources/rest', import.meta.url));
const fromTemplate = (file: string): Promise<string> => readFile(path.join(template, file), 'utf8');

const manifest = `version: 1
router:
  release: 0.299.0
binary: bin/router
modules: []
`;

const sdl = `type Query {
  catalogItem(id: ID!): CatalogItem
  items(limit: Int, tag: String): [CatalogItem!]!
}

type CatalogItem {
  itemId: String!
  displayName: String
  price: Float
  tags: [String!]!
  warehouse: Warehouse
}

type Warehouse {
  code: String!
}
`;

const skipped = [
  { subject: 'CatalogItem.attributes', reason: 'CatalogItemAttributes has no property that can become a field' },
  { subject: 'POST /v1/items', reason: 'only GET operations are generated' },
  {
    subject: 'GET /v1/items parameter ids',
    reason: 'only plain string, number and boolean parameters are generated',
  },
  { subject: 'GET /v1/export', reason: 'it has no application/json response for status 200' },
];

const url = 'https://catalog.example.com/openapi.yaml';

const sourceWorkspace = (files: Record<string, string> = {}) =>
  createWorkspace({ 'forge.yaml': manifest, 'forge.lock': lockForReleaseA, ...files });

const catalogSystem = async () =>
  createFakeSystem({ documents: { [url]: await fromTemplate('testdata/openapi.yaml') } });

describe('wgc forge source add <openapi>', () => {
  test('reports the generated subgraph SDL, the module path and what was left out', async () => {
    const workspace = await sourceWorkspace();

    const run = await runForge(['source', 'add', url], { workspace, system: await catalogSystem() });

    expect(run.exitCode).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({
      status: 'success',
      source: { kind: 'openapi', location: url },
      module: { id: 'catalog', path: './modules/catalog', package: 'forge.local/catalog' },
      subgraph: {
        name: 'catalog',
        routingUrl: 'dns:///127.0.0.1:4011',
        schema: './modules/catalog/schema.graphql',
        proto: './modules/catalog/generated/service.proto',
        mapping: './modules/catalog/generated/mapping.json',
        sdl,
      },
      graph: 'graph.yaml',
      operations: [
        { field: 'catalogItem', request: 'GET /v1/items/{id}' },
        { field: 'items', request: 'GET /v1/items' },
      ],
      skipped,
      execution: { process: 'router', transport: 'grpc over loopback tcp', listenAddr: '127.0.0.1:4011' },
    });
  });

  test('writes a module with the Cosmo Connect contract and the REST call behind every RPC', async () => {
    const workspace = await sourceWorkspace();

    await runForge(['source', 'add', url], { workspace, system: await catalogSystem() });

    // The Go tests in gomodules/sources/rest run against these same files.
    for (const file of ['schema.graphql', 'generated/service.proto', 'generated/mapping.json', 'operations.json']) {
      expect(await read(workspace, `modules/catalog/${file}`)).toBe(await fromTemplate(file));
    }
    for (const file of ['service.go', 'rest.go', 'operations_test.go']) {
      expect(await read(workspace, `modules/catalog/${file}`)).toBe(await fromTemplate(file));
    }
    expect(await read(workspace, 'modules/catalog/module.go')).toContain('const moduleID = "catalog"');
    expect(await read(workspace, 'modules/catalog/go.mod')).toBe(
      `module forge.local/catalog\n\ngo 1.26.0\n\nrequire github.com/wundergraph/cosmo/router ${versionA}\n`,
    );
    expect(JSON.parse(await read(workspace, 'modules/catalog/operations.json'))).toEqual({
      baseUrl: 'https://catalog.example.com',
      listenAddr: '127.0.0.1:4011',
      operations: [
        {
          rpc: 'QueryCatalogItem',
          method: 'GET',
          path: '/v1/items/{id}',
          parameters: [{ field: 'id', name: 'id', in: 'path' }],
        },
        {
          rpc: 'QueryItems',
          method: 'GET',
          path: '/v1/items',
          parameters: [
            { field: 'limit', name: 'limit', in: 'query' },
            { field: 'tag', name: 'tag', in: 'query' },
          ],
        },
      ],
      types: {
        CatalogItem: {
          item_id: 'item_id',
          display_name: 'display_name',
          price: 'price',
          tags: 'tags',
          warehouse: 'warehouse',
        },
        Warehouse: { code: 'code' },
      },
    });
  });

  test('registers the module in forge.yaml and the subgraph in the graph file', async () => {
    const workspace = await sourceWorkspace();

    await runForge(['source', 'add', url], { workspace, system: await catalogSystem() });

    expect(await read(workspace, 'forge.yaml')).toBe(
      manifest.replace('modules: []\n', 'modules:\n  - path: ./modules/catalog\n'),
    );
    expect(await read(workspace, 'graph.yaml')).toBe(`version: 1
subgraphs:
  - name: catalog
    routing_url: dns:///127.0.0.1:4011
    grpc:
      schema_file: modules/catalog/schema.graphql
      proto_file: modules/catalog/generated/service.proto
      mapping_file: modules/catalog/generated/mapping.json
`);
  });

  test('the next build compiles the module into the router binary', async () => {
    const workspace = await sourceWorkspace();
    const system = await catalogSystem();
    await runForge(['source', 'add', url], { workspace, system });

    const run = await runForge(['build'], { workspace, system });

    expect(JSON.parse(run.stdout)).toMatchObject({
      status: 'success',
      binary: `${workspace}/bin/router`,
      localModules: 1,
    });
    expect(await read(workspace, '.forge/build/main.go')).toBe(
      [
        '// Code generated by wgc forge. DO NOT EDIT.',
        '',
        'package main',
        '',
        'import (',
        '\troutercmd "github.com/wundergraph/cosmo/router/cmd"',
        '',
        '\t_ "forge.local/catalog"',
        ')',
        '',
        'func main() {',
        '\troutercmd.Main()',
        '}',
        '',
      ].join('\n'),
    );
  });

  test('the generated subgraph composes and passes the design check', async () => {
    const workspace = await sourceWorkspace();
    await runForge(['source', 'add', url], { workspace, system: await catalogSystem() });

    const run = await runForge(['check'], { workspace });

    expect(JSON.parse(run.stdout)).toEqual({
      status: 'success',
      complete: true,
      compositionErrors: [],
      findings: [],
      exceptions: [],
      summary: { errors: 0, warnings: 0, exceptions: 0, subgraphs: 1 },
    });
  });

  test('a person reads the same result as text', async () => {
    const workspace = await sourceWorkspace({ 'api/openapi.yaml': await fromTemplate('testdata/openapi.yaml') });

    const run = await runForge(['source', 'add', 'api/openapi.yaml'], { workspace, caller: 'human' });

    expect(run.stdout).toBe(
      [
        'Created ./modules/catalog from api/openapi.yaml and added it to forge.yaml and graph.yaml.',
        '  2 query field(s)',
        '    catalogItem  GET /v1/items/{id}',
        '    items  GET /v1/items',
        '  4 skipped',
        ...skipped.map((entry) => `    ${entry.subject}: ${entry.reason}`),
        '  The router serves the subgraph to itself on 127.0.0.1:4011. No plugin executable is started.',
        'Next: `wgc forge build`, then `wgc router compose -i graph.yaml -o config.json`.',
        '',
      ].join('\n'),
    );
  });

  test('a second source needs its own name and its own address', async () => {
    const workspace = await sourceWorkspace();
    const system = await catalogSystem();
    await runForge(['source', 'add', url], { workspace, system });

    const sameName = await runForge(['source', 'add', url], { workspace, system });
    const sameAddress = await runForge(['source', 'add', '--name', 'catalog-two', url], { workspace, system });
    const distinct = await runForge(['source', 'add', '--name', 'catalog-two', '--listen', '127.0.0.1:4012', url], {
      workspace,
      system,
    });

    expect(JSON.parse(sameName.stdout).error).toEqual({
      message: 'graph.yaml already has a subgraph named catalog.',
      input: '--name catalog',
      fix: 'Pass another --name.',
    });
    expect(JSON.parse(sameAddress.stdout).error).toEqual({
      message: 'Another subgraph in graph.yaml is already served on 127.0.0.1:4011.',
      input: '--listen 127.0.0.1:4011',
      fix: 'Pass --listen with a free address, for example --listen 127.0.0.1:4012.',
    });
    expect(JSON.parse(distinct.stdout).subgraph.routingUrl).toBe('dns:///127.0.0.1:4012');
    expect(await read(workspace, 'modules/catalog-two/generated/service.proto')).toContain('package catalog_two.v1;');
  });

  test('translates inline objects, allOf, nullable types and operations without an operationId', async () => {
    const workspace = await sourceWorkspace({
      'openapi.json': JSON.stringify({
        openapi: '3.1.0',
        info: { title: 'Orders API' },
        paths: {
          '/orders/{order-id}/lines': {
            parameters: [{ name: 'order-id', in: 'path', required: true, schema: { type: 'integer' } }],
            get: {
              responses: {
                200: {
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        required: ['total_count', 'lines'],
                        properties: {
                          total_count: { type: 'integer', format: 'int64' },
                          lines: { type: 'array', items: { $ref: '#/components/schemas/order-line' } },
                          matrix: { type: 'array', items: { type: 'array', items: { type: 'number' } } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        components: {
          schemas: {
            'order-line': {
              allOf: [
                { $ref: '#/components/schemas/Identified' },
                {
                  type: 'object',
                  required: ['SKU'],
                  properties: {
                    SKU: { type: ['string', 'null'] },
                    shipped: { type: 'boolean' },
                    dimensions: { type: 'object', properties: { 'weight-kg': { type: 'number' } } },
                  },
                },
              ],
            },
            Identified: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
          },
        },
      }),
    });

    const run = await runForge(['source', 'add', 'openapi.json'], { workspace });

    const result = JSON.parse(run.stdout);
    expect(result.module.id).toBe('orders-api');
    expect(result.subgraph.sdl).toBe(`type Query {
  getOrdersByOrderIdLines(orderId: Int!): GetOrdersByOrderIdLinesResponse
}

type GetOrdersByOrderIdLinesResponse {
  totalCount: Float!
  lines: [OrderLine!]!
}

type OrderLine {
  id: ID!
  sKU: String
  shipped: Boolean
  dimensions: OrderLineDimensions
}

type OrderLineDimensions {
  weightKg: Float
}
`);
    expect(result.skipped).toEqual([
      { subject: 'GetOrdersByOrderIdLinesResponse.matrix', reason: 'lists of lists are not generated' },
    ]);
    expect(JSON.parse(await read(workspace, 'modules/orders-api/operations.json')).types.OrderLine).toEqual({
      id: 'id',
      SKU: 's_ku',
      shipped: 'shipped',
      dimensions: 'dimensions',
    });
  });
});

describe('wgc forge source add rejects what it cannot generate', () => {
  test('a proto file names what is missing', async () => {
    const workspace = await sourceWorkspace({ 'service.proto': 'syntax = "proto3";\n' });

    const run = await runForge(['source', 'add', 'service.proto'], { workspace });

    expect(run.exitCode).toBe(1);
    expect(JSON.parse(run.stdout).error).toEqual({
      message:
        'A proto file cannot become a subgraph yet. Cosmo compiles a GraphQL schema to a proto contract, and nothing derives a graph schema and its field mapping from a proto service.',
      input: 'service.proto',
      fix: 'Add the OpenAPI 3 description of the same API instead.',
    });
    expect(await read(workspace, 'forge.yaml')).toBe(manifest);
  });

  test('a Postgres URL names what is missing and does not repeat the credentials', async () => {
    const workspace = await sourceWorkspace();

    const run = await runForge(['source', 'add', 'postgres://admin:hunter2@db.internal:5432/shop'], { workspace });

    expect(run.exitCode).toBe(1);
    expect(JSON.parse(run.stdout).error).toEqual({
      message:
        'A Postgres database cannot become a subgraph yet. Forge does not read a database schema, and the module it generates answers fields from a REST API, not from SQL.',
      input: 'postgres source',
      fix: 'Add the OpenAPI 3 description of a REST API in front of the database instead.',
    });
  });

  test('a Swagger 2.0 document', async () => {
    const workspace = await sourceWorkspace({ 'swagger.json': '{"swagger":"2.0","paths":{}}' });

    const run = await runForge(['source', 'add', 'swagger.json'], { workspace });

    expect(JSON.parse(run.stdout).error).toEqual({
      message: 'swagger.json is not an OpenAPI 3 description.',
      input: 'swagger.json',
      fix: 'Pass an OpenAPI 3.0 or 3.1 document. Convert a Swagger 2.0 document first.',
    });
  });

  test('a description with nothing to read lists why each operation was left out', async () => {
    const workspace = await sourceWorkspace({
      'openapi.yaml': `openapi: 3.0.3
info:
  title: Writes
paths:
  /items:
    post:
      responses:
        '201':
          description: Created.
  /report:
    get:
      responses:
        '200':
          description: A PDF.
`,
    });

    const run = await runForge(['source', 'add', 'openapi.yaml'], { workspace });

    expect(JSON.parse(run.stdout).error).toEqual({
      message:
        'openapi.yaml has no operation that can become a query field.\n  POST /items: only GET operations are generated\n  GET /report: it has no application/json response for status 200',
      input: 'openapi.yaml',
      fix: 'The description needs at least one GET operation with an application/json response for status 200.',
    });
    expect(await read(workspace, 'forge.yaml')).toBe(manifest);
  });

  test('a URL that does not answer', async () => {
    const workspace = await sourceWorkspace();

    const run = await runForge(['source', 'add', 'https://catalog.example.com/missing.yaml'], { workspace });

    expect(JSON.parse(run.stdout).error).toEqual({
      message: 'https://catalog.example.com/missing.yaml answered with status 404.',
      input: 'https://catalog.example.com/missing.yaml',
      fix: 'Check the URL and that it can be read without signing in, or download the description and pass the file.',
    });
  });
});
