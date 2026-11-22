import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { createWorkspace, lockForReleaseA, read, runForge, versionA } from './harness.js';

const template = fileURLToPath(new URL('../../gomodules/sources/grpc', import.meta.url));
const fromTemplate = (file: string): Promise<string> => readFile(path.join(template, file), 'utf8');

const manifest = `version: 1
router:
  release: 0.299.0
binary: bin/router
modules: []
`;

const sdl = `type Query {
  salary(userId: ID): Salary
  listSalaries(frequencies: [PayFrequency!]! = [], pageSize: Int, pageToken: String): ListSalariesResponse
}

type Mutation {
  updateSalary(userId: ID, base: MoneyInput, payFrequency: PayFrequency): Salary
  deleteSalary(userId: ID): Boolean
}

type Salary {
  id: ID!
  userId: ID!
  base: Money
  payFrequency: PayFrequency
  effectiveFrom: String
  note: String
  tags: [String!]!
}

type Money {
  currency: String!
  amountCents: String!
}

type ListSalariesResponse {
  salaries: [Salary!]!
  nextPageToken: String!
}

input MoneyInput {
  currency: String
  amountCents: String
}

enum PayFrequency {
  MONTHLY
  BIWEEKLY
}
`;

const skipped = [
  { subject: 'Salary.labels', reason: 'maps are not generated' },
  { subject: 'payroll.v1.PayrollService/WatchSalaries', reason: 'streaming RPCs are not generated' },
];

const protoWorkspace = async (files: Record<string, string> = {}) =>
  createWorkspace({
    'forge.yaml': manifest,
    'forge.lock': lockForReleaseA,
    'protos/payroll.proto': await fromTemplate('testdata/payroll.proto'),
    ...files,
  });

/** A proto file with one service whose RPCs are each `rpc <line>`, and the given messages. */
const service = (rpcs: string[], messages: string) => `syntax = "proto3";
package shop.v1;

service ShopService {
${rpcs.map((rpc) => `  rpc ${rpc}`).join('\n')}
}

${messages}
`;

