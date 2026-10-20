import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { eq } from 'drizzle-orm';
import { afterAllSetup, beforeAllSetup, genID } from '../../src/core/test-util.js';
import * as schema from '../../src/db/schema.js';
import {
  createAndPublishSubgraph,
  createFeatureFlag,
  createFederatedGraph,
  createThenPublishFeatureSubgraph,
  DEFAULT_NAMESPACE,
  DEFAULT_ROUTER_URL,
  DEFAULT_SUBGRAPH_URL_ONE,
  getDebugTestOptions,
  SetupTest,
  readBlob,
} from '../test-util.js';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';

// Change to true to enable a longer timeout
const isDebugMode = false;
let dbname = '';

const baseSchema = `type Query { users: [User!]! } type User @key(fields: "id") { id: ID! email: String! }`;
const sdl = (probe: string) =>
  `type Query { users: [User!]! ${probe}: Boolean } type User @key(fields: "id") { id: ID! email: String! }`;

vi.mock('../../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

describe('Concurrent feature subgraph publish tests', () => {
  let chClient: ClickHouseClient;

  beforeEach(() => {
    chClient = new ClickHouseClient();
  });
  afterEach(() => vi.restoreAllMocks());
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });
  afterAll(() => afterAllSetup(dbname));

  test(
    'that concurrent feature subgraph publishes keep the uploaded mapper in sync with the database',
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

      const labels = [{ key: 'team', value: 'A' }];
      const baseSubgraphName = genID('users');
      await createAndPublishSubgraph(
        client,
        baseSubgraphName,
        DEFAULT_NAMESPACE,
        baseSchema,
        labels,
        DEFAULT_SUBGRAPH_URL_ONE,
      );

      const federatedGraphName = genID('fedGraph');
      await createFederatedGraph(client, federatedGraphName, DEFAULT_NAMESPACE, ['team=A'], DEFAULT_ROUTER_URL);

      // Create multiple subgraphs to test concurrent subgraph publish
      const featureSubgraphNames = ['a', 'b', 'c', 'd', 'e'].map((suffix) => genID(`users-feature-${suffix}`));
      const featureFlagNames: string[] = [];
      for (const [index, featureSubgraphName] of featureSubgraphNames.entries()) {
        await createThenPublishFeatureSubgraph(
          client,
          featureSubgraphName,
          baseSubgraphName,
          DEFAULT_NAMESPACE,
          sdl(`probe_0_${index}`),
          labels,
          `http://localhost:${4100 + index}`,
        );

        const featureFlagName = genID('flag');
        await createFeatureFlag(client, featureFlagName, labels, [featureSubgraphName], DEFAULT_NAMESPACE, true);
        featureFlagNames.push(featureFlagName);
      }

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
        expect(Object.keys(mapper)).toHaveLength(6); // base graph + 5 feature flags

        const hashesInDatabase = await server.db
          .select({ hash: schema.routerConfigHash.hash, featureFlagName: schema.featureFlags.name })
          .from(schema.routerConfigHash)
          .leftJoin(schema.featureFlags, eq(schema.featureFlags.id, schema.routerConfigHash.featureFlagId))
          .where(eq(schema.routerConfigHash.federatedGraphId, federatedGraphId))
          .execute();

        const expectedMapper: Record<string, string> = {};
        for (const row of hashesInDatabase) {
          expectedMapper[row.featureFlagName ?? ''] = row.hash;
        }

        // The base graph plus one entry per feature flag
        expect(Object.keys(expectedMapper).sort()).toStrictEqual(['', ...featureFlagNames].sort());

        // The mapper uploaded to the CDN must reflect the router config hashes stored in the database
        expect(mapper, `mapper.json is out of sync with router_config_hash after iteration ${iteration}`).toStrictEqual(
          expectedMapper,
        );

        // ...and every hash must belong to the router config actually uploaded for that entry
        for (const [featureFlagName, hash] of Object.entries(mapper)) {
          const key =
            featureFlagName === ''
              ? `${manifestPath}/latest.json`
              : `${manifestPath}/feature-flags/${featureFlagName}.json`;

          const routerConfig = await readBlob(blobStorage, key);
          const routerConfigHash = createHash('sha256').update(routerConfig).digest('hex');
          expect(hash, `mapper.json does not match ${key} after iteration ${iteration}`).toBe(routerConfigHash);
        }
      };

      await assertMapperMatchesDatabase(0);

      for (let iteration = 1; iteration <= 10; iteration++) {
        const responses = await Promise.all(
          featureSubgraphNames.map((name, index) =>
            client.publishFederatedSubgraph({
              name,
              namespace: DEFAULT_NAMESPACE,
              schema: sdl(`probe_${iteration}_${index}`),
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
