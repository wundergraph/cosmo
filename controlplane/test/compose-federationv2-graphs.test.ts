import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as prettier from 'prettier';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../src/core/test-util.js';
import { ClickHouseClient } from '../src/core/clickhouse/index.js';
import { SetupTest } from './test-util.js';

let dbname = '';

vi.mock('../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

describe('ComposeFederationV2Graphs', (ctx) => {
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

  test('Compose these federation v2 subgraph schemas(pandas, products, reviews, users)', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const pandasSchemaBuffer = await readFile(join(process.cwd(), 'test/graphql/federationV2/pandas.graphql'));
    const productsSchemaBuffer = await readFile(join(process.cwd(), 'test/graphql/federationV2/products.graphql'));
    const reviewsSchemaBuffer = await readFile(join(process.cwd(), 'test/graphql/federationV2/reviews.graphql'));
    const usersSchemaBuffer = await readFile(join(process.cwd(), 'test/graphql/federationV2/users.graphql'));

    const pandasSchema = new TextDecoder().decode(pandasSchemaBuffer);
    const productsSchema = new TextDecoder().decode(productsSchemaBuffer);
    const reviewsSchema = new TextDecoder().decode(reviewsSchemaBuffer);
    const usersSchema = new TextDecoder().decode(usersSchemaBuffer);

    const federatedGraphName = genID();
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

    resp = await client.publishFederatedSubgraph({
      name: 'pandas',
      namespace: 'default',
      schema: pandasSchema,
    });
    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    resp = await client.createFederatedSubgraph({
      name: 'products',
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8001',
    });
    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    resp = await client.publishFederatedSubgraph({
      name: 'products',
      namespace: 'default',
      schema: productsSchema,
    });
    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    resp = await client.createFederatedSubgraph({
      name: 'reviews',
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8002',
    });
    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    resp = await client.publishFederatedSubgraph({
      name: 'reviews',
      namespace: 'default',
      schema: reviewsSchema,
    });
    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    resp = await client.createFederatedSubgraph({
      name: 'users',
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8002',
    });
    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    resp = await client.publishFederatedSubgraph({
      name: 'users',
      namespace: 'default',
      schema: usersSchema,
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
      join(process.cwd(), 'test/graphql/federationV2/composedFederatedV2Graph.graphql'),
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
