import { describe, expect, test } from 'vitest';
import { createWorkspace, lockForReleaseA, runForge } from './harness.js';

const manifest = (check: string) => `version: 1
router:
  release: 0.299.0
modules: []
${check}`;

const blockingPagination = `check:
  rules:
    pagination.forward-connection: error
`;

const graph = `version: 1
subgraphs:
  - name: orders
    routing_url: http://localhost:4001/graphql
    schema:
      file: services/orders/schema.graphql
  - name: returns
    routing_url: http://localhost:4002/graphql
    schema:
      file: services/returns/schema.graphql
`;

const orders = `type Query {
  orders(first: Int!, after: String): OrderConnection!
}

type OrderConnection {
  edges: [OrderEdge!]!
  pageInfo: PageInfo!
}

type OrderEdge {
  cursor: String!
  node: Order!
}

type PageInfo {
  endCursor: String
  hasNextPage: Boolean!
}

type Order {
  id: ID!
}
`;

const offsetReturns = `type Query {
  returns(limit: Int!, offset: Int!): [Return!]!
  supportedCurrencies: [String!]!
}

type Return {
  id: ID!
  refund_reason: String
}
`;

const connectionReturns = `type Query {
  returns(first: Int!, after: String): ReturnConnection!
  supportedCurrencies: [String!]!
}

type ReturnConnection {
  edges: [ReturnEdge!]!
  pageInfo: ReturnPageInfo!
}

type ReturnEdge {
  cursor: String!
  node: Return!
}

type ReturnPageInfo {
  endCursor: String
  hasNextPage: Boolean!
}

type Return {
  id: ID!
  refundReason: String
}
`;

const checkWorkspace = (returns: string, check = blockingPagination) =>
  createWorkspace({
    'forge.yaml': manifest(check),
    'forge.lock': lockForReleaseA,
    'graph.yaml': graph,
    'services/orders/schema.graphql': orders,
    'services/returns/schema.graphql': returns,
  });

const camelCaseFinding = {
  rule: 'FIELD_NAMES_SHOULD_BE_CAMEL_CASE',
  severity: 'warn',
  coordinate: 'Return.refund_reason',
  message: 'Field "refund_reason" should be in camelCase.',
  location: { file: 'services/returns/schema.graphql', line: 8, column: 3 },
};

const paginationFinding = {
  rule: 'pagination.forward-connection',
  severity: 'error',
  coordinate: 'Query.returns',
  message: 'Expose edges and PageInfo. Keep upstream paging inside the adapter.',
  location: { file: 'services/returns/schema.graphql', line: 2, column: 3 },
  found: '(limit: Int!, offset: Int!): [Return!]!',
  expected: '(first: Int!, after: String): ReturnConnection!',
  reference: { coordinate: 'Query.orders', file: 'services/orders/schema.graphql' },
};

