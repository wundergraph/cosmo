import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../../src/core/test-util.js';
import {
  assertNumberOfCompositions,
  createFederatedGraph,
  createNamespace,
  createThenPublishSubgraph,
  SetupTest,
} from '../test-util.js';

describe('federated-graph recompose tests', () => {
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

  test('that recomposing a published federated graph succeeds and triggers a new composition', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const namespace = genID('namespace').toLowerCase();
    await createNamespace(client, namespace);
    const subgraphName = genID('subgraph');
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel('label');
    const subgraphSchemaSDL = 'type Query { hello: String! }';

    await createThenPublishSubgraph(
      client,
      subgraphName,
      namespace,
      subgraphSchemaSDL,
      [label],
      'http://localhost:8082',
    );

    await createFederatedGraph(client, fedGraphName, namespace, [joinLabel(label)], 'http://localhost:8080');
    await assertNumberOfCompositions(client, fedGraphName, 1, namespace);

    const response = await client.recomposeGraph({
      name: fedGraphName,
      namespace,
      isMonograph: false,
    });

    expect(response.response).toBeDefined();
    expect(response.response!.code).toBe(EnumStatusCode.OK);
    expect(response.compositionErrors).toHaveLength(0);
    expect(response.deploymentErrors).toHaveLength(0);

    await assertNumberOfCompositions(client, fedGraphName, 2, namespace);
  });
});
