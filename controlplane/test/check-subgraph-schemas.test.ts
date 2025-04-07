import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { CheckSubgraphSchemasRequest } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { ClickHouseClient } from '../src/core/clickhouse/index.js';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../src/core/test-util.js';
import {
  createFederatedGraph,
  createThenPublishSubgraph,
  DEFAULT_NAMESPACE,
  DEFAULT_SUBGRAPH_URL_ONE,
  DEFAULT_SUBGRAPH_URL_TWO,
  DEFAULT_SUBGRAPH_URL_THREE,
  SetupTest,
} from './test-util.js';

let dbname = '';

vi.mock('../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

describe('CheckSubgraphSchemas', (ctx) => {
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

  test('Should check schemas for 2 subgraphs with 2 federated graphs and verify 2 affected graphs', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    // Create unique label for our test
    const label = genUniqueLabel();

    // Create first subgraph
    const subgraphName1 = genID('subgraph1');
    await createThenPublishSubgraph(
      client,
      subgraphName1,
      DEFAULT_NAMESPACE,
      'type Query { hello: String! }',
      [label],
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    // Create second subgraph
    const subgraphName2 = genID('subgraph2');
    await createThenPublishSubgraph(
      client,
      subgraphName2,
      DEFAULT_NAMESPACE,
      'type Query { world: String! }',
      [label],
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    // Create first federated graph
    const fedGraphName1 = genID('fedgraph1');
    await createFederatedGraph(client, fedGraphName1, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:8081');

    // Create second federated graph
    const fedGraphName2 = genID('fedgraph2');
    await createFederatedGraph(client, fedGraphName2, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:8082');

    // Create the check request with new schemas for both subgraphs
    const request = new CheckSubgraphSchemasRequest({
      namespace: DEFAULT_NAMESPACE,
      subgraphs: [
        {
          name: subgraphName1,
          schemaSDL: 'type Query { hello: String!, helloExtended: String! }',
        },
        {
          name: subgraphName2,
          schemaSDL: 'type Query { world: String!, worldExtended: String! }',
        },
      ],
    });

    // Perform the check
    const checkResp = await client.checkSubgraphSchemas(request);
    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);
    // Verify non-breaking changes were detected
    expect(checkResp.nonBreakingChanges.length).toBeGreaterThan(0);

    // Verify the check summary for the first federated graph
    const checkSummary1 = await client.getCheckSummary({
      namespace: DEFAULT_NAMESPACE,
      graphName: fedGraphName1,
      checkId: checkResp.checkId,
    });

    expect(checkSummary1.response?.code).toBe(EnumStatusCode.OK);
    expect(checkSummary1.affectedGraphs).toHaveLength(2);

    expect(checkSummary1.check?.checkedSubgraphs.length).toEqual(2);

    // Verify the check summary for the second federated graph
    const checkSummary2 = await client.getCheckSummary({
      namespace: DEFAULT_NAMESPACE,
      graphName: fedGraphName2,
      checkId: checkResp.checkId,
    });

    expect(checkSummary2.response?.code).toBe(EnumStatusCode.OK);
    expect(checkSummary2.affectedGraphs).toHaveLength(2);
    expect(checkSummary2.check?.checkedSubgraphs.length).toEqual(2);

    await server.close();
  });

  test('Should check schemas for 3 subgraphs with 3 federated graphs of different configurations', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    // Create labels for our test
    const labelAll = genUniqueLabel();
    const labelPair = genUniqueLabel();
    const labelSingle = genUniqueLabel();

    // Create first subgraph with labelSingle and labelPair
    const subgraphName1 = genID('subgraph1');
    await createThenPublishSubgraph(
      client,
      subgraphName1,
      DEFAULT_NAMESPACE,
      'type Query { test1: String! }',
      [labelSingle, labelPair, labelAll],
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    // Create second subgraph with labelPair
    const subgraphName2 = genID('subgraph2');
    await createThenPublishSubgraph(
      client,
      subgraphName2,
      DEFAULT_NAMESPACE,
      'type Query { test2: String! }',
      [labelPair, labelAll],
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    // Create third subgraph with labelAll
    const subgraphName3 = genID('subgraph3');
    await createThenPublishSubgraph(
      client,
      subgraphName3,
      DEFAULT_NAMESPACE,
      'type Query { test3: String! }',
      [labelAll],
      DEFAULT_SUBGRAPH_URL_THREE,
    );

    // Create first federated graph that only includes subgraph1
    const fedGraphName1 = genID('fedgraph1');
    await createFederatedGraph(
      client,
      fedGraphName1,
      DEFAULT_NAMESPACE,
      [joinLabel(labelSingle)],
      'http://localhost:8081',
    );

    // Create second federated graph that includes subgraph1 and subgraph2
    const fedGraphName2 = genID('fedgraph2');
    await createFederatedGraph(
      client,
      fedGraphName2,
      DEFAULT_NAMESPACE,
      [joinLabel(labelPair)],
      'http://localhost:8082',
    );

    // Create third federated graph that includes all subgraphs
    const fedGraphName3 = genID('fedgraph3');
    await createFederatedGraph(
      client,
      fedGraphName3,
      DEFAULT_NAMESPACE,
      [joinLabel(labelAll)],
      'http://localhost:8083',
    );

    // Create the check request with new schemas for all three subgraphs
    const request = new CheckSubgraphSchemasRequest({
      namespace: DEFAULT_NAMESPACE,
      subgraphs: [
        {
          name: subgraphName1,
          schemaSDL: 'type Query { test1: String!, test1Extended: String! }',
        },
        {
          name: subgraphName2,
          schemaSDL: 'type Query { test2: String!, test2Extended: String! }',
        },
        {
          name: subgraphName3,
          schemaSDL: 'type Query { test3: String!, test3Extended: String! }',
        },
      ],
    });

    // Perform the check
    const checkResp = await client.checkSubgraphSchemas(request);
    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);

    // Verify the check summary for the first federated graph
    const checkSummary1 = await client.getCheckSummary({
      namespace: DEFAULT_NAMESPACE,
      graphName: fedGraphName1,
      checkId: checkResp.checkId,
    });

    expect(checkSummary1.response?.code).toBe(EnumStatusCode.OK);
    expect(checkSummary1.affectedGraphs).toHaveLength(3);
    expect(checkSummary1.check?.checkedSubgraphs.length).toEqual(1);

    // Verify the check summary for the second federated graph
    const checkSummary2 = await client.getCheckSummary({
      namespace: DEFAULT_NAMESPACE,
      graphName: fedGraphName2,
      checkId: checkResp.checkId,
    });

    expect(checkSummary2.response?.code).toBe(EnumStatusCode.OK);
    expect(checkSummary2.affectedGraphs).toHaveLength(3);
    expect(checkSummary2.check?.checkedSubgraphs.length).toEqual(2);

    // Verify the check summary for the third federated graph
    const checkSummary3 = await client.getCheckSummary({
      namespace: DEFAULT_NAMESPACE,
      graphName: fedGraphName3, // Check against the graph that includes all subgraphs
      checkId: checkResp.checkId,
    });

    expect(checkSummary3.response?.code).toBe(EnumStatusCode.OK);
    expect(checkSummary3.affectedGraphs).toHaveLength(3);
    expect(checkSummary3.check?.checkedSubgraphs.length).toEqual(3);

    await server.close();
  });

  test('Should handle breaking changes correctly', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    // Create unique label for our test
    const label = genUniqueLabel();

    // Create subgraph
    const subgraphName = genID('subgraph');
    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      'type Query { requiredField: String! }',
      [label],
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    // Create federated graph
    const fedGraphName = genID('fedgraph');
    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:8081');

    // Create a check request with schema containing breaking changes
    const request = new CheckSubgraphSchemasRequest({
      namespace: DEFAULT_NAMESPACE,
      subgraphs: [
        {
          name: subgraphName,
          // Removing a required field is a breaking change
          schemaSDL: 'type Query { newField: String }',
        },
      ],
    });

    // Perform the check
    const checkResp = await client.checkSubgraphSchemas(request);
    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);

    // Verify breaking changes were detected
    expect(checkResp.breakingChanges.length).toBeGreaterThan(0);

    await server.close();
  });

  test('Should handle deleted subgraph correctly', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    // Create unique label for our test
    const label = genUniqueLabel();

    // Create subgraph
    const subgraphName = genID('subgraph');
    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      'type Query { test: String! }',
      [label],
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    // Create second subgraph
    const subgraphName2 = genID('subgraph2');
    await createThenPublishSubgraph(
      client,
      subgraphName2,
      DEFAULT_NAMESPACE,
      'type Query { world: String! }',
      [label],
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    // Create federated graph
    const fedGraphName = genID('fedgraph');
    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:8081');

    // Create the check request with delete flag set to true
    const request = new CheckSubgraphSchemasRequest({
      namespace: DEFAULT_NAMESPACE,
      subgraphs: [
        {
          name: subgraphName,
          schemaSDL: '',
          isDeleted: true,
        },
      ],
    });

    // Perform the check
    const checkResp = await client.checkSubgraphSchemas(request);
    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);

    // Verify breaking changes were detected (deleting a subgraph is breaking)
    expect(checkResp.breakingChanges.length).toBeGreaterThan(0);

    // Get the check summary
    const checkSummary = await client.getCheckSummary({
      namespace: DEFAULT_NAMESPACE,
      graphName: fedGraphName,
      checkId: checkResp.checkId,
    });

    expect(checkSummary.response?.code).toBe(EnumStatusCode.OK);
    // Check that at least one subgraph is marked as deleted
    expect(checkSummary.check?.checkedSubgraphs.some((sg) => sg.isDeleted)).toBe(true);

    await server.close();
  });

  test('Should handle composition errors correctly', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    // Create unique label for our test
    const label = genUniqueLabel();

    // Create first subgraph
    const subgraphName1 = genID('subgraph1');
    await createThenPublishSubgraph(
      client,
      subgraphName1,
      DEFAULT_NAMESPACE,
      'type Query { users: [User!]! } type User { id: ID! }',
      [label],
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    // Create federated graph
    const fedGraphName = genID('fedgraph');
    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:8081');

    // Create the check request with schemas that will cause composition errors
    const request = new CheckSubgraphSchemasRequest({
      namespace: DEFAULT_NAMESPACE,
      subgraphs: [
        {
          name: subgraphName1,
          // Reference Product in extend but it doesn't exist
          schemaSDL: 'type Query { users: [User!]! } type User { id: ID! } extend type Product { name: String! }',
        },
      ],
    });

    // Perform the check
    const checkResp = await client.checkSubgraphSchemas(request);
    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);

    // Verify composition errors were detected
    expect(checkResp.compositionErrors.length).toBeGreaterThan(0);
    expect(checkResp.compositionErrors[0].message).toContain('Product');

    await server.close();
  });
});
