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
import { DEFAULT_NAMESPACE, createFederatedGraph, SetupTest } from '../test-util.js';

let dbname = '';

describe('Router Tokens', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  describe('createFederatedGraphToken', () => {
    test('Should create a router token for a federated graph', async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      const graphName = genID('fedgraph');
      await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

      const response = await client.createFederatedGraphToken({
        graphName,
        namespace: DEFAULT_NAMESPACE,
        tokenName: 'my-token',
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);
      expect(typeof response.token).toBe('string');
      expect(response.token).not.toBe('');
    });

    test('Should fail when the federated graph does not exist', async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      const response = await client.createFederatedGraphToken({
        graphName: 'nonexistent',
        namespace: DEFAULT_NAMESPACE,
        tokenName: 'my-token',
      });

      expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
      expect(response.response?.details).toContain("Federated graph 'nonexistent' not found");
    });

    test('Should fail when a token with the same name already exists', async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      const graphName = genID('fedgraph');
      await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

      const firstResponse = await client.createFederatedGraphToken({
        graphName,
        namespace: DEFAULT_NAMESPACE,
        tokenName: 'duplicate-token',
      });
      expect(firstResponse.response?.code).toBe(EnumStatusCode.OK);

      const duplicateResponse = await client.createFederatedGraphToken({
        graphName,
        namespace: DEFAULT_NAMESPACE,
        tokenName: 'duplicate-token',
      });

      expect(duplicateResponse.response?.code).toBe(EnumStatusCode.ERR_ALREADY_EXISTS);
      expect(duplicateResponse.response?.details).toContain("Router token 'duplicate-token' already exists");
    });

    test.each(['organization-admin', 'organization-developer', 'graph-admin'])(
      '%s should be able to create a router token',
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

        const response = await client.createFederatedGraphToken({
          graphName,
          namespace: DEFAULT_NAMESPACE,
          tokenName: `token-${role}`,
        });

        expect(response.response?.code).toBe(EnumStatusCode.OK);
        expect(response.token).not.toBe('');
      },
    );

    test.each(['organization-viewer', 'graph-viewer', 'subgraph-viewer', 'subgraph-publisher'])(
      '%s should NOT be able to create a router token',
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

        const response = await client.createFederatedGraphToken({
          graphName,
          namespace: DEFAULT_NAMESPACE,
          tokenName: 'unauthorized-token',
        });

        expect(response.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
      },
    );
  });

  describe('getRouterTokens', () => {
    test('Should return empty list when no tokens exist', async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      const graphName = genID('fedgraph');
      await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

      const response = await client.getRouterTokens({
        fedGraphName: graphName,
        namespace: DEFAULT_NAMESPACE,
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);
      expect(response.tokens).toEqual([]);
    });

    test('Should return created tokens without the token value', async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      const graphName = genID('fedgraph');
      await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

      await client.createFederatedGraphToken({
        graphName,
        namespace: DEFAULT_NAMESPACE,
        tokenName: 'token-1',
      });

      // The JWT payload for router tokens only varies by `iat` (seconds precision).
      // Wait >1s so the second token's JWT is unique and doesn't violate the DB
      // unique constraint on the token column.
      await new Promise((resolve) => setTimeout(resolve, 1100));

      await client.createFederatedGraphToken({
        graphName,
        namespace: DEFAULT_NAMESPACE,
        tokenName: 'token-2',
      });

      const response = await client.getRouterTokens({
        fedGraphName: graphName,
        namespace: DEFAULT_NAMESPACE,
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);
      expect(response.tokens).toHaveLength(2);

      const names = response.tokens.map((t) => t.name).sort();
      expect(names).toEqual(['token-1', 'token-2']);

      // id and createdAt should be populated
      for (const token of response.tokens) {
        expect(token.id).not.toBe('');
        expect(token.createdAt).not.toBe('');
      }
    });

    test('Should fail when the federated graph does not exist', async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      const response = await client.getRouterTokens({
        fedGraphName: 'nonexistent',
        namespace: DEFAULT_NAMESPACE,
      });

      expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    });

    test.each(['organization-admin', 'organization-developer', 'graph-admin', 'graph-viewer'])(
      '%s should be able to list router tokens',
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

        const response = await client.getRouterTokens({
          fedGraphName: graphName,
          namespace: DEFAULT_NAMESPACE,
        });

        expect(response.response?.code).toBe(EnumStatusCode.OK);
      },
    );

    test.each(['graph-admin', 'graph-viewer', 'subgraph-admin', 'subgraph-viewer'])(
      '%s scoped to a different graph should NOT be able to list router tokens',
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

        authenticator.changeUserWithSuppliedContext({
          ...users.adminAliceCompanyA,
          rbac: createTestRBACEvaluator(
            createTestGroup({
              role,
              resources: [otherGraphResponse.graph!.targetId],
            }),
          ),
        });

        const response = await client.getRouterTokens({
          fedGraphName: targetGraphName,
          namespace: DEFAULT_NAMESPACE,
        });

        expect(response.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
      },
    );
  });

  describe('deleteRouterToken', () => {
    test('Should delete an existing token', async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      const graphName = genID('fedgraph');
      await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

      await client.createFederatedGraphToken({
        graphName,
        namespace: DEFAULT_NAMESPACE,
        tokenName: 'to-delete',
      });

      const deleteResponse = await client.deleteRouterToken({
        fedGraphName: graphName,
        namespace: DEFAULT_NAMESPACE,
        tokenName: 'to-delete',
      });

      expect(deleteResponse.response?.code).toBe(EnumStatusCode.OK);

      // Verify the token is gone
      const listResponse = await client.getRouterTokens({
        fedGraphName: graphName,
        namespace: DEFAULT_NAMESPACE,
      });
      expect(listResponse.tokens.find((t) => t.name === 'to-delete')).toBe(undefined);
    });

    test('Should fail when the federated graph does not exist', async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      const response = await client.deleteRouterToken({
        fedGraphName: 'nonexistent',
        namespace: DEFAULT_NAMESPACE,
        tokenName: 'some-token',
      });

      expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    });

    test('Should fail when the token does not exist', async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      const graphName = genID('fedgraph');
      await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

      const response = await client.deleteRouterToken({
        fedGraphName: graphName,
        namespace: DEFAULT_NAMESPACE,
        tokenName: 'nonexistent-token',
      });

      expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
      expect(response.response?.details).toContain("Router token 'nonexistent-token' doesn't exist");
    });

    test.each(['organization-viewer', 'graph-viewer', 'subgraph-viewer'])(
      '%s should NOT be able to delete a router token',
      async (role) => {
        const { client, server, authenticator, users } = await SetupTest({ dbname });
        onTestFinished(() => server.close());

        const graphName = genID('fedgraph');
        await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

        await client.createFederatedGraphToken({
          graphName,
          namespace: DEFAULT_NAMESPACE,
          tokenName: 'protected-token',
        });

        const getGraphResponse = await client.getFederatedGraphByName({
          name: graphName,
          namespace: DEFAULT_NAMESPACE,
        });

        authenticator.changeUserWithSuppliedContext({
          ...users.adminAliceCompanyA,
          rbac: createTestRBACEvaluator(
            createTestGroup({
              role,
              resources: [getGraphResponse.graph!.targetId],
            }),
          ),
        });

        const response = await client.deleteRouterToken({
          fedGraphName: graphName,
          namespace: DEFAULT_NAMESPACE,
          tokenName: 'protected-token',
        });

        expect(response.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
      },
    );
  });
});
