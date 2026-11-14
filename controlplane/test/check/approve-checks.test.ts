import { Client } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  PlatformService,
  ProposalNamingConvention,
  ProposalOrigin,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  onTestFinished,
  test,
  type Mock,
  vi,
} from 'vitest';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';
import {
  afterAllSetup,
  beforeAllSetup,
  createTestGroup,
  createTestRBACEvaluator,
  genID,
  genUniqueLabel,
} from '../../src/core/test-util.js';
import { createFederatedGraph, createThenPublishSubgraph, DEFAULT_NAMESPACE, SetupTest } from '../test-util.js';

let dbname = '';

vi.mock('../../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

const employeesChange = { changeType: 'FIELD_TYPE_CHANGED', path: 'Query.employees' };

async function approveCheck(client: Client<typeof PlatformService>, graphName: string, checkId: string) {
  const graph = { graphName, namespace: DEFAULT_NAMESPACE };
  const operation = { ...graph, operationHash: 'hash1', changes: [employeesChange], checkId };

  const responses = [
    await client.createOperationOverrides({ ...operation, operationName: 'op1' }),
    await client.removeOperationOverrides(operation),
    await client.toggleChangeOverridesForAllOperations({ ...graph, checkId, isSafe: true }),
    await client.forceCheckSuccess({ ...graph, checkId }),
  ];

  return responses.map((r) => r.response?.code);
}

async function ignoreOperations(client: Client<typeof PlatformService>, graphName: string, checkId: string) {
  const graph = { graphName, namespace: DEFAULT_NAMESPACE };
  const operation = { ...graph, operationHash: 'hash1' };

  const responses = [
    await client.createOperationIgnoreAllOverride({ ...operation, operationName: 'op1' }),
    await client.removeOperationIgnoreAllOverride(operation),
    await client.createIgnoreOverridesForAllOperations({ ...graph, checkId }),
  ];

  return responses.map((r) => r.response?.code);
}

async function forceCheckSuccess(client: Client<typeof PlatformService>, graphName: string, checkId: string) {
  const response = await client.forceCheckSuccess({ graphName, namespace: DEFAULT_NAMESPACE, checkId });
  return response.response?.code;
}

async function permissionFlags(client: Client<typeof PlatformService>, graphName: string, checkId: string) {
  const graph = { graphName, namespace: DEFAULT_NAMESPACE };
  const summary = await client.getCheckSummary({ ...graph, checkId });
  const operations = await client.getCheckOperations({ ...graph, checkId, limit: 10, offset: 0 });
  const overrides = await client.getOperationOverrides({ ...graph, operationHash: 'hash1' });

  return {
    summaryCanApproveChecks: summary.canApproveChecks,
    operationsCanApproveChecks: operations.canApproveChecks,
    operationsCanIgnoreOperations: operations.canIgnoreOperations,
    overridesCanManageOverrides: overrides.canManageOverrides,
  };
}

describe('Check approval RBAC', () => {
  let chClient: ClickHouseClient;

  beforeEach(() => {
    chClient = new ClickHouseClient();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  // A graph composed of the employees and teams subgraphs, with a failed check of the employees subgraph
  // that breaks the operation hash1.
  async function setup() {
    const { client, server, authenticator, users } = await SetupTest({
      dbname,
      chClient,
      setupBilling: { plan: 'enterprise' },
      enabledFeatures: ['proposals'],
    });
    onTestFinished(() => server.close());

    const graphName = genID('fedGraph');
    const employeesName = genID('employees');
    const teamsName = genID('teams');
    const label = genUniqueLabel();

    await createThenPublishSubgraph(
      client,
      employeesName,
      DEFAULT_NAMESPACE,
      'type Query { employees: [Employee!]! } type Employee { id: Int! }',
      [label],
      'http://localhost:4001',
    );
    await createThenPublishSubgraph(
      client,
      teamsName,
      DEFAULT_NAMESPACE,
      'type Query { teams: [Team!]! } type Team { id: Int! }',
      [label],
      'http://localhost:4002',
    );
    await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:3002');

    (chClient.queryPromise as Mock).mockResolvedValue([
      {
        operationHash: 'hash1',
        operationName: 'op1',
        operationType: 'query',
        firstSeen: Date.now() / 1000,
        lastSeen: Date.now() / 1000,
      },
    ]);

    const checkResp = await client.checkSubgraphSchema({
      subgraphName: employeesName,
      namespace: DEFAULT_NAMESPACE,
      schema: Buffer.from('type Query { employees: [Employee] } type Employee { id: Int! }'),
    });
    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);

    const enableProposalsResp = await client.enableProposalsForNamespace({
      namespace: DEFAULT_NAMESPACE,
      enableProposals: true,
    });
    expect(enableProposalsResp.response?.code).toBe(EnumStatusCode.OK);

    const graph = await client.getFederatedGraphByName({ name: graphName, namespace: DEFAULT_NAMESPACE });
    const employees = await client.getSubgraphByName({ name: employeesName, namespace: DEFAULT_NAMESPACE });
    const teams = await client.getSubgraphByName({ name: teamsName, namespace: DEFAULT_NAMESPACE });

    const graphTargetId = graph.graph!.targetId;
    const employeesTargetId = employees.graph!.targetId;
    const teamsTargetId = teams.graph!.targetId;

    // Must run before switching away from the admin, since only graph writers can create proposals.
    async function createProposalCheck(subgraphs: { name: string; schemaSDL: string; isNew: boolean }[]) {
      const response = await client.createProposal({
        federatedGraphName: graphName,
        namespace: DEFAULT_NAMESPACE,
        name: genID('proposal'),
        namingConvention: ProposalNamingConvention.INCREMENTAL,
        origin: ProposalOrigin.INTERNAL,
        subgraphs: subgraphs.map((s) => ({ ...s, isDeleted: false, labels: s.isNew ? [label] : [] })),
      });
      expect(response.response?.code).toBe(EnumStatusCode.OK);
      return response.checkId;
    }

    return {
      client,
      graphName,
      employeesName,
      teamsName,
      checkId: checkResp.checkId,
      graphTargetId,
      employeesTargetId,
      teamsTargetId,
      createProposalCheck,
      loginAs: (...rules: Parameters<typeof createTestGroup>) =>
        authenticator.changeUserWithSuppliedContext({
          ...users.adminAliceCompanyA,
          rbac: createTestRBACEvaluator(createTestGroup(...rules)),
        }),
      graphViewer: { role: 'graph-viewer', resources: [graphTargetId] },
      graphAdmin: { role: 'graph-admin', resources: [graphTargetId] },
      approverOf: (...targetIds: string[]) => ({ role: 'subgraph-check-approver', resources: targetIds }),
    };
  }

  const allowed = [EnumStatusCode.OK, EnumStatusCode.OK, EnumStatusCode.OK, EnumStatusCode.OK];
  const denied = [
    EnumStatusCode.ERROR_NOT_AUTHORIZED,
    EnumStatusCode.ERROR_NOT_AUTHORIZED,
    EnumStatusCode.ERROR_NOT_AUTHORIZED,
    EnumStatusCode.ERROR_NOT_AUTHORIZED,
  ];
  const ignoreAllowed = [EnumStatusCode.OK, EnumStatusCode.OK, EnumStatusCode.OK];
  const ignoreDenied = [
    EnumStatusCode.ERROR_NOT_AUTHORIZED,
    EnumStatusCode.ERROR_NOT_AUTHORIZED,
    EnumStatusCode.ERROR_NOT_AUTHORIZED,
  ];

  test('Check approver of the checked subgraph with graph read access can approve the check', async () => {
    const { client, graphName, checkId, employeesTargetId, graphViewer, approverOf, loginAs } = await setup();

    loginAs(graphViewer, approverOf(employeesTargetId));

    expect(await approveCheck(client, graphName, checkId)).toEqual(allowed);
  });

  test('Check approver cannot approve a check through a graph the check does not belong to', async () => {
    const { client, checkId, employeesTargetId, approverOf, loginAs } = await setup();

    const otherGraphName = genID('otherFedGraph');
    await createFederatedGraph(
      client,
      otherGraphName,
      DEFAULT_NAMESPACE,
      [joinLabel(genUniqueLabel())],
      'http://localhost:3003',
    );
    const otherGraph = await client.getFederatedGraphByName({ name: otherGraphName, namespace: DEFAULT_NAMESPACE });

    loginAs({ role: 'graph-viewer', resources: [otherGraph.graph!.targetId] }, approverOf(employeesTargetId));

    expect(await approveCheck(client, otherGraphName, checkId)).toEqual([
      EnumStatusCode.ERROR_NOT_AUTHORIZED,
      EnumStatusCode.ERROR_NOT_AUTHORIZED,
      EnumStatusCode.ERR_NOT_FOUND,
      EnumStatusCode.ERR_NOT_FOUND,
    ]);
  });

  test('Check approver without read access to a graph cannot tell which checks belong to it', async () => {
    const { client, checkId, employeesTargetId, graphViewer, approverOf, loginAs } = await setup();

    const otherGraphName = genID('otherFedGraph');
    await createFederatedGraph(
      client,
      otherGraphName,
      DEFAULT_NAMESPACE,
      [joinLabel(genUniqueLabel())],
      'http://localhost:3003',
    );

    loginAs(graphViewer, approverOf(employeesTargetId));

    expect(await approveCheck(client, otherGraphName, checkId)).toEqual(denied);
  });

  test('Check approver without graph read access cannot approve the check', async () => {
    const { client, graphName, checkId, employeesTargetId, approverOf, loginAs } = await setup();

    loginAs(approverOf(employeesTargetId));

    expect(await approveCheck(client, graphName, checkId)).toEqual(denied);
  });

  test('Check approver of another subgraph cannot approve the check', async () => {
    const { client, graphName, checkId, teamsTargetId, graphViewer, approverOf, loginAs } = await setup();

    loginAs(graphViewer, approverOf(teamsTargetId));

    expect(await approveCheck(client, graphName, checkId)).toEqual(denied);
  });

  test('Subgraph admin of the checked subgraph cannot approve the check', async () => {
    const { client, graphName, checkId, employeesTargetId, teamsTargetId, graphViewer, loginAs } = await setup();

    loginAs(graphViewer, { role: 'subgraph-admin', resources: [employeesTargetId, teamsTargetId] });

    expect(await approveCheck(client, graphName, checkId)).toEqual(denied);
    expect(await ignoreOperations(client, graphName, checkId)).toEqual(ignoreDenied);
  });

  test('Check approver must approve operation overrides through a check that reports them', async () => {
    const { client, graphName, checkId, employeesTargetId, graphViewer, approverOf, loginAs } = await setup();
    const operation = { graphName, namespace: DEFAULT_NAMESPACE, operationHash: 'hash1', operationName: 'op1' };

    loginAs(graphViewer, approverOf(employeesTargetId));

    const withoutCheck = await client.createOperationOverrides({ ...operation, changes: [employeesChange] });
    const removeWithoutCheck = await client.removeOperationOverrides({ ...operation, changes: [employeesChange] });
    const changeNotInCheck = await client.createOperationOverrides({
      ...operation,
      checkId,
      changes: [{ changeType: 'FIELD_REMOVED', path: 'Query.teams' }],
    });
    const operationNotInCheck = await client.createOperationOverrides({
      ...operation,
      operationHash: 'hash2',
      checkId,
      changes: [employeesChange],
    });

    expect(withoutCheck.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
    expect(removeWithoutCheck.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
    expect(changeNotInCheck.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
    expect(operationNotInCheck.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
  });

  test('Only graph writers can ignore operations', async () => {
    const { client, graphName, checkId, employeesTargetId, graphViewer, graphAdmin, approverOf, loginAs } =
      await setup();

    loginAs(graphViewer, approverOf(employeesTargetId));
    expect(await ignoreOperations(client, graphName, checkId)).toEqual(ignoreDenied);

    loginAs(graphAdmin);
    expect(await ignoreOperations(client, graphName, checkId)).toEqual(ignoreAllowed);
  });

  test('Check approver must be granted every subgraph of a multi-subgraph check', async () => {
    const {
      client,
      graphName,
      employeesName,
      teamsName,
      employeesTargetId,
      teamsTargetId,
      graphViewer,
      approverOf,
      createProposalCheck,
      loginAs,
    } = await setup();
    const checkId = await createProposalCheck([
      {
        name: employeesName,
        schemaSDL: 'type Query { employees: [Employee] } type Employee { id: Int! }',
        isNew: false,
      },
      { name: teamsName, schemaSDL: 'type Query { teams: [Team] } type Team { id: Int! }', isNew: false },
    ]);

    loginAs(graphViewer, approverOf(employeesTargetId));
    expect(await forceCheckSuccess(client, graphName, checkId)).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

    loginAs(graphViewer, approverOf(employeesTargetId, teamsTargetId));
    expect(await forceCheckSuccess(client, graphName, checkId)).toBe(EnumStatusCode.OK);
  });

  test('Only graph writers can approve a check that includes a new subgraph', async () => {
    const {
      client,
      graphName,
      employeesName,
      employeesTargetId,
      teamsTargetId,
      graphViewer,
      graphAdmin,
      approverOf,
      createProposalCheck,
      loginAs,
    } = await setup();
    const checkId = await createProposalCheck([
      {
        name: employeesName,
        schemaSDL: 'type Query { employees: [Employee] } type Employee { id: Int! }',
        isNew: false,
      },
      { name: genID('products'), schemaSDL: 'type Query { products: [String!]! }', isNew: true },
    ]);

    loginAs(graphViewer, approverOf(employeesTargetId, teamsTargetId));
    expect(await forceCheckSuccess(client, graphName, checkId)).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

    loginAs(graphAdmin);
    expect(await forceCheckSuccess(client, graphName, checkId)).toBe(EnumStatusCode.OK);
  });

  test('Check responses report what the user can do with the check', async () => {
    const { client, graphName, checkId, employeesTargetId, graphViewer, graphAdmin, approverOf, loginAs } =
      await setup();
    const graphWriter = {
      summaryCanApproveChecks: true,
      operationsCanApproveChecks: true,
      operationsCanIgnoreOperations: true,
      overridesCanManageOverrides: true,
    };
    const checkApprover = {
      summaryCanApproveChecks: true,
      operationsCanApproveChecks: true,
      operationsCanIgnoreOperations: false,
      overridesCanManageOverrides: false,
    };
    const reader = {
      summaryCanApproveChecks: false,
      operationsCanApproveChecks: false,
      operationsCanIgnoreOperations: false,
      overridesCanManageOverrides: false,
    };

    loginAs({ role: 'organization-admin' });
    expect(await permissionFlags(client, graphName, checkId)).toEqual(graphWriter);

    loginAs(graphAdmin);
    expect(await permissionFlags(client, graphName, checkId)).toEqual(graphWriter);

    loginAs(graphViewer, approverOf(employeesTargetId));
    expect(await permissionFlags(client, graphName, checkId)).toEqual(checkApprover);

    loginAs(graphViewer);
    expect(await permissionFlags(client, graphName, checkId)).toEqual(reader);
  });
});