describe('wgc forge source add <proto>', () => {
  test('reports the derived subgraph SDL, its fields and what was left out', async () => {
    const workspace = await protoWorkspace();

    const run = await runForge(['source', 'add', 'protos/payroll.proto'], { workspace });

    expect(run.exitCode).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({
      ok: true,
      data: {
        source: { kind: 'proto', location: 'protos/payroll.proto' },
        module: { id: 'payroll', path: './modules/payroll', package: 'forge.local/payroll' },
        subgraph: {
          name: 'payroll',
          routingUrl: 'dns:///127.0.0.1:4011',
          schema: './modules/payroll/schema.graphql',
          proto: './modules/payroll/generated/service.proto',
          mapping: './modules/payroll/generated/mapping.json',
          sdl,
        },
        graph: 'graph.yaml',
        operations: [
          { field: 'Query.salary', request: '/payroll.v1.PayrollService/GetSalary' },
          { field: 'Query.listSalaries', request: '/payroll.v1.PayrollService/ListSalaries' },
          { field: 'Mutation.updateSalary', request: '/payroll.v1.PayrollService/UpdateSalary' },
          { field: 'Mutation.deleteSalary', request: '/payroll.v1.PayrollService/DeleteSalary' },
        ],
        skipped,
        execution: { process: 'router', transport: 'grpc over loopback tcp', listenAddr: '127.0.0.1:4011' },
      },
    });
  });

  test('writes a module with the Cosmo Connect contract, the service proto and the method behind every RPC', async () => {
    const workspace = await protoWorkspace();

    await runForge(['source', 'add', 'protos/payroll.proto'], { workspace });

    // The Go tests in gomodules/sources/grpc run against these same files.
    for (const file of [
      'schema.graphql',
      'generated/service.proto',
      'generated/mapping.json',
      'operations.json',
      'upstream.proto',
    ]) {
      expect(await read(workspace, `modules/payroll/${file}`)).toBe(await fromTemplate(file));
    }
    for (const file of ['service.go', 'upstream.go', 'operations_test.go']) {
      expect(await read(workspace, `modules/payroll/${file}`)).toBe(await fromTemplate(file));
    }
    expect(await read(workspace, 'modules/payroll/module.go')).toContain('const moduleID = "payroll"');
    expect(await read(workspace, 'modules/payroll/go.mod')).toBe(
      `module forge.local/payroll\n\ngo 1.26.0\n\nrequire github.com/wundergraph/cosmo/router ${versionA}\n`,
    );
  });

  test('--target names the gRPC service the module calls', async () => {
    const workspace = await protoWorkspace();

    await runForge(['source', 'add', '--target', 'dns:///payroll.internal:50051', 'protos/payroll.proto'], {
      workspace,
    });

    expect(JSON.parse(await read(workspace, 'modules/payroll/operations.json')).target).toBe(
      'dns:///payroll.internal:50051',
    );
  });

  test('registers the module in forge.yaml and the subgraph in the graph file', async () => {
    const workspace = await protoWorkspace();

    await runForge(['source', 'add', 'protos/payroll.proto'], { workspace });

    expect(await read(workspace, 'forge.yaml')).toBe(
      manifest.replace('modules: []\n', 'modules:\n  - path: ./modules/payroll\n'),
    );
    expect(await read(workspace, 'graph.yaml')).toBe(`version: 1
subgraphs:
  - name: payroll
    routing_url: dns:///127.0.0.1:4011
    grpc:
      schema_file: modules/payroll/schema.graphql
      proto_file: modules/payroll/generated/service.proto
      mapping_file: modules/payroll/generated/mapping.json
`);
  });

  test('the derived subgraph composes and passes the design check', async () => {
    const workspace = await protoWorkspace();
    await runForge(['source', 'add', 'protos/payroll.proto'], { workspace });

    const run = await runForge(['check'], { workspace });

    expect(JSON.parse(run.stdout)).toMatchObject({
      ok: true,
      data: { complete: true, compositionErrors: [], summary: { errors: 0, subgraphs: 1 } },
    });
  });

  test('a person reads the same result as text', async () => {
    const workspace = await protoWorkspace();

    const run = await runForge(['source', 'add', 'protos/payroll.proto'], { workspace, caller: 'human' });

    expect(run.stdout).toBe(
      [
        'Created ./modules/payroll from protos/payroll.proto and added it to forge.yaml and graph.yaml.',
        '  4 field(s)',
        '    Query.salary  /payroll.v1.PayrollService/GetSalary',
        '    Query.listSalaries  /payroll.v1.PayrollService/ListSalaries',
        '    Mutation.updateSalary  /payroll.v1.PayrollService/UpdateSalary',
        '    Mutation.deleteSalary  /payroll.v1.PayrollService/DeleteSalary',
        '  2 skipped',
        ...skipped.map((entry) => `    ${entry.subject}: ${entry.reason}`),
        '  The router serves the subgraph to itself on 127.0.0.1:4011. No plugin executable is started.',
        'Next: `wgc forge build`, then `wgc router compose -i graph.yaml -o config.json`.',
        '',
      ].join('\n'),
    );
  });

  test('derives root types, field names, nullability and names from the proto', async () => {
    const workspace = await protoWorkspace({
      'shop.proto': `syntax = "proto3";
package shop.v1;

import "google/protobuf/timestamp.proto";
import "google/protobuf/wrappers.proto";

service ShopService {
  rpc GetOrder(OrderRef) returns (Order);
  rpc Order(OrderRef) returns (Order);
  rpc Basket(BasketRequest) returns (BasketResponse) {
    option idempotency_level = NO_SIDE_EFFECTS;
  }
  rpc Listen(OrderRef) returns (OrderRef);
}

enum Color {
  RED = 0;
  GREEN = 1;
}

message OrderRef {
  string order_id = 1;
  optional uint32 version = 2;
}

message Order {
  message Line {
    string sku = 1;
    uint64 quantity = 2;
    bytes image = 3;
  }

  string id = 1;
  repeated Line lines = 2;
  Color color = 3;
  oneof payment {
    string card = 4;
    string invoice = 5;
  }
  google.protobuf.Timestamp placed_at = 6;
  google.protobuf.Int64Value points = 7;
  optional bool gift = 8;
}

message BasketRequest {}

message BasketResponse {
  repeated Order.Line lines = 1;
  sint32 total = 2;
}
`,
    });

    const run = await runForge(['source', 'add', 'shop.proto'], { workspace });

    const result = JSON.parse(run.stdout).data;
    expect(result.module.id).toBe('shop');
    expect(result.subgraph.sdl).toBe(`type Query {
  order(orderId: ID, version: Float): Order
  basket: BasketResponse
}

type Mutation {
  order(orderId: ID, version: Float): Order
  listen(orderId: ID, version: Float): OrderRef
}

type Order {
  id: ID!
  lines: [OrderLine!]!
  color: Color
  card: String
  invoice: String
  placedAt: String
  points: String
  gift: Boolean
}

type OrderLine {
  sku: String!
  quantity: String!
  image: String!
}

type BasketResponse {
  lines: [OrderLine!]!
  total: Int!
}

type OrderRef {
  orderId: ID!
  version: Float
}

enum Color {
  RED
  GREEN
}
`);
    expect(result.skipped).toEqual([]);
    expect(JSON.parse(await read(workspace, 'modules/shop/operations.json')).enums).toEqual({
      Color: { COLOR_RED: 'RED', COLOR_GREEN: 'GREEN' },
    });
  });
});

