import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../../src/core/test-util.js';
import {
  createBaseAndFeatureSubgraph,
  DEFAULT_NAMESPACE,
  DEFAULT_SUBGRAPH_URL_ONE,
  DEFAULT_SUBGRAPH_URL_TWO,
  SetupTest,
} from '../test-util.js';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';

let dbname = '';

vi.mock('../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

describe('DeleteSubgraph', (ctx) => {
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

  test('Should be able to create a subgraph, publish the schema, create a federated graph and then delete a subgraph', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const federatedGraphName = genID('fedGraph');
    const subgraphName = genID('subgraph');
    const label = genUniqueLabel();

    const createFederatedGraphResp = await client.createFederatedGraph({
      name: federatedGraphName,
      namespace: 'default',
      labelMatchers: [joinLabel(label)],
      routingUrl: 'http://localhost:4000',
    });

    expect(createFederatedGraphResp.response?.code).toBe(EnumStatusCode.OK);

    const createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8080',
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    const publishFederatedSubgraphResp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      schema: 'type Query { hello: String! }',
    });

    expect(publishFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    // delete the subgraph because it was the only one it produced a composition error
    const deleteFederatedSubgraphResp = await client.deleteFederatedSubgraph({
      subgraphName,
      namespace: 'default',
    });
    expect(deleteFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);

    // after deletion of subgraph verify if the subgraph was deleted
    const getSubgraphResp = await client.getSubgraphByName({
      name: subgraphName,
      namespace: 'default',
    });
    expect(getSubgraphResp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

    // after deletion of subgraph verify if the federated graph exists
    const getFederatedGraphResp = await client.getFederatedGraphByName({
      name: federatedGraphName,
      namespace: 'default',
    });
    expect(getFederatedGraphResp.response?.code).toBe(EnumStatusCode.OK);
    expect(getFederatedGraphResp.subgraphs.length).toBe(0);

    await server.close();
  });

  test('Should be able to delete a subgraph from multiple federated graphs', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const federatedGraph1Name = genID('fedGraph1');
    const federatedGraph2Name = genID('fedGraph2');

    const subgraphName = genID('subgraph');
    const label = genUniqueLabel();

    const createFederatedGraph1Resp = await client.createFederatedGraph({
      name: federatedGraph1Name,
      namespace: 'default',
      labelMatchers: [joinLabel(label)],
      routingUrl: 'http://localhost:4000',
    });

    expect(createFederatedGraph1Resp.response?.code).toBe(EnumStatusCode.OK);

    const createFederatedGraph2Resp = await client.createFederatedGraph({
      name: federatedGraph2Name,
      namespace: 'default',
      labelMatchers: [joinLabel(label)],
      routingUrl: 'http://localhost:4000',
    });

    expect(createFederatedGraph2Resp.response?.code).toBe(EnumStatusCode.OK);

    const createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8080',
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    const publishFederatedSubgraphResp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      schema: 'type Query { hello: String! }',
    });

    expect(publishFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    // Check if subgraph exists on both federated graphs
    let getGraph1Resp = await client.getFederatedGraphByName({
      name: federatedGraph1Name,
      namespace: 'default',
    });

    expect(getGraph1Resp.response?.code).toBe(EnumStatusCode.OK);
    expect(getGraph1Resp.subgraphs.length).toBe(1);
    expect(getGraph1Resp.subgraphs[0].name).toBe(subgraphName);

    let getGraph2Resp = await client.getFederatedGraphByName({
      name: federatedGraph1Name,
      namespace: 'default',
    });

    expect(getGraph2Resp.response?.code).toBe(EnumStatusCode.OK);
    expect(getGraph2Resp.subgraphs.length).toBe(1);
    expect(getGraph2Resp.subgraphs[0].name).toBe(subgraphName);

    // delete the subgraph because it was the only one it produced a composition error
    const deleteFederatedSubgraphResp = await client.deleteFederatedSubgraph({
      subgraphName,
      namespace: 'default',
    });
    expect(deleteFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);

    // after deletion of subgraph verify if the subgraph was deleted
    // and don't exist on both federated graphs
    const getSubgraphResp = await client.getSubgraphByName({
      name: subgraphName,
      namespace: 'default',
    });
    expect(getSubgraphResp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

    getGraph1Resp = await client.getFederatedGraphByName({
      name: federatedGraph1Name,
      namespace: 'default',
    });

    expect(getGraph1Resp.response?.code).toBe(EnumStatusCode.OK);
    expect(getGraph1Resp.subgraphs.length).toBe(0);

    getGraph2Resp = await client.getFederatedGraphByName({
      name: federatedGraph1Name,
      namespace: 'default',
    });

    expect(getGraph2Resp.response?.code).toBe(EnumStatusCode.OK);
    expect(getGraph2Resp.subgraphs.length).toBe(0);

    await server.close();
  });

  test('that deleting a subgraph also deletes any feature subgraphs for which it is the base subgraph', async () => {
    const { client, server } = await SetupTest({ dbname });

    const baseSubgraphName = genID('subgraph');
    const featureSubgraphNameOne = genID('featureSubgraphOne');
    const featureSubgraphNameTwo = genID('featureSubgraphTwo');

    await createBaseAndFeatureSubgraph(
      client,
      baseSubgraphName,
      featureSubgraphNameOne,
      DEFAULT_SUBGRAPH_URL_ONE,
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    // Create a second feature subgraph
    const createFeatureSubgraphResponse = await client.createFederatedSubgraph({
      name: featureSubgraphNameTwo,
      routingUrl: 'http://localhost:4004',
      baseSubgraphName,
      isFeatureSubgraph: true,
    });
    expect(createFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    const deleteFederatedSubgraphResponse = await client.deleteFederatedSubgraph({
      subgraphName: baseSubgraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(deleteFederatedSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    // Expect the base subgraph to no longer exist
    const getFeatureSubgraphByNameResponseOne = await client.getSubgraphByName({
      name: baseSubgraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(getFeatureSubgraphByNameResponseOne.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

    // Expect the first feature subgraph to no longer exist
    const getFeatureSubgraphByNameResponseTwo = await client.getSubgraphByName({
      name: featureSubgraphNameOne,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(getFeatureSubgraphByNameResponseTwo.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

    // Expect the second feature subgraph to no longer exist
    const getFeatureSubgraphByNameResponseThree = await client.getSubgraphByName({
      name: featureSubgraphNameTwo,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(getFeatureSubgraphByNameResponseThree.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

    await server.close();
  });
});
