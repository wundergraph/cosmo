import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, onTestFinished, test } from 'vitest';
import {
  afterAllSetup,
  beforeAllSetup,
  createTestGroup,
  createTestRBACEvaluator,
  genID,
} from '../../src/core/test-util.js';
import {
  createBaseAndFeatureSubgraph,
  createFeatureFlag,
  DEFAULT_NAMESPACE,
  DEFAULT_SUBGRAPH_URL_ONE,
  DEFAULT_SUBGRAPH_URL_TWO,
  SetupTest,
} from '../test-util.js';

let dbname = '';

// Feature-subgraph change detection compares the new id set against the stored set (length +
// membership), so it is order-independent. `hasChanged` is the same early-no-op signal as above.
const createFeatureSubgraph = async (client: Parameters<typeof createFeatureFlag>[0]) => {
  const subgraphName = genID('subgraph');
  const featureSubgraphName = genID('featureSubgraph');
  await createBaseAndFeatureSubgraph(
    client,
    subgraphName,
    featureSubgraphName,
    DEFAULT_SUBGRAPH_URL_ONE,
    DEFAULT_SUBGRAPH_URL_TWO,
  );
  return featureSubgraphName;
};

/**
 * The update handler skips the write + recomposition when nothing actually changes. For labels
 * this is decided by `currentLabels.some((label, i) => label !== newLabels[i])` over two arrays
 * that `normalizeLabels` has already sorted and deduped, guarded by a length check. `hasChanged`
 * is `false` only when that early no-op return is taken, so it is the precise signal to assert.
 */
const createFlagWithLabels = async (
  client: Parameters<typeof createFeatureFlag>[0],
  labels: { key: string; value: string }[],
) => {
  const subgraphName = genID('subgraph');
  const featureSubgraphName = genID('featureSubgraph');
  await createBaseAndFeatureSubgraph(
    client,
    subgraphName,
    featureSubgraphName,
    DEFAULT_SUBGRAPH_URL_ONE,
    DEFAULT_SUBGRAPH_URL_TWO,
  );
  const featureFlagName = genID('flag');
  await createFeatureFlag(client, featureFlagName, labels, [featureSubgraphName]);
  return featureFlagName;
};