describe('wgc forge source add rejects a proto file it cannot generate', () => {
  test('an import other than a well-known type', async () => {
    const workspace = await protoWorkspace({
      'orders.proto': `syntax = "proto3";\npackage orders.v1;\nimport "common/money.proto";\nservice Orders {}\n`,
    });

    const run = await runForge(['source', 'add', 'orders.proto'], { workspace });

    expect(run.exitCode).toBe(1);
    expect(JSON.parse(run.stdout).error).toEqual({
      code: 'COMMAND_FAILED',
      message: 'orders.proto imports common/money.proto. Only the google/protobuf well-known types can be imported.',
      input: 'orders.proto',
      remediation:
        'Copy the definitions orders.proto uses from common/money.proto into it, or pass one file that holds the whole service.',
    });
    expect(await read(workspace, 'forge.yaml')).toBe(manifest);
  });

  test('a file without a service', async () => {
    const workspace = await protoWorkspace({
      'types.proto': 'syntax = "proto3";\nmessage Money { string currency = 1; }\n',
    });

    const run = await runForge(['source', 'add', 'types.proto'], { workspace });

    expect(JSON.parse(run.stdout).error).toEqual({
      code: 'COMMAND_FAILED',
      message: 'types.proto defines no service.',
      input: 'types.proto',
      remediation: 'Pass the proto file that defines the gRPC service.',
    });
  });

  test('a service with nothing that reads lists why each RPC was left out', async () => {
    const workspace = await protoWorkspace({
      'writes.proto': service(
        ['Tail(Empty) returns (stream Entry);', 'Clear(Empty) returns (Empty);'],
        'message Empty {}\nmessage Entry { string text = 1; }',
      ),
    });

    const run = await runForge(['source', 'add', 'writes.proto'], { workspace });

    expect(JSON.parse(run.stdout).error).toEqual({
      code: 'COMMAND_FAILED',
      message:
        'writes.proto has no RPC that can become a query field.\n  shop.v1.ShopService/Tail: streaming RPCs are not generated',
      input: 'writes.proto',
      remediation:
        'A subgraph needs at least one unary RPC that reads: one whose name starts with Get, List, Search, Find, Lookup, Query, Count, Fetch, Read, Describe, or that sets idempotency_level = NO_SIDE_EFFECTS.',
    });
  });

  test('a file that does not parse', async () => {
    const workspace = await protoWorkspace({ 'broken.proto': 'syntax = "proto3";\nservice {\n' });

    const run = await runForge(['source', 'add', 'broken.proto'], { workspace });

    expect(JSON.parse(run.stdout).error).toMatchObject({
      code: 'COMMAND_FAILED',
      input: 'broken.proto',
      remediation: 'Pass a proto2 or proto3 file with at least one service.',
    });
    expect(JSON.parse(run.stdout).error.message).toMatch(/^broken\.proto is not a proto file: /);
  });
});
