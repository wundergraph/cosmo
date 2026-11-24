import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { createWorkspace, lockForReleaseA, read, runForge, versionA } from './harness.js';

const template = fileURLToPath(new URL('../../gomodules/sources/grpc', import.meta.url));
const fromTemplate = (file: string): Promise<string> => readFile(path.join(template, file), 'utf8');

const config = `graph: shop
subgraphs: []
router:
  release: 0.299.0
  binary: bin/router
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
    'wundergraph.yaml': config,
    'wundergraph.lock': lockForReleaseA,
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

  test('registers the module and the grpc subgraph in wundergraph.yaml', async () => {
    const workspace = await protoWorkspace();

    await runForge(['source', 'add', 'protos/payroll.proto'], { workspace });

    expect(await read(workspace, 'wundergraph.yaml')).toBe(`graph: shop
subgraphs:
  - name: payroll
    kind: grpc
    schema:
      file: modules/payroll/schema.graphql
    proto: modules/payroll/generated/service.proto
    mapping: modules/payroll/generated/mapping.json
    routing_url: dns:///127.0.0.1:4011
router:
  release: 0.299.0
  modules:
    - path: ./modules/payroll
  binary: bin/router
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
        'Created ./modules/payroll from protos/payroll.proto and added the module and the subgraph to wundergraph.yaml.',
        '  4 field(s)',
        '    Query.salary  /payroll.v1.PayrollService/GetSalary',
        '    Query.listSalaries  /payroll.v1.PayrollService/ListSalaries',
        '    Mutation.updateSalary  /payroll.v1.PayrollService/UpdateSalary',
        '    Mutation.deleteSalary  /payroll.v1.PayrollService/DeleteSalary',
        '  2 skipped',
        ...skipped.map((entry) => `    ${entry.subject}: ${entry.reason}`),
        '  The router serves the subgraph to itself on 127.0.0.1:4011. No plugin executable is started.',
        'Next: `wgc forge build`.',
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

