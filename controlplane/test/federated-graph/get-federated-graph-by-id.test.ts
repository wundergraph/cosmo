import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, onTestFinished, test } from 'vitest';
import {
  afterAllSetup,
  beforeAllSetup,
  createTestGroup,
  createTestRBACEvaluator,
  genID
} from '../../src/core/test-util.js';
import {
  createFederatedGraph,
  createThenPublishSubgraph,
  DEFAULT_NAMESPACE,
  SetupTest
} from '../test-util.js';

let dbname = '';

describe('GetFederatedGraphById', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should return federated graph details by id', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const graphName = genID('fedgraph');
    await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

    const graphByName = await client.getFederatedGraphByName({
      name: graphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(graphByName.response?.code).toBe(EnumStatusCode.OK);

    const response = await client.getFederatedGraphById({
      id: graphByName.graph!.id,
      includeMetrics: false,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.graph?.id).toBe(graphByName.graph!.id);
    expect(response.graph?.name).toBe(graphName);
    expect(response.graph?.namespace).toBe(DEFAULT_NAMESPACE);
    expect(response.subgraphs).toEqual([]);
    expect(response.featureFlagsInLatestValidComposition).toEqual([]);
    expect(response.featureSubgraphs).toEqual([]);
    expect(response.graphRequestToken).not.toBe('');
  });

  test('Should return the associated subgraphs', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const graphName = genID('fedgraph');
    await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, ['team=A'], 'http://localhost:8080');

    const subgraphName = genID('subgraph');
    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      'type Query { hello: String }',
      [{ key: 'team', value: 'A' }],
      'http://localhost:4001',
    );

    const graphByName = await client.getFederatedGraphByName({
      name: graphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(graphByName.response?.code).toBe(EnumStatusCode.OK);

    const response = await client.getFederatedGraphById({
      id: graphByName.graph!.id,
      includeMetrics: false,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    // The subgraph should be associated with the graph since the labels match
    expect(response.subgraphs.length).toBe(1);
    expect(response.subgraphs[0].name).toBe(subgraphName);
  });

  test('Should fail when the graph does not exist', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const response = await client.getFederatedGraphById({
      id: '00000000-0000-0000-0000-000000000000',
      includeMetrics: false,
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(response.subgraphs).toEqual([]);
    expect(response.featureFlagsInLatestValidComposition).toEqual([]);
    expect(response.featureSubgraphs).toEqual([]);
  });

  test.each(['organization-admin', 'organization-developer', 'organization-viewer', 'graph-admin', 'graph-viewer'])(
    '%s should be able to get a federated graph by id',
    async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphName = genID('fedgraph');
      await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

      const graphByName = await client.getFederatedGraphByName({
        name: graphName,
        namespace: DEFAULT_NAMESPACE,
      });
      expect(graphByName.response?.code).toBe(EnumStatusCode.OK);

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(
          createTestGroup({
            role,
            resources: [graphByName.graph!.targetId],
          }),
        ),
      });

      const response = await client.getFederatedGraphById({
        id: graphByName.graph!.id,
        includeMetrics: false,
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);
      expect(response.graph?.id).toBe(graphByName.graph!.id);
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

      const targetGraphResponse = await client.getFederatedGraphByName({
        name: targetGraphName,
        namespace: DEFAULT_NAMESPACE,
      });
      expect(targetGraphResponse.response?.code).toBe(EnumStatusCode.OK);

      // Create a different graph that the user will be scoped to
      const otherGraphName = genID('other');
      await createFederatedGraph(client, otherGraphName, DEFAULT_NAMESPACE, [], 'http://localhost:8081');

      const otherGraphResponse = await client.getFederatedGraphByName({
        name: otherGraphName,
        namespace: DEFAULT_NAMESPACE,
      });
      expect(otherGraphResponse.response?.code).toBe(EnumStatusCode.OK);

      // Scope the role to the OTHER graph, not the target
      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(
          createTestGroup({
            role,
            resources: [otherGraphResponse.graph!.targetId],
          }),
        ),
      });

      const response = await client.getFederatedGraphById({
        id: targetGraphResponse.graph!.id,
        includeMetrics: false,
      });

      expect(response.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
    },
  );
});
