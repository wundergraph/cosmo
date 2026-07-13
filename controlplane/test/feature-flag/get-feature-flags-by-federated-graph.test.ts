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
  createBaseAndFeatureSubgraph,
  createFederatedGraph,
  createFeatureFlag,
  SetupTest,
} from '../test-util.js';

let dbname = '';

describe('GetFeatureFlagsByFederatedGraph', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should return empty list when no feature flags match', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const graphName = genID('fedgraph');
    await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

    const response = await client.getFeatureFlagsByFederatedGraph({
      federatedGraphName: graphName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.featureFlags).toEqual([]);
    expect(response.totalCount).toBe(0);
  });

  test('Should return feature flags matching federated graph labels', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const graphName = genID('fedgraph');
    await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, ['team=A'], 'http://localhost:8080');

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
    await createFeatureFlag(client, flagName, [{ key: 'team', value: 'A' }], [featureSubgraphName]);

    const response = await client.getFeatureFlagsByFederatedGraph({
      federatedGraphName: graphName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.featureFlags.length).toBe(1);
    expect(response.featureFlags[0].name).toBe(flagName);
    expect(response.totalCount).toBe(1);
  });

  test('Should fail when namespace does not exist', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const response = await client.getFeatureFlagsByFederatedGraph({
      federatedGraphName: 'some-graph',
      namespace: 'nonexistent-namespace',
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(response.response?.details).toContain('Namespace nonexistent-namespace not found');
    expect(response.featureFlags).toEqual([]);
  });

  test('Should fail when federated graph does not exist', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const response = await client.getFeatureFlagsByFederatedGraph({
      federatedGraphName: 'nonexistent',
      namespace: DEFAULT_NAMESPACE,
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(response.response?.details).toContain("Federated Graph 'nonexistent' not found");
    expect(response.featureFlags).toEqual([]);
  });

  test.each(['organization-admin', 'organization-developer', 'organization-viewer', 'graph-admin', 'graph-viewer'])(
    '%s should be able to get feature flags by federated graph',
    async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphName = genID('fedgraph');
      await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

      const getGraphResponse = await client.getFederatedGraphByName({
        name: graphName,
        namespace: DEFAULT_NAMESPACE,
      });
      expect(getGraphResponse.response?.code).toBe(EnumStatusCode.OK);

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(
          createTestGroup({
            role,
            resources: [getGraphResponse.graph!.targetId],
          }),
        ),
      });

      const response = await client.getFeatureFlagsByFederatedGraph({
        federatedGraphName: graphName,
        namespace: DEFAULT_NAMESPACE,
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);
    },
  );

  test.each(['graph-admin', 'graph-viewer', 'subgraph-admin', 'subgraph-viewer'])(
    '%s scoped to a different graph should NOT have access',
    async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      // Create the target graph we'll query
      const targetGraphName = genID('fedgraph');
      await createFederatedGraph(client, targetGraphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

      // Create a different graph that the user WILL have access to
      const otherGraphName = genID('other');
      await createFederatedGraph(client, otherGraphName, DEFAULT_NAMESPACE, [], 'http://localhost:8081');

      const getOtherGraphResponse = await client.getFederatedGraphByName({
        name: otherGraphName,
        namespace: DEFAULT_NAMESPACE,
      });
      expect(getOtherGraphResponse.response?.code).toBe(EnumStatusCode.OK);

      // Scope the role only to the OTHER graph, not the target
      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(
          createTestGroup({
            role,
            resources: [getOtherGraphResponse.graph!.targetId],
          }),
        ),
      });

      const response = await client.getFeatureFlagsByFederatedGraph({
        federatedGraphName: targetGraphName,
        namespace: DEFAULT_NAMESPACE,
      });

      expect(response.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
    },
  );
});
