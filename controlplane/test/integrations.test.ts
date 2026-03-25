import { PartialMessage } from '@bufbuild/protobuf';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { EventMeta, OrganizationEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../src/core/test-util.js';
import { COMPOSITION_IGNORE_EXTERNAL_KEYS_FEATURE_ID } from '../src/types/index.js';
import { createNamespace, resolvabilitySDLOne, resolvabilitySDLTwo, SetupTest } from './test-util.js';

let dbname = '';

describe('Federated Graph', (ctx) => {
  const mockServer = setupServer(
    http.post('https://slack.com/api/oauth.v2.access', () => {
      return HttpResponse.json({
        access_token: 'test',
        authed_user: { id: '1' },
        team: {
          id: '1',
          name: 'test',
        },
        incoming_webhook: {
          channel_id: '1',
          channel: 'test',
          url: 'http://localhost:1234',
        },
      });
    }),
  );

  afterEach(() => mockServer.resetHandlers());

  beforeAll(async () => {
    mockServer.listen({ onUnhandledRequest: 'bypass' });
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    mockServer.resetHandlers();
    await afterAllSetup(dbname);
  });

  test('Webhook meta for monograph and federated graph should be stored and retrieved correctly', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const monographName = genID('monograph');
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel();

    const createFedGraphRes = await client.createFederatedGraph({
      name: fedGraphName,
      namespace: 'default',
      routingUrl: 'http://localhost:8080',
      labelMatchers: [joinLabel(label)],
    });
    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    const createMonographRes = await client.createMonograph({
      name: monographName,
      namespace: 'default',
      routingUrl: 'http://localhost:8081',
      graphUrl: 'http://localhost:8082',
    });
    expect(createMonographRes.response?.code).toBe(EnumStatusCode.OK);

    const federatedGraphRes = await client.getFederatedGraphByName({
      name: fedGraphName,
      namespace: 'default',
    });
    expect(federatedGraphRes.response?.code).toBe(EnumStatusCode.OK);
    const monographRes = await client.getFederatedGraphByName({
      name: monographName,
      namespace: 'default',
    });
    expect(monographRes.response?.code).toBe(EnumStatusCode.OK);

    const eventsMeta: PartialMessage<EventMeta>[] = [
      {
        eventName: OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED,
        meta: {
          case: 'federatedGraphSchemaUpdated',
          value: {
            graphIds: [federatedGraphRes.graph!.id],
          },
        },
      },
      {
        eventName: OrganizationEventName.MONOGRAPH_SCHEMA_UPDATED,
        meta: {
          case: 'monographSchemaUpdated',
          value: {
            graphIds: [monographRes.graph!.id],
          },
        },
      },
      {
        eventName: OrganizationEventName.PROPOSAL_STATE_UPDATED,
        meta: {
          case: 'proposalStateUpdated',
          value: { graphIds: [] },
        },
      },
    ];

    const webhookCreateRes = await client.createOrganizationWebhookConfig({
      endpoint: 'http://loclhost:4242',
      events: [OrganizationEventName[OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED]],
      eventsMeta,
    });
    expect(webhookCreateRes.response?.code).toBe(EnumStatusCode.OK);

    const webhooksRes = await client.getOrganizationWebhookConfigs({});
    expect(webhooksRes.response?.code).toBe(EnumStatusCode.OK);
    expect(webhooksRes.configs.length).toBe(1);

    const webhookMetaRes = await client.getOrganizationWebhookMeta({
      id: webhooksRes.configs[0].id,
    });
    expect(webhookMetaRes.response?.code).toBe(EnumStatusCode.OK);
    expect(webhookMetaRes.eventsMeta).toMatchObject(eventsMeta);
  });

  test('Slack integration meta for monograph and federated graph should be stored and retrieved correctly', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const monographName = genID('monograph');
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel();

    const createFedGraphRes = await client.createFederatedGraph({
      name: fedGraphName,
      namespace: 'default',
      routingUrl: 'http://localhost:8080',
      labelMatchers: [joinLabel(label)],
    });
    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    const createMonographRes = await client.createMonograph({
      name: monographName,
      namespace: 'default',
      routingUrl: 'http://localhost:8081',
      graphUrl: 'http://localhost:8082',
    });
    expect(createMonographRes.response?.code).toBe(EnumStatusCode.OK);

    const federatedGraphRes = await client.getFederatedGraphByName({
      name: fedGraphName,
      namespace: 'default',
    });
    expect(federatedGraphRes.response?.code).toBe(EnumStatusCode.OK);
    const monographRes = await client.getFederatedGraphByName({
      name: monographName,
      namespace: 'default',
    });
    expect(monographRes.response?.code).toBe(EnumStatusCode.OK);

    const eventsMeta: PartialMessage<EventMeta>[] = [
      {
        eventName: OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED,
        meta: {
          case: 'federatedGraphSchemaUpdated',
          value: {
            graphIds: [federatedGraphRes.graph!.id],
          },
        },
      },
      {
        eventName: OrganizationEventName.MONOGRAPH_SCHEMA_UPDATED,
        meta: {
          case: 'monographSchemaUpdated',
          value: {
            graphIds: [monographRes.graph!.id],
          },
        },
      },
    ];

    const slackIntegrationCreateRes = await client.createIntegration({
      name: 'test-slack',
      code: 'test',
      events: [OrganizationEventName[OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED]],
      eventsMeta,
      type: 'slack',
    });
    expect(slackIntegrationCreateRes.response?.code).toBe(EnumStatusCode.OK);

    const integrationsRes = await client.getOrganizationIntegrations({});
    expect(integrationsRes.response?.code).toBe(EnumStatusCode.OK);
    expect(integrationsRes.integrations.length).toBe(1);
    expect(integrationsRes.integrations[0].eventsMeta).toMatchObject(eventsMeta);
  });

  test('that resolvability validation is disabled successfully', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const namespace = genID('namespace').toLowerCase();
    await createNamespace(client, namespace);
    const fedGraphName = genID('fedGraph');

    const createFedGraphResponse = await client.createFederatedGraph({
      name: fedGraphName,
      namespace,
      routingUrl: 'http://localhost:8080',
    });
    expect(createFedGraphResponse.response?.code).toBe(EnumStatusCode.OK);

    const publishResponseOne = await client.publishFederatedSubgraph({
      name: genID('one'),
      namespace,
      routingUrl: 'http://localhost:4001',
      schema: resolvabilitySDLOne,
    });
    expect(publishResponseOne.response?.code).toBe(EnumStatusCode.OK);
    expect(publishResponseOne.compositionErrors).toHaveLength(0);

    const subgraphNameTwo = genID('two');

    const checkResponseOne = await client.checkSubgraphSchema({
      namespace,
      schema: Uint8Array.from(Buffer.from(resolvabilitySDLTwo)),
      subgraphName: subgraphNameTwo,
    });
    expect(checkResponseOne.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResponseOne.compositionErrors).toHaveLength(1);

    const checkResponseTwo = await client.checkSubgraphSchema({
      disableResolvabilityValidation: true,
      namespace,
      schema: Uint8Array.from(Buffer.from(resolvabilitySDLTwo)),
      subgraphName: subgraphNameTwo,
    });
    expect(checkResponseTwo.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResponseTwo.compositionErrors).toHaveLength(0);

    const publishResponseTwo = await client.publishFederatedSubgraph({
      name: subgraphNameTwo,
      namespace,
      routingUrl: 'http://localhost:4002',
      schema: resolvabilitySDLTwo,
    });
    expect(publishResponseTwo.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);
    expect(publishResponseTwo.compositionErrors).toHaveLength(2);

    const deleteResponse = await client.deleteFederatedSubgraph({
      namespace,
      subgraphName: subgraphNameTwo,
    });
    expect(deleteResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(deleteResponse.compositionErrors).toHaveLength(0);

    const publishResponseThree = await client.publishFederatedSubgraph({
      disableResolvabilityValidation: true,
      name: subgraphNameTwo,
      namespace,
      routingUrl: 'http://localhost:4002',
      schema: resolvabilitySDLTwo,
    });

    expect(publishResponseThree.response?.code).toBe(EnumStatusCode.OK);
    expect(publishResponseThree.compositionErrors).toHaveLength(0);
  });

  test('that true external entity key errors can be ignored with the composition feature flag', async (testContext) => {
    const namespace = genID('namespace').toLowerCase();
    const label = genUniqueLabel();
    const graphName = genID('fedGraph');
    const externalKeySubgraphName = genID('external-key');
    const keySourceSubgraphName = genID('key-source');
    const externalKeySDL = `
      type Entity @key(fields: "id") {
        id: ID! @external
      }

      type Query {
        entities: [Entity!]!
      }
    `;
    const keySourceSDL = `
      type Entity @key(fields: "id") {
        id: ID!
        name: String!
      }
    `;

    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    await createNamespace(client, namespace);

    const publishExternalKeySubgraph = await client.publishFederatedSubgraph({
      name: externalKeySubgraphName,
      namespace,
      labels: [label],
      routingUrl: 'http://localhost:4001',
      schema: externalKeySDL,
    });
    expect(publishExternalKeySubgraph.response?.code).toBe(EnumStatusCode.OK);

    const publishKeySourceSubgraph = await client.publishFederatedSubgraph({
      name: keySourceSubgraphName,
      namespace,
      labels: [label],
      routingUrl: 'http://localhost:4002',
      schema: keySourceSDL,
    });
    expect(publishKeySourceSubgraph.response?.code).toBe(EnumStatusCode.OK);

    const createGraphWithoutFeature = await client.createFederatedGraph({
      name: graphName,
      namespace,
      routingUrl: 'http://localhost:8080',
      labelMatchers: [joinLabel(label)],
    });
    expect(createGraphWithoutFeature.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);
    expect(createGraphWithoutFeature.compositionErrors).toHaveLength(3);

    const { client: featureClient, server: featureServer } = await SetupTest({
      dbname,
      enabledFeatures: [COMPOSITION_IGNORE_EXTERNAL_KEYS_FEATURE_ID],
    });
    testContext.onTestFinished(() => featureServer.close());

    const featureNamespace = genID('namespace').toLowerCase();
    const featureLabel = genUniqueLabel();

    await createNamespace(featureClient, featureNamespace);

    const featureExternalKeySubgraph = await featureClient.publishFederatedSubgraph({
      name: genID('external-key'),
      namespace: featureNamespace,
      labels: [featureLabel],
      routingUrl: 'http://localhost:4001',
      schema: externalKeySDL,
    });
    expect(featureExternalKeySubgraph.response?.code).toBe(EnumStatusCode.OK);

    const featureKeySourceSubgraph = await featureClient.publishFederatedSubgraph({
      name: genID('key-source'),
      namespace: featureNamespace,
      labels: [featureLabel],
      routingUrl: 'http://localhost:4002',
      schema: keySourceSDL,
    });
    expect(featureKeySourceSubgraph.response?.code).toBe(EnumStatusCode.OK);

    const createGraphWithFeature = await featureClient.createFederatedGraph({
      name: genID('fedGraph'),
      namespace: featureNamespace,
      routingUrl: 'http://localhost:8080',
      labelMatchers: [joinLabel(featureLabel)],
    });
    expect(createGraphWithFeature.response?.code).toBe(EnumStatusCode.OK);
    expect(createGraphWithFeature.compositionErrors).toHaveLength(0);
  });
});
