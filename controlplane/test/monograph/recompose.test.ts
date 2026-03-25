import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';
import { afterAllSetup, beforeAllSetup, genID } from '../../src/core/test-util.js';
import { assertNumberOfCompositions, createNamespace, SetupTest } from '../test-util.js';

describe('monograph recompose tests', () => {
  let chClient: ClickHouseClient;
  let dbname = '';

  vi.mock('../../src/core/clickhouse/index.js', () => {
    const ClickHouseClient = vi.fn();
    ClickHouseClient.prototype.queryPromise = vi.fn();

    return { ClickHouseClient };
  });

  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  beforeEach(() => {
    chClient = new ClickHouseClient();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('that recomposing a published monograph succeeds and triggers a new composition', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const namespace = genID('namespace').toLowerCase();
    await createNamespace(client, namespace);
    const monographName = genID('monograph');
    const schemaSDL = 'type Query { hello: String! }';

    const createMonographResponse = await client.createMonograph({
      name: monographName,
      namespace,
      graphUrl: 'http://localhost:4000',
      routingUrl: 'http://localhost:3002',
    });
    expect(createMonographResponse.response?.code).toBe(EnumStatusCode.OK);

    const publishMonographResponse = await client.publishMonograph({
      name: monographName,
      namespace,
      schema: schemaSDL,
    });
    expect(publishMonographResponse.response?.code).toBe(EnumStatusCode.OK);

    await assertNumberOfCompositions(client, monographName, 1, namespace);

    const response = await client.recomposeGraph({
      name: monographName,
      namespace,
      isMonograph: true,
    });

    expect(response.response).toBeDefined();
    expect(response.response!.code).toBe(EnumStatusCode.OK);
    expect(response.compositionErrors).toHaveLength(0);
    expect(response.deploymentErrors).toHaveLength(0);

    await assertNumberOfCompositions(client, monographName, 2, namespace);
  });
});
