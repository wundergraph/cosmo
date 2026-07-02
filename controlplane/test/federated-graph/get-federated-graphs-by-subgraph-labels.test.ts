import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, onTestFinished, test } from 'vitest';
import {
  afterAllSetup,
  beforeAllSetup,
  createTestGroup,
  createTestRBACEvaluator,
  genID,
} from '../../src/core/test-util.js';
import { DEFAULT_NAMESPACE, createFederatedGraph, createSubgraph, SetupTest } from '../test-util.js';

let dbname = '';

describe('GetFederatedGraphsBySubgraphLabels', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should return federated graphs that match the subgraph labels', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const graphName = genID('fedgraph');
    await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, ['team=A'], 'http://localhost:8080');

    const subgraphName = genID('subgraph');
    await createSubgraph(client, subgraphName, 'http://localhost:4001', DEFAULT_NAMESPACE, [
      { key: 'team', value: 'A' },
    ]);

    const response = await client.getFederatedGraphsBySubgraphLabels({
      subgraphName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.graphs.length).toBe(1);
    expect(response.graphs[0].name).toBe(graphName);
  });

  test('Should return empty list when no graphs match the labels', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const subgraphName = genID('subgraph');
    await createSubgraph(client, subgraphName, 'http://localhost:4001', DEFAULT_NAMESPACE, [
      { key: 'team', value: 'noone' },
    ]);

    const response = await client.getFederatedGraphsBySubgraphLabels({
      subgraphName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.graphs).toEqual([]);
  });

  test('Should fail when the subgraph does not exist', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const response = await client.getFederatedGraphsBySubgraphLabels({
      subgraphName: 'nonexistent',
      namespace: DEFAULT_NAMESPACE,
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(response.response?.details).toContain("Subgraph 'nonexistent' not found");
    expect(response.graphs).toEqual([]);
  });

  test('Should default to the default namespace when namespace is not passed', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const graphName = genID('fedgraph');
    await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, ['env=prod'], 'http://localhost:8080');

    const subgraphName = genID('subgraph');
    await createSubgraph(client, subgraphName, 'http://localhost:4001', DEFAULT_NAMESPACE, [
      { key: 'env', value: 'prod' },
    ]);

    const response = await client.getFederatedGraphsBySubgraphLabels({
      subgraphName,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.graphs.some((g) => g.name === graphName)).toBe(true);
  });

  test.each([
    'organization-admin',
    'organization-developer',
    'organization-viewer',
    'subgraph-admin',
    'subgraph-publisher',
    'subgraph-viewer',
  ])('%s should be able to call getFederatedGraphsBySubgraphLabels', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });
    onTestFinished(() => server.close());

    const graphName = genID('fedgraph');
    await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [`lbl-${role}=v`], 'http://localhost:8080');

    const subgraphName = genID('subgraph');
    await createSubgraph(client, subgraphName, 'http://localhost:4001', DEFAULT_NAMESPACE, [
      { key: `lbl-${role}`, value: 'v' },
    ]);

    const getSubgraphResponse = await client.getSubgraphByName({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(getSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(
        createTestGroup({
          role,
          resources: [getSubgraphResponse.graph!.targetId],
        }),
      ),
    });

    const response = await client.getFederatedGraphsBySubgraphLabels({
      subgraphName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
  });

  test.each(['subgraph-admin', 'subgraph-publisher', 'subgraph-viewer', 'graph-admin', 'graph-viewer'])(
    '%s scoped to a different subgraph should NOT have access',
    async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      // Target subgraph we'll query
      const targetSubgraphName = genID('subgraph');
      await createSubgraph(client, targetSubgraphName, 'http://localhost:4001', DEFAULT_NAMESPACE, [
        { key: 'team', value: 'A' },
      ]);

      // A different subgraph the user WILL be scoped to
      const otherSubgraphName = genID('other');
      await createSubgraph(client, otherSubgraphName, 'http://localhost:4002', DEFAULT_NAMESPACE, [
        { key: 'team', value: 'B' },
      ]);

      const otherSubgraphResponse = await client.getSubgraphByName({
        name: otherSubgraphName,
        namespace: DEFAULT_NAMESPACE,
      });
      expect(otherSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

      // Scope the role only to the OTHER subgraph, not the target
      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(
          createTestGroup({
            role,
            resources: [otherSubgraphResponse.graph!.targetId],
          }),
        ),
      });

      const response = await client.getFederatedGraphsBySubgraphLabels({
        subgraphName: targetSubgraphName,
        namespace: DEFAULT_NAMESPACE,
      });

      expect(response.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
    },
  );
});
