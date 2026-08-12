import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel, routerConfigFromJsonString } from '@wundergraph/cosmo-shared';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../src/core/test-util.js';
import {
  createFederatedGraph,
  createThenPublishSubgraph,
  DEFAULT_NAMESPACE,
  DEFAULT_ROUTER_URL,
  DEFAULT_SUBGRAPH_URL_ONE,
  SetupTest,
} from './test-util.js';

let dbname = '';

describe('Prompt to Query RPC', () => {
  const yokoURL = 'http://yoko.test';
  const mockServer = setupServer();

  beforeAll(async () => {
    mockServer.listen({ onUnhandledRequest: 'bypass' });
    dbname = await beforeAllSetup();
  });
  afterEach(() => mockServer.resetHandlers());
  afterAll(async () => {
    mockServer.close();
    await afterAllSetup(dbname);
  });

  test("resolves the router schema version and generates a query with Yoko's index ID", async (testContext) => {
    const ensureIndexRequests: unknown[] = [];
    let generateQueryRequest: unknown;
    mockServer.use(
      http.post(`${yokoURL}/yoko.v1.YokoService/EnsureIndex`, async ({ request }) => {
        ensureIndexRequests.push(await request.json());
        return HttpResponse.json({ indexId: 'opaque-yoko-index-id' });
      }),
      http.post(`${yokoURL}/yoko.v1.YokoService/GenerateQuery`, async ({ request }) => {
        generateQueryRequest = await request.json();
        return HttpResponse.json({
          resolution: {
            queries: [
              {
                description: 'Returns hello',
                document: 'query GetHello { hello }',
                operationName: 'GetHello',
                operationType: 'query',
                variablesSchema: '{}',
              },
            ],
            unsatisfied: [],
          },
        });
      }),
    );

    const { client, nodeClient, server, users, blobStorage } = await SetupTest({
      dbname,
      enabledFeatures: ['prompt-to-query'],
      promptToQueryServiceAddress: yokoURL,
    });
    testContext.onTestFinished(() => server.close());

    const subgraphName = genID('subgraph');
    const graphName = genID('graph');
    const label = genUniqueLabel();
    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      'type Query { hello: String! }',
      [label],
      DEFAULT_SUBGRAPH_URL_ONE,
    );
    await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [joinLabel(label)], DEFAULT_ROUTER_URL);

    const graphResponse = await client.getFederatedGraphByName({ name: graphName, namespace: DEFAULT_NAMESPACE });
    expect(graphResponse.response?.code).toBe(EnumStatusCode.OK);
    const tokenResponse = await client.generateRouterToken({ fedGraphName: graphName, namespace: DEFAULT_NAMESPACE });
    expect(tokenResponse.response?.code).toBe(EnumStatusCode.OK);

    const configBlob = await blobStorage.getObject({
      key: `${users.adminAliceCompanyA.organizationId}/${graphResponse.graph?.id}/routerconfigs/latest.json`,
    });
    const config = routerConfigFromJsonString(await new Response(configBlob.stream).text());
    const response = await nodeClient.generateQuery(
      {
        version: config?.version,
        prompt: 'Return hello',
      },
      { headers: { Authorization: `Bearer ${tokenResponse.token}` } },
    );

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.query?.operationName).toBe('GetHello');
    expect(ensureIndexRequests.at(-1)).toEqual({ sdl: config?.engineConfig?.graphqlSchema });
    expect(generateQueryRequest).toEqual({ indexId: 'opaque-yoko-index-id', prompt: 'Return hello' });
  });
});