describe('wgc forge check', () => {
  test('an offset-paginated collection is a blocking finding that points at a conforming field in another subgraph', async () => {
    const workspace = await checkWorkspace(offsetReturns);

    const run = await runForge(['check'], { workspace });

    expect(run.exitCode).toBe(3);
    expect(JSON.parse(run.stdout)).toEqual({
      ok: false,
      error: {
        code: 'CHECK_FAILED',
        message: 'The check found 1 blocking finding(s).',
        input: `${workspace}/graph.yaml`,
        remediation: 'Repair each finding, or record an approved exception under `check.exceptions` in forge.yaml.',
      },
      data: {
        complete: true,
        compositionErrors: [],
        findings: [camelCaseFinding, paginationFinding],
        exceptions: [],
        summary: { errors: 1, warnings: 1, exceptions: 0, subgraphs: 2 },
      },
    });
  });

  test('a person reads the same findings as text, and the exit code is the same', async () => {
    const workspace = await checkWorkspace(offsetReturns);

    const run = await runForge(['check'], { workspace, caller: 'human' });

    expect(run.exitCode).toBe(3);
    expect(run.stderr).toBe('');
    expect(run.stdout).toBe(
      [
        'WARN  FIELD_NAMES_SHOULD_BE_CAMEL_CASE  Return.refund_reason',
        '      services/returns/schema.graphql:8:3',
        '      Field "refund_reason" should be in camelCase.',
        'FAIL  pagination.forward-connection  Query.returns',
        '      services/returns/schema.graphql:2:3',
        '      Found     (limit: Int!, offset: Int!): [Return!]!',
        '      Expected  (first: Int!, after: String): ReturnConnection!',
        '      Example   Query.orders in services/orders/schema.graphql',
        '      Expose edges and PageInfo. Keep upstream paging inside the adapter.',
        '1 error(s), 1 warning(s), 0 exception(s) in 2 subgraph(s).',
        '',
      ].join('\n'),
    );
  });

  test('the repaired connection passes, and a bounded list of scalars was never a collection', async () => {
    const workspace = await checkWorkspace(connectionReturns);

    const run = await runForge(['check'], { workspace });

    expect(run.exitCode).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({
      ok: true,
      data: {
        complete: true,
        compositionErrors: [],
        findings: [],
        exceptions: [],
        summary: { errors: 0, warnings: 0, exceptions: 0, subgraphs: 2 },
      },
    });
  });

  test('warnings are reported without failing the check', async () => {
    const workspace = await checkWorkspace(offsetReturns, '');

    const run = await runForge(['check'], { workspace, caller: 'human' });

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe(
      [
        'WARN  FIELD_NAMES_SHOULD_BE_CAMEL_CASE  Return.refund_reason',
        '      services/returns/schema.graphql:8:3',
        '      Field "refund_reason" should be in camelCase.',
        '0 error(s), 1 warning(s), 0 exception(s) in 2 subgraph(s).',
        '',
      ].join('\n'),
    );
  });

  test('a rule set to error blocks, and one set to off is not reported', async () => {
    const workspace = await checkWorkspace(
      offsetReturns,
      `check:
  rules:
    FIELD_NAMES_SHOULD_BE_CAMEL_CASE: error
    pagination.forward-connection: off
`,
    );

    const run = await runForge(['check'], { workspace });

    expect(run.exitCode).toBe(3);
    expect(JSON.parse(run.stdout).data.findings).toEqual([{ ...camelCaseFinding, severity: 'error' }]);
  });

  test('an approved exception is reported apart, and a new field does not inherit it', async () => {
    const workspace = await checkWorkspace(
      offsetReturns.replace('supportedCurrencies: [String!]!', 'auditEvents: [Return!]!'),
      `check:
  rules:
    pagination.forward-connection: error
    FIELD_NAMES_SHOULD_BE_CAMEL_CASE: off
  exceptions:
    - rule: pagination.forward-connection
      coordinate: Query.auditEvents
      reason: Predates the pagination convention.
`,
    );

    const run = await runForge(['check'], { workspace });

    expect(run.exitCode).toBe(3);
    const details = JSON.parse(run.stdout).data;
    expect(details.findings).toEqual([paginationFinding]);
    expect(details.exceptions).toEqual([
      {
        rule: 'pagination.forward-connection',
        severity: 'error',
        coordinate: 'Query.auditEvents',
        message: 'Expose edges and PageInfo. Keep upstream paging inside the adapter.',
        location: { file: 'services/returns/schema.graphql', line: 3, column: 3 },
        found: ': [Return!]!',
        expected: '(first: Int!, after: String): ReturnConnection!',
        reference: { coordinate: 'Query.orders', file: 'services/orders/schema.graphql' },
        reason: 'Predates the pagination convention.',
      },
    ]);
    expect(details.summary).toEqual({ errors: 1, warnings: 0, exceptions: 1, subgraphs: 2 });
  });

  test('a graph that does not compose is an incomplete check and exits non-zero', async () => {
    const workspace = await checkWorkspace('type Query {\n  returns: [Missing!]!\n}\n');

    const run = await runForge(['check'], { workspace });

    expect(run.exitCode).toBe(3);
    const { error, data } = JSON.parse(run.stdout);
    expect(error.message).toBe('The check is incomplete: the graph does not compose.');
    expect(error.remediation).toBe('Fix the composition errors, then run the check again.');
    expect(data.complete).toBe(false);
    expect(data.compositionErrors.join('\n')).toContain('Missing');
  });

  test('without a graph file there is nothing to check, which is a failure', async () => {
    const workspace = await createWorkspace({ 'forge.yaml': manifest(''), 'forge.lock': lockForReleaseA });

    const run = await runForge(['check'], { workspace });

    expect(run.exitCode).toBe(1);
    expect(JSON.parse(run.stdout).error).toEqual({
      code: 'COMMAND_FAILED',
      message: `There is no graph to check: ${workspace}/graph.yaml does not exist.`,
      input: `${workspace}/graph.yaml`,
      remediation:
        'List the subgraphs and their schema files in the graph file, in the input format of `wgc router compose`, or pass --graph <file>.',
    });
  });

  test('a rule the policy names but Forge does not have is rejected', async () => {
    const workspace = await checkWorkspace(offsetReturns, 'check:\n  rules:\n    pagination.offset: error\n');

    const run = await runForge(['check'], { workspace });

    expect(JSON.parse(run.stdout).error).toEqual({
      code: 'COMMAND_FAILED',
      message: 'forge.yaml sets a rule that does not exist: pagination.offset.',
      input: 'forge.yaml: check.rules.pagination.offset',
      remediation: 'Run `wgc forge check --help` to list the rules.',
    });
  });

  test('every Cosmo schema lint rule reports the coordinate it is about', async () => {
    const rules = [
      'FIELD_NAMES_SHOULD_BE_CAMEL_CASE',
      'TYPE_NAMES_SHOULD_BE_PASCAL_CASE',
      'SHOULD_NOT_HAVE_TYPE_PREFIX',
      'SHOULD_NOT_HAVE_TYPE_SUFFIX',
      'SHOULD_NOT_HAVE_INPUT_PREFIX',
      'SHOULD_HAVE_INPUT_SUFFIX',
      'SHOULD_NOT_HAVE_ENUM_PREFIX',
      'SHOULD_NOT_HAVE_ENUM_SUFFIX',
      'SHOULD_NOT_HAVE_INTERFACE_PREFIX',
      'SHOULD_NOT_HAVE_INTERFACE_SUFFIX',
      'ENUM_VALUES_SHOULD_BE_UPPER_CASE',
      'DISALLOW_CASE_INSENSITIVE_ENUM_VALUES',
      'NO_TYPENAME_PREFIX_IN_TYPE_FIELDS',
      'REQUIRE_DEPRECATION_REASON',
      'ALL_TYPES_REQUIRE_DESCRIPTION',
      'ORDER_FIELDS',
      'ORDER_ENUM_VALUES',
      'ORDER_DEFINITIONS',
    ];
    const workspace = await createWorkspace({
      'forge.yaml': manifest(`check:\n  rules:\n${rules.map((rule) => `    ${rule}: error\n`).join('')}`),
      'forge.lock': lockForReleaseA,
      'graph.yaml': 'version: 1\nsubgraphs:\n  - name: kitchen\n    schema:\n      file: kitchen.graphql\n',
      'kitchen.graphql': `type Query {
  zebra: String @deprecated
  apple: typeUser
}

type typeUser {
  typeUserName: String
}

type AccountType {
  id: ID!
  Bad_Name: String
}

input InputFilter {
  term: String
}

enum EnumColor {
  red
  RED
}

enum ShadeEnum {
  DARK
}

interface InterfaceNode {
  id: ID!
}

interface NodeInterface {
  id: ID!
}
`,
    });

    const run = await runForge(['check'], { workspace });

    const findings: { rule: string; coordinate: string }[] = JSON.parse(run.stdout).data.findings;
    expect(findings.map((finding) => `${finding.rule} ${finding.coordinate}`)).toEqual([
      'FIELD_NAMES_SHOULD_BE_CAMEL_CASE AccountType.Bad_Name',
      'TYPE_NAMES_SHOULD_BE_PASCAL_CASE typeUser',
      'SHOULD_NOT_HAVE_TYPE_PREFIX typeUser',
      'SHOULD_NOT_HAVE_TYPE_SUFFIX AccountType',
      'SHOULD_NOT_HAVE_INPUT_PREFIX InputFilter',
      'SHOULD_HAVE_INPUT_SUFFIX InputFilter',
      'SHOULD_NOT_HAVE_ENUM_PREFIX EnumColor',
      'SHOULD_NOT_HAVE_ENUM_SUFFIX ShadeEnum',
      'SHOULD_NOT_HAVE_INTERFACE_PREFIX InterfaceNode',
      'SHOULD_NOT_HAVE_INTERFACE_SUFFIX NodeInterface',
      'ENUM_VALUES_SHOULD_BE_UPPER_CASE EnumColor.red',
      'DISALLOW_CASE_INSENSITIVE_ENUM_VALUES EnumColor.RED',
      'NO_TYPENAME_PREFIX_IN_TYPE_FIELDS typeUser.typeUserName',
      'REQUIRE_DEPRECATION_REASON Query.zebra',
      'ALL_TYPES_REQUIRE_DESCRIPTION Query',
      'ALL_TYPES_REQUIRE_DESCRIPTION typeUser',
      'ALL_TYPES_REQUIRE_DESCRIPTION AccountType',
      'ALL_TYPES_REQUIRE_DESCRIPTION InputFilter',
      'ALL_TYPES_REQUIRE_DESCRIPTION EnumColor',
      'ALL_TYPES_REQUIRE_DESCRIPTION ShadeEnum',
      'ALL_TYPES_REQUIRE_DESCRIPTION InterfaceNode',
      'ALL_TYPES_REQUIRE_DESCRIPTION NodeInterface',
      'ORDER_FIELDS Query.apple',
      'ORDER_FIELDS AccountType.Bad_Name',
      'ORDER_DEFINITIONS AccountType',
      'ORDER_DEFINITIONS EnumColor',
      'ORDER_DEFINITIONS InterfaceNode',
    ]);
  });
});