describe('wgc forge source add <proto> --rename', () => {
  test('renames a root field and a type in the graph and keeps calling the same RPC', async () => {
    const workspace = await protoWorkspace();

    const run = await runForge(
      [
        'source',
        'add',
        '--rename',
        'Query.salary=payrollSalary',
        '--rename',
        'Salary=PayrollSalary',
        'protos/payroll.proto',
      ],
      { workspace },
    );

    const result = JSON.parse(run.stdout).data;
    expect(result.subgraph.sdl).toBe(`type Query {
  payrollSalary(userId: ID): PayrollSalary
  listSalaries(frequencies: [PayFrequency!]! = [], pageSize: Int, pageToken: String): ListSalariesResponse
}

type Mutation {
  updateSalary(userId: ID, base: MoneyInput, payFrequency: PayFrequency): PayrollSalary
  deleteSalary(userId: ID): Boolean
}

type PayrollSalary {
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
  salaries: [PayrollSalary!]!
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
`);
    expect(result.operations).toEqual([
      { field: 'Query.payrollSalary', request: '/payroll.v1.PayrollService/GetSalary' },
      { field: 'Query.listSalaries', request: '/payroll.v1.PayrollService/ListSalaries' },
      { field: 'Mutation.updateSalary', request: '/payroll.v1.PayrollService/UpdateSalary' },
      { field: 'Mutation.deleteSalary', request: '/payroll.v1.PayrollService/DeleteSalary' },
    ]);
    expect(await read(workspace, 'modules/payroll/schema.graphql')).toBe(result.subgraph.sdl);
    expect(await read(workspace, 'modules/payroll/upstream.proto')).toBe(await fromTemplate('testdata/payroll.proto'));

    const operations = JSON.parse(await read(workspace, 'modules/payroll/operations.json'));
    expect(operations.operations[0]).toEqual({
      rpc: 'QueryPayrollSalary',
      method: '/payroll.v1.PayrollService/GetSalary',
      returns: 'field',
      field: 'salary',
    });
    expect(operations.messages.QueryPayrollSalaryRequest).toEqual({ user_id: 'user_id' });
    expect(operations.messages.PayrollSalary).toEqual({
      id: 'id',
      user_id: 'user_id',
      base: 'base',
      pay_frequency: 'pay_frequency',
      effective_from: 'effective_from',
      note: 'note',
      tags: 'tags',
    });
    expect(operations.messages.Salary).toBeUndefined();
    expect(await read(workspace, 'modules/payroll/generated/service.proto')).toContain(
      'rpc QueryPayrollSalary(QueryPayrollSalaryRequest) returns (QueryPayrollSalaryResponse) {}',
    );
  });

  test('renames an enum and an input type everywhere they are used', async () => {
    const workspace = await protoWorkspace();

    const run = await runForge(
      [
        'source',
        'add',
        '--rename',
        'PayFrequency=Cadence',
        '--rename',
        'MoneyInput=AmountInput',
        'protos/payroll.proto',
      ],
      { workspace },
    );

    const result = JSON.parse(run.stdout).data;
    expect(result.subgraph.sdl).toContain('updateSalary(userId: ID, base: AmountInput, payFrequency: Cadence): Salary');
    expect(result.subgraph.sdl).toContain('listSalaries(frequencies: [Cadence!]! = [], pageSize: Int');
    expect(result.subgraph.sdl).toContain('input AmountInput {');
    expect(result.subgraph.sdl).toContain('enum Cadence {');
    const operations = JSON.parse(await read(workspace, 'modules/payroll/operations.json'));
    expect(operations.enums).toEqual({
      Cadence: { CADENCE_MONTHLY: 'PAY_FREQUENCY_MONTHLY', CADENCE_BIWEEKLY: 'PAY_FREQUENCY_BIWEEKLY' },
    });
    expect(operations.messages.AmountInput).toEqual({ currency: 'currency', amount_cents: 'amount_cents' });
  });

  test('two types can swap names', async () => {
    const workspace = await protoWorkspace();

    const run = await runForge(
      ['source', 'add', '--rename', 'Salary=Money', '--rename', 'Money=Salary', 'protos/payroll.proto'],
      { workspace },
    );

    const { sdl: swapped } = JSON.parse(run.stdout).data.subgraph;
    expect(swapped).toContain('  salary(userId: ID): Money\n');
    expect(swapped).toContain('type Money {\n  id: ID!\n');
    expect(swapped).toContain('  base: Salary\n');
  });

  test.each([
    {
      renames: ['Salary.id=identifier'],
      error: {
        message: 'Salary.id names no type or root field that the generated graph can rename.',
        input: '--rename Salary.id=identifier',
        remediation: 'Pass a type or a root field of the generated SDL, such as Salary or Query.salary.',
      },
    },
    {
      renames: ['Query=Root'],
      error: {
        message: 'Query names no type or root field that the generated graph can rename.',
        input: '--rename Query=Root',
        remediation: 'Pass a type or a root field of the generated SDL, such as Salary or Query.salary.',
      },
    },
    {
      renames: ['Salary=Money'],
      error: {
        message: 'The generated graph already has a type named Money.',
        input: '--rename Salary=Money',
        remediation: 'Pass another name for Salary.',
      },
    },
    {
      renames: ['Salary=String'],
      error: {
        message: 'The generated graph already has a type named String.',
        input: '--rename Salary=String',
        remediation: 'Pass another name for Salary.',
      },
    },
    {
      renames: ['Query.salary=listSalaries'],
      error: {
        message: 'Query already has a field named listSalaries.',
        input: '--rename Query.salary=listSalaries',
        remediation: 'Pass another name for Query.salary.',
      },
    },
    {
      renames: ['Salary'],
      error: {
        message: '--rename Salary is not <coordinate>=<name>.',
        input: '--rename Salary',
        remediation:
          'Pass a type or a root field and its new name, for example --rename Salary=PayrollSalary or --rename Query.salary=payrollSalary.',
      },
    },
    {
      renames: ['Salary=Payroll-Salary'],
      error: {
        message: 'Payroll-Salary is not a valid GraphQL name.',
        input: '--rename Salary=Payroll-Salary',
        remediation:
          'Pass a name of letters, digits and underscores that starts with a letter or an underscore, but not with two underscores.',
      },
    },
    {
      renames: ['Salary=PayrollSalary', 'Salary=Pay'],
      error: {
        message: 'Salary is renamed twice.',
        input: '--rename Salary=Pay',
        remediation: 'Pass one --rename for Salary.',
      },
    },
  ])('rejects --rename $renames', async ({ renames, error }) => {
    const workspace = await protoWorkspace();

    const run = await runForge(
      ['source', 'add', ...renames.flatMap((rename) => ['--rename', rename]), 'protos/payroll.proto'],
      { workspace },
    );

    expect(run.exitCode).toBe(1);
    expect(JSON.parse(run.stdout).error).toEqual({ code: 'COMMAND_FAILED', ...error });
    expect(await read(workspace, 'wundergraph.yaml')).toBe(config);
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
    expect(await read(workspace, 'wundergraph.yaml')).toBe(config);
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
