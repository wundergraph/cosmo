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
  createFederatedGraph,
  createSubgraph,
  createThenPublishSubgraph,
  SetupTest,
} from '../test-util.js';

let dbname = '';

describe('GetSubgraphSDLFromLatestComposition', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should return SDL after successful composition', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const graphName = genID('fedgraph');
    await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

    const subgraphName = genID('subgraph');
    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      'type Query { hello: String }',
      [],
      'http://localhost:4001',
    );

    const response = await client.getSubgraphSDLFromLatestComposition({
      name: subgraphName,
      fedGraphName: graphName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.sdl).toBe('type Query { hello: String }');
    expect(response.versionId).not.toBe('');
  });

  test('Should fail when subgraph does not exist', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const graphName = genID('fedgraph');
    await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

    const response = await client.getSubgraphSDLFromLatestComposition({
      name: 'nonexistent-subgraph',
      fedGraphName: graphName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
  });

  test('Should fail when federated graph does not exist', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const subgraphName = genID('subgraph');
    await createSubgraph(client, subgraphName, 'http://localhost:4001');

    const response = await client.getSubgraphSDLFromLatestComposition({
      name: subgraphName,
      fedGraphName: 'nonexistent-graph',
      namespace: DEFAULT_NAMESPACE,
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
  });

  test('Should fail when subgraph has no composition', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const graphName = genID('fedgraph');
    await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

    const subgraphName = genID('subgraph');
    await createSubgraph(client, subgraphName, 'http://localhost:4001');

    // Don't publish - there's no composition yet
    const response = await client.getSubgraphSDLFromLatestComposition({
      name: subgraphName,
      fedGraphName: graphName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
  });

  test.each([
    'organization-admin',
    'organization-developer',
    'organization-viewer',
    'subgraph-admin',
    'subgraph-publisher',
    'subgraph-viewer',
  ])('%s should be able to get SDL from latest composition', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });
    onTestFinished(() => server.close());

    const graphName = genID('fedgraph');
    await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

    const subgraphName = genID('subgraph');
    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      'type Query { hello: String }',
      [],
      'http://localhost:4001',
    );

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

    const response = await client.getSubgraphSDLFromLatestComposition({
      name: subgraphName,
      fedGraphName: graphName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
  });

  test.each(['namespace-admin', 'namespace-viewer', 'graph-admin', 'graph-viewer', 'organization-apikey-manager'])(
    '%s should not be able to get SDL from latest composition',
    async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphName = genID('fedgraph');
      await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

      const subgraphName = genID('subgraph');
      await createThenPublishSubgraph(
        client,
        subgraphName,
        DEFAULT_NAMESPACE,
        'type Query { hello: String }',
        [],
        'http://localhost:4001',
      );

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

      const response = await client.getSubgraphSDLFromLatestComposition({
        name: subgraphName,
        fedGraphName: graphName,
        namespace: DEFAULT_NAMESPACE,
      });

      expect(response.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
    },
  );
});
