import fs from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { addMinutes, formatISO, subDays } from 'date-fns';
import { afterAllSetup, beforeAllSetup, genID } from '../../src/core/test-util.js';
import { Label } from '../../src/types/index.js';
import {
  createFeatureFlag,
  createNamespace,
  featureFlagIntegrationTestSetUp,
  getDebugTestOptions,
  SetupTest,
} from '../test-util.js';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';

// Change to true to enable a longer timeout
const isDebugMode = false;
let dbname = '';

describe('getCompositions tests', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test(
    'that the name of the subgraph that triggered a composition is correct',
    getDebugTestOptions(isDebugMode),
    async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      const namespace = genID('namespace').toLowerCase();
      const labels: Label[] = [];
      const graphName = genID('federated-graph');

      await createNamespace(client, namespace);
      await featureFlagIntegrationTestSetUp(
        client,
        [{ name: 'users', hasFeatureSubgraph: false }],
        graphName,
        labels,
        namespace,
      );

      const updateSubgraphResp = await client.publishFederatedSubgraph({
        name: 'users',
        namespace,
        schema: fs.readFileSync(join(process.cwd(), `test/test-data/feature-flags/users-update.graphql`)).toString(),
      });

      expect(updateSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

      const compositionsResp = await client.getCompositions({
        fedGraphName: graphName,
        namespace,
        startDate: formatISO(subDays(new Date(), 1)),
        endDate: formatISO(addMinutes(new Date(), 1)),
        excludeFeatureFlagCompositions: true,
      });

      expect(compositionsResp.response?.code).toBe(EnumStatusCode.OK);
      expect(compositionsResp.count).toBe(2);
      expect(compositionsResp.compositions).toEqual([
        expect.objectContaining({ hasMultipleChangedSubgraphs: false, triggeredBySubgraphName: 'users' }),
        expect.objectContaining({ hasMultipleChangedSubgraphs: false, triggeredBySubgraphName: 'users' }),
      ]);
    },
  );

  test(
    'that the name of a feature subgraph that triggered a composition is correct',
    getDebugTestOptions(isDebugMode),
    async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      const namespace = genID('namespace').toLowerCase();
      const labels: Label[] = [];
      const baseGraphName = genID('baseFederatedGraphName');
      const ffName = genID('feature-flag');

      await createNamespace(client, namespace);
      await featureFlagIntegrationTestSetUp(
        client,
        [
          { name: 'users', hasFeatureSubgraph: true },
          { name: 'products-standalone', hasFeatureSubgraph: true },
        ],
        baseGraphName,
        labels,
        namespace,
      );

      await createFeatureFlag(client, ffName, labels, ['products-standalone-feature'], namespace, true);

      const updateSubgraphResp = await client.publishFederatedSubgraph({
        name: 'products-standalone-feature',
        namespace,
        schema: fs
          .readFileSync(join(process.cwd(), `test/test-data/feature-flags/products-standalone-update.graphql`))
          .toString(),
      });

      expect(updateSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

      const compositionsResp = await client.getCompositions({
        fedGraphName: baseGraphName,
        namespace,
        startDate: formatISO(subDays(new Date(), 1)),
        endDate: formatISO(addMinutes(new Date(), 1)),
        excludeFeatureFlagCompositions: true,
      });

      /**
       * We expect the base composition plus two new compositions:
       *   - The feature flag was created with the `products-standalone-feature` subgraph
       *   - The feature subgraph `products-standalone-feature` was updated
       */
      expect(compositionsResp.response?.code).toBe(EnumStatusCode.OK);
      expect(compositionsResp.count).toBe(3);
      expect(compositionsResp.compositions).toEqual([
        expect.objectContaining({
          hasMultipleChangedSubgraphs: false,
          triggeredBySubgraphName: 'products-standalone-feature',
        }),
        expect.objectContaining({
          hasMultipleChangedSubgraphs: false,
          triggeredBySubgraphName: 'products-standalone-feature',
        }),
        // Base composition should have been triggered by multiple subgraphs: `users` and `products-standalone`
        expect.objectContaining({ hasMultipleChangedSubgraphs: true }),
      ]);
    },
  );
});
