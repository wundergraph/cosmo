import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { and, eq, isNull } from 'drizzle-orm';
import { afterAllSetup, beforeAllSetup, genID } from '../../src/core/test-util.js';
import * as schema from '../../src/db/schema.js';
import {
  createAndPublishSubgraph,
  createFederatedGraph,
  DEFAULT_NAMESPACE,
  DEFAULT_ROUTER_URL,
  getDebugTestOptions,
  SetupTest,
  readBlob,
} from '../test-util.js';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';

// Change to true to enable a longer timeout
const isDebugMode = false;
let dbname = '';

const sdl = (index: number, probe: string) => `type Query { field_${index}: String! ${probe}: Boolean }`;

vi.mock('../../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

describe('Concurrent subgraph publish tests', () => {
  let chClient: ClickHouseClient;

  beforeEach(() => {
    chClient = new ClickHouseClient();
  });
  afterEach(() => vi.clearAllMocks());
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });
  afterAll(() => afterAllSetup(dbname));

  test(
    'that concurrent subgraph publishes keep the uploaded mapper in sync with the database',
    { timeout: 60_000, ...getDebugTestOptions(isDebugMode) },
    async (testContext) => {
      const { client, server, blobStorage, users } = await SetupTest({
        dbname,
        chClient,
        enabledFeatures: ['split-config-loading'],
      });
      testContext.onTestFinished(() => server.close());

      // Simulate latency for the mapper upload.
      // This widens the window between reading the router config hashes from the database and writing the mapper,
      // so a request that reads stale hashes can overwrite the mapper written by a request that reads newer ones.
      const originalPutObject = blobStorage.putObject.bind(blobStorage);
      vi.spyOn(blobStorage, 'putObject').mockImplementation(async (data) => {
        if (data.key.endsWith('/mapper.json')) {
          await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 50)));
        }

        return originalPutObject(data);
      });

      // Create multiple subgraphs to test concurrent subgraph publish
      const labels = [{ key: 'team', value: 'A' }];
      const subgraphNames = ['a', 'b', 'c', 'd', 'e'].map((suffix) => genID(`subgraph-${suffix}`));
      for (const [index, subgraphName] of subgraphNames.entries()) {
        await createAndPublishSubgraph(
          client,
          subgraphName,
          DEFAULT_NAMESPACE,
          sdl(index, 'probe_0'),
          labels,
          `http://localhost:${4100 + index}`,
        );
      }

      const federatedGraphName = genID('fedGraph');
      await createFederatedGraph(client, federatedGraphName, DEFAULT_NAMESPACE, ['team=A'], DEFAULT_ROUTER_URL);

      const graphResponse = await client.getFederatedGraphByName({
        name: federatedGraphName,
        namespace: DEFAULT_NAMESPACE,
      });

      expect(graphResponse.response?.code).toBe(EnumStatusCode.OK);

      const federatedGraphId = graphResponse.graph!.id;
      const manifestPath = `${users.adminAliceCompanyA.organizationId}/${federatedGraphId}/manifest`;
      const assertMapperMatchesDatabase = async (iteration: number) => {
        const mapperJson = await readBlob(blobStorage, `${manifestPath}/mapper.json`);
        const mapper: Record<string, string> = JSON.parse(mapperJson);
        expect(mapper).toBeDefined();
        expect(mapper['']).toBeDefined();

        const [{ hash }] = await server.db
          .select({ hash: schema.routerConfigHash.hash })
          .from(schema.routerConfigHash)
          .where(
            and(
              eq(schema.routerConfigHash.federatedGraphId, federatedGraphId),
              isNull(schema.routerConfigHash.featureFlagId),
            ),
          )
          .execute();

        // The mapper uploaded to the CDN must reflect the router config hashes stored in the database
        expect(
          mapper[''],
          `mapper.json is out of sync with router_config_hash after iteration ${iteration}`,
        ).toStrictEqual(hash);

        // ...and the hash must belong to the router config that was actually uploaded
        const latestRouterConfig = await readBlob(blobStorage, `${manifestPath}/latest.json`);
        const latestHash = createHash('sha256').update(latestRouterConfig).digest('hex');
        expect(mapper[''], `mapper.json does not match latest.json after iteration ${iteration}`).toBe(latestHash);
      };

      await assertMapperMatchesDatabase(0);

      for (let iteration = 1; iteration <= 10; iteration++) {
        const responses = await Promise.all(
          subgraphNames.map((name, index) =>
            client.publishFederatedSubgraph({
              name,
              namespace: DEFAULT_NAMESPACE,
              schema: sdl(index, `probe_${iteration}`),
            }),
          ),
        );

        for (const response of responses) {
          expect(response.response?.code).toBe(EnumStatusCode.OK);
        }

        await assertMapperMatchesDatabase(iteration);
      }
    },
  );
});
