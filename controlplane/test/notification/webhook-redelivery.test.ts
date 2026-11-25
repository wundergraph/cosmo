import { createHmac } from 'node:crypto';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { OrganizationEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import { formatISO, subDays } from 'date-fns';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { afterAllSetup, beforeAllSetup, genID } from '../../src/core/test-util.js';
import { SetupTest } from '../test-util.js';

let dbname = '';

const webhookUrl = 'http://redelivery-webhook.test';

type ReceivedRequest = {
  body: string;
  signature: string | null;
  deliveryId: string | null;
};

describe('Webhook redelivery', () => {
  const received: ReceivedRequest[] = [];

  const mockServer = setupServer(
    http.post(webhookUrl, async ({ request }) => {
      received.push({
        body: await request.text(),
        signature: request.headers.get('x-cosmo-signature-256'),
        deliveryId: request.headers.get('x-cosmo-delivery-id'),
      });
      return HttpResponse.json({ success: true });
    }),
  );

  beforeAll(async () => {
    mockServer.listen({ onUnhandledRequest: 'bypass' });
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    mockServer.close();
    await afterAllSetup(dbname);
  });

  test('a redelivery is signed with the webhook secret and keeps the delivery id', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, enabledFeatures: ['rbac'] });
    testContext.onTestFinished(() => server.close());

    const createResponse = await client.createOrganizationWebhookConfig({
      endpoint: webhookUrl,
      key: 'first-secret',
      events: [OrganizationEventName[OrganizationEventName.ORGANIZATION_GOVERNANCE_UPDATED]],
      eventsMeta: [],
    });
    expect(createResponse.response?.code).toBe(EnumStatusCode.OK);

    await client.createOrganizationGroup({ name: genID('team'), description: '' });

    await vi.waitFor(() => {
      expect(received).toHaveLength(1);
    });

    const [firstDelivery] = received;
    expect(firstDelivery.signature).toBe(createHmac('sha256', 'first-secret').update(firstDelivery.body).digest('hex'));
    expect(firstDelivery.deliveryId).toMatch(/^[\da-f-]{36}$/);

    // A rotated secret signs the redelivery, as it would sign a first delivery now.
    const configs = await client.getOrganizationWebhookConfigs({});
    const updateResponse = await client.updateOrganizationWebhookConfig({
      id: configs.configs[0].id,
      endpoint: webhookUrl,
      key: 'second-secret',
      shouldUpdateKey: true,
      events: [OrganizationEventName[OrganizationEventName.ORGANIZATION_GOVERNANCE_UPDATED]],
      eventsMeta: [],
    });
    expect(updateResponse.response?.code).toBe(EnumStatusCode.OK);

    // The delivery is recorded once its response arrives.
    const deliveryId = await vi.waitFor(async () => {
      const history = await client.getOrganizationWebhookHistory({
        pagination: { limit: 10, offset: 0 },
        dateRange: { start: formatISO(subDays(new Date(), 1)), end: formatISO(new Date()) },
      });
      expect(history.deliveries).toHaveLength(1);
      return history.deliveries[0].id;
    });

    const redeliverResponse = await client.redeliverWebhook({ id: deliveryId });
    expect(redeliverResponse.response?.code).toBe(EnumStatusCode.OK);

    expect(received).toHaveLength(2);
    const redelivery = received[1];
    expect(redelivery.body).toBe(firstDelivery.body);
    expect(redelivery.signature).toBe(createHmac('sha256', 'second-secret').update(redelivery.body).digest('hex'));
    expect(redelivery.deliveryId).toBe(firstDelivery.deliveryId);
  });
});
