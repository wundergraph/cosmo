import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { OrganizationEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../src/core/test-util.js';
import {
  createFederatedGraph,
  createThenPublishSubgraph,
  DEFAULT_NAMESPACE,
  DEFAULT_ROUTER_URL,
  SetupTest,
} from './test-util.js';

let dbname = '';

const webhookUrl = 'http://graph-lifecycle-webhook.test';

const lifecycleEvents = [
  OrganizationEventName[OrganizationEventName.GRAPH_CREATED],
  OrganizationEventName[OrganizationEventName.GRAPH_DELETED],
];

const movedEvents = ['GRAPH_MOVED'];

describe('Graph lifecycle webhooks', () => {
  let capturedWebhooks: Record<string, unknown>[] = [];
  let capturedDeliveryIds: (string | null)[] = [];
  let failuresBeforeSuccess = 0;

  const mockServer = setupServer(
    http.post(webhookUrl, async ({ request }) => {
      capturedDeliveryIds.push(request.headers.get('X-Cosmo-Delivery-Id'));
      if (failuresBeforeSuccess > 0) {
        failuresBeforeSuccess -= 1;
        return HttpResponse.json({ success: false }, { status: 503 });
      }
      capturedWebhooks.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json({ success: true });
    }),
  );

  beforeAll(async () => {
    mockServer.listen({ onUnhandledRequest: 'bypass' });
    dbname = await beforeAllSetup();
  });

  afterEach(() => {
    capturedWebhooks = [];
    capturedDeliveryIds = [];
    failuresBeforeSuccess = 0;
  });

  afterAll(async () => {
    mockServer.close();
    await afterAllSetup(dbname);
  });

  test('creating and deleting a federated graph sends GRAPH_CREATED and GRAPH_DELETED', async (testContext) => {
    const { client, server, users } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const webhookResponse = await client.createOrganizationWebhookConfig({
      endpoint: webhookUrl,
      events: lifecycleEvents,
      eventsMeta: [],
    });
    expect(webhookResponse.response?.code).toBe(EnumStatusCode.OK);

    const graphName = genID('fedGraph');
    await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], DEFAULT_ROUTER_URL);

    await vi.waitFor(() => {
      expect(capturedWebhooks).toHaveLength(1);
    });

    const graph = await client.getFederatedGraphByName({ name: graphName, namespace: DEFAULT_NAMESPACE });
    const graphId = graph.graph?.id;
    expect(graphId).toBeDefined();

    const organization = {
      id: users.adminAliceCompanyA.organizationId,
      slug: users.adminAliceCompanyA.organizationSlug,
    };
    const lifecycleGraph = { id: graphId, name: graphName, namespace: DEFAULT_NAMESPACE, type: 'federated' };

    expect(capturedWebhooks[0]).toEqual({
      version: 1,
      event: 'GRAPH_CREATED',
      payload: { graph: lifecycleGraph, organization, actor_id: users.adminAliceCompanyA.userId },
    });

    const deleteResponse = await client.deleteFederatedGraph({ name: graphName, namespace: DEFAULT_NAMESPACE });
    expect(deleteResponse.response?.code).toBe(EnumStatusCode.OK);

    await vi.waitFor(() => {
      expect(capturedWebhooks).toHaveLength(2);
    });

    expect(capturedWebhooks[1]).toEqual({
      version: 1,
      event: 'GRAPH_DELETED',
      payload: { graph: lifecycleGraph, organization, actor_id: users.adminAliceCompanyA.userId },
    });
  });

  test('creating and deleting a monograph sends GRAPH_CREATED and GRAPH_DELETED for a monograph', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    await client.createOrganizationWebhookConfig({ endpoint: webhookUrl, events: lifecycleEvents, eventsMeta: [] });

    const monographName = genID('monograph');
    const createResponse = await client.createMonograph({
      name: monographName,
      namespace: DEFAULT_NAMESPACE,
      graphUrl: 'http://localhost:4000',
      routingUrl: 'http://localhost:3002',
    });
    expect(createResponse.response?.code).toBe(EnumStatusCode.OK);

    const deleteResponse = await client.deleteMonograph({ name: monographName, namespace: DEFAULT_NAMESPACE });
    expect(deleteResponse.response?.code).toBe(EnumStatusCode.OK);

    await vi.waitFor(() => {
      expect(capturedWebhooks).toHaveLength(2);
    });

    expect(capturedWebhooks.map((webhook) => webhook.event)).toEqual(['GRAPH_CREATED', 'GRAPH_DELETED']);
    expect(capturedWebhooks.map((webhook) => (webhook.payload as { graph: { type: string } }).graph.type)).toEqual([
      'monograph',
      'monograph',
    ]);
  });

  test('moving a federated graph sends GRAPH_MOVED with its new namespace, for its contracts too', async (testContext) => {
    const { client, server, users } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const graphName = genID('fedGraph');
    const contractName = genID('contract');
    const newNamespace = genID('namespace').toLowerCase();
    const label = genUniqueLabel('label');
    await createThenPublishSubgraph(
      client,
      genID('subgraph'),
      DEFAULT_NAMESPACE,
      'type Query { hello: String! }',
      [label],
      'http://localhost:8082',
    );
    await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [joinLabel(label)], DEFAULT_ROUTER_URL);
    const contractResponse = await client.createContract({
      name: contractName,
      namespace: DEFAULT_NAMESPACE,
      sourceGraphName: graphName,
      excludeTags: ['internal'],
      routingUrl: 'http://localhost:3003',
    });
    expect(contractResponse.response?.code).toBe(EnumStatusCode.OK);
    expect((await client.createNamespace({ name: newNamespace })).response?.code).toBe(EnumStatusCode.OK);

    const graph = await client.getFederatedGraphByName({ name: graphName, namespace: DEFAULT_NAMESPACE });
    const contract = await client.getFederatedGraphByName({ name: contractName, namespace: DEFAULT_NAMESPACE });

    await client.createOrganizationWebhookConfig({ endpoint: webhookUrl, events: movedEvents, eventsMeta: [] });

    // The subgraph stays behind, so the moved graph no longer composes; the move itself still happens.
    await client.moveFederatedGraph({ name: graphName, namespace: DEFAULT_NAMESPACE, newNamespace });
    const moved = await client.getFederatedGraphByName({ name: graphName, namespace: newNamespace });
    expect(moved.graph?.id).toBe(graph.graph?.id);

    await vi.waitFor(() => {
      expect(capturedWebhooks).toHaveLength(2);
    });

    const organization = {
      id: users.adminAliceCompanyA.organizationId,
      slug: users.adminAliceCompanyA.organizationSlug,
    };
    expect(capturedWebhooks).toEqual(
      expect.arrayContaining([
        {
          version: 1,
          event: 'GRAPH_MOVED',
          payload: {
            graph: { id: graph.graph?.id, name: graphName, namespace: newNamespace, type: 'federated' },
            organization,
            actor_id: users.adminAliceCompanyA.userId,
          },
        },
        {
          version: 1,
          event: 'GRAPH_MOVED',
          payload: {
            graph: { id: contract.graph?.id, name: contractName, namespace: newNamespace, type: 'federated' },
            organization,
            actor_id: users.adminAliceCompanyA.userId,
          },
        },
      ]),
    );
  });

  test('moving a monograph sends GRAPH_MOVED with its new namespace', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const monographName = genID('monograph');
    const newNamespace = genID('namespace').toLowerCase();
    await client.createMonograph({
      name: monographName,
      namespace: DEFAULT_NAMESPACE,
      graphUrl: 'http://localhost:4000',
      routingUrl: 'http://localhost:3002',
    });
    await client.createNamespace({ name: newNamespace });
    const monograph = await client.getFederatedGraphByName({ name: monographName, namespace: DEFAULT_NAMESPACE });

    await client.createOrganizationWebhookConfig({ endpoint: webhookUrl, events: movedEvents, eventsMeta: [] });

    const moveResponse = await client.moveMonograph({
      name: monographName,
      namespace: DEFAULT_NAMESPACE,
      newNamespace,
    });
    expect(moveResponse.response?.code).toBe(EnumStatusCode.OK);

    await vi.waitFor(() => {
      expect(capturedWebhooks).toHaveLength(1);
    });

    expect(capturedWebhooks[0].event).toBe('GRAPH_MOVED');
    expect((capturedWebhooks[0].payload as { graph: unknown }).graph).toEqual({
      id: monograph.graph?.id,
      name: monographName,
      namespace: newNamespace,
      type: 'monograph',
    });
  });

  test('renaming a namespace sends GRAPH_MOVED for every graph in it', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const namespace = genID('namespace').toLowerCase();
    const renamed = genID('renamed').toLowerCase();
    const graphName = genID('fedGraph');
    const monographName = genID('monograph');
    await client.createNamespace({ name: namespace });
    await createFederatedGraph(client, graphName, namespace, [], DEFAULT_ROUTER_URL);
    await client.createMonograph({
      name: monographName,
      namespace,
      graphUrl: 'http://localhost:4000',
      routingUrl: 'http://localhost:3002',
    });
    const graph = await client.getFederatedGraphByName({ name: graphName, namespace });
    const monograph = await client.getFederatedGraphByName({ name: monographName, namespace });

    await client.createOrganizationWebhookConfig({ endpoint: webhookUrl, events: movedEvents, eventsMeta: [] });

    const renameResponse = await client.renameNamespace({ name: namespace, newName: renamed });
    expect(renameResponse.response?.code).toBe(EnumStatusCode.OK);

    await vi.waitFor(() => {
      expect(capturedWebhooks).toHaveLength(2);
    });

    const graphs = capturedWebhooks.map((webhook) => {
      expect(webhook.event).toBe('GRAPH_MOVED');
      return (webhook.payload as { graph: unknown }).graph;
    });
    expect(graphs).toEqual(
      expect.arrayContaining([
        { id: graph.graph?.id, name: graphName, namespace: renamed, type: 'federated' },
        { id: monograph.graph?.id, name: monographName, namespace: renamed, type: 'monograph' },
      ]),
    );
  });

  test('every event carries its own delivery id, and a retry of the event repeats it', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    await client.createOrganizationWebhookConfig({ endpoint: webhookUrl, events: lifecycleEvents, eventsMeta: [] });

    failuresBeforeSuccess = 1;
    const graphName = genID('fedGraph');
    await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], DEFAULT_ROUTER_URL);

    await vi.waitFor(
      () => {
        expect(capturedWebhooks).toHaveLength(1);
      },
      { timeout: 10_000 },
    );

    await client.deleteFederatedGraph({ name: graphName, namespace: DEFAULT_NAMESPACE });

    await vi.waitFor(() => {
      expect(capturedWebhooks).toHaveLength(2);
    });

    const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/;
    expect(capturedDeliveryIds).toHaveLength(3);
    const [createdAttempt, createdRetry, deleted] = capturedDeliveryIds;
    expect(createdAttempt).toMatch(uuid);
    expect(createdRetry).toBe(createdAttempt);
    expect(deleted).toMatch(uuid);
    expect(deleted).not.toBe(createdAttempt);
  });

  test('a webhook without the lifecycle events gets neither', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    await client.createOrganizationWebhookConfig({
      endpoint: webhookUrl,
      events: [OrganizationEventName[OrganizationEventName.ORGANIZATION_GOVERNANCE_UPDATED]],
      eventsMeta: [],
    });

    const graphName = genID('fedGraph');
    await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], DEFAULT_ROUTER_URL);
    await client.deleteFederatedGraph({ name: graphName, namespace: DEFAULT_NAMESPACE });

    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(capturedWebhooks).toHaveLength(0);
  });

  test('a monograph publish names the composed schema version it produced', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const monographName = genID('monograph');
    await client.createMonograph({
      name: monographName,
      namespace: DEFAULT_NAMESPACE,
      graphUrl: 'http://localhost:4000',
      routingUrl: 'http://localhost:3002',
    });
    const monograph = await client.getFederatedGraphByName({ name: monographName, namespace: DEFAULT_NAMESPACE });
    const monographId = monograph.graph?.id ?? '';

    await client.createOrganizationWebhookConfig({
      endpoint: webhookUrl,
      events: [OrganizationEventName[OrganizationEventName.MONOGRAPH_SCHEMA_UPDATED]],
      eventsMeta: [
        {
          eventName: OrganizationEventName.MONOGRAPH_SCHEMA_UPDATED,
          meta: { case: 'monographSchemaUpdated', value: { graphIds: [monographId] } },
        },
      ],
    });

    const publishResponse = await client.publishMonograph({
      name: monographName,
      namespace: DEFAULT_NAMESPACE,
      schema: 'type Query { hello: String }',
    });
    expect(publishResponse.response?.code).toBe(EnumStatusCode.OK);

    await vi.waitFor(() => {
      expect(capturedWebhooks).toHaveLength(1);
    });

    const payload = capturedWebhooks[0].payload as { monograph: Record<string, string>; errors: boolean };
    expect(capturedWebhooks[0].event).toBe('MONOGRAPH_SCHEMA_UPDATED');
    expect(payload.errors).toBe(false);
    expect(payload.monograph).toEqual({
      id: monographId,
      name: monographName,
      namespace: DEFAULT_NAMESPACE,
      composedSchemaVersionId: expect.stringMatching(/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/),
    });
  });
});
