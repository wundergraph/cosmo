import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, onTestFinished, test } from 'vitest';
import {
  afterAllSetup,
  beforeAllSetup,
  createTestGroup,
  createTestRBACEvaluator,
  genID,
} from '../../src/core/test-util.js';
import { DEFAULT_NAMESPACE, createBaseAndFeatureSubgraph, createFeatureFlag, SetupTest } from '../test-util.js';

let dbname = '';

describe('GetFeatureSubgraphsByFeatureFlag', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should return the feature subgraphs for a feature flag', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const baseSubgraphName = genID('base');
    const featureSubgraphName = genID('feature');
    await createBaseAndFeatureSubgraph(
      client,
      baseSubgraphName,
      featureSubgraphName,
      'http://localhost:4001',
      'http://localhost:4002',
    );

    const flagName = genID('flag');
    await createFeatureFlag(client, flagName, [], [featureSubgraphName]);

    const response = await client.getFeatureSubgraphsByFeatureFlag({
      featureFlagName: flagName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.featureSubgraphs.length).toBe(1);
    expect(response.featureSubgraphs[0].name).toBe(featureSubgraphName);
    expect(response.featureSubgraphs[0].isFeatureSubgraph).toBe(true);
  });

  test('Should fail when namespace does not exist', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const response = await client.getFeatureSubgraphsByFeatureFlag({
      featureFlagName: 'some-flag',
      namespace: 'nonexistent-namespace',
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(response.response?.details).toContain('Could not find namespace nonexistent-namespace');
    expect(response.featureSubgraphs).toEqual([]);
  });

  test('Should fail when feature flag does not exist', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const response = await client.getFeatureSubgraphsByFeatureFlag({
      featureFlagName: 'nonexistent-flag',
      namespace: DEFAULT_NAMESPACE,
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(response.response?.details).toContain('Could not find feature flag nonexistent-flag');
    expect(response.featureSubgraphs).toEqual([]);
  });

  test.each(['organization-admin', 'organization-developer', 'organization-viewer'])(
    '%s should be able to get feature subgraphs by feature flag',
    async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const baseSubgraphName = genID('base');
      const featureSubgraphName = genID('feature');
      await createBaseAndFeatureSubgraph(
        client,
        baseSubgraphName,
        featureSubgraphName,
        'http://localhost:4001',
        'http://localhost:4002',
      );

      const flagName = genID('flag');
      await createFeatureFlag(client, flagName, [], [featureSubgraphName]);

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(createTestGroup({ role })),
      });

      const response = await client.getFeatureSubgraphsByFeatureFlag({
        featureFlagName: flagName,
        namespace: DEFAULT_NAMESPACE,
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);
    },
  );

  test.each([
    'organization-apikey-manager',
    'namespace-admin',
    'namespace-viewer',
    'graph-admin',
    'graph-viewer',
    'subgraph-admin',
    'subgraph-publisher',
    'subgraph-viewer',
  ])('%s should NOT be able to get feature subgraphs by feature flag', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });
    onTestFinished(() => server.close());

    const baseSubgraphName = genID('base');
    const featureSubgraphName = genID('feature');
    await createBaseAndFeatureSubgraph(
      client,
      baseSubgraphName,
      featureSubgraphName,
      'http://localhost:4001',
      'http://localhost:4002',
    );

    const flagName = genID('flag');
    await createFeatureFlag(client, flagName, [], [featureSubgraphName]);

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({ role })),
    });

    const response = await client.getFeatureSubgraphsByFeatureFlag({
      featureFlagName: flagName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
  });
});
