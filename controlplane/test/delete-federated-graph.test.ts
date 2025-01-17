import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { ClickHouseClient } from '../src/core/clickhouse/index.js';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../src/core/test-util.js';
import { SetupTest } from './test-util.js';

let dbname = '';

vi.mock('../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

describe('DeleteFederatedGraph', (ctx) => {
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

  test('Should be able to create a subgraph, publish the schema, create a federated graph and then delete a federated graph', async (testContext) => {
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

    const getFederatedGraphBeforeDeleteResp = await client.getFederatedGraphByName({
      name: federatedGraphName,
      namespace: 'default',
    });
    expect(getFederatedGraphBeforeDeleteResp.response?.code).toBe(EnumStatusCode.OK);

    // delete the federatedGraph
    const deleteFederatedGraphResp = await client.deleteFederatedGraph({
      name: federatedGraphName,
      namespace: 'default',
    });
    expect(deleteFederatedGraphResp.response?.code).toBe(EnumStatusCode.OK);

    // after deletion of federated graph verify if it was deleted
    const getFederatedGraphResp = await client.getFederatedGraphByName({
      name: federatedGraphName,
      namespace: 'default',
    });
    expect(getFederatedGraphResp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

    // after deletion of the federated graph verify that the subgraphs still exist
    for (const subgraph of getFederatedGraphBeforeDeleteResp.subgraphs) {
      const getSubgraphResp = await client.getSubgraphByName({
        name: subgraph.name,
        namespace: 'default',
      });
      expect(getSubgraphResp.response?.code).toBe(EnumStatusCode.OK);
    }

    await server.close();
  });
});
