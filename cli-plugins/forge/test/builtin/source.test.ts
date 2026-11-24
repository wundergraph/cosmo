import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromJsonString } from '@bufbuild/protobuf';
import { GRPCMappingSchema } from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { describe, expect, test } from 'vitest';
import { createFakeSystem, createWorkspace, lockForReleaseA, read, runForge, versionA } from './harness.js';

const template = fileURLToPath(new URL('../../gomodules/sources/rest', import.meta.url));
const fromTemplate = (file: string): Promise<string> => readFile(path.join(template, file), 'utf8');

const config = `graph: shop
subgraphs: []
router:
  release: 0.299.0
  binary: bin/router
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
  createWorkspace({ 'wundergraph.yaml': config, 'wundergraph.lock': lockForReleaseA, ...files });

const catalogSystem = async () =>
  createFakeSystem({ documents: { [url]: await fromTemplate('testdata/openapi.yaml') } });

describe('wgc forge source add <openapi>', () => {
  test('reports the generated subgraph SDL, the module path and what was left out', async () => {
    const workspace = await sourceWorkspace();

    const run = await runForge(['source', 'add', url], { workspace, system: await catalogSystem() });

    expect(run.exitCode).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({
      ok: true,
      data: {
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
        operations: [
          { field: 'catalogItem', request: 'GET /v1/items/{id}' },
          { field: 'items', request: 'GET /v1/items' },
        ],
        skipped,
        execution: { process: 'router', transport: 'grpc over loopback tcp', listenAddr: '127.0.0.1:4011' },
      },
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

  test('writes the mapping in the format `wgc router compose` reads', async () => {
    const workspace = await sourceWorkspace();

    await runForge(['source', 'add', url], { workspace, system: await catalogSystem() });

    const mapping = fromJsonString(GRPCMappingSchema, await read(workspace, 'modules/catalog/generated/mapping.json'));
    expect(mapping.service).toBe('CatalogService');
    expect(mapping.operationMappings.map((operation) => `${operation.original} ${operation.mapped}`)).toEqual([
      'catalogItem QueryCatalogItem',
      'items QueryItems',
    ]);
  });

  test('registers the module and the grpc subgraph in wundergraph.yaml', async () => {
    const workspace = await sourceWorkspace();

    await runForge(['source', 'add', url], { workspace, system: await catalogSystem() });

    expect(await read(workspace, 'wundergraph.yaml')).toBe(`graph: shop
subgraphs:
  - name: catalog
    kind: grpc
    schema:
      file: modules/catalog/schema.graphql
    proto: modules/catalog/generated/service.proto
    mapping: modules/catalog/generated/mapping.json
    routing_url: dns:///127.0.0.1:4011
router:
  release: 0.299.0
  modules:
    - path: ./modules/catalog
  binary: bin/router
`);
  });

  test('one run adds the module and the subgraph next to the existing subgraphs and check policy', async () => {
    const existing = `graph: shop
subgraphs:
  - name: orders
    schema:
      file: services/orders/schema.graphql
    routing_url: http://localhost:4001/graphql
router:
  release: 0.299.0
check:
  rules:
    pagination.forward-connection: error
  exceptions:
    - rule: pagination.forward-connection
      coordinate: Query.auditEvents
      reason: Predates the pagination convention.
`;
    const workspace = await sourceWorkspace({ 'wundergraph.yaml': existing });

    const run = await runForge(['source', 'add', url], { workspace, system: await catalogSystem() });

    expect(run.exitCode).toBe(0);
    expect(await read(workspace, 'wundergraph.yaml')).toBe(`graph: shop
subgraphs:
  - name: orders
    schema:
      file: services/orders/schema.graphql
    routing_url: http://localhost:4001/graphql
  - name: catalog
    kind: grpc
    schema:
      file: modules/catalog/schema.graphql
    proto: modules/catalog/generated/service.proto
    mapping: modules/catalog/generated/mapping.json
    routing_url: dns:///127.0.0.1:4011
router:
  release: 0.299.0
  modules:
    - path: ./modules/catalog
check:
  rules:
    pagination.forward-connection: error
  exceptions:
    - rule: pagination.forward-connection
      coordinate: Query.auditEvents
      reason: Predates the pagination convention.
