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

  test('Should be possible to subscribe for a federated graph that belong to the same organization', async (testContext) => {
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
      throw new Error('Jim Graph could not be found');
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

  test('Should not be possible to create a webhook for a federated graph that dont belong to the user organization', async (testContext) => {
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
      throw new Error('Jim Graph could not be found');
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
      throw new Error('Jim Graph could not be found');
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

    const createAliceWebhook = await client.createOrganizationWebhookConfig({
      endpoint: 'http://localhost:8081',
      eventsMeta: [
        {
          eventName: OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED,
          meta: {
            case: 'federatedGraphSchemaUpdated',
            value: {
              graphIds: [aliceGraph.graph.id],
            },
          },
        },
      ],
    });

    expect(createAliceWebhook.response?.code).toBe(EnumStatusCode.OK);

    authenticator.changeUser(TestUser.adminJimCompanyB);

    const updateAliceWebhook = await client.updateOrganizationWebhookConfig({
      id: createAliceWebhook.webhookConfigId,
      endpoint: 'http://localhost:8081',
      eventsMeta: [
        {
          eventName: OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED,
          meta: {
            case: 'federatedGraphSchemaUpdated',
            value: {
              graphIds: [aliceGraph.graph.id],
            },
          },
        },
        {
          eventName: OrganizationEventName.MONOGRAPH_SCHEMA_UPDATED,
          meta: {
            case: 'monographSchemaUpdated',
            value: {
              graphIds: [],
            },
          },
        },
        {
          eventName: OrganizationEventName.PROPOSAL_STATE_UPDATED,
          meta: {
            case: 'proposalStateUpdated',
            value: {
              graphIds: [],
            },
          },
        },
      ],
    });

    expect(updateAliceWebhook.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

    await server.close();
  });

  test('Should be able to create a webhook for proposal state updates', async (testContext) => {
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

    const createWebhook = await client.createOrganizationWebhookConfig({
      endpoint: 'http://localhost:8081',
      events: [OrganizationEventName[OrganizationEventName.PROPOSAL_STATE_UPDATED]],
      eventsMeta: [
        {
          eventName: OrganizationEventName.PROPOSAL_STATE_UPDATED,
          meta: {
            case: 'proposalStateUpdated',
            value: {
              graphIds: [graph?.graph?.id],
            },
          },
        },
      ],
    });

    expect(createWebhook.response?.code).toBe(EnumStatusCode.OK);

    // Retrieve all webhook configurations to verify the webhook was created
    const getWebhooksRes = await client.getOrganizationWebhookConfigs({});

    expect(getWebhooksRes.response?.code).toBe(EnumStatusCode.OK);
    expect(getWebhooksRes.configs.length).toBe(1);
    expect(getWebhooksRes.configs[0].events).toContain(
      OrganizationEventName[OrganizationEventName.PROPOSAL_STATE_UPDATED],
    );
    expect(getWebhooksRes.configs[0].endpoint).toBe('http://localhost:8081');

    // Now get the metadata for this webhook to verify the proposal state updated event
    const getWebhookMetaRes = await client.getOrganizationWebhookMeta({
      id: createWebhook.webhookConfigId,
    });

    expect(getWebhookMetaRes.response?.code).toBe(EnumStatusCode.OK);

    // Verify the metadata contains our proposal state updated event
    const proposalEvent = getWebhookMetaRes.eventsMeta?.find(
      (event) => event.eventName === OrganizationEventName.PROPOSAL_STATE_UPDATED,
    );

    expect(proposalEvent).toBeDefined();
    expect(proposalEvent?.meta.case).toBe('proposalStateUpdated');
    expect(proposalEvent?.meta.value?.graphIds).toContain(graph.graph.id);

    await server.close();
  });

  test('Should be able to update a webhook to include proposal state update events', async (testContext) => {
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

    // First create a webhook for schema updates
    const createWebhook = await client.createOrganizationWebhookConfig({
      endpoint: 'http://localhost:8081',
      events: [OrganizationEventName[OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED]],
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

    expect(createWebhook.response?.code).toBe(EnumStatusCode.OK);

    // Now update the webhook to include proposal state updates
    const updateWebhook = await client.updateOrganizationWebhookConfig({
      id: createWebhook.webhookConfigId,
      endpoint: 'http://localhost:8081',
      events: [
        OrganizationEventName[OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED],
        OrganizationEventName[OrganizationEventName.PROPOSAL_STATE_UPDATED],
      ],
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
        {
          eventName: OrganizationEventName.MONOGRAPH_SCHEMA_UPDATED,
          meta: {
            case: 'monographSchemaUpdated',
            value: {
              graphIds: [],
            },
          },
        },
        {
          eventName: OrganizationEventName.PROPOSAL_STATE_UPDATED,
          meta: {
            case: 'proposalStateUpdated',
            value: {
              graphIds: [graph?.graph?.id],
            },
          },
        },
      ],
    });

    expect(updateWebhook.response?.code).toBe(EnumStatusCode.OK);

    // Retrieve all webhook configurations to verify the webhook was created
    const getWebhooksRes = await client.getOrganizationWebhookConfigs({});
    expect(getWebhooksRes.response?.code).toBe(EnumStatusCode.OK);
    expect(getWebhooksRes.configs.length).toBe(1);

    // Verify the updated webhook metadata includes both events
    const getWebhookMetaRes = await client.getOrganizationWebhookMeta({
      id: createWebhook.webhookConfigId,
    });

    expect(getWebhookMetaRes.response?.code).toBe(EnumStatusCode.OK);

    // Check for the schema updated event
    const schemaEvent = getWebhookMetaRes.eventsMeta?.find(
      (event) => event.eventName === OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED,
    );

    expect(schemaEvent).toBeDefined();
    expect(schemaEvent?.meta.case).toBe('federatedGraphSchemaUpdated');
    expect(schemaEvent?.meta.value?.graphIds).toContain(graph.graph.id);

    // Check for the proposal state updated event
    const proposalEvent = getWebhookMetaRes.eventsMeta?.find(
      (event) => event.eventName === OrganizationEventName.PROPOSAL_STATE_UPDATED,
    );

    expect(proposalEvent).toBeDefined();
    expect(proposalEvent?.meta.case).toBe('proposalStateUpdated');
    expect(proposalEvent?.meta.value?.graphIds).toContain(graph.graph.id);

    await server.close();
  });
});
