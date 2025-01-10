import crypto from 'node:crypto';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../src/core/test-util.js';
import { ClickHouseClient } from '../src/core/clickhouse/index.js';
import { createThenPublishSubgraph, DEFAULT_NAMESPACE, SetupTest } from './test-util.js';

let dbname = '';

vi.mock('../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

describe('Admission Webhook', (ctx) => {
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

  test('Ensure headers reach the webhook endpoint', async (textContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const admissionWebhookURL = `https://${genID()}`;

    const mockServer = setupServer(
      http.post(`${admissionWebhookURL}/validate-config`, async ({ request }) => {
        const receivedSignature = request.headers.get('x-cosmo-signature-256');
        expect(receivedSignature).toBeDefined();

        const body = await request.json();
        const computedSignature = crypto.createHmac('sha256', 'test').update(JSON.stringify(body)).digest('hex');

        expect(computedSignature).toEqual(receivedSignature);

        return HttpResponse.json({
          signatureSha256: 'dummy',
        });
      }),
    );
    mockServer.listen({ onUnhandledRequest: 'bypass' });

    const subgraphName = genID('subgraph');
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel();

    const subgraphSchemaSDL = 'type Query { hello: String! }';

    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      subgraphSchemaSDL,
      [label],
      'http://localhost:8082',
    );

    const res = await client.createFederatedGraph({
      name: fedGraphName,
      namespace: 'default',
      routingUrl: 'http://localhost:8080',
      labelMatchers: [joinLabel(label)],
      admissionWebhookURL,
      admissionWebhookSecret: 'test',
    });
    expect(res.response?.code).toBe(EnumStatusCode.OK);

    expect(mockServer.listHandlers()[0].isUsed).toBe(true);

    mockServer.resetHandlers();
    mockServer.close();

    await server.close();
  });
});
