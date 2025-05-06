import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../src/core/test-util.js';
import { ClickHouseClient } from '../src/core/clickhouse/index.js';
import { createFederatedGraph, SetupTest } from './test-util.js';

let dbname = '';

vi.mock('../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

describe('Namespaces', (ctx) => {
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

  test('Creates a monograph with internal labels and one subgraph', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });

    const name = genID('mono');

    const createResp = await client.createMonograph({
      name,
      namespace: 'default',
      graphUrl: 'http://localhost:4000',
      routingUrl: 'http://localhost:3002',
    });

    expect(createResp.response?.code).toBe(EnumStatusCode.OK);

    const monographRes = await client.getFederatedGraphByName({
      name,
      namespace: 'default',
    });
    expect(monographRes.response?.code).toBe(EnumStatusCode.OK);
    expect(monographRes.graph?.labelMatchers.length).toBe(1);
    expect(monographRes.graph?.labelMatchers[0]).toContain('_internal=');
    expect(monographRes.graph?.routingURL).toBe('http://localhost:3002');
    expect(monographRes.subgraphs.length).toBe(1);
    expect(monographRes.subgraphs[0].labels.length).toBe(1);
    expect(monographRes.subgraphs[0].labels[0].key).toBe('_internal');
    expect(monographRes.subgraphs[0].routingURL).toBe('http://localhost:4000');

    await server.close();
  });

  test('Publish monograph updates internal subgraph schema', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const name = genID('mono');

    const createResp = await client.createMonograph({
      name,
      namespace: 'default',
      graphUrl: 'http://localhost:4000',
      routingUrl: 'http://localhost:3002',
    });
    expect(createResp.response?.code).toBe(EnumStatusCode.OK);

    const publishResp = await client.publishMonograph({
      name,
      namespace: 'default',
      schema: 'type Query { hello: String! }',
    });
    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    const monographRes = await client.getFederatedGraphByName({
      name,
      namespace: 'default',
    });
    expect(monographRes.response?.code).toBe(EnumStatusCode.OK);

    const subgraphSDL = await client.getLatestSubgraphSDL({
      name: monographRes.subgraphs[0].name,
      namespace: monographRes.subgraphs[0].namespace,
    });
    expect(subgraphSDL.response?.code).toBe(EnumStatusCode.OK);
    expect(subgraphSDL.sdl).toBe('type Query { hello: String! }');

    await server.close();
  });

  test('Migrate monograph removes internal label', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });

    const name = genID('mono');

    const createResp = await client.createMonograph({
      name,
      namespace: 'default',
      graphUrl: 'http://localhost:4000',
      routingUrl: 'http://localhost:3002',
    });
    expect(createResp.response?.code).toBe(EnumStatusCode.OK);

    const migrateResp = await client.migrateMonograph({
      name,
      namespace: 'default',
    });
    expect(migrateResp.response?.code).toBe(EnumStatusCode.OK);

    const monographRes = await client.getFederatedGraphByName({
      name,
      namespace: 'default',
    });
    expect(monographRes.response?.code).toBe(EnumStatusCode.OK);
    expect(monographRes.graph?.labelMatchers.length).toBe(1);
    expect(monographRes.graph?.labelMatchers[0]).toContain('federated=');
    expect(monographRes.subgraphs.length).toBe(1);
    expect(monographRes.subgraphs[0].labels.length).toBe(1);
    expect(monographRes.subgraphs[0].labels[0].key).toBe('federated');

    await server.close();
  });

  test('Lists monographs and federated graphs correctly', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });

    const monographName = genID('mono');
    const fedGraph1Name = genID('fedGraph1');
    const fedGraph2Name = genID('fedGraph2');
    const label = genUniqueLabel('label');

    const createResp = await client.createMonograph({
      name: monographName,
      namespace: 'default',
      graphUrl: 'http://localhost:4000',
      routingUrl: 'http://localhost:3002',
    });
    expect(createResp.response?.code).toBe(EnumStatusCode.OK);

    await createFederatedGraph(client, fedGraph1Name, 'default', [joinLabel(label)], 'http://localhost:8080');
    await createFederatedGraph(client, fedGraph2Name, 'default', [joinLabel(label)], 'http://localhost:8081');

    const graphsRes = await client.getFederatedGraphs({
      namespace: 'default',
    });
    expect(graphsRes.response?.code).toBe(EnumStatusCode.OK);
    expect(graphsRes.graphs.length).toBe(3);

    const fedGraphsRes = await client.getFederatedGraphs({
      namespace: 'default',
      supportsFederation: true,
    });
    expect(fedGraphsRes.response?.code).toBe(EnumStatusCode.OK);
    expect(fedGraphsRes.graphs.length).toBe(2);
    expect(fedGraphsRes.graphs.map((g) => g.name)).toContain(fedGraph1Name);
    expect(fedGraphsRes.graphs.map((g) => g.name)).toContain(fedGraph2Name);

    const monographsRes = await client.getFederatedGraphs({
      namespace: 'default',
      supportsFederation: false,
    });
    expect(monographsRes.response?.code).toBe(EnumStatusCode.OK);
    expect(monographsRes.graphs.length).toBe(1);
    expect(monographsRes.graphs.map((g) => g.name)).toContain(monographName);

    await server.close();
  });

  test('Federated graph commands do not modify monograph', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });

    const monographName = genID('mono');

    const createResp = await client.createMonograph({
      name: monographName,
      namespace: 'default',
      graphUrl: 'http://localhost:4000',
      routingUrl: 'http://localhost:3002',
    });
    expect(createResp.response?.code).toBe(EnumStatusCode.OK);

    const deleteRes = await client.deleteFederatedGraph({
      name: monographName,
    });
    expect(deleteRes.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

    const res = await client.createNamespace({
      name: 'prod',
    });
    expect(res.response?.code).toBe(EnumStatusCode.OK);

    const moveRes = await client.moveFederatedGraph({
      name: monographName,
      namespace: 'default',
      newNamespace: 'prod',
    });
    expect(moveRes.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

    const updateRes = await client.updateFederatedGraph({
      name: monographName,
      namespace: 'default',
      labelMatchers: ['federate=123'],
    });
    expect(updateRes.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

    await server.close();
  });

  test('Monograph commands do not modify federated graph', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });

    const fedName = genID('fed1');
    const label = genUniqueLabel('label');

    await createFederatedGraph(client, fedName, 'default', [joinLabel(label)], 'http://localhost:8080');

    const deleteRes = await client.deleteMonograph({
      name: fedName,
    });
    expect(deleteRes.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

    const res = await client.createNamespace({
      name: 'prod',
    });
    expect(res.response?.code).toBe(EnumStatusCode.OK);

    const moveRes = await client.moveMonograph({
      name: fedName,
      namespace: 'default',
      newNamespace: 'prod',
    });
    expect(moveRes.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

    const updateRes = await client.updateMonograph({
      name: fedName,
      namespace: 'default',
      routingUrl: 'http://localhoust:4003',
    });
    expect(updateRes.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

    const migrateRes = await client.migrateMonograph({
      name: fedName,
      namespace: 'default',
    });
    expect(migrateRes.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

    const publishRes = await client.publishMonograph({
      name: fedName,
      namespace: 'default',
      schema: 'type Query { hello: String! }',
    });
    expect(publishRes.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

    await server.close();
  });
});
