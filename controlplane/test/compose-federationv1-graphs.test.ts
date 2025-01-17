import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import * as prettier from 'prettier';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../src/core/test-util.js';
import { ClickHouseClient } from '../src/core/clickhouse/index.js';
import { SetupTest } from './test-util.js';

let dbname = '';

vi.mock('../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

describe('ComposeFederationV1Graphs', (ctx) => {
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

  test('Compose these federation v1 subgraph schemas', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const pandasSchemaBuffer = await readFile(join(process.cwd(), 'test/graphql/federationV1/pandas.graphql'));
    const productsSchemaBuffer = await readFile(join(process.cwd(), 'test/graphql/federationV1/products.graphql'));
    const inventorySchemaBuffer = await readFile(join(process.cwd(), 'test/graphql/federationV1/inventory.graphql'));
    const usersSchemaBuffer = await readFile(join(process.cwd(), 'test/graphql/federationV1/users.graphql'));

    const pandasSchema = new TextDecoder().decode(pandasSchemaBuffer);
    const productsSchema = new TextDecoder().decode(productsSchemaBuffer);
    const inventorySchema = new TextDecoder().decode(inventorySchemaBuffer);
    const usersSchema = new TextDecoder().decode(usersSchemaBuffer);

    const federatedGraphName = genID('fedGraph');
    const label = genUniqueLabel();

    const createFederatedGraphResp = await client.createFederatedGraph({
      name: federatedGraphName,
      namespace: 'default',
      labelMatchers: [joinLabel(label)],
      routingUrl: 'http://localhost:8081',
    });
    expect(createFederatedGraphResp.response?.code).toBe(EnumStatusCode.OK);

    let resp = await client.createFederatedSubgraph({
      name: 'pandas',
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8000',
    });
    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    let publishResp = await client.publishFederatedSubgraph({
      name: 'pandas',
      namespace: 'default',
      schema: pandasSchema,
    });
    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    resp = await client.createFederatedSubgraph({
      name: 'users',
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8002',
    });
    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    publishResp = await client.publishFederatedSubgraph({
      name: 'users',
      namespace: 'default',
      schema: usersSchema,
    });
    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    resp = await client.createFederatedSubgraph({
      name: 'products',
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8001',
    });
    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    publishResp = await client.publishFederatedSubgraph({
      name: 'products',
      namespace: 'default',
      schema: productsSchema,
    });
    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    resp = await client.createFederatedSubgraph({
      name: 'inventory',
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8002',
    });
    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    resp = await client.publishFederatedSubgraph({
      name: 'inventory',
      namespace: 'default',
      schema: inventorySchema,
    });
    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    const graph = await client.getFederatedGraphByName({
      name: federatedGraphName,
      namespace: 'default',
    });

    expect(graph.response?.code).toBe(EnumStatusCode.OK);
    expect(graph.graph?.compositionErrors).toBe('');
    expect(graph.graph?.isComposable).toBe(true);

    const fetchSchemaResp = await client.getFederatedGraphSDLByName({
      name: federatedGraphName,
      namespace: 'default',
    });
    expect(fetchSchemaResp.response?.code).toBe(EnumStatusCode.OK);

    const composedFederatedGraphSchema = await readFile(
      join(process.cwd(), 'test/graphql/federationV1/composedFederatedV1Graph.graphql'),
      { encoding: 'utf8' },
    );
    let formattedFederatedSchemaSDL = '';
    if (fetchSchemaResp.sdl) {
      formattedFederatedSchemaSDL = await prettier.format(fetchSchemaResp.sdl, {
        parser: 'graphql',
      });
    }
    expect(formattedFederatedSchemaSDL).toBe(composedFederatedGraphSchema);

    await server.close();
  });
});
