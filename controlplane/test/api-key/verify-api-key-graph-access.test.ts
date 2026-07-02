import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
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

describe('VerifyAPIKeyGraphAccess', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('organization-admin should have admin/developer permissions and write access', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const graphName = genID('fedgraph');
    await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

    const getGraphResponse = await client.getFederatedGraphByName({
      name: graphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(getGraphResponse.response?.code).toBe(EnumStatusCode.OK);

    const response = await client.verifyAPIKeyGraphAccess({
      federatedGraphId: getGraphResponse.graph!.id,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.hasOrganizationAdminOrDeveloperPermissions).toBe(true);
    expect(response.hasWriteAccessToGraph).toBe(true);
  });

  test('Should return false for both flags when graph does not exist', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const response = await client.verifyAPIKeyGraphAccess({
      federatedGraphId: '00000000-0000-0000-0000-000000000000',
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.hasOrganizationAdminOrDeveloperPermissions).toBe(false);
    expect(response.hasWriteAccessToGraph).toBe(false);
  });

  test('organization-developer should have admin/developer permissions and write access', async (testContext) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const graphName = genID('fedgraph');
    await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

    const getGraphResponse = await client.getFederatedGraphByName({
      name: graphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(getGraphResponse.response?.code).toBe(EnumStatusCode.OK);

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({ role: 'organization-developer' })),
    });

    const response = await client.verifyAPIKeyGraphAccess({
      federatedGraphId: getGraphResponse.graph!.id,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.hasOrganizationAdminOrDeveloperPermissions).toBe(true);
    expect(response.hasWriteAccessToGraph).toBe(true);
  });

  test.each(['organization-viewer', 'organization-apikey-manager'])(
    '%s should NOT have admin/developer permissions',
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
        rbac: createTestRBACEvaluator(createTestGroup({ role })),
      });

      const response = await client.verifyAPIKeyGraphAccess({
        federatedGraphId: getGraphResponse.graph!.id,
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);
      expect(response.hasOrganizationAdminOrDeveloperPermissions).toBe(false);
    },
  );

  test('graph-admin should have write access but not org-level permissions', async (testContext) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

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
          role: 'graph-admin',
          resources: [getGraphResponse.graph!.targetId],
        }),
      ),
    });

    const response = await client.verifyAPIKeyGraphAccess({
      federatedGraphId: getGraphResponse.graph!.id,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.hasOrganizationAdminOrDeveloperPermissions).toBe(false);
    expect(response.hasWriteAccessToGraph).toBe(true);
  });

  test('graph-viewer should NOT have write access', async (testContext) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

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
          role: 'graph-viewer',
          resources: [getGraphResponse.graph!.targetId],
        }),
      ),
    });

    const response = await client.verifyAPIKeyGraphAccess({
      federatedGraphId: getGraphResponse.graph!.id,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.hasOrganizationAdminOrDeveloperPermissions).toBe(false);
    expect(response.hasWriteAccessToGraph).toBe(false);
  });
});
