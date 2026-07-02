import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { formatISO, subDays, subYears } from 'date-fns';
import { afterAll, beforeAll, describe, expect, onTestFinished, test } from 'vitest';
import {
  afterAllSetup,
  beforeAllSetup,
  createTestGroup,
  createTestRBACEvaluator,
  genID,
} from '../../src/core/test-util.js';
import { DEFAULT_NAMESPACE, createFederatedGraph, SetupTest } from '../test-util.js';

let dbname = '';

describe('GetFederatedGraphChangelog', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should return empty changelog for a graph with no changes', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const graphName = genID('fedgraph');
    await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

    const now = new Date();
    const yesterday = subDays(now, 1);

    const response = await client.getFederatedGraphChangelog({
      name: graphName,
      namespace: DEFAULT_NAMESPACE,
      pagination: { limit: 10, offset: 0 },
      dateRange: {
        start: formatISO(yesterday),
        end: formatISO(now),
      },
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.federatedGraphChangelogOutput).toEqual([]);
    expect(response.hasNextPage).toBe(false);
  });

  test('Should fail when the graph does not exist', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const now = new Date();
    const yesterday = subDays(now, 1);

    const response = await client.getFederatedGraphChangelog({
      name: 'nonexistent',
      namespace: DEFAULT_NAMESPACE,
      pagination: { limit: 10, offset: 0 },
      dateRange: {
        start: formatISO(yesterday),
        end: formatISO(now),
      },
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(response.federatedGraphChangelogOutput).toEqual([]);
    expect(response.hasNextPage).toBe(false);
  });

  test('Should fail when pagination is missing', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const graphName = genID('fedgraph');
    await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

    const response = await client.getFederatedGraphChangelog({
      name: graphName,
      namespace: DEFAULT_NAMESPACE,
      dateRange: {
        start: formatISO(subDays(new Date(), 1)),
        end: formatISO(new Date()),
      },
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR);
    expect(response.response?.details).toBe('Please provide pagination and daterange');
  });

  test('Should fail when dateRange is missing', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const graphName = genID('fedgraph');
    await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

    const response = await client.getFederatedGraphChangelog({
      name: graphName,
      namespace: DEFAULT_NAMESPACE,
      pagination: { limit: 10, offset: 0 },
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR);
    expect(response.response?.details).toBe('Please provide pagination and daterange');
  });

  test('Should fail when dateRange is invalid', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const graphName = genID('fedgraph');
    await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

    // Use a very old date (beyond retention) and invalid range
    const response = await client.getFederatedGraphChangelog({
      name: graphName,
      namespace: DEFAULT_NAMESPACE,
      pagination: { limit: 10, offset: 0 },
      dateRange: {
        start: formatISO(subYears(new Date(), 5)),
        end: formatISO(subYears(new Date(), 4)),
      },
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR);
  });

  test.each(['organization-admin', 'organization-developer', 'organization-viewer', 'graph-admin', 'graph-viewer'])(
    '%s should be able to get the federated graph changelog',
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

      const response = await client.getFederatedGraphChangelog({
        name: graphName,
        namespace: DEFAULT_NAMESPACE,
        pagination: { limit: 10, offset: 0 },
        dateRange: {
          start: formatISO(subDays(new Date(), 1)),
          end: formatISO(new Date()),
        },
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);
    },
  );

  test.each(['graph-admin', 'graph-viewer', 'subgraph-admin', 'subgraph-viewer'])(
    '%s scoped to a different graph should NOT have access',
    async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      // Target graph we'll query
      const targetGraphName = genID('fedgraph');
      await createFederatedGraph(client, targetGraphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

      // A different graph the user WILL be scoped to
      const otherGraphName = genID('other');
      await createFederatedGraph(client, otherGraphName, DEFAULT_NAMESPACE, [], 'http://localhost:8081');

      const otherGraphResponse = await client.getFederatedGraphByName({
        name: otherGraphName,
        namespace: DEFAULT_NAMESPACE,
      });
      expect(otherGraphResponse.response?.code).toBe(EnumStatusCode.OK);

      // Scope the role only to the OTHER graph, not the target
      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(
          createTestGroup({
            role,
            resources: [otherGraphResponse.graph!.targetId],
          }),
        ),
      });

      const response = await client.getFederatedGraphChangelog({
        name: targetGraphName,
        namespace: DEFAULT_NAMESPACE,
        pagination: { limit: 10, offset: 0 },
        dateRange: {
          start: formatISO(subDays(new Date(), 1)),
          end: formatISO(new Date()),
        },
      });

      expect(response.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
    },
  );
});
