import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fromJsonString, toJsonString } from '@bufbuild/protobuf';
import { createClient, createRouterTransport } from '@connectrpc/connect';
import { GRPCMappingSchema, RouterConfigSchema } from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { compileGraphQLToMapping, compileGraphQLToProto } from '@wundergraph/protographic';
import { Command } from 'commander';
import { dirname, join } from 'pathe';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import ComposeCommand from '../../src/commands/router/commands/compose.js';
import { Client } from '../../src/core/client/client.js';
import { normalizeString } from '../utils.js';

const mockPlatformTransport = () =>
  createRouterTransport(({ service }) => {
    service(PlatformService, {});
  });

const productsSdl = 'type Query {\n  products: [String!]!\n}\n';
const inventorySdl = 'type Query {\n  stock: Int!\n}\n';
const paymentsSdl = 'type Query {\n  payments: [String!]!\n}\n';

describe('router compose reads wundergraph.yaml', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wgc-compose-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  const write = async (file: string, content: string) => {
    await mkdir(dirname(join(dir, file)), { recursive: true });
    await writeFile(join(dir, file), content);
  };

  const writeGrpcFiles = async (directory: string, sdl: string, serviceName: string) => {
    await write(join(directory, 'service.proto'), compileGraphQLToProto(sdl, { serviceName }).proto);
    await write(
      join(directory, 'mapping.json'),
      toJsonString(GRPCMappingSchema, compileGraphQLToMapping(sdl, serviceName)),
    );
  };

  const compose = async (args: string[]) => {
    const client: Client = { platform: createClient(PlatformService, mockPlatformTransport()) };
    const outputFile = join(dir, 'out', 'router-config.json');
    const program = new Command();
    program.addCommand(ComposeCommand({ client }));
    await program.parseAsync(['compose', ...args, '-o', outputFile], { from: 'user' });
    return fromJsonString(RouterConfigSchema, await readFile(outputFile, 'utf8'));
  };

  const composeError = async (args: string[]) => {
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await expect(compose(args)).rejects.toThrow('process.exit');
    return stderr.mock.calls.flat().join('');
  };

  test('composes a schema, a grpc and a plugin subgraph', async () => {
    await write('services/products.graphql', productsSdl);
    await write('modules/inventory/schema.graphql', inventorySdl);
    await writeGrpcFiles('modules/inventory', inventorySdl, 'InventoryService');
    await write('plugins/payments/src/schema.graphql', paymentsSdl);
    await writeGrpcFiles('plugins/payments/generated', paymentsSdl, 'PaymentsService');
    await write(
      'wundergraph.yaml',
      `graph: shop
subgraphs:
  - name: products
    schema: { file: services/products.graphql }
    routing_url: http://localhost:4001/graphql
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
`,
    );

    const routerConfig = await compose(['-i', join(dir, 'wundergraph.yaml')]);

    expect(routerConfig.subgraphs.map(({ name, routingUrl }) => ({ name, routingUrl }))).toEqual([
      { name: 'products', routingUrl: 'http://localhost:4001/graphql' },
      { name: 'inventory', routingUrl: 'dns:///localhost:4011' },
      { name: 'payments', routingUrl: 'http://localhost:3000/plugin/2' },
    ]);
    const grpc = routerConfig.engineConfig!.datasourceConfigurations.map((source) => ({
      plugin: source.customGraphql?.grpc?.plugin
        ? { name: source.customGraphql.grpc.plugin.name, version: source.customGraphql.grpc.plugin.version }
        : undefined,
      proto: source.customGraphql?.grpc?.protoSchema,
    }));
    expect(grpc).toEqual([
      { plugin: undefined, proto: undefined },
      { plugin: undefined, proto: compileGraphQLToProto(inventorySdl, { serviceName: 'InventoryService' }).proto },
      {
        plugin: { name: 'payments', version: '0.0.1' },
        proto: compileGraphQLToProto(paymentsSdl, { serviceName: 'PaymentsService' }).proto,
      },
    ]);
  });

  test('takes the SDL from the stdout of schema.command run in the config directory, for subgraphs and feature graphs', async () => {
    await write('schemas/products.graphql', productsSdl);
    await write('schemas/products-next.graphql', 'type Query {\n  products: [String!]!\n  newest: String\n}\n');
    await write(
      'wundergraph.yaml',
      `graph: shop
subgraphs:
  - name: products
    schema: { command: cat schemas/products.graphql }
    routing_url: http://localhost:4001/graphql
feature_flags:
  - name: next
    feature_graphs:
      - name: products-next
        subgraph_name: products
        schema: { command: cat schemas/products-next.graphql }
        routing_url: http://localhost:4002/graphql
`,
    );

    const routerConfig = await compose(['-i', join(dir, 'wundergraph.yaml')]);

    expect(normalizeString(routerConfig.engineConfig!.graphqlSchema)).toBe(
      normalizeString('schema { query: Query } type Query { products: [String!]! }'),
    );
    const next = routerConfig.featureFlagConfigs!.configByFeatureFlagName.next;
    expect(normalizeString(next.engineConfig!.graphqlSchema)).toBe(
      normalizeString('schema { query: Query } type Query { products: [String!]! newest: String }'),
    );
    expect(next.subgraphs.map(({ name, routingUrl }) => ({ name, routingUrl }))).toEqual([
      { name: 'products-next', routingUrl: 'http://localhost:4002/graphql' },
    ]);
  });

  test('names the subgraph whose schema.command fails', async () => {
    await write(
      'wundergraph.yaml',
      `graph: shop
subgraphs:
  - name: products
    schema: { command: echo broken >&2; exit 3 }
    routing_url: http://localhost:4001/graphql
`,
    );

    const stderr = await composeError(['-i', join(dir, 'wundergraph.yaml')]);

    expect(stderr).toContain("The schema command of subgraph 'products' failed: echo broken >&2; exit 3\nbroken");
  });

  test('names the subgraph that has no routing_url', async () => {
    await write('schemas/products.graphql', productsSdl);
    await write(
      'wundergraph.yaml',
      `graph: shop
subgraphs:
  - name: products
    schema: { file: schemas/products.graphql }
`,
    );

    const stderr = await composeError(['-i', join(dir, 'wundergraph.yaml')]);

    expect(stderr).toContain("Subgraph 'products' has no routing_url. Set routing_url to where the router reaches it.");
  });

  test('composes an event-driven graph that has no routing_url', async () => {
    await write(
      'schemas/employees.graphql',
      'type Query {\n  employee(id: ID!): Employee\n}\n\ntype Employee @key(fields: "id") {\n  id: ID!\n}\n',
    );
    await write(
      'schemas/employee-events.graphql',
      'type Employee @key(fields: "id", resolvable: false) {\n  id: ID! @external\n}\n\ntype Subscription {\n  employeeUpdated(id: ID!): Employee! @edfs__natsSubscribe(subjects: ["employees.{{ args.id }}"])\n}\n',
    );
    await write(
      'wundergraph.yaml',
      `graph: shop
subgraphs:
  - name: employees
    schema: { file: schemas/employees.graphql }
    routing_url: http://localhost:4001/graphql
  - name: employee-events
    schema: { file: schemas/employee-events.graphql }
`,
    );

    const routerConfig = await compose(['-i', join(dir, 'wundergraph.yaml')]);

    expect(routerConfig.subgraphs.map(({ name, routingUrl }) => ({ name, routingUrl }))).toEqual([
      { name: 'employees', routingUrl: 'http://localhost:4001/graphql' },
      { name: 'employee-events', routingUrl: '' },
    ]);
  });

  test('reads the wundergraph.yaml of the nearest parent directory when --input is left out', async () => {
    await write('schemas/products.graphql', productsSdl);
    await write(
      'wundergraph.yaml',
      `graph: shop
subgraphs:
  - name: products
    schema: { file: schemas/products.graphql }
    routing_url: http://localhost:4001/graphql
`,
    );
    await mkdir(join(dir, 'services', 'products'), { recursive: true });
    vi.spyOn(process, 'cwd').mockReturnValue(join(dir, 'services', 'products'));

    const routerConfig = await compose([]);

    expect(routerConfig.subgraphs.map(({ name, routingUrl }) => ({ name, routingUrl }))).toEqual([
      { name: 'products', routingUrl: 'http://localhost:4001/graphql' },
    ]);
  });

  test('says where it looked when no wundergraph.yaml is found', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue(dir);

    const stderr = await composeError([]);

    expect(stderr).toContain(
      `No wundergraph.yaml in ${dir} or any parent directory. Create one or pass --input <path>.`,
    );
  });

  test('reports the invalid paths of wundergraph.yaml', async () => {
    await write(
      'wundergraph.yaml',
      'version: 1\nsubgraphs:\n  - name: products\n    routing_url: http://localhost:4001/graphql\n',
    );

    const stderr = await composeError(['-i', join(dir, 'wundergraph.yaml')]);

    expect(stderr).toContain(
      `${join(dir, 'wundergraph.yaml')} is invalid:\n` +
        '  graph: set `graph` to the federated graph in Cosmo, e.g. `graph: shop`\n' +
        '  subgraphs[0].schema: set `schema` to `{ file: <path to an SDL file> }` or `{ command: <command that prints the SDL> }`\n' +
        '  (top level): Unrecognized key: "version"',
    );
  });
});