`);
    expect((await readdir(workspace)).sort()).toEqual(['modules', 'wundergraph.lock', 'wundergraph.yaml']);
  });

  test('the next build compiles the module into the router binary', async () => {
    const workspace = await sourceWorkspace();
    const system = await catalogSystem();
    await runForge(['source', 'add', url], { workspace, system });

    const run = await runForge(['build'], { workspace, system });

    expect(JSON.parse(run.stdout)).toMatchObject({
      ok: true,
      data: {
        binary: `${workspace}/bin/router`,
        localModules: 1,
      },
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
      ok: true,
      data: {
        complete: true,
        compositionErrors: [],
        findings: [],
        exceptions: [],
        summary: { errors: 0, warnings: 0, exceptions: 0, subgraphs: 1 },
      },
    });
  });

  test('a person reads the same result as text', async () => {
    const workspace = await sourceWorkspace({ 'api/openapi.yaml': await fromTemplate('testdata/openapi.yaml') });

    const run = await runForge(['source', 'add', 'api/openapi.yaml'], { workspace, caller: 'human' });

    expect(run.stdout).toBe(
      [
        'Created ./modules/catalog from api/openapi.yaml and added the module and the subgraph to wundergraph.yaml.',
        '  2 field(s)',
        '    catalogItem  GET /v1/items/{id}',
        '    items  GET /v1/items',
        '  4 skipped',
        ...skipped.map((entry) => `    ${entry.subject}: ${entry.reason}`),
        '  The router serves the subgraph to itself on 127.0.0.1:4011. No plugin executable is started.',
        'Next: `wgc forge build`.',
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
      code: 'COMMAND_FAILED',
      message: 'wundergraph.yaml already has a subgraph named catalog.',
      input: '--name catalog',
      remediation: 'Pass another --name.',
    });
    expect(JSON.parse(sameAddress.stdout).error).toEqual({
      code: 'COMMAND_FAILED',
      message: 'Another subgraph in wundergraph.yaml is already served on 127.0.0.1:4011.',
      input: '--listen 127.0.0.1:4011',
      remediation: 'Pass --listen with a free address, for example --listen 127.0.0.1:4012.',
    });
    expect(JSON.parse(distinct.stdout).data.subgraph.routingUrl).toBe('dns:///127.0.0.1:4012');
    expect(await read(workspace, 'modules/catalog-two/generated/service.proto')).toContain('package catalog_two.v1;');
  });

  test('translates inline objects, allOf, nullable types and operations without an operationId', async () => {
    const workspace = await sourceWorkspace({
      'openapi.json': JSON.stringify({
        openapi: '3.1.0',
        info: { title: 'Orders API' },
        servers: [{ url: 'https://orders.example.com' }],
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

    const result = JSON.parse(run.stdout).data;
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

describe('wgc forge source add <openapi> --rename', () => {
  test('renames a root field and a type in the graph and keeps calling the same REST operation', async () => {
    const workspace = await sourceWorkspace();

    const run = await runForge(
      ['source', 'add', '--rename', 'Query.catalogItem=item', '--rename', 'CatalogItem=Product', url],
      {
        workspace,
        system: await catalogSystem(),
      },
    );

    const result = JSON.parse(run.stdout).data;
    expect(result.subgraph.sdl).toBe(`type Query {
  item(id: ID!): Product
  items(limit: Int, tag: String): [Product!]!
}

type Product {
  itemId: String!
  displayName: String
  price: Float
  tags: [String!]!
  warehouse: Warehouse
}

