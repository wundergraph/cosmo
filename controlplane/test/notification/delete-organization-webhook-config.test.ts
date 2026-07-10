import { Client } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { OrganizationEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
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

async function createWebhookConfig(
  client: Client<typeof PlatformService>,
  graphId: string,
  endpoint = 'http://localhost:8081',
) {
  const response = await client.createOrganizationWebhookConfig({
    endpoint,
    key: 'secret',
    events: ['federatedGraphSchemaUpdated'],
    eventsMeta: [
      {
        eventName: OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED,
        meta: {
          case: 'federatedGraphSchemaUpdated',
          value: {
            graphIds: [graphId],
          },
        },
      },
    ],
  });
  expect(response.response?.code).toBe(EnumStatusCode.OK);

  const configs = await client.getOrganizationWebhookConfigs({});
  expect(configs.response?.code).toBe(EnumStatusCode.OK);
  const created = configs.configs.find((c) => c.endpoint === endpoint);
  expect(created?.endpoint).toBe(endpoint);
  return created!.id;
}

describe('DeleteOrganizationWebhookConfig', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should delete an existing webhook config', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const graphName = genID('fedgraph');
    await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

    const graph = await client.getFederatedGraphByName({
      name: graphName,
      namespace: DEFAULT_NAMESPACE,
    });

    const webhookId = await createWebhookConfig(client, graph.graph!.id);

    const response = await client.deleteOrganizationWebhookConfig({
      id: webhookId,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);

    // Verify it was deleted
    const configs = await client.getOrganizationWebhookConfigs({});
    expect(configs.configs.find((c) => c.id === webhookId)).toBe(undefined);
  });

  test('Should fail when id is empty', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const response = await client.deleteOrganizationWebhookConfig({
      id: '',
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR);
    expect(response.response?.details).toContain('Webhook config id is required');
  });

  test('Should fail when webhook config does not exist', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const response = await client.deleteOrganizationWebhookConfig({
      id: '00000000-0000-0000-0000-000000000000',
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(response.response?.details).toContain('Webhook config not found');
  });

  test.each(['organization-admin', 'organization-developer'])(
    '%s should be able to delete a webhook config',
    async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphName = genID('fedgraph');
      await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

      const graph = await client.getFederatedGraphByName({
        name: graphName,
        namespace: DEFAULT_NAMESPACE,
      });

      const webhookId = await createWebhookConfig(
        client,
        graph.graph!.id,
        `http://localhost:808${Math.floor(Math.random() * 10)}`,
      );

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(createTestGroup({ role })),
      });

      const response = await client.deleteOrganizationWebhookConfig({
        id: webhookId,
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);
    },
  );

  test.each(['organization-viewer', 'organization-apikey-manager', 'namespace-admin', 'graph-admin', 'subgraph-admin'])(
    '%s should NOT be able to delete a webhook config',
    async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphName = genID('fedgraph');
      await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

      const graph = await client.getFederatedGraphByName({
        name: graphName,
        namespace: DEFAULT_NAMESPACE,
      });

      const webhookId = await createWebhookConfig(
        client,
        graph.graph!.id,
        `http://localhost:909${Math.floor(Math.random() * 10)}`,
      );

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(createTestGroup({ role })),
      });

      const response = await client.deleteOrganizationWebhookConfig({
        id: webhookId,
      });

      expect(response.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
    },
  );
});
