import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { OrganizationEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import { afterAllSetup, beforeAllSetup, genID, TestUser } from '../src/core/test-util.js';
import { SetupTest } from './test-util.js';

let dbname = '';

describe('Webhooks', (ctx) => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should be able to create a webhook for a federated graph', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });

    const fedGraphName = genID('fedGraph');

    const createFedGraphRes = await client.createFederatedGraph({
      name: fedGraphName,
      namespace: 'default',
      routingUrl: 'http://localhost:8081',
    });

    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    const graph = await client.getFederatedGraphByName({
      name: fedGraphName,
      namespace: 'default',
    });

    if (!graph.graph) {
      throw new Error('Graph could not be found');
    }

    expect(graph.response?.code).toBe(EnumStatusCode.OK);
    expect(graph.graph?.name).toBe(fedGraphName);

    await client.createOrganizationWebhookConfig({
      endpoint: 'http://localhost:8081',
      eventsMeta: [
        {
          eventName: OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED,
          meta: {
            case: 'federatedGraphSchemaUpdated',
            value: {
              graphIds: [graph?.graph?.id],
            },
          },
        },
      ],
    });

    await server.close();
  });

  test('Should be possible to subscribe for a federated graph that dont belong to the same organization', async (testContext) => {
    const { client, server, authenticator } = await SetupTest({ dbname, enableMultiUsers: true });

    const aliceFedGraphId = genID('fedGraph');
    const bobFedGraphId = genID('fedGraph');

    const createAliceGraphRes = await client.createFederatedGraph({
      name: aliceFedGraphId,
      namespace: 'default',
      routingUrl: 'http://localhost:8081',
    });

    expect(createAliceGraphRes.response?.code).toBe(EnumStatusCode.OK);

    authenticator.changeUser(TestUser.adminBobCompanyA);

    const createBobGraphRes = await client.createFederatedGraph({
      name: bobFedGraphId,
      namespace: 'default',
      routingUrl: 'http://localhost:8081',
    });

    expect(createBobGraphRes.response?.code).toBe(EnumStatusCode.OK);

    const bobGraph = await client.getFederatedGraphByName({
      name: bobFedGraphId,
      namespace: 'default',
    });

    if (!bobGraph.graph) {
      throw new Error('Bob Graph could not be found');
    }

    expect(bobGraph.response?.code).toBe(EnumStatusCode.OK);
    expect(bobGraph.graph?.name).toBe(bobFedGraphId);

    authenticator.changeUser(TestUser.adminAliceCompanyA);

    const aliceGraph = await client.getFederatedGraphByName({
      name: aliceFedGraphId,
      namespace: 'default',
    });

    if (!aliceGraph.graph) {
      throw new Error('Alice Graph could not be found');
    }

    expect(aliceGraph.response?.code).toBe(EnumStatusCode.OK);
    expect(aliceGraph.graph?.name).toBe(aliceFedGraphId);

    // Alice should not be able to subscribe to Bob's graph
    const createWebhook = await client.createOrganizationWebhookConfig({
      endpoint: 'http://localhost:8081',
      eventsMeta: [
        {
          eventName: OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED,
          meta: {
            case: 'federatedGraphSchemaUpdated',
            value: {
              graphIds: [bobGraph.graph.id],
            },
          },
        },
      ],
    });

    expect(createWebhook.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('Should not be possible to subscribe for a federated graph that dont belong to the user organization', async (testContext) => {
    const { client, server, authenticator } = await SetupTest({ dbname, enableMultiUsers: true });

    const aliceFedGraphId = genID('fedGraph');
    const jimFedGraphId = genID('fedGraph');

    const createAliceGraphRes = await client.createFederatedGraph({
      name: aliceFedGraphId,
      namespace: 'default',
      routingUrl: 'http://localhost:8081',
    });

    expect(createAliceGraphRes.response?.code).toBe(EnumStatusCode.OK);

    authenticator.changeUser(TestUser.adminJimCompanyB);

    const createJimGraphRes = await client.createFederatedGraph({
      name: jimFedGraphId,
      namespace: 'default',
      routingUrl: 'http://localhost:8081',
    });

    expect(createJimGraphRes.response?.code).toBe(EnumStatusCode.OK);

    const jimGraph = await client.getFederatedGraphByName({
      name: jimFedGraphId,
      namespace: 'default',
    });

    if (!jimGraph.graph) {
      throw new Error('Bob Graph could not be found');
    }

    expect(jimGraph.response?.code).toBe(EnumStatusCode.OK);
    expect(jimGraph.graph?.name).toBe(jimFedGraphId);

    authenticator.changeUser(TestUser.adminAliceCompanyA);

    const aliceGraph = await client.getFederatedGraphByName({
      name: aliceFedGraphId,
      namespace: 'default',
    });

    if (!aliceGraph.graph) {
      throw new Error('Alice Graph could not be found');
    }

    expect(aliceGraph.response?.code).toBe(EnumStatusCode.OK);
    expect(aliceGraph.graph?.name).toBe(aliceFedGraphId);

    // Alice should not be able to subscribe to Jim's graph
    const createWebhook = await client.createOrganizationWebhookConfig({
      endpoint: 'http://localhost:8081',
      eventsMeta: [
        {
          eventName: OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED,
          meta: {
            case: 'federatedGraphSchemaUpdated',
            value: {
              graphIds: [jimGraph.graph.id],
            },
          },
        },
      ],
    });

    expect(createWebhook.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

    await server.close();
  });

  test('Should not be possible to update a webhook for a federated graph that dont belong to the user organization', async (testContext) => {
    const { client, server, authenticator } = await SetupTest({ dbname, enableMultiUsers: true });

    const aliceFedGraphId = genID('fedGraph');
    const jimFedGraphId = genID('fedGraph');

    const createAliceGraphRes = await client.createFederatedGraph({
      name: aliceFedGraphId,
      namespace: 'default',
      routingUrl: 'http://localhost:8081',
    });

    expect(createAliceGraphRes.response?.code).toBe(EnumStatusCode.OK);

    authenticator.changeUser(TestUser.adminJimCompanyB);

    const createJimGraphRes = await client.createFederatedGraph({
      name: jimFedGraphId,
      namespace: 'default',
      routingUrl: 'http://localhost:8081',
    });

    expect(createJimGraphRes.response?.code).toBe(EnumStatusCode.OK);

    const jimGraph = await client.getFederatedGraphByName({
      name: jimFedGraphId,
      namespace: 'default',
    });

    if (!jimGraph.graph) {
      throw new Error('Bob Graph could not be found');
    }

    expect(jimGraph.response?.code).toBe(EnumStatusCode.OK);
    expect(jimGraph.graph?.name).toBe(jimFedGraphId);

    authenticator.changeUser(TestUser.adminAliceCompanyA);

    const aliceGraph = await client.getFederatedGraphByName({
      name: aliceFedGraphId,
      namespace: 'default',
    });

    if (!aliceGraph.graph) {
      throw new Error('Alice Graph could not be found');
    }

    expect(aliceGraph.response?.code).toBe(EnumStatusCode.OK);
    expect(aliceGraph.graph?.name).toBe(aliceFedGraphId);

    // Alice should not be able to subscribe to Jim's graph
    const createWebhook = await client.updateOrganizationWebhookConfig({
      endpoint: 'http://localhost:8081',
      eventsMeta: [
        {
          eventName: OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED,
          meta: {
            case: 'federatedGraphSchemaUpdated',
            value: {
              graphIds: [jimGraph.graph.id],
            },
          },
        },
      ],
    });

    expect(createWebhook.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

    await server.close();
  });
});
