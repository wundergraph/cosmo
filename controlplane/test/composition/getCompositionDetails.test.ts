import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { join } from 'node:path';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { addMinutes, formatISO, subDays } from 'date-fns';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../../src/core/test-util.js';
import {
  createFeatureFlag,
  createFederatedGraph,
  createNamespace,
  createThenPublishSubgraph,
  DEFAULT_NAMESPACE,
  featureFlagIntegrationTestSetUp,
  getDebugTestOptions,
  SetupTest,
} from '../test-util.js';
import { Label } from '../../src/types/index.js';

let dbname = '';
const isDebugMode = false;

describe('getCompositionDetails', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('should return composition details for a valid composition', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const subgraphName = genID('subgraph');
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel('label');
    const subgraphSchemaSDL = 'type Query { hello: String! }';

    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      subgraphSchemaSDL,
      [label],
      'http://localhost:8082',
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:8080');

    const compositionsRes = await client.getCompositions({
      fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      startDate: formatISO(subDays(new Date(), 1)),
      endDate: formatISO(addMinutes(new Date(), 1)),
    });
    expect(compositionsRes.response?.code).toBe(EnumStatusCode.OK);
    expect(compositionsRes.compositions.length).toBe(1);

    const compositionId = compositionsRes.compositions[0].id;

    const detailsRes = await client.getCompositionDetails({
      compositionId,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(detailsRes.response?.code).toBe(EnumStatusCode.OK);
    expect(detailsRes.composition).toBeDefined();
    expect(detailsRes.composition?.id).toBe(compositionId);
    expect(detailsRes.compositionSubgraphs).toBeDefined();
    expect(detailsRes.compositionSubgraphs.length).toBe(1);
    expect(detailsRes.changeCounts).toBeDefined();
  });

  test('should return not found error for non-existent composition', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const nonExistentId = randomUUID();
    const detailsRes = await client.getCompositionDetails({
      compositionId: nonExistentId,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(detailsRes.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(detailsRes.response?.details).toBe(`Graph composition with '${nonExistentId}' does not exist`);
  });

  test('should return not found error for non-existent namespace', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const detailsRes = await client.getCompositionDetails({
      compositionId: randomUUID(),
      namespace: 'non-existent-namespace',
    });

    expect(detailsRes.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(detailsRes.response?.details).toBe("Namespace 'non-existent-namespace' not found");
  });

  test('should not allow access to compositions from different organization', async (testContext) => {
    const { client, server, authenticator, users } = await SetupTest({
      dbname,
      enableMultiUsers: true,
    });
    testContext.onTestFinished(() => server.close());

    // Create a composition as Company A
    const subgraphName = genID('subgraph');
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel('label');
    const subgraphSchemaSDL = 'type Query { hello: String! }';

    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      subgraphSchemaSDL,
      [label],
      'http://localhost:8082',
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:8080');

    const compositionsRes = await client.getCompositions({
      fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      startDate: formatISO(subDays(new Date(), 1)),
      endDate: formatISO(addMinutes(new Date(), 1)),
    });
    expect(compositionsRes.response?.code).toBe(EnumStatusCode.OK);
    expect(compositionsRes.compositions.length).toBe(1);

    const compositionId = compositionsRes.compositions[0].id;

    // Switch to Company B user
    if (!users.adminJimCompanyB) {
      throw new Error('adminJimCompanyB user not found');
    }
    authenticator.changeUserWithSuppliedContext(users.adminJimCompanyB);

    // Try to access Company A's composition
    const detailsRes = await client.getCompositionDetails({
      compositionId,
      namespace: DEFAULT_NAMESPACE,
    });

    // Should return not found (since it filters by organization)
    expect(detailsRes.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
  });

  test('should include composition subgraphs information', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const subgraph1Name = genID('subgraph1');
    const subgraph2Name = genID('subgraph2');
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel('label');
    const subgraphSchemaSDL = 'type Query { hello: String! }';

    // Create multiple subgraphs
    await createThenPublishSubgraph(
      client,
      subgraph1Name,
      DEFAULT_NAMESPACE,
      subgraphSchemaSDL,
      [label],
      'http://localhost:8082',
    );

    await createThenPublishSubgraph(
      client,
      subgraph2Name,
      DEFAULT_NAMESPACE,
      'type Query { world: String! }',
      [label],
      'http://localhost:8083',
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:8080');

    const compositionsRes = await client.getCompositions({
      fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      startDate: formatISO(subDays(new Date(), 1)),
      endDate: formatISO(addMinutes(new Date(), 1)),
    });
    expect(compositionsRes.response?.code).toBe(EnumStatusCode.OK);

    const compositionId = compositionsRes.compositions[0].id;

    const detailsRes = await client.getCompositionDetails({
      compositionId,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(detailsRes.response?.code).toBe(EnumStatusCode.OK);
    expect(detailsRes.compositionSubgraphs).toBeDefined();
    expect(detailsRes.compositionSubgraphs.length).toBe(2);

    // Verify subgraph information is present
    const subgraphNames = detailsRes.compositionSubgraphs.map((sg) => sg.name);
    expect(subgraphNames).toContain(subgraph1Name);
    expect(subgraphNames).toContain(subgraph2Name);
  });

  test('should return empty feature flag compositions when none exist', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const subgraphName = genID('subgraph');
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel('label');
    const subgraphSchemaSDL = 'type Query { hello: String! }';

    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      subgraphSchemaSDL,
      [label],
      'http://localhost:8082',
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:8080');

    const compositionsRes = await client.getCompositions({
      fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      startDate: formatISO(subDays(new Date(), 1)),
      endDate: formatISO(addMinutes(new Date(), 1)),
    });
    expect(compositionsRes.response?.code).toBe(EnumStatusCode.OK);

    const compositionId = compositionsRes.compositions[0].id;

    const detailsRes = await client.getCompositionDetails({
      compositionId,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(detailsRes.response?.code).toBe(EnumStatusCode.OK);
    expect(detailsRes.featureFlagCompositions).toBeDefined();
    expect(detailsRes.featureFlagCompositions).toEqual([]);
  });

  test(
    'that the correct subgraphs are marked as added and updated in composition details when split config loading is disabled',
    getDebugTestOptions(isDebugMode),
    async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      const namespace = genID('namespace').toLowerCase();
      const labels: Label[] = [];
      const graphName = genID('fed-graph');

      await createNamespace(client, namespace);
      await featureFlagIntegrationTestSetUp(
        client,
        [
          { name: 'users', hasFeatureSubgraph: false },
          { name: 'products-standalone', hasFeatureSubgraph: false },
        ],
        graphName,
        labels,
        namespace,
      );

      const updateSubgraphResp = await client.publishFederatedSubgraph({
        name: 'products-standalone',
        namespace,
        schema: fs
          .readFileSync(join(process.cwd(), `test/test-data/feature-flags/products-standalone-update.graphql`))
          .toString(),
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
      expect(compositionsResp.compositions).toHaveLength(2);

      // Only the `products-standalone` subgraph should be updated on the latest composition
      let compositionResp = await client.getCompositionDetails({
        compositionId: compositionsResp.compositions[0].id,
        namespace,
      });

      expect(compositionResp.response?.code).toBe(EnumStatusCode.OK);
      expect(compositionResp.composition).toBeDefined();
      expect(compositionResp.compositionSubgraphs).toHaveLength(2);
      expect(compositionResp.featureFlagCompositions).toHaveLength(0);
      expect(compositionResp.composition?.isFeatureFlagComposition).toBe(false);

      expect(compositionResp.compositionSubgraphs).toEqual([
        expect.objectContaining({ name: 'users', changeType: 'unchanged' }),
        expect.objectContaining({ name: 'products-standalone', changeType: 'updated' }),
      ]);

      // Both subgraphs should be added on the first composition
      compositionResp = await client.getCompositionDetails({
        compositionId: compositionsResp.compositions[1].id,
        namespace,
      });

      expect(compositionResp.response?.code).toBe(EnumStatusCode.OK);
      expect(compositionResp.composition).toBeDefined();
      expect(compositionResp.compositionSubgraphs).toHaveLength(2);
      expect(compositionResp.featureFlagCompositions).toHaveLength(0);
      expect(compositionResp.composition?.isFeatureFlagComposition).toBe(false);

      expect(compositionResp.compositionSubgraphs).toEqual([
        expect.objectContaining({ name: 'users', changeType: 'added' }),
        expect.objectContaining({ name: 'products-standalone', changeType: 'added' }),
      ]);
    },
  );

  test(
    'that the correct feature subgraphs are marked as added and updated in composition details when split config loading is disabled',
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

      expect(compositionsResp.response?.code).toBe(EnumStatusCode.OK);
      expect(compositionsResp.compositions).toHaveLength(3);

      // The latest composition should not have any changed subgraph as a feature subgraph was updated instead
      let compositionResp = await client.getCompositionDetails({
        compositionId: compositionsResp.compositions[0].id,
        namespace,
      });

      expect(compositionResp.response?.code).toBe(EnumStatusCode.OK);
      expect(compositionResp.composition).toBeDefined();
      expect(compositionResp.compositionSubgraphs).toHaveLength(2);
      expect(compositionResp.featureFlagCompositions).toHaveLength(1);
      expect(compositionResp.composition?.isFeatureFlagComposition).toBe(false);

      expect(compositionResp.compositionSubgraphs).toEqual([
        expect.objectContaining({ name: 'users', changeType: 'unchanged' }),
        expect.objectContaining({ name: 'products-standalone', changeType: 'unchanged' }),
      ]);

      // The feature flag composition should contain the updated feature subgraph plus the unchanged `users` subgraph
      compositionResp = await client.getCompositionDetails({
        compositionId: compositionResp.featureFlagCompositions[0].id,
        namespace,
      });

      expect(compositionResp.response?.code).toBe(EnumStatusCode.OK);
      expect(compositionResp.composition).toBeDefined();
      expect(compositionResp.compositionSubgraphs).toHaveLength(2);
      expect(compositionResp.featureFlagCompositions).toHaveLength(0);
      expect(compositionResp.composition?.isFeatureFlagComposition).toBe(true);

      expect(compositionResp.compositionSubgraphs).toEqual([
        expect.objectContaining({ name: 'users', changeType: 'unchanged' }),
        expect.objectContaining({ name: 'products-standalone-feature', changeType: 'updated' }),
      ]);
    },
  );

  test(
    'that the correct subgraphs are marked as added and updated in composition details when split config loading is enabled',
    getDebugTestOptions(isDebugMode),
    async (testContext) => {
      const { client, server } = await SetupTest({ dbname, enabledFeatures: ['split-config-loading'] });
      testContext.onTestFinished(() => server.close());

      const namespace = genID('namespace').toLowerCase();
      const labels: Label[] = [];
      const graphName = genID('fed-graph');

      await createNamespace(client, namespace);
      await featureFlagIntegrationTestSetUp(
        client,
        [
          { name: 'users', hasFeatureSubgraph: false },
          { name: 'products-standalone', hasFeatureSubgraph: false },
        ],
        graphName,
        labels,
        namespace,
      );

      const updateSubgraphResp = await client.publishFederatedSubgraph({
        name: 'products-standalone',
        namespace,
        schema: fs
          .readFileSync(join(process.cwd(), `test/test-data/feature-flags/products-standalone-update.graphql`))
          .toString(),
      });

      expect(updateSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

      const compositionsResp = await client.getCompositions({
        fedGraphName: graphName,
        namespace,
        startDate: formatISO(subDays(new Date(), 1)),
        endDate: formatISO(addMinutes(new Date(), 1)),
        excludeFeatureFlagCompositions: false,
      });

      expect(compositionsResp.response?.code).toBe(EnumStatusCode.OK);
      expect(compositionsResp.compositions).toEqual([
        expect.objectContaining({ isFeatureFlagComposition: false }),
        expect.objectContaining({ isFeatureFlagComposition: false }),
      ]);

      // Only the `products-standalone` subgraph should be updated on the latest composition
      let compositionResp = await client.getCompositionDetails({
        compositionId: compositionsResp.compositions[0].id,
        namespace,
      });

      expect(compositionResp.response?.code).toBe(EnumStatusCode.OK);
      expect(compositionResp.composition).toBeDefined();
      expect(compositionResp.compositionSubgraphs).toHaveLength(2);
      expect(compositionResp.featureFlagCompositions).toHaveLength(0);
      expect(compositionResp.composition?.isFeatureFlagComposition).toBe(false);

      expect(compositionResp.compositionSubgraphs).toEqual([
        expect.objectContaining({ name: 'users', changeType: 'unchanged' }),
        expect.objectContaining({ name: 'products-standalone', changeType: 'updated' }),
      ]);

      // Both subgraphs should be added on the first composition
      compositionResp = await client.getCompositionDetails({
        compositionId: compositionsResp.compositions[1].id,
        namespace,
      });

      expect(compositionResp.response?.code).toBe(EnumStatusCode.OK);
      expect(compositionResp.composition).toBeDefined();
      expect(compositionResp.compositionSubgraphs).toHaveLength(2);
      expect(compositionResp.featureFlagCompositions).toHaveLength(0);
      expect(compositionResp.composition?.isFeatureFlagComposition).toBe(false);

      expect(compositionResp.compositionSubgraphs).toEqual([
        expect.objectContaining({ name: 'users', changeType: 'added' }),
        expect.objectContaining({ name: 'products-standalone', changeType: 'added' }),
      ]);
    },
  );

  test(
    'that the correct feature subgraphs are marked as added and updated in composition details when split config loading is enabled',
    getDebugTestOptions(isDebugMode),
    async (testContext) => {
      const { client, server } = await SetupTest({ dbname, enabledFeatures: ['split-config-loading'] });
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
        excludeFeatureFlagCompositions: false,
      });

      expect(compositionsResp.response?.code).toBe(EnumStatusCode.OK);
      expect(compositionsResp.compositions).toEqual([
        expect.objectContaining({ isFeatureFlagComposition: true, featureFlagName: ffName }),
        expect.objectContaining({ isFeatureFlagComposition: true, featureFlagName: ffName }),
        expect.objectContaining({ isFeatureFlagComposition: false }),
      ]);

      /**
       * The latest composition should be a feature flag composition and be triggered because the updated
       * feature subgraph
       */
      let compositionResp = await client.getCompositionDetails({
        compositionId: compositionsResp.compositions[0].id,
        namespace,
      });

      expect(compositionResp.response?.code).toBe(EnumStatusCode.OK);
      expect(compositionResp.composition).toBeDefined();
      expect(compositionResp.compositionSubgraphs).toHaveLength(2);
      expect(compositionResp.featureFlagCompositions).toHaveLength(0);
      expect(compositionResp.composition?.isFeatureFlagComposition).toBe(true);

      expect(compositionResp.compositionSubgraphs).toEqual([
        expect.objectContaining({ name: 'users', changeType: 'unchanged' }),
        expect.objectContaining({ name: 'products-standalone-feature', changeType: 'updated' }),
      ]);

      /**
       * The second composition is a feature flag composition due to the feature flag creation, so the feature
       * subgraph and the users subgraph should have been added
       */
      compositionResp = await client.getCompositionDetails({
        compositionId: compositionsResp.compositions[1].id,
        namespace,
      });

      expect(compositionResp.response?.code).toBe(EnumStatusCode.OK);
      expect(compositionResp.composition).toBeDefined();
      expect(compositionResp.compositionSubgraphs).toHaveLength(2);
      expect(compositionResp.featureFlagCompositions).toHaveLength(0);
      expect(compositionResp.composition?.isFeatureFlagComposition).toBe(true);

      expect(compositionResp.compositionSubgraphs).toEqual([
        expect.objectContaining({ name: 'users', changeType: 'added' }),
        expect.objectContaining({ name: 'products-standalone-feature', changeType: 'added' }),
      ]);

      // The first composition is the federated graph composition and both subgraphs should be added
      compositionResp = await client.getCompositionDetails({
        compositionId: compositionsResp.compositions[2].id,
        namespace,
      });

      expect(compositionResp.response?.code).toBe(EnumStatusCode.OK);
      expect(compositionResp.composition).toBeDefined();
      expect(compositionResp.compositionSubgraphs).toHaveLength(2);
      expect(compositionResp.featureFlagCompositions).toHaveLength(0);
      expect(compositionResp.composition?.isFeatureFlagComposition).toBe(false);

      expect(compositionResp.compositionSubgraphs).toEqual([
        expect.objectContaining({ name: 'users', changeType: 'added' }),
        expect.objectContaining({ name: 'products-standalone', changeType: 'added' }),
      ]);
    },
  );
});
