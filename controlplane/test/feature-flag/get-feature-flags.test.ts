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
  DEFAULT_NAMESPACE,
  DEFAULT_SUBGRAPH_URL_ONE,
  DEFAULT_SUBGRAPH_URL_TWO,
  SetupTest,
  createBaseAndFeatureSubgraph,
} from '../test-util.js';

let dbname = '';

// Creates a namespace with a feature flag built on top of a single feature subgraph and
// returns every identifier the RBAC rules can be scoped to.
const setupNamespaceWithFeatureFlag = async (client: Awaited<ReturnType<typeof SetupTest>>['client']) => {
  const namespace = genID('namespace').toLowerCase();
  const subgraphName = genID('subgraph');
  const featureSubgraphName = genID('featureSubgraph');
  const flagName = genID('flag');

  const createNamespaceResp = await client.createNamespace({ name: namespace });
  expect(createNamespaceResp.response?.code).toBe(EnumStatusCode.OK);

  const getNamespaceResp = await client.getNamespace({ name: namespace });
  expect(getNamespaceResp.response?.code).toBe(EnumStatusCode.OK);

  await createBaseAndFeatureSubgraph(
    client,
    subgraphName,
    featureSubgraphName,
    DEFAULT_SUBGRAPH_URL_ONE,
    DEFAULT_SUBGRAPH_URL_TWO,
    namespace,
  );

  const getFeatureSubgraphResp = await client.getSubgraphByName({ name: featureSubgraphName, namespace });
  expect(getFeatureSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

  const createFeatureFlagResp = await client.createFeatureFlag({
    name: flagName,
    featureSubgraphNames: [featureSubgraphName],
    isEnabled: true,
    namespace,
  });

  expect(createFeatureFlagResp.response?.code).toBe(EnumStatusCode.OK);

  return {
    namespace,
    namespaceId: getNamespaceResp.namespace!.id,
    flagName,
    featureSubgraphTargetId: getFeatureSubgraphResp.graph!.targetId,
  };
};

describe('List feature flags', (ctx) => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should be able to list feature flags of different namespace', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');
    const flagName = genID('flag');

    const createNamespaceResp = await client.createNamespace({
      name: 'prod',
    });

    expect(createNamespaceResp.response?.code).toBe(EnumStatusCode.OK);

    await createBaseAndFeatureSubgraph(
      client,
      subgraphName,
      featureSubgraphName,
      DEFAULT_SUBGRAPH_URL_ONE,
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    await createBaseAndFeatureSubgraph(
      client,
      subgraphName,
      featureSubgraphName,
      DEFAULT_SUBGRAPH_URL_ONE,
      DEFAULT_SUBGRAPH_URL_TWO,
      'prod',
    );

    let featureFlagResponse = await client.createFeatureFlag({
      name: flagName,
      featureSubgraphNames: [featureSubgraphName],
      isEnabled: true,
    });

    expect(featureFlagResponse.response?.code).toBe(EnumStatusCode.OK);

    featureFlagResponse = await client.createFeatureFlag({
      name: flagName,
      featureSubgraphNames: [featureSubgraphName],
      namespace: 'prod',
      isEnabled: true,
    });

    expect(featureFlagResponse.response?.code).toBe(EnumStatusCode.OK);

    // fetching feature flags from default namespace
    let listFeatureFlagsResp = await client.getFeatureFlags({
      namespace: 'default',
      offset: 0,
      // fetches all
      limit: 0,
    });

    expect(listFeatureFlagsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(listFeatureFlagsResp.totalCount).toBe(1);

    // fetching feature flags from prod namespace
    listFeatureFlagsResp = await client.getFeatureFlags({
      namespace: 'prod',
      offset: 0,
      // fetches all
      limit: 0,
    });

    expect(listFeatureFlagsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(listFeatureFlagsResp.totalCount).toBe(1);

    // fetching all feature flags
    listFeatureFlagsResp = await client.getFeatureFlags({
      offset: 0,
      // fetches all
      limit: 0,
    });

    expect(listFeatureFlagsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(listFeatureFlagsResp.totalCount).toBe(2);

    // fetching feature flags from non-existing namespace
    listFeatureFlagsResp = await client.getFeatureFlags({
      // prod1 namespace does not exist
      namespace: 'prod1',
      offset: 0,
      // fetches all
      limit: 0,
    });

    expect(listFeatureFlagsResp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(listFeatureFlagsResp.response?.details).toBe(`Could not find namespace prod1`);
  });

  describe('Should apply RBAC rules of a non-organization-wide role', () => {
    test.each(['subgraph-admin', 'subgraph-publisher', 'subgraph-viewer'])(
      'Should list the feature flags of a namespace the %s was granted',
      async (role) => {
        const { client, server, users, authenticator } = await SetupTest({ dbname, enabledFeatures: ['rbac'] });
        onTestFinished(() => server.close());

        const granted = await setupNamespaceWithFeatureFlag(client);
        const other = await setupNamespaceWithFeatureFlag(client);

        authenticator.changeUserWithSuppliedContext({
          ...users.adminAliceCompanyA,
          rbac: createTestRBACEvaluator(createTestGroup({ role, namespaces: [granted.namespaceId] })),
        });

        const listResp = await client.getFeatureFlags({ limit: 0, offset: 0 });

        expect(listResp.response?.code).toBe(EnumStatusCode.OK);
        expect(listResp.totalCount).toBe(1);
        expect(listResp.featureFlags).toHaveLength(1);
        expect(listResp.featureFlags[0].name).toBe(granted.flagName);
        expect(listResp.featureFlags[0].namespace).toBe(granted.namespace);
        expect(listResp.featureFlags.map((ff) => ff.name)).not.toContain(other.flagName);
      },
    );

    test('Should list the feature flags containing a feature subgraph the actor was granted', async () => {
      const { client, server, users, authenticator } = await SetupTest({ dbname, enabledFeatures: ['rbac'] });
      onTestFinished(() => server.close());

      const granted = await setupNamespaceWithFeatureFlag(client);
      const other = await setupNamespaceWithFeatureFlag(client);

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(
          createTestGroup({ role: 'subgraph-viewer', resources: [granted.featureSubgraphTargetId] }),
        ),
      });

      const listResp = await client.getFeatureFlags({ limit: 0, offset: 0 });

      expect(listResp.response?.code).toBe(EnumStatusCode.OK);
      expect(listResp.totalCount).toBe(1);
      expect(listResp.featureFlags).toHaveLength(1);
      expect(listResp.featureFlags[0].name).toBe(granted.flagName);
      expect(listResp.featureFlags.map((ff) => ff.name)).not.toContain(other.flagName);
    });

    test('Should not list any feature flag when the granted resources are unrelated to every flag', async () => {
      const { client, server, users, authenticator } = await SetupTest({ dbname, enabledFeatures: ['rbac'] });
      onTestFinished(() => server.close());

      await setupNamespaceWithFeatureFlag(client);

      // The base subgraph is never part of a feature flag, so granting it must not expose any flag
      const subgraphName = genID('subgraph');
      const createSubgraphResp = await client.createFederatedSubgraph({
        name: subgraphName,
        namespace: DEFAULT_NAMESPACE,
        labels: [],
        routingUrl: DEFAULT_SUBGRAPH_URL_ONE,
      });

      expect(createSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

      const getSubgraphResp = await client.getSubgraphByName({ name: subgraphName, namespace: DEFAULT_NAMESPACE });
      expect(getSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(
          createTestGroup({ role: 'subgraph-viewer', resources: [getSubgraphResp.graph!.targetId] }),
        ),
      });

      const listResp = await client.getFeatureFlags({ limit: 0, offset: 0 });

      expect(listResp.response?.code).toBe(EnumStatusCode.OK);
      expect(listResp.totalCount).toBe(0);
      expect(listResp.featureFlags).toHaveLength(0);
    });

    test('Should not list any feature flag when the actor has no subgraph role', async () => {
      const { client, server, users, authenticator } = await SetupTest({ dbname, enabledFeatures: ['rbac'] });
      onTestFinished(() => server.close());

      await setupNamespaceWithFeatureFlag(client);

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(createTestGroup({ role: 'graph-viewer' })),
      });

      const listResp = await client.getFeatureFlags({ limit: 10, offset: 0 });

      expect(listResp.response?.code).toBe(EnumStatusCode.OK);
      expect(listResp.totalCount).toBe(0);
      expect(listResp.featureFlags).toHaveLength(0);
    });

    test('Should list every feature flag when the granted role is not scoped', async () => {
      const { client, server, users, authenticator } = await SetupTest({ dbname, enabledFeatures: ['rbac'] });
      onTestFinished(() => server.close());

      const first = await setupNamespaceWithFeatureFlag(client);
      const second = await setupNamespaceWithFeatureFlag(client);

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(createTestGroup({ role: 'subgraph-viewer' })),
      });

      const listResp = await client.getFeatureFlags({ limit: 10, offset: 0 });

      expect(listResp.response?.code).toBe(EnumStatusCode.OK);
      expect(listResp.totalCount).toBe(2);
      expect(listResp.featureFlags.map((ff) => ff.name).sort()).toEqual([first.flagName, second.flagName].sort());
    });
  });
});
