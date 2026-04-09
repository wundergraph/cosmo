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
import { DEFAULT_NAMESPACE, createNamespace, SetupTest } from '../test-util.js';

let dbname = '';

describe('Namespace Checks Configuration', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  describe('getNamespaceChecksConfig', () => {
    test('Should return config for the default namespace', async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      const response = await client.getNamespaceChecksConfig({
        namespace: DEFAULT_NAMESPACE,
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);
      // Default retention limit is 7 days, timeframe defaults to the limit
      expect(response.timeframeInDays).toBe(7);
      expect(response.timeframeLimitInDays).toBe(7);
    });

    test('Should return default config for a newly created namespace', async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      const namespace = await createNamespace(client, genID('ns'));

      const response = await client.getNamespaceChecksConfig({
        namespace,
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);
      expect(response.timeframeInDays).toBe(7);
      expect(response.timeframeLimitInDays).toBe(7);
    });

    test('Should fail when namespace does not exist', async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      const response = await client.getNamespaceChecksConfig({
        namespace: 'nonexistent-namespace',
      });

      expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
      expect(response.response?.details).toContain(`Namespace 'nonexistent-namespace' not found`);
      expect(response.timeframeInDays).toBe(0);
      expect(response.timeframeLimitInDays).toBe(0);
    });

    test.each([
      'organization-admin',
      'organization-developer',
      'organization-viewer',
      'namespace-admin',
      'namespace-viewer',
    ])('%s should be able to get namespace checks config', async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const namespace = await createNamespace(client, genID('ns'));

      const getNamespaceResponse = await client.getNamespace({ name: namespace });
      expect(getNamespaceResponse.response?.code).toBe(EnumStatusCode.OK);

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(
          createTestGroup({
            role,
            namespaces: [getNamespaceResponse.namespace!.id],
          }),
        ),
      });

      const response = await client.getNamespaceChecksConfig({ namespace });

      expect(response.response?.code).toBe(EnumStatusCode.OK);
    });

    test.each(['namespace-admin', 'namespace-viewer'])(
      '%s scoped to a different namespace should NOT have read access',
      async (role) => {
        const { client, server, authenticator, users } = await SetupTest({ dbname });
        onTestFinished(() => server.close());

        const targetNamespace = await createNamespace(client, genID('ns'));

        const otherNamespace = await createNamespace(client, genID('other'));

        const getOtherResponse = await client.getNamespace({ name: otherNamespace });
        expect(getOtherResponse.response?.code).toBe(EnumStatusCode.OK);

        // Scope the role to the OTHER namespace, not the one we're querying
        authenticator.changeUserWithSuppliedContext({
          ...users.adminAliceCompanyA,
          rbac: createTestRBACEvaluator(
            createTestGroup({
              role,
              namespaces: [getOtherResponse.namespace!.id],
            }),
          ),
        });

        const response = await client.getNamespaceChecksConfig({ namespace: targetNamespace });

        expect(response.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
      },
    );
  });

  describe('updateNamespaceChecksConfig', () => {
    test('Should update the timeframe for a namespace', async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      const namespace = await createNamespace(client, genID('ns'));

      // Default timeframe is 7 days — verify this first
      const beforeResponse = await client.getNamespaceChecksConfig({ namespace });
      expect(beforeResponse.timeframeInDays).toBe(7);

      // Update to a different value
      const response = await client.updateNamespaceChecksConfig({
        namespace,
        timeframeInDays: 3,
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);

      const afterResponse = await client.getNamespaceChecksConfig({ namespace });
      expect(afterResponse.timeframeInDays).toBe(3);
    });

    test('Should clamp the timeframe to the upper limit', async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      const namespace = await createNamespace(client, genID('ns'));

      const getResponse = await client.getNamespaceChecksConfig({ namespace });
      const limit = getResponse.timeframeLimitInDays;

      const response = await client.updateNamespaceChecksConfig({
        namespace,
        timeframeInDays: limit + 1000,
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);

      const getAfter = await client.getNamespaceChecksConfig({ namespace });
      expect(getAfter.timeframeInDays).toBe(limit);
    });

    test('Should clamp the timeframe to the lower bound (1 day)', async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      const namespace = await createNamespace(client, genID('ns'));

      const response = await client.updateNamespaceChecksConfig({
        namespace,
        timeframeInDays: 0,
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);

      const getResponse = await client.getNamespaceChecksConfig({ namespace });
      expect(getResponse.timeframeInDays).toBe(1);
    });

    test('Should fail when namespace does not exist', async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      const response = await client.updateNamespaceChecksConfig({
        namespace: 'nonexistent-namespace',
        timeframeInDays: 7,
      });

      expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
      expect(response.response?.details).toContain(`Namespace 'nonexistent-namespace' not found`);
    });

    test.each(['organization-admin', 'organization-developer', 'namespace-admin'])(
      '%s should be able to update namespace checks config',
      async (role) => {
        const { client, server, authenticator, users } = await SetupTest({ dbname });
        onTestFinished(() => server.close());

        const namespace = await createNamespace(client, genID('ns'));

        const getNamespaceResponse = await client.getNamespace({ name: namespace });
        expect(getNamespaceResponse.response?.code).toBe(EnumStatusCode.OK);

        authenticator.changeUserWithSuppliedContext({
          ...users.adminAliceCompanyA,
          rbac: createTestRBACEvaluator(
            createTestGroup({
              role,
              namespaces: [getNamespaceResponse.namespace!.id],
            }),
          ),
        });

        const response = await client.updateNamespaceChecksConfig({
          namespace,
          timeframeInDays: 4,
        });

        expect(response.response?.code).toBe(EnumStatusCode.OK);
      },
    );

    test.each(['organization-viewer', 'namespace-viewer', 'graph-viewer', 'subgraph-viewer'])(
      '%s should NOT be able to update namespace checks config',
      async (role) => {
        const { client, server, authenticator, users } = await SetupTest({ dbname });
        onTestFinished(() => server.close());

        const namespace = await createNamespace(client, genID('ns'));

        const getNamespaceResponse = await client.getNamespace({ name: namespace });
        expect(getNamespaceResponse.response?.code).toBe(EnumStatusCode.OK);

        authenticator.changeUserWithSuppliedContext({
          ...users.adminAliceCompanyA,
          rbac: createTestRBACEvaluator(
            createTestGroup({
              role,
              namespaces: [getNamespaceResponse.namespace!.id],
            }),
          ),
        });

        const response = await client.updateNamespaceChecksConfig({
          namespace,
          timeframeInDays: 4,
        });

        expect(response.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
      },
    );
  });
});
