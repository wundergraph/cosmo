import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  ProposalNamingConvention,
  ProposalOrigin,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../../src/core/test-util.js';
import {
  DEFAULT_NAMESPACE,
  DEFAULT_ROUTER_URL,
  DEFAULT_SUBGRAPH_URL_ONE,
  DEFAULT_SUBGRAPH_URL_TWO,
  createFederatedGraph,
  createSubgraph,
  createThenPublishSubgraph,
  SetupTest,
} from '../test-util.js';

let dbname = '';

vi.mock('../../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

describe('GetProposedSchemaOfCheckedSubgraph', () => {
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

  test('Should return the proposed schema for a valid check', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const graphName = genID('fedgraph');
    await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

    const subgraphName = genID('subgraph');
    await createSubgraph(client, subgraphName, 'http://localhost:4001');

    await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: 'type Query { hello: String }',
    });

    const proposedSchema = 'type Query { hello: String, newField: Int }';
    const checkResp = await client.checkSubgraphSchema({
      subgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: Buffer.from(proposedSchema),
      skipTrafficCheck: true,
    });
    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);

    // Get the checkedSubgraphId from the check summary
    const summaryResp = await client.getCheckSummary({
      checkId: checkResp.checkId,
      graphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(summaryResp.response?.code).toBe(EnumStatusCode.OK);
    expect(summaryResp.check?.checkedSubgraphs.length).toBe(1);
    const checkedSubgraphId = summaryResp.check!.checkedSubgraphs[0].id;

    const getSubgraphResponse = await client.getSubgraphByName({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(getSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    const response = await client.getProposedSchemaOfCheckedSubgraph({
      checkId: checkResp.checkId,
      checkedSubgraphId,
      subgraphId: getSubgraphResponse.graph!.id,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.proposedSchema).toBe(proposedSchema);
  });

  test('Should fail when subgraph does not exist', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const response = await client.getProposedSchemaOfCheckedSubgraph({
      checkId: '00000000-0000-0000-0000-000000000000',
      checkedSubgraphId: '00000000-0000-0000-0000-000000000000',
      subgraphId: '00000000-0000-0000-0000-000000000000',
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(response.response?.details).toContain('Subgraph not found');
    expect(response.proposedSchema).toBe('');
  });

  test('Should fail when the check does not exist', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const subgraphName = genID('subgraph');
    await createSubgraph(client, subgraphName, 'http://localhost:4001');

    const getSubgraphResponse = await client.getSubgraphByName({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
    });

    const response = await client.getProposedSchemaOfCheckedSubgraph({
      checkId: '00000000-0000-0000-0000-000000000000',
      checkedSubgraphId: '00000000-0000-0000-0000-000000000000',
      subgraphId: getSubgraphResponse.graph!.id,
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(response.response?.details).toContain('Proposed schema not found');
    expect(response.proposedSchema).toBe('');
  });

  test('Should return the correct proposed schema for each subgraph in a multi-subgraph proposal check', async (testContext) => {
    const { client, server } = await SetupTest({
      dbname,
      chClient,
      setupBilling: { plan: 'enterprise' },
      enabledFeatures: ['proposals'],
    });
    testContext.onTestFinished(() => server.close());

    const fedGraphName = genID('fedGraph');
    const subgraphOneName = genID('subgraph1');
    const subgraphTwoName = genID('subgraph2');
    const label = genUniqueLabel('label');

    const subgraphOneSDL = `type Query { hello: String! }`;
    const subgraphTwoSDL = `type Query { world: String! }`;

    await createThenPublishSubgraph(
      client,
      subgraphOneName,
      DEFAULT_NAMESPACE,
      subgraphOneSDL,
      [label],
      DEFAULT_SUBGRAPH_URL_ONE,
    );
    await createThenPublishSubgraph(
      client,
      subgraphTwoName,
      DEFAULT_NAMESPACE,
      subgraphTwoSDL,
      [label],
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], DEFAULT_ROUTER_URL);

    // Enable proposals for the namespace
    const enableResponse = await client.enableProposalsForNamespace({
      namespace: DEFAULT_NAMESPACE,
      enableProposals: true,
    });
    expect(enableResponse.response?.code).toBe(EnumStatusCode.OK);

    // Proposed changes to both subgraphs
    const updatedSubgraphOneSDL = `type Query { hello: String!, newField1: Int! }`;
    const updatedSubgraphTwoSDL = `type Query { world: String!, newField2: Int! }`;

    const createProposalResponse = await client.createProposal({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      name: genID('proposal'),
      namingConvention: ProposalNamingConvention.INCREMENTAL,
      origin: ProposalOrigin.INTERNAL,
      subgraphs: [
        {
          name: subgraphOneName,
          schemaSDL: updatedSubgraphOneSDL,
          isDeleted: false,
          isNew: false,
          labels: [],
        },
        {
          name: subgraphTwoName,
          schemaSDL: updatedSubgraphTwoSDL,
          isDeleted: false,
          isNew: false,
          labels: [],
        },
      ],
    });
    expect(createProposalResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(createProposalResponse.checkId).not.toBe('');

    // Fetch the check summary to get the checkedSubgraphIds
    const summaryResp = await client.getCheckSummary({
      checkId: createProposalResponse.checkId,
      graphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(summaryResp.response?.code).toBe(EnumStatusCode.OK);
    expect(summaryResp.check?.checkedSubgraphs.length).toBe(2);

    const checkedSubgraphOne = summaryResp.check!.checkedSubgraphs.find((s) => s.subgraphName === subgraphOneName);
    const checkedSubgraphTwo = summaryResp.check!.checkedSubgraphs.find((s) => s.subgraphName === subgraphTwoName);
    expect(checkedSubgraphOne?.subgraphName).toBe(subgraphOneName);
    expect(checkedSubgraphTwo?.subgraphName).toBe(subgraphTwoName);

    // Look up subgraph IDs
    const getSubgraphOne = await client.getSubgraphByName({
      name: subgraphOneName,
      namespace: DEFAULT_NAMESPACE,
    });
    const getSubgraphTwo = await client.getSubgraphByName({
      name: subgraphTwoName,
      namespace: DEFAULT_NAMESPACE,
    });

    // Verify subgraph ONE returns its own proposed schema
    const responseOne = await client.getProposedSchemaOfCheckedSubgraph({
      checkId: createProposalResponse.checkId,
      checkedSubgraphId: checkedSubgraphOne!.id,
      subgraphId: getSubgraphOne.graph!.id,
    });
    expect(responseOne.response?.code).toBe(EnumStatusCode.OK);
    expect(responseOne.proposedSchema).toBe(updatedSubgraphOneSDL);

    // Verify subgraph TWO returns its own (different) proposed schema
    const responseTwo = await client.getProposedSchemaOfCheckedSubgraph({
      checkId: createProposalResponse.checkId,
      checkedSubgraphId: checkedSubgraphTwo!.id,
      subgraphId: getSubgraphTwo.graph!.id,
    });
    expect(responseTwo.response?.code).toBe(EnumStatusCode.OK);
    expect(responseTwo.proposedSchema).toBe(updatedSubgraphTwoSDL);

    // Sanity check: the two proposed schemas are different
    expect(responseOne.proposedSchema).not.toBe(responseTwo.proposedSchema);
  });
});