type Warehouse {
  code: String!
}
`);
    expect(result.operations).toEqual([
      { field: 'item', request: 'GET /v1/items/{id}' },
      { field: 'items', request: 'GET /v1/items' },
    ]);
    expect(JSON.parse(await read(workspace, 'modules/catalog/operations.json'))).toEqual({
      baseUrl: 'https://catalog.example.com',
      listenAddr: '127.0.0.1:4011',
      operations: [
        {
          rpc: 'QueryItem',
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
        Product: {
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

  test('a REST API has no Mutation field to rename', async () => {
    const workspace = await sourceWorkspace();

    const run = await runForge(['source', 'add', '--rename', 'Mutation.items=allItems', url], {
      workspace,
      system: await catalogSystem(),
    });

    expect(JSON.parse(run.stdout).error).toEqual({
      code: 'COMMAND_FAILED',
      message: 'Mutation.items names no type or root field that the generated graph can rename.',
      input: '--rename Mutation.items=allItems',
      remediation: 'Pass a type or a root field of the generated SDL, such as CatalogItem or Query.catalogItem.',
    });
  });
});

const petsWith = (servers: object): string =>
  JSON.stringify({
    openapi: '3.0.4',
    info: { title: 'Pets' },
    ...servers,
    paths: {
      '/pet': {
        get: {
          operationId: 'pet',
          responses: {
            200: {
              description: 'A pet.',
              content: {
                'application/json': { schema: { type: 'object', properties: { name: { type: 'string' } } } },
              },
            },
          },
        },
      },
    },
  });

describe('wgc forge source add resolves the server of an OpenAPI description', () => {
  const servedFrom = 'https://petstore3.swagger.io/api/v3/openapi.json';
  const baseUrlAfter = async (args: string[], description: string): Promise<string> => {
    const workspace = await sourceWorkspace({ 'openapi.json': description });
    await runForge(['source', 'add', ...args], {
      workspace,
      system: createFakeSystem({ documents: { [servedFrom]: description } }),
    });
    return JSON.parse(await read(workspace, 'modules/pets/operations.json')).baseUrl;
  };

  test('a relative server is resolved against the URL the description is served from', async () => {
    const relative = petsWith({ servers: [{ url: '/api/v3' }] });

    expect([
      await baseUrlAfter([servedFrom], relative),
      await baseUrlAfter(['openapi.json', '--served-from', servedFrom], relative),
      await baseUrlAfter([servedFrom], petsWith({ servers: [{ url: 'v2' }] })),
    ]).toEqual([
      'https://petstore3.swagger.io/api/v3',
      'https://petstore3.swagger.io/api/v3',
      'https://petstore3.swagger.io/api/v3/v2',
    ]);
  });

  test('an absolute server is kept as the description names it', async () => {
    const absolute = petsWith({ servers: [{ url: 'https://api.example.com/v1' }] });

    expect([
      await baseUrlAfter(['openapi.json'], absolute),
      await baseUrlAfter(['openapi.json', '--served-from', servedFrom], absolute),
    ]).toEqual(['https://api.example.com/v1', 'https://api.example.com/v1']);
  });

  test('a description without servers is served from the root of its URL', async () => {
    expect([
      await baseUrlAfter([servedFrom], petsWith({})),
      await baseUrlAfter(['openapi.json', '--served-from', servedFrom], petsWith({ servers: [] })),
    ]).toEqual(['https://petstore3.swagger.io', 'https://petstore3.swagger.io']);
  });

  test('a file whose server cannot be resolved is refused with what to pass', async () => {
    const remediation =
      'Give the description a full server URL under `servers`, such as https://api.example.com/v1, or pass --served-from with the http(s) URL the description is served from.';
    const relative = await sourceWorkspace({ 'openapi.json': petsWith({ servers: [{ url: '/api/v3' }] }) });
    const missing = await sourceWorkspace({ 'openapi.json': petsWith({}) });

    const refusedRelative = await runForge(['source', 'add', 'openapi.json'], { workspace: relative });
    const refusedMissing = await runForge(['source', 'add', 'openapi.json'], { workspace: missing });

    expect([refusedRelative.exitCode, JSON.parse(refusedRelative.stdout).error]).toEqual([
      1,
      {
        code: 'COMMAND_FAILED',
        message:
          'openapi.json names the server /api/v3, which is relative to the URL the description is served from, and Forge was not told that URL.',
        input: 'openapi.json',
        remediation,
      },
    ]);
    expect(JSON.parse(refusedMissing.stdout).error).toEqual({
      code: 'COMMAND_FAILED',
      message:
        'openapi.json names no server, so its API is at the root of the URL the description is served from, and Forge was not told that URL.',
      input: 'openapi.json',
      remediation,
    });
    expect(await read(relative, 'wundergraph.yaml')).toBe(config);
  });
});

describe('wgc forge source add rejects what it cannot generate', () => {
  test('a Postgres URL names what is missing and does not repeat the credentials', async () => {
    const workspace = await sourceWorkspace();

    const run = await runForge(['source', 'add', 'postgres://admin:hunter2@db.internal:5432/shop'], { workspace });

    expect(run.exitCode).toBe(1);
    expect(JSON.parse(run.stdout).error).toEqual({
      code: 'COMMAND_FAILED',
      message:
        'A Postgres database cannot become a subgraph yet. Forge does not read a database schema, and the module it generates answers fields from a REST API or a gRPC service, not from SQL.',
      input: 'postgres source',
      remediation:
        'Add the OpenAPI 3 description of a REST API, or the proto file of a gRPC service, in front of the database instead.',
    });
  });

  test('a Swagger 2.0 document', async () => {
    const workspace = await sourceWorkspace({ 'swagger.json': '{"swagger":"2.0","paths":{}}' });

    const run = await runForge(['source', 'add', 'swagger.json'], { workspace });

    expect(JSON.parse(run.stdout).error).toEqual({
      code: 'COMMAND_FAILED',
      message: 'swagger.json is not an OpenAPI 3 description.',
      input: 'swagger.json',
      remediation: 'Pass an OpenAPI 3.0 or 3.1 document. Convert a Swagger 2.0 document first.',
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
      code: 'COMMAND_FAILED',
      message:
        'openapi.yaml has no operation that can become a query field.\n  POST /items: only GET operations are generated\n  GET /report: it has no application/json response for status 200',
      input: 'openapi.yaml',
      remediation: 'The description needs at least one GET operation with an application/json response for status 200.',
    });
    expect(await read(workspace, 'wundergraph.yaml')).toBe(config);
  });

  test('a URL that does not answer', async () => {
    const workspace = await sourceWorkspace();

    const run = await runForge(['source', 'add', 'https://catalog.example.com/missing.yaml'], { workspace });

    expect(JSON.parse(run.stdout).error).toEqual({
      code: 'COMMAND_FAILED',
      message: 'https://catalog.example.com/missing.yaml answered with status 404.',
      input: 'https://catalog.example.com/missing.yaml',
      remediation:
        'Check the URL and that it can be read without signing in, or download the description and pass the file.',
    });
  });
});