describe('Update feature flag tests', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('that an error is returned if a feature flag that does not exist is updated', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');

    await createBaseAndFeatureSubgraph(
      client,
      subgraphName,
      featureSubgraphName,
      DEFAULT_SUBGRAPH_URL_ONE,
      'http://localhost:4002',
    );

    const featureFlagName = genID('flag');

    const updateFeatureFlagResponse = await client.updateFeatureFlag({
      name: featureFlagName,
      featureSubgraphNames: [featureSubgraphName],
    });

    expect(updateFeatureFlagResponse.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(updateFeatureFlagResponse.response?.details).toBe(
      `The feature flag "${featureFlagName}" does not exist in the namespace "default".`,
    );
  });

  test('that an error is returned if a feature flag is updated to contain duplicate feature subgraphs', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');

    await createBaseAndFeatureSubgraph(
      client,
      subgraphName,
      featureSubgraphName,
      DEFAULT_SUBGRAPH_URL_ONE,
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    const featureFlagName = genID('flag');

    await createFeatureFlag(client, featureFlagName, [], [featureSubgraphName]);

    const updateFeatureFlagResponse = await client.updateFeatureFlag({
      name: featureFlagName,
      featureSubgraphNames: [featureSubgraphName, featureSubgraphName],
    });
    expect(updateFeatureFlagResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(updateFeatureFlagResponse.response?.details).toBe(
      '1. Feature subgraphs with the same base subgraph cannot compose the same feature flag.',
    );
  });

  test('that an error is returned if a feature flag is updated to contain feature subgraphs that share the same base subgraph', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const subgraphName = genID('subgraph');
    const featureSubgraphNameOne = genID('featureSubgraphOne');
    const featureSubgraphNameTwo = genID('featureSubgraphTwo');

    await createBaseAndFeatureSubgraph(
      client,
      subgraphName,
      featureSubgraphNameOne,
      DEFAULT_SUBGRAPH_URL_ONE,
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    const featureFlagName = genID('flag');

    await createFeatureFlag(client, featureFlagName, [], [featureSubgraphNameOne]);

    const createFeatureSubgraphResponse = await client.createFederatedSubgraph({
      name: featureSubgraphNameTwo,
      routingUrl: 'http://localhost:4004',
      baseSubgraphName: subgraphName,
      isFeatureSubgraph: true,
    });
    expect(createFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    const updateFeatureFlagResponse = await client.updateFeatureFlag({
      name: featureFlagName,
      featureSubgraphNames: [featureSubgraphNameOne, featureSubgraphNameTwo],
    });
    expect(updateFeatureFlagResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(updateFeatureFlagResponse.response?.details).toBe(
      '1. Feature subgraphs with the same base subgraph cannot compose the same feature flag.',
    );
  });

  test('that an error is returned if a feature flag is updated to contain a base subgraph', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');

    await createBaseAndFeatureSubgraph(
      client,
      subgraphName,
      featureSubgraphName,
      DEFAULT_SUBGRAPH_URL_ONE,
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    const featureFlagName = genID('flag');

    await createFeatureFlag(client, featureFlagName, [], [featureSubgraphName]);

    const updateFeatureFlagResponse = await client.updateFeatureFlag({
      name: featureFlagName,
      featureSubgraphNames: [subgraphName],
    });
    expect(updateFeatureFlagResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(updateFeatureFlagResponse.response?.details).toBe(
      `1. The subgraph "${subgraphName}" is not a feature subgraph.`,
    );
  });

  test('that updating a feature flag feature subgraphs array does not affect already set labels', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const subgraphName = genID('subgraph');
    const featureSubgraphNameOne = genID('featureSubgraphOne');
    const featureSubgraphNameTwo = genID('featureSubgraphTwo');
    const labels = [{ key: 'team', value: 'A' }];

    await createBaseAndFeatureSubgraph(
      client,
      subgraphName,
      featureSubgraphNameOne,
      DEFAULT_SUBGRAPH_URL_ONE,
      'http://localhost:4002',
    );

    const featureFlagName = genID('flag');
    await createFeatureFlag(client, featureFlagName, labels, [featureSubgraphNameOne]);

    const createFeatureSubgraphResponse = await client.createFederatedSubgraph({
      name: featureSubgraphNameTwo,
      routingUrl: 'http://localhost:4004',
      baseSubgraphName: subgraphName,
      isFeatureSubgraph: true,
    });
    expect(createFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    const updateFeatureFlagResponse = await client.updateFeatureFlag({
      name: featureFlagName,
      featureSubgraphNames: [featureSubgraphNameTwo],
    });
    expect(updateFeatureFlagResponse.response?.code).toBe(EnumStatusCode.OK);

    const getFeatureFlagResponse = await client.getFeatureFlagByName({
      name: featureFlagName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(getFeatureFlagResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getFeatureFlagResponse.featureSubgraphs.map((featureSubraph) => featureSubraph.name)).toStrictEqual([
      featureSubgraphNameTwo,
    ]);
    expect(getFeatureFlagResponse.featureFlag?.labels).toMatchObject(labels);
  });

  test('that updating a feature flag with labels does not affect the feature subgraphs array', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');
    const labels = [{ key: 'team', value: 'A' }];

    await createBaseAndFeatureSubgraph(
      client,
      subgraphName,
      featureSubgraphName,
      DEFAULT_SUBGRAPH_URL_ONE,
      'http://localhost:4002',
    );

    const featureFlagName = genID('flag');
    await createFeatureFlag(client, featureFlagName, [], [featureSubgraphName]);

    const updateFeatureFlagResponse = await client.updateFeatureFlag({
      name: featureFlagName,
      labels,
    });
    expect(updateFeatureFlagResponse.response?.code).toBe(EnumStatusCode.OK);

    const getFeatureFlagResponse = await client.getFeatureFlagByName({
      name: featureFlagName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(getFeatureFlagResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getFeatureFlagResponse.featureSubgraphs.map((featureSubgraph) => featureSubgraph.name)).toStrictEqual([
      featureSubgraphName,
    ]);
    expect(getFeatureFlagResponse.featureFlag?.labels).toMatchObject(labels);
  });

  test('that updating a feature flag with unset labels removes all existing labels', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');
    const labels = [{ key: 'team', value: 'A' }];

    await createBaseAndFeatureSubgraph(
      client,
      subgraphName,
      featureSubgraphName,
      DEFAULT_SUBGRAPH_URL_ONE,
      'http://localhost:4002',
    );

    const featureFlagName = genID('flag');
    await createFeatureFlag(client, featureFlagName, labels, [featureSubgraphName]);

    const updateFeatureFlagResponse = await client.updateFeatureFlag({
      name: featureFlagName,
      unsetLabels: true,
    });
    expect(updateFeatureFlagResponse.response?.code).toBe(EnumStatusCode.OK);

    const getFeatureFlagResponse = await client.getFeatureFlagByName({
      name: featureFlagName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(getFeatureFlagResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getFeatureFlagResponse.featureSubgraphs.map((featureSubgraph) => featureSubgraph.name)).toStrictEqual([
      featureSubgraphName,
    ]);
    expect(getFeatureFlagResponse.featureFlag?.labels).toStrictEqual([]);
  });

  test('that updating a feature flag with unset labels removes all existing labels and ignores new labels', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const subgraphName = genID('subgraph');
    const featureSubgraphNameOne = genID('featureSubgraphOne');
    const featureSubgraphNameTwo = genID('featureSubgraphTwo');
    const labels = [{ key: 'team', value: 'A' }];

    await createBaseAndFeatureSubgraph(
      client,
      subgraphName,
      featureSubgraphNameOne,
      DEFAULT_SUBGRAPH_URL_ONE,
      'http://localhost:4002',
    );

    const featureFlagName = genID('flag');
    await createFeatureFlag(client, featureFlagName, labels, [featureSubgraphNameOne]);

    const createFeatureSubgraphResponse = await client.createFederatedSubgraph({
      name: featureSubgraphNameTwo,
      routingUrl: 'http://localhost:4004',
      baseSubgraphName: subgraphName,
      isFeatureSubgraph: true,
    });
    expect(createFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    const updateFeatureFlagResponse = await client.updateFeatureFlag({
      name: featureFlagName,
      labels: [{ key: 'team', value: 'B' }],
      featureSubgraphNames: [featureSubgraphNameTwo],
      unsetLabels: true,
    });
    expect(updateFeatureFlagResponse.response?.code).toBe(EnumStatusCode.OK);

    const getFeatureFlagResponse = await client.getFeatureFlagByName({
      name: featureFlagName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(getFeatureFlagResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getFeatureFlagResponse.featureSubgraphs.map((featureSubgraph) => featureSubgraph.name)).toStrictEqual([
      featureSubgraphNameTwo,
    ]);
    expect(getFeatureFlagResponse.featureFlag?.labels).toStrictEqual([]);
  });

  test.each(['organization-admin', 'organization-developer'])(
    '%s should be able to update feature flag',
    async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const subgraphName = genID('subgraph');
      const featureSubgraphName = genID('featureSubgraph');

      await createBaseAndFeatureSubgraph(
        client,
        subgraphName,
        featureSubgraphName,
        DEFAULT_SUBGRAPH_URL_ONE,
        'http://localhost:4002',
      );

      const featureFlagName = genID('flag');
      await createFeatureFlag(client, featureFlagName, [], [featureSubgraphName]);

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(createTestGroup({ role })),
      });

      const updateFeatureFlagResponse = await client.updateFeatureFlag({
        name: featureFlagName,
        featureSubgraphNames: [featureSubgraphName],
      });
      expect(updateFeatureFlagResponse.response?.code).toBe(EnumStatusCode.OK);
    },
  );

  test.each(['organization-admin', 'organization-developer'])(
    '%s should be able to update feature flag can be updated with another feature subgraph',
    async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const subgraphName = genID('subgraph');
      const featureSubgraphName = genID('featureSubgraph');

      await createBaseAndFeatureSubgraph(
        client,
        subgraphName,
        featureSubgraphName,
        DEFAULT_SUBGRAPH_URL_ONE,
        'http://localhost:4002',
      );

      const featureFlagName = genID('flag');
      await createFeatureFlag(client, featureFlagName, [], [featureSubgraphName]);

      const subgraphNameTwo = genID('subgraph');
      const featureSubgraphNameTwo = genID('featureSubgraph');

      await createBaseAndFeatureSubgraph(
        client,
        subgraphNameTwo,
        featureSubgraphNameTwo,
        DEFAULT_SUBGRAPH_URL_ONE,
        'http://localhost:4002',
      );

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(createTestGroup({ role })),
      });

      const updateFeatureFlagResponse = await client.updateFeatureFlag({
        name: featureFlagName,
        featureSubgraphNames: [featureSubgraphName, featureSubgraphNameTwo],
      });

      expect(updateFeatureFlagResponse.response?.code).toBe(EnumStatusCode.OK);
    },
  );

  test.each([
    'organization-apikey-manager',
    'organization-viewer',
    'namespace-admin',
    'namespace-viewer',
    'graph-admin',
    'graph-viewer',
    'subgraph-admin',
    'subgraph-publisher',
    'subgraph-viewer',
  ])('%s should not be able to update feature flag', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });
    onTestFinished(() => server.close());

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');

    await createBaseAndFeatureSubgraph(
      client,
      subgraphName,
      featureSubgraphName,
      DEFAULT_SUBGRAPH_URL_ONE,
      'http://localhost:4002',
    );

    const featureFlagName = genID('flag');
    await createFeatureFlag(client, featureFlagName, [], [featureSubgraphName]);

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({ role })),
    });

    const updateFeatureFlagResponse = await client.updateFeatureFlag({
      name: featureFlagName,
      featureSubgraphNames: [featureSubgraphName],
    });
    expect(updateFeatureFlagResponse.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
  });

  test('that updating a feature flag with the same labels in a different order is a no-op (hasChanged is false)', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const featureFlagName = await createFlagWithLabels(client, [
      { key: 'team', value: 'A' },
      { key: 'env', value: 'prod' },
    ]);

    // Same set of labels, reversed order.
    const res = await client.updateFeatureFlag({
      name: featureFlagName,
      labels: [
        { key: 'env', value: 'prod' },
        { key: 'team', value: 'A' },
      ],
    });
    expect(res.response?.code).toBe(EnumStatusCode.OK);
    expect(res.hasChanged).toBe(false);
  });

  test('that updating a feature flag with the identical labels is a no-op (hasChanged is false)', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const labels = [
      { key: 'team', value: 'A' },
      { key: 'env', value: 'prod' },
    ];
    const featureFlagName = await createFlagWithLabels(client, labels);

    const res = await client.updateFeatureFlag({ name: featureFlagName, labels });
    expect(res.response?.code).toBe(EnumStatusCode.OK);
    expect(res.hasChanged).toBe(false);
  });

  test('that updating a feature flag with the same labels plus a duplicate is a no-op (hasChanged is false)', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const featureFlagName = await createFlagWithLabels(client, [{ key: 'team', value: 'A' }]);

    // Duplicate of the existing label — `normalizeLabels` dedupes, so this is not a change.
    const res = await client.updateFeatureFlag({
      name: featureFlagName,
      labels: [
        { key: 'team', value: 'A' },
        { key: 'team', value: 'A' },
      ],
    });
    expect(res.response?.code).toBe(EnumStatusCode.OK);
    expect(res.hasChanged).toBe(false);
  });

  test('that updating a feature flag with a changed label value triggers a change (hasChanged is true)', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const featureFlagName = await createFlagWithLabels(client, [
      { key: 'team', value: 'A' },
      { key: 'env', value: 'prod' },
    ]);

    const res = await client.updateFeatureFlag({
      name: featureFlagName,
      labels: [
        { key: 'team', value: 'B' }, // value changed A -> B
        { key: 'env', value: 'prod' },
      ],
    });
    expect(res.response?.code).toBe(EnumStatusCode.OK);
    expect(res.hasChanged).toBe(true);
  });

  test('that updating a feature flag with an added label triggers a change (hasChanged is true)', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const featureFlagName = await createFlagWithLabels(client, [{ key: 'team', value: 'A' }]);

    const res = await client.updateFeatureFlag({
      name: featureFlagName,
      labels: [
        { key: 'team', value: 'A' },
        { key: 'env', value: 'prod' }, // added
      ],
    });
    expect(res.response?.code).toBe(EnumStatusCode.OK);
    expect(res.hasChanged).toBe(true);
  });

  test('that updating a feature flag with the same feature subgraphs is a no-op (hasChanged is false)', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const featureSubgraphName = await createFeatureSubgraph(client);
    const featureFlagName = genID('flag');
    await createFeatureFlag(client, featureFlagName, [], [featureSubgraphName]);

    const res = await client.updateFeatureFlag({
      name: featureFlagName,
      featureSubgraphNames: [featureSubgraphName],
    });
    expect(res.response?.code).toBe(EnumStatusCode.OK);
    expect(res.hasChanged).toBe(false);
  });

  test('that updating a feature flag with the same feature subgraphs in a different order is a no-op (hasChanged is false)', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const featureSubgraphOne = await createFeatureSubgraph(client);
    const featureSubgraphTwo = await createFeatureSubgraph(client);
    const featureFlagName = genID('flag');
    await createFeatureFlag(client, featureFlagName, [], [featureSubgraphOne, featureSubgraphTwo]);

    // Same set of feature subgraphs, reversed order.
    const res = await client.updateFeatureFlag({
      name: featureFlagName,
      featureSubgraphNames: [featureSubgraphTwo, featureSubgraphOne],
    });
    expect(res.response?.code).toBe(EnumStatusCode.OK);
    expect(res.hasChanged).toBe(false);
  });

  test('that updating a feature flag with an added feature subgraph triggers a change (hasChanged is true)', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const featureSubgraphOne = await createFeatureSubgraph(client);
    const featureSubgraphTwo = await createFeatureSubgraph(client);
    const featureFlagName = genID('flag');
    await createFeatureFlag(client, featureFlagName, [], [featureSubgraphOne]);

    const res = await client.updateFeatureFlag({
      name: featureFlagName,
      featureSubgraphNames: [featureSubgraphOne, featureSubgraphTwo], // added featureSubgraphTwo
    });
    expect(res.response?.code).toBe(EnumStatusCode.OK);
    expect(res.hasChanged).toBe(true);
  });

  test('that updating a feature flag with a swapped feature subgraph triggers a change (hasChanged is true)', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const featureSubgraphOne = await createFeatureSubgraph(client);
    const featureSubgraphTwo = await createFeatureSubgraph(client);
    const featureFlagName = genID('flag');
    await createFeatureFlag(client, featureFlagName, [], [featureSubgraphOne]);

    // Same count, different member.
    const res = await client.updateFeatureFlag({
      name: featureFlagName,
      featureSubgraphNames: [featureSubgraphTwo],
    });
    expect(res.response?.code).toBe(EnumStatusCode.OK);
    expect(res.hasChanged).toBe(true);
  });
});
