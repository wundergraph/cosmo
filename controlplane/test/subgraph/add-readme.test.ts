import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, onTestFinished, test } from 'vitest';
import {
  afterAllSetup,
  beforeAllSetup,
  createAPIKeyTestRBACEvaluator,
  createTestGroup,
  createTestRBACEvaluator,
  genID,
} from '../../src/core/test-util.js';
import { DEFAULT_NAMESPACE, createSubgraph, SetupTest } from '../test-util.js';

let dbname = '';

describe('AddReadme', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should add a readme to an existing subgraph', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const subgraphName = genID('subgraph');
    await createSubgraph(client, subgraphName, 'http://localhost:4001');

    const readme = '# My Subgraph\nThis is a test readme.';

    const addReadmeResponse = await client.addReadme({
      targetName: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      readme,
    });

    expect(addReadmeResponse.response?.code).toBe(EnumStatusCode.OK);

    // Verify the readme was set
    const getSubgraphResponse = await client.getSubgraphByName({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(getSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getSubgraphResponse.graph?.readme).toBe(readme);
  });

  test('Should add a readme to an existing federated graph', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const federatedGraphName = genID('fedgraph');

    const createResponse = await client.createFederatedGraph({
      name: federatedGraphName,
      namespace: DEFAULT_NAMESPACE,
      labelMatchers: [],
      routingUrl: 'http://localhost:8080',
    });
    expect(createResponse.response?.code).toBe(EnumStatusCode.OK);

    const readme = '# My Federated Graph\nThis is a test readme.';

    const addReadmeResponse = await client.addReadme({
      targetName: federatedGraphName,
      namespace: DEFAULT_NAMESPACE,
      readme,
    });

    expect(addReadmeResponse.response?.code).toBe(EnumStatusCode.OK);

    const getFederatedGraphResponse = await client.getFederatedGraphByName({
      name: federatedGraphName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(getFederatedGraphResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getFederatedGraphResponse.graph?.readme).toBe(readme);
  });

  test('Should update an existing readme', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const subgraphName = genID('subgraph');
    await createSubgraph(client, subgraphName, 'http://localhost:4001');

    await client.addReadme({
      targetName: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      readme: 'Initial readme',
    });

    const updatedReadme = 'Updated readme content';
    const updateResponse = await client.addReadme({
      targetName: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      readme: updatedReadme,
    });

    expect(updateResponse.response?.code).toBe(EnumStatusCode.OK);

    const getSubgraphResponse = await client.getSubgraphByName({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(getSubgraphResponse.graph?.readme).toBe(updatedReadme);
  });

  test('Should fail to add a readme to a target that does not exist', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const nonExistentTarget = genID('nonexistent');

    const addReadmeResponse = await client.addReadme({
      targetName: nonExistentTarget,
      namespace: DEFAULT_NAMESPACE,
      readme: 'Test readme',
    });

    expect(addReadmeResponse.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(addReadmeResponse.response?.details).toContain(`Target ${nonExistentTarget} not found`);
  });

  test('Should fail when the namespace does not exist', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const subgraphName = genID('subgraph');
    await createSubgraph(client, subgraphName, 'http://localhost:4001');

    const addReadmeResponse = await client.addReadme({
      targetName: subgraphName,
      namespace: 'nonexistent-namespace',
      readme: 'Test readme',
    });

    expect(addReadmeResponse.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
  });

  test.each([
    'organization-admin',
    'organization-developer',
    'subgraph-admin',
    'subgraph-publisher',
  ])('%s should be able to add a readme to a subgraph', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });
    onTestFinished(() => server.close());

    const subgraphName = genID('subgraph');
    await createSubgraph(client, subgraphName, 'http://localhost:4001');

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

    const addReadmeResponse = await client.addReadme({
      targetName: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      readme: 'Test readme',
    });

    expect(addReadmeResponse.response?.code).toBe(EnumStatusCode.OK);
  });

  test.each(['organization-viewer', 'namespace-viewer', 'subgraph-viewer', 'graph-viewer'])(
    '%s should NOT be able to add a readme',
    async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const subgraphName = genID('subgraph');
      await createSubgraph(client, subgraphName, 'http://localhost:4001');

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

      const addReadmeResponse = await client.addReadme({
        targetName: subgraphName,
        namespace: DEFAULT_NAMESPACE,
        readme: 'Test readme',
      });

      expect(addReadmeResponse.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
    },
  );

  test('Should be able to add a readme when using legacy API key', async (testContext) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const subgraphName = genID('subgraph');
    await createSubgraph(client, subgraphName, 'http://localhost:4001');

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createAPIKeyTestRBACEvaluator(),
    });

    const addReadmeResponse = await client.addReadme({
      targetName: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      readme: 'Test readme',
    });

    expect(addReadmeResponse.response?.code).toBe(EnumStatusCode.OK);
  });

  test('Should accept an empty readme', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const subgraphName = genID('subgraph');
    await createSubgraph(client, subgraphName, 'http://localhost:4001');

    const addReadmeResponse = await client.addReadme({
      targetName: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      readme: '',
    });

    expect(addReadmeResponse.response?.code).toBe(EnumStatusCode.OK);

    const getSubgraphResponse = await client.getSubgraphByName({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    // sanitizeReadme() converts empty/whitespace-only strings to null, so the
    // readme is stored as null and returned as undefined.
    expect(getSubgraphResponse.graph?.readme).toBe(undefined);
  });
});
