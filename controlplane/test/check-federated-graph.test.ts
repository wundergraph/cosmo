import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { allExternalFieldInstancesError, noBaseDefinitionForExtensionError, OBJECT } from '@wundergraph/composition';
import { afterAllSetup, beforeAllSetup, genID } from '../src/core/test-util.js';
import { ClickHouseClient } from '../src/core/clickhouse/index.js';
import { DEFAULT_NAMESPACE, SetupTest } from './test-util.js';

let dbname = '';

vi.mock('../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

describe('CheckFederatedGraph', (ctx) => {
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

  test('Should be able to create a federated graph, subgraphs, publish the schema and then check the graph for composition errors', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const federatedGraphName = genID('fedGraph');

    const pandasSchemaBuffer = await readFile(join(process.cwd(), 'test/graphql/federationV1/pandas.graphql'));
    const productsSchemaBuffer = await readFile(join(process.cwd(), 'test/graphql/federationV1/products.graphql'));
    const usersSchemaBuffer = await readFile(join(process.cwd(), 'test/graphql/federationV1/users.graphql'));

    const pandasSchema = new TextDecoder().decode(pandasSchemaBuffer);
    const productsSchema = new TextDecoder().decode(productsSchemaBuffer);
    const usersSchema = new TextDecoder().decode(usersSchemaBuffer);

    const createFederatedGraphResp = await client.createFederatedGraph({
      name: federatedGraphName,
      namespace: DEFAULT_NAMESPACE,
      labelMatchers: ['team=A'],
      routingUrl: 'http://localhost:8080',
    });
    expect(createFederatedGraphResp.response?.code).toBe(EnumStatusCode.OK);

    let resp = await client.createFederatedSubgraph({
      name: 'pandas',
      namespace: DEFAULT_NAMESPACE,
      labels: [{ key: 'team', value: 'A' }],
      routingUrl: 'http://localhost:8081',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    let publishResp = await client.publishFederatedSubgraph({
      name: 'pandas',
      namespace: DEFAULT_NAMESPACE,
      schema: pandasSchema,
    });

    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    resp = await client.createFederatedSubgraph({
      name: 'users',
      namespace: DEFAULT_NAMESPACE,
      labels: [{ key: 'team', value: 'A' }],
      routingUrl: 'http://localhost:8082',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    publishResp = await client.publishFederatedSubgraph({
      name: 'users',
      namespace: DEFAULT_NAMESPACE,
      schema: usersSchema,
    });

    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    resp = await client.createFederatedSubgraph({
      name: 'products',
      namespace: DEFAULT_NAMESPACE,
      labels: [{ key: 'team', value: 'B' }],
      routingUrl: 'http://localhost:8082',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    publishResp = await client.publishFederatedSubgraph({
      name: 'products',
      namespace: DEFAULT_NAMESPACE,
      schema: productsSchema,
    });

    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    let checkResp = await client.checkFederatedGraph({
      name: federatedGraphName,
      namespace: DEFAULT_NAMESPACE,
      labelMatchers: ['team=A'],
    });
    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResp.compositionErrors).toHaveLength(0);

    checkResp = await client.checkFederatedGraph({
      name: federatedGraphName,
      namespace: DEFAULT_NAMESPACE,
      labelMatchers: ['team=B'],
    });
    expect(checkResp.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);
    expect(checkResp.compositionErrors).toHaveLength(2);
    expect(checkResp.compositionErrors[0].message).toBe(noBaseDefinitionForExtensionError(OBJECT, 'User').message);
    expect(checkResp.compositionErrors[1].message).toBe(
      allExternalFieldInstancesError(
        'User',
        new Map<string, Array<string>>([
          ['email', ['products']],
          ['totalProductsCreated', ['products']],
        ]),
      ).message,
    );

    await server.close();
  });
});
